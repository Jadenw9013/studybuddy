/* Browser-owned PCM capture. No model-generated code is executed here. */
class TutorCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.cursor = 0;
    this.batch = new Int16Array(320); // 20ms at 16kHz.
    this.offset = 0;
    this.stopped = false;
    this.port.onmessage = event => {
      if (event.data?.type === 'stop') { this.stopped = true; this.pending = []; }
    };
  }
  process(inputs) {
    if (this.stopped) return false;
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    // Linear resampling with a persistent fractional position avoids assuming
    // the requested AudioContext sample rate was accepted by the device.
    this.pending.push(...channel);
    const step = sampleRate / 16000;
    while (this.cursor + 1 < this.pending.length) {
      const index = Math.floor(this.cursor);
      const fraction = this.cursor - index;
      const sample = this.pending[index] * (1 - fraction) + this.pending[index + 1] * fraction;
      this.batch[this.offset++] = Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767));
      this.cursor += step;
      if (this.offset === this.batch.length) {
        this.port.postMessage(this.batch.buffer, [this.batch.buffer]);
        this.batch = new Int16Array(320);
        this.offset = 0;
      }
    }
    const consumed = Math.min(Math.floor(this.cursor), this.pending.length - 1);
    this.pending.splice(0, consumed);
    this.cursor -= consumed;
    return true;
  }
}
registerProcessor('tutor-capture', TutorCapture);
