"use client";

// Providers can generate speech faster than realtime. Buffer ordinary bursts
// without interpreting them as learner interruption; still bound PCM and nodes.
const MAX_BUFFERED_AUDIO_SECONDS = 60;
const MAX_BUFFERED_AUDIO_CHUNKS = 4096;

/** Browser media lifecycle. Provider credentials and tool authority stay in Fastify. */
export class LiveAudio {
  ws?: WebSocket;
  mic?: MediaStream;
  context?: AudioContext;
  worklet?: AudioWorkletNode;
  source?: MediaStreamAudioSourceNode;
  private silentOutput?: GainNode;
  playing = new Set<AudioBufferSourceNode>();
  next = 0;
  epoch = 0;
  closed = true;
  reconnects = 0;
  private lifecycle = 0;
  private heartbeat?: ReturnType<typeof setInterval>;
  private pending?: AbortController;
  private serverReady = false;
  private awaitingEpoch = false;
  private captionSpeaker = "";
  private captionText = "";
  private newCaptionTurn = true;
  private providerListening = false;
  private lessonId = "";
  private apiOrigin = "";
  private readonly leave = () => this.stop();

  constructor(
    public state: (status: string) => void,
    public caption: (text: string) => void,
    public tool: (event?:Record<string,any>) => void,
  ) {}

  clear() {
    for (const node of this.playing) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        /* already ended */
      }
      node.disconnect();
    }
    this.playing.clear();
    this.next = 0;
  }

  async start(lessonId: string, apiOrigin: string) {
    this.stop();
    this.closed = false;
    const lifecycle = ++this.lifecycle;
    this.lessonId = lessonId;
    this.apiOrigin = apiOrigin;
    this.epoch = 0;
    this.reconnects = 0;
    this.pending = new AbortController();
    const current = () => !this.closed && lifecycle === this.lifecycle;
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof AudioContext === "undefined"
      )
        throw new Error(
          "Microphone audio is unavailable. Continue this lesson by typing.",
        );
      this.context = new AudioContext();
      await this.context.resume();
      if (!current()) return;
      // An unavailable/fixture provider fails before asking for microphone access.
      let ticket = await this.ticket();
      if (!current()) return;
      this.state(
        "Allow the microphone to start voice. You can continue by typing.",
      );
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (!current()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.mic = stream;
      for (const track of stream.getAudioTracks())
        track.onended = () => {
          if (!this.closed) {
            this.stop();
            this.state(
              "Microphone stopped. Continue by typing or start voice again.",
            );
          }
        };
      await this.context!.audioWorklet.addModule("/audio/capture-worklet.js");
      if (!current()) return;
      // Permission dialogs can outlast the short-lived ticket. Refresh before upgrade.
      if (ticket.expiresAt <= Date.now() + 3000) ticket = await this.ticket();
      if (!current()) return;
      this.source = this.context!.createMediaStreamSource(stream);
      this.worklet = new AudioWorkletNode(this.context!, "tutor-capture");
      this.silentOutput = this.context!.createGain();
      this.silentOutput.gain.value = 0;
      this.source.connect(this.worklet);
      this.worklet.connect(this.silentOutput);
      this.silentOutput.connect(this.context!.destination);
      this.worklet.port.onmessage = (event) => {
        if (
          !current() ||
          !this.serverReady ||
          this.awaitingEpoch ||
          this.ws?.readyState !== WebSocket.OPEN
        )
          return;
        if (
          !(event.data instanceof ArrayBuffer) ||
          event.data.byteLength !== 640
        )
          return;
        if (this.ws.bufferedAmount > 128_000) {
          this.stop();
          this.state(
            "Audio connection is too slow. Your saved lesson is available by text.",
          );
          return;
        }
        this.ws.send(event.data);
      };
      window.addEventListener("pagehide", this.leave);
      await this.connectSocket(ticket.wsPath, lifecycle);
    } catch (error) {
      if (!current()) return;
      this.stop();
      if (error instanceof DOMException && error.name === "NotAllowedError")
        throw new Error(
          "Microphone permission was denied. You can finish this lesson by typing.",
        );
      throw error;
    }
  }

  private async ticket(): Promise<{ wsPath: string; expiresAt: number }> {
    const response = await fetch(
      `/api/lessons/${encodeURIComponent(this.lessonId)}/live-ticket`,
      {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: this.pending?.signal,
      },
    );
    const ticket = await response.json();
    if (!response.ok)
      throw new Error(
        ticket.message || "Live voice is unavailable. Continue by typing.",
      );
    if (
      typeof ticket.wsPath !== "string" ||
      !ticket.wsPath.startsWith("/live?ticket=") ||
      typeof ticket.expiresAt !== "number"
    )
      throw new Error("Voice could not start safely. Continue by typing.");
    return ticket;
  }

  private connectSocket(wsPath: string, lifecycle: number): Promise<void> {
    this.serverReady = false;
    this.state(
      this.reconnects
        ? "Reconnecting from your confirmed work…"
        : "Connecting voice…",
    );
    const origin = new URL(this.apiOrigin || window.location.origin);
    if (!["http:", "https:"].includes(origin.protocol))
      return Promise.reject(
        new Error("Voice requires the configured secure app origin."),
      );
    const url = new URL(wsPath, origin);
    url.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.ws = socket;
    return new Promise<void>((resolve, reject) => {
      let opened = false;
      const timer = setTimeout(() => {
        if (opened) return;
        reject(new Error("Voice connection timed out. Continue by typing."));
        socket.close();
      }, 10_000);
      const current = () =>
        !this.closed && lifecycle === this.lifecycle && socket === this.ws;
      socket.onopen = () => {
        opened = true;
        clearTimeout(timer);
        if (!current()) {
          socket.close();
          resolve();
          return;
        }
        clearInterval(this.heartbeat);
        this.heartbeat = setInterval(
          () => this.send({ type: "heartbeat" }),
          4000,
        );
        resolve();
      };
      socket.onmessage = (event) => {
        if (!current()) return;
        try {
          this.message(JSON.parse(String(event.data)));
        } catch {
          this.stop();
          this.state(
            "Voice received an invalid response. Your confirmed work is saved; continue by typing.",
          );
        }
      };
      socket.onerror = () => {
        if (!opened) {
          clearTimeout(timer);
          reject(new Error("Voice connection failed. Continue by typing."));
        }
      };
      socket.onclose = (event) => {
        clearTimeout(timer);
        if (!opened)
          reject(
            new Error("Voice connection could not start. Continue by typing."),
          );
        if (!current()) return;
        this.serverReady = false;
        this.clear();
        clearInterval(this.heartbeat);
        if (
          event.code === 1000 ||
          event.code === 1008 ||
          this.reconnects >= 1
        ) {
          this.stop();
          this.state(
            event.reason === "quota_exhausted"
              ? "Live minutes ended. Continue this saved lesson by typing."
              : "Voice stopped. Continue by typing or start voice again.",
          );
          return;
        }
        // One bounded reconnect. No audio, screen frames or pending actions replay.
        this.reconnects++;
        this.state(
          "Connection lost. Reconnecting once; typing remains available.",
        );
        void this.ticket()
          .then((ticket) => {
            if (current()) return this.connectSocket(ticket.wsPath, lifecycle);
          })
          .catch(() => {
            if (!this.closed && lifecycle === this.lifecycle) {
              this.stop();
              this.state(
                "Voice could not reconnect. Your confirmed work is saved; continue by typing.",
              );
            }
          });
      };
    });
  }

  private message(message: Record<string, any>) {
    if (!message || typeof message !== "object")
      throw new Error("invalid voice response");
    if (typeof message.turnEpoch === "number") {
      if (message.turnEpoch < this.epoch) return;
      if (message.turnEpoch > this.epoch) this.clear();
      this.epoch = message.turnEpoch;
    }
    if (message.type === "audio") {
      if (!this.serverReady || this.awaitingEpoch || !this.context) return;
      this.providerListening = false;
      if (typeof message.data !== "string" || message.data.length > 512_000)
        throw new Error("invalid audio");
      const rate = Number(message.sampleRate);
      if (!Number.isInteger(rate) || rate < 8000 || rate > 96000)
        throw new Error("invalid sample rate");
      const raw = atob(message.data);
      if (raw.length % 2 || !raw.length) throw new Error("invalid PCM");
      const context = this.context;
      const duration = raw.length / 2 / rate;
      if (
        Math.max(this.next, context.currentTime) + duration - context.currentTime >
          MAX_BUFFERED_AUDIO_SECONDS ||
        this.playing.size >= MAX_BUFFERED_AUDIO_CHUNKS
      ) {
        // A playback backlog is not a new student turn. End the session rather
        // than repeatedly interrupting/reconnecting and replaying its opening.
        this.stop();
        this.state(
          "Voice stopped because too much audio is waiting to play. Your confirmed work is saved; continue by typing or start voice again.",
        );
        return;
      }
      const audio = context.createBuffer(1, raw.length / 2, rate);
      const samples = audio.getChannelData(0);
      for (let index = 0; index < samples.length; index++) {
        const unsigned =
          raw.charCodeAt(index * 2) | (raw.charCodeAt(index * 2 + 1) << 8);
        samples[index] =
          (unsigned >= 32768 ? unsigned - 65536 : unsigned) / 32768;
      }
      const node = context.createBufferSource();
      node.buffer = audio;
      node.connect(context.destination);
      this.playing.add(node);
      node.onended = () => {
        this.playing.delete(node);
        node.disconnect();
        if (!this.playing.size && this.providerListening && !this.closed)
          this.state("Listening");
      };
      this.next = Math.max(this.next, context.currentTime + 0.02);
      node.start(this.next);
      this.next += audio.duration;
      this.send({ type: "metric", name: "audio_scheduled_proxy" });
      this.state("Tutor speaking");
    } else if (message.type === "caption" && typeof message.text === "string") {
      if (!this.awaitingEpoch) {
        const speaker = message.speaker === "student" ? "student" : "tutor";
        if (this.newCaptionTurn || this.captionSpeaker !== speaker) this.captionText = "";
        this.newCaptionTurn = false;
        this.captionSpeaker = speaker;
        this.captionText = (this.captionText + message.text).slice(-8000);
        this.caption(this.captionText);
      }
    } else if (message.type === "interrupted") {
      this.clear();
      this.caption("");
      this.newCaptionTurn = true;
      this.awaitingEpoch = false;
    } else if (message.type === "tool") {
      this.tool(message);
    } else if (message.type === "state") {
      const state = String(message.state);
      this.providerListening = state === "listening";
      if (state === "listening" || state === "reconnecting") this.newCaptionTurn = true;
      this.serverReady = [
        "listening",
        "speaking",
        "waiting_for_evidence",
      ].includes(state);
      if (state === "reconnecting") {
        this.clear();
        this.caption("");
      }
      if (state === "listening") this.awaitingEpoch = false;
      this.state(
        state === "listening" && this.playing.size ? "Tutor speaking" :
        (
          {
            listening: "Listening",
            connecting: "Connecting voice…",
            reconnecting: "Reconnecting from confirmed work…",
            waiting_for_evidence: "Checking course evidence…",
          } as Record<string, string>
        )[state] || state,
      );
    } else if (message.type === "quota") {
      this.state(
        `${Math.max(0, Math.floor(Number(message.remainingSeconds) || 0))} seconds of voice remain. Typing stays available.`,
      );
    } else if (message.type === "error") {
      const text =
        typeof message.message === "string"
          ? message.message
          : "Voice is unavailable. Continue by typing.";
      this.stop();
      this.state(text);
    }
  }

  send(message: Record<string, unknown>) {
    if (!this.closed && this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(message));
  }

  finishTurn() {
    this.send({ type: "audio_end" });
  }

  interrupt() {
    if (this.closed) return;
    // Silence is local and immediate; it never waits for the server round trip.
    this.clear();
    this.caption("");
    this.newCaptionTurn = true;
    this.awaitingEpoch = true;
    this.serverReady = false;
    this.send({ type: "interrupt" });
    this.state("Interrupted. Reconnecting from the last displayed step…");
  }

  reconnect() {
    if (this.closed) return;
    this.clear();
    this.caption("");
    this.newCaptionTurn = true;
    this.serverReady = false;
    this.awaitingEpoch = true;
    this.send({ type: "reconnect" });
    this.state("Reconnecting from confirmed work…");
  }

  stop() {
    if (!this.closed) this.send({ type: "end" });
    this.closed = true;
    this.lifecycle++;
    this.serverReady = false;
    this.awaitingEpoch = false;
    this.providerListening = false;
    this.newCaptionTurn = true;
    this.captionText = "";
    this.captionSpeaker = "";
    this.pending?.abort();
    this.pending = undefined;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.clear();
    this.caption("");
    for (const track of this.mic?.getTracks() || []) {
      track.onended = null;
      track.stop();
    }
    this.mic = undefined;
    if (this.worklet) {
      this.worklet.port.postMessage({ type: "stop" });
      this.worklet.port.onmessage = null;
    }
    this.source?.disconnect();
    this.worklet?.disconnect();
    this.silentOutput?.disconnect();
    this.source = undefined;
    this.worklet = undefined;
    this.silentOutput = undefined;
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
    }
    this.ws = undefined;
    void this.context?.close().catch(() => undefined);
    this.context = undefined;
    if (typeof window !== "undefined")
      window.removeEventListener("pagehide", this.leave);
  }
}
