"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

export interface IllustrationsProps {
  lesson: { id: string; epoch: number; board?: { revision: number } };
  available: boolean;
  estimateUsd: number | null;
  api: (route: string, method?: string, body?: any) => Promise<any>;
}

export interface IllustrationItem {
  id: string;
  title: string;
  prompt: string;
  purpose: string;
  status: "queued" | "generating" | "ready" | "failed" | "cancelled" | "stale";
  imageUrl?: string;
  model: string;
  fixture: boolean;
  estimateUsd: number | null;
  message?: string;
  costState?: "reserved" | "estimated" | "unknown" | "released";
}

const pending = (item: IllustrationItem) =>
  item.status === "queued" || item.status === "generating";
const statusText: Record<IllustrationItem["status"], string> = {
  queued: "Waiting to generate",
  generating: "Generating image",
  ready: "Ready",
  failed: "Generation failed",
  cancelled: "Cancelled",
  stale: "Earlier lesson turn",
};
const errorText = (error: unknown) =>
  (error instanceof Error
    ? error.message
    : "This request could not finish."
  ).slice(0, 300);
const estimateText = (amount: number | null) =>
  typeof amount === "number" && Number.isFinite(amount) && amount >= 0
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(amount)
    : null;

/** An authenticated API read is the sole image source; provider URLs are never embedded. */
function imagePath(lessonId: string, item: IllustrationItem) {
  const expected = `/api/lessons/${encodeURIComponent(lessonId)}/illustrations/${encodeURIComponent(item.id)}/content`;
  return item.imageUrl === expected ? expected : null;
}

export default function Illustrations(props: IllustrationsProps) {
  // Navigating between lessons must never retain the prior lesson's images or draft.
  return <IllustrationPanel key={props.lesson.id} {...props} />;
}

function IllustrationPanel({
  lesson,
  available,
  estimateUsd,
  api,
}: IllustrationsProps) {
  const uid = useId();
  const route = `/api/lessons/${encodeURIComponent(lesson.id)}/illustrations`;
  const [items, setItems] = useState<IllustrationItem[]>([]);
  const [capability, setCapability] = useState<{
    available: boolean;
    estimateUsd: number | null;
  } | null>(null);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [purpose, setPurpose] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [requestError, setRequestError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [removing, setRemoving] = useState<string[]>([]);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const apiRef = useRef(api);
  const alive = useRef(true);
  const epoch = useRef(lesson.epoch);
  const sending = useRef(false);
  const deleting = useRef(new Set<string>());
  const prepared = useRef<{
    actionId: string;
    sessionId: string;
    turnEpoch: number;
    type: "illustration.generate";
    targetId: string;
    expectedRevision: number;
    args: { prompt: string; purpose: string; title: string };
  } | null>(null);
  apiRef.current = api;
  epoch.current = lesson.epoch;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    prepared.current = null;
    setUncertain(false);
    setRequestError("");
  }, [lesson.epoch]);

  useEffect(() => {
    let ignore = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    async function load() {
      try {
        const data = await apiRef.current(route);
        if (ignore) return;
        if (!Array.isArray(data.items))
          throw Error(
            "Illustration status could not be read. Refresh to try again.",
          );
        const next = data.items as IllustrationItem[];
        setItems(next);
        setCapability({
          available: data.available === true,
          estimateUsd: data.estimateUsd ?? null,
        });
        setLoadError("");
        if (
          !sending.current &&
          prepared.current &&
          next.some((item) => item.id === prepared.current?.targetId)
        ) {
          prepared.current = null;
          setUncertain(false);
          setRequestError("");
        }
        // No requests run in the background once all jobs have settled.
        if (next.some(pending)) timer = setTimeout(() => void load(), 1000);
      } catch (error) {
        if (!ignore)
          setLoadError(
            `${errorText(error)} Refresh illustrations to check again.`,
          );
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void load();
    return () => {
      ignore = true;
      if (timer) clearTimeout(timer);
    };
  }, [route, lesson.epoch, refresh]);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || !(capability?.available ?? available)) return;
    const clean = {
      title: title.trim(),
      prompt: prompt.trim(),
      purpose: purpose.trim(),
    };
    if (!clean.title || !clean.prompt || !clean.purpose) {
      setRequestError(
        "Add a title, an image description and a learning purpose.",
      );
      return;
    }
    const action = prepared.current ?? {
      actionId: crypto.randomUUID(),
      sessionId: lesson.id,
      turnEpoch: lesson.epoch,
      type: "illustration.generate" as const,
      targetId: crypto.randomUUID(),
      expectedRevision: lesson.board?.revision ?? 0,
      args: clean,
    };
    prepared.current = action;
    sending.current = true;
    setSubmitting(true);
    setRequestError("");
    const requestEpoch = lesson.epoch;
    try {
      await apiRef.current(
        `/api/lessons/${encodeURIComponent(lesson.id)}/actions`,
        "POST",
        action,
      );
      if (!alive.current || epoch.current !== requestEpoch) return;
      prepared.current = null;
      setUncertain(false);
      setRefresh((value) => value + 1);
    } catch (error) {
      if (!alive.current || epoch.current !== requestEpoch) return;
      // A lost acknowledgement retries exactly the same action and payload.
      setUncertain(true);
      setRequestError(
        `${errorText(error)} Check status or retry the same request.`,
      );
      setRefresh((value) => value + 1);
    } finally {
      sending.current = false;
      if (alive.current) setSubmitting(false);
    }
  }

  async function remove(item: IllustrationItem) {
    if (deleting.current.has(item.id)) return;
    deleting.current.add(item.id);
    setRemoving([...deleting.current]);
    setRequestError("");
    try {
      await apiRef.current(`${route}/${encodeURIComponent(item.id)}`, "DELETE");
      if (!alive.current) return;
      setItems((current) =>
        current.filter((existing) => existing.id !== item.id),
      );
      setRefresh((value) => value + 1);
    } catch (error) {
      if (alive.current) setRequestError(errorText(error));
    } finally {
      deleting.current.delete(item.id);
      if (alive.current) setRemoving([...deleting.current]);
    }
  }

  const enabled = capability?.available ?? available;
  const estimate = estimateText(
    capability ? capability.estimateUsd : estimateUsd,
  );
  const pendingCount = items.filter(pending).length;
  const readyCount = items.filter((item) => item.status === "ready").length;
  const unavailableImages = items.filter(
    (item) =>
      item.status === "ready" &&
      (!imagePath(lesson.id, item) || failedImages.includes(item.id)),
  ).length;
  const summary = loading
    ? "Checking illustration status."
    : unavailableImages
      ? "An illustration image could not be loaded. Refresh its status or remove it."
      : pendingCount
        ? `${pendingCount} illustration ${pendingCount === 1 ? "request is" : "requests are"} in progress.`
        : readyCount
          ? `${readyCount} ${readyCount === 1 ? "illustration is" : "illustrations are"} ready.`
          : items.length
            ? "Illustration requests are up to date."
            : "No illustrations requested yet.";

  return (
    <section className="illustration-panel" aria-labelledby={`${uid}-heading`}>
      <div className="illustration-heading">
        <h3 id={`${uid}-heading`}>Optional illustrations</h3>
        <button
          type="button"
          className="illustration-secondary"
          onClick={() => {
            setFailedImages([]);
            setRefresh((value) => value + 1);
          }}
        >
          Refresh illustrations
        </button>
      </div>
      <details className="illustration-request">
        <summary>Create an illustration</summary>
        <p id={`${uid}-intro`} className="illustration-note">
          Describe a conceptual image and how it would help you understand the
          idea. Provider requests send your description and learning purpose to
          Black Forest Labs.
        </p>
        {!enabled && (
          <p className="illustration-unavailable">
            Illustration generation is unavailable for this lesson.
          </p>
        )}
        <form
          className="illustration-form"
          onSubmit={generate}
          aria-describedby={`${uid}-intro ${uid}-cost`}
        >
          <fieldset disabled={!enabled || submitting || uncertain}>
            <legend className="illustration-legend">
              Request an illustration
            </legend>
            <label htmlFor={`${uid}-title`}>
              Illustration title
              <input
                id={`${uid}-title`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={80}
                autoComplete="off"
                placeholder="Sampling from a jar"
              />
            </label>
            <label htmlFor={`${uid}-prompt`}>
              What should the image show?
              <textarea
                id={`${uid}-prompt`}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                required
                maxLength={1200}
                rows={3}
                placeholder="Two jars with colored counters to picture random sampling."
              />
            </label>
            <label htmlFor={`${uid}-purpose`}>
              What should this help you understand?
              <textarea
                id={`${uid}-purpose`}
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                required
                maxLength={300}
                rows={2}
                placeholder="How a sample can differ from the population."
              />
            </label>
          </fieldset>
          <div className="illustration-controls">
            <button type="submit" disabled={!enabled || submitting}>
              {submitting
                ? "Requesting illustration…"
                : uncertain
                  ? "Retry same request"
                  : "Generate illustration"}
              {!submitting && estimate ? ` (about ${estimate})` : ""}
            </button>
            <p id={`${uid}-cost`} className="illustration-note">
              {estimate
                ? "Estimated cost per illustration; actual provider billing may differ."
                : "Cost estimate unavailable."}
            </p>
          </div>
        </form>
      </details>
      <p
        className="illustration-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {(requestError || loadError || summary).slice(0, 400)}
      </p>
      {items.length > 0 && (
        <ul className="illustration-list">
          {items.map((item) => {
            const src =
              item.status === "ready" ? imagePath(lesson.id, item) : null;
            const imageFailed = failedImages.includes(item.id);
            return (
              <li className="illustration-item" key={item.id}>
                <div className="illustration-item-heading">
                  <h4>{item.title}</h4>
                  <span className="illustration-item-status">
                    {statusText[item.status]}
                  </span>
                </div>
                {item.fixture && (
                  <p className="illustration-fixture">
                    Development fixture: no image provider was called.
                  </p>
                )}
                <p className="illustration-purpose">{item.purpose}</p>
                {item.status === "ready" && src && !imageFailed && (
                  <figure className="illustration-figure">
                    {/* Authenticated, revocable bytes bypass the public image optimizer. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={() =>
                        setFailedImages((current) =>
                          current.includes(item.id)
                            ? current
                            : [...current, item.id],
                        )
                      }
                    />
                    <figcaption>
                      {item.fixture
                        ? "Illustration development fixture"
                        : "AI-generated illustration"}
                    </figcaption>
                  </figure>
                )}
                {item.status === "ready" && (!src || imageFailed) && (
                  <p className="illustration-message">
                    The illustration image could not be loaded. Refresh its
                    status or remove it.
                  </p>
                )}
                {item.message && (
                  <p className="illustration-message">
                    {item.message.slice(0, 300)}
                  </p>
                )}
                {item.status === "stale" && !item.message && (
                  <p className="illustration-message">
                    This request belongs to an earlier lesson turn.
                  </p>
                )}
                <p className="illustration-model">
                  {item.model}
                  {item.costState === "unknown"
                    ? ` · charge unconfirmed${estimateText(item.estimateUsd) ? `; provision ${estimateText(item.estimateUsd)}` : ""}`
                    : estimateText(item.estimateUsd)
                      ? ` · estimated ${estimateText(item.estimateUsd)}`
                      : ""}
                </p>
                <button
                  type="button"
                  className="illustration-secondary"
                  disabled={removing.includes(item.id)}
                  aria-label={`${pending(item) ? "Cancel" : "Remove"} illustration ${item.title}`}
                  onClick={() => void remove(item)}
                >
                  {removing.includes(item.id)
                    ? "Updating request…"
                    : pending(item)
                      ? "Cancel request"
                      : "Remove illustration"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
