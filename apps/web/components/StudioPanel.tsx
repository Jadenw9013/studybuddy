"use client";

import { useEffect, useRef, useState } from "react";
import type {
  StudioArtifact,
  StudioCitation,
  StudioKind,
  StudioProgress,
} from "../../api/src/studio";
import RichText from "./RichText";
import Icon from "./Icon";
import { fetchApiResponse, readApiJson } from "./api-response";

type Artifact = Omit<
  StudioArtifact,
  "requestFingerprint" | "epoch" | "selectionRevision"
> & { earlierSourceVersion?: boolean };
export interface StudioPanelProps {
  lessonId: string;
  onCitation: (citation: StudioCitation) => void;
  onUpdate?: () => void;
  disabled?: boolean;
}
async function request(
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
) {
  const response = await fetchApiResponse(url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  return readApiJson(response, "This study tool could not be loaded.");
}
function location(c: StudioCitation) {
  const p = c.locator;
  return p.pageIndex !== undefined
    ? `page ${Number(p.pageIndex) + 1}`
    : p.physicalPage
      ? `page ${p.physicalPage}`
      : p.cellId
        ? "notebook cell"
        : p.section
          ? String(p.section)
          : p.rowStart
            ? `rows ${p.rowStart}–${p.rowEnd ?? p.rowStart}`
            : p.lineStart
              ? `lines ${p.lineStart}–${p.lineEnd ?? p.lineStart}`
              : "source excerpt";
}

export default function StudioPanel({
  lessonId,
  onCitation,
  onUpdate,
  disabled = false,
}: StudioPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]),
    [activeId, setActiveId] = useState<string>(),
    [focus, setFocus] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [flipped, setFlipped] = useState(false);
  const currentLesson = useRef(lessonId);
  const readerRef = useRef<HTMLElement>(null);
  const [revealEpoch, setRevealEpoch] = useState(0);
  useEffect(() => {
    if (revealEpoch)
      readerRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [activeId, revealEpoch]);
  currentLesson.current = lessonId;
  const base = `/api/lessons/${lessonId}/studio`;
  const accept = (a: Artifact) => {
    if (a.id !== activeId) setRevealEpoch((value) => value + 1);
    setArtifacts((rows) =>
      rows.some((row) => row.id === a.id)
        ? rows.map((row) => (row.id === a.id ? a : row))
        : [...rows, a],
    );
    setActiveId(a.id);
  };
  useEffect(() => {
    const controller = new AbortController();
    setArtifacts([]);
    setActiveId(undefined);
    setError("");
    setLoading(true);
    setBusy(false);
    setFlipped(false);
    void request(base, "GET", undefined, controller.signal)
      .then((data) => {
        setArtifacts(data.artifacts);
        setActiveId(
          data.artifacts.find((a: Artifact) => a.status === "ready")?.id,
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base]);
  const pending = artifacts.some((a) => a.status === "generating");
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController(),
      timer = setInterval(() => {
        void request(base, "GET", undefined, controller.signal)
          .then((data) => setArtifacts(data.artifacts))
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message);
          });
      }, 1500);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [base, pending]);
  const active = artifacts.find((a) => a.id === activeId),
    items =
      active?.content?.cards ??
      active?.content?.questions ??
      active?.content?.sections ??
      [],
    cursor = Math.min(
      active?.progress.cursor ?? 0,
      Math.max(0, items.length - 1),
    );
  async function generate(kind: StudioKind) {
    const captured = lessonId;
    setBusy(true);
    setError("");
    try {
      const data = await request(base, "POST", {
        requestId: crypto.randomUUID(),
        kind,
        focus: focus.trim(),
      });
      if (currentLesson.current === captured) {
        accept(data.artifact);
        setFlipped(false);
        onUpdate?.();
      }
    } catch (e: any) {
      if (currentLesson.current === captured) {
        setError(e.message);
        try {
          const data = await request(base);
          if (currentLesson.current === captured) setArtifacts(data.artifacts);
        } catch {}
      }
    } finally {
      if (currentLesson.current === captured) setBusy(false);
    }
  }
  async function progress(update: Partial<StudioProgress>) {
    if (!active) return;
    const captured = lessonId;
    setBusy(true);
    setError("");
    try {
      const data = await request(`${base}/${active.id}/progress`, "PATCH", {
        expectedRevision: active.revision,
        ...update,
      });
      if (currentLesson.current === captured) {
        accept(data.artifact);
        setFlipped(false);
      }
    } catch (e: any) {
      if (currentLesson.current === captured) setError(e.message);
    } finally {
      if (currentLesson.current === captured) setBusy(false);
    }
  }
  async function remove() {
    if (!active) return;
    const captured = lessonId;
    setBusy(true);
    setError("");
    try {
      await request(`${base}/${active.id}`, "DELETE");
      if (currentLesson.current === captured) {
        setArtifacts((rows) => rows.filter((a) => a.id !== active.id));
        setActiveId(undefined);
        onUpdate?.();
      }
    } catch (e: any) {
      if (currentLesson.current === captured) setError(e.message);
    } finally {
      if (currentLesson.current === captured) setBusy(false);
    }
  }
  const citations = (refs: StudioCitation[]) => (
    <div className="studio-citations">
      {refs.map((c) => (
        <button
          key={c.passageId}
          className="citation"
          type="button"
          onClick={() => onCitation(c)}
        >
          {c.filename} · {location(c)}
        </button>
      ))}
    </div>
  );
  const controls =
    items.length > 1 ? (
      <div className="studio-actions">
        <button
          className="secondary"
          disabled={busy || cursor === 0}
          onClick={() => void progress({ cursor: cursor - 1 })}
        >
          Previous
        </button>
        <span>
          {cursor + 1} of {items.length}
        </span>
        <button
          className="secondary"
          disabled={busy || cursor === items.length - 1}
          onClick={() => void progress({ cursor: cursor + 1 })}
        >
          Next
        </button>
      </div>
    ) : null;
  const card = active?.content?.cards?.[cursor],
    question = active?.content?.questions?.[cursor],
    answer = question ? active?.progress.answers[question.id] : undefined;
  return (
    <section className="studio-panel" aria-label="Study tools">
      <div className="studio-heading">
        <h2>Studio</h2>
        <p>Turn your selected sources into study tools.</p>
      </div>
      <label className="studio-focus">
        Focus (optional)
        <input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          maxLength={500}
          placeholder="A topic or learning goal"
          disabled={busy || pending || disabled}
        />
      </label>
      <div className="studio-tiles">
        {(
          [
            ["guide", "Study guide", "Key ideas and a study sequence"],
            ["flashcards", "Flashcards", "Recall, reveal, and mark known"],
            ["quiz", "Quiz", "Check your understanding"],
          ] as const
        ).map(([kind, label, description]) => (
          <button
            type="button"
            className="studio-tile"
            data-kind={kind}
            key={kind}
            aria-label={`Generate ${label.toLowerCase()}`}
            disabled={busy || pending || loading || disabled}
            onClick={() => void generate(kind)}
          >
            <Icon
              name={
                kind === "guide"
                  ? "note"
                  : kind === "flashcards"
                    ? "cards"
                    : "quiz"
              }
              size={21}
            />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </button>
        ))}
      </div>
      {disabled ? (
        <p className="studio-empty">
          Select a ready source to create study tools.
        </p>
      ) : null}
      {error ? (
        <p className="studio-error" role="alert">
          {error}
        </p>
      ) : null}
      {busy || pending ? (
        <p role="status">
          Preparing your study tool… You can keep studying while it is saved.
        </p>
      ) : null}
      {loading ? <p role="status">Loading saved study tools…</p> : null}
      {!loading && !artifacts.length ? (
        <p className="studio-empty">Your saved study tools will appear here.</p>
      ) : null}
      <div className="studio-artifacts" aria-label="Saved study tools">
        {artifacts.map((a) => (
          <button
            key={a.id}
            className={`studio-artifact-item${activeId === a.id ? " selected" : ""}`}
            aria-pressed={activeId === a.id}
            onClick={() => {
              setActiveId(a.id);
              setRevealEpoch((value) => value + 1);
              setFlipped(false);
            }}
          >
            <strong>{a.title}</strong>
            <span>
              {a.status === "failed"
                ? "Could not finish"
                : a.status === "generating"
                  ? "Preparing…"
                  : a.kind === "guide"
                    ? "Study guide"
                    : a.kind === "quiz"
                      ? "Quiz"
                      : "Flashcards"}
            </span>
          </button>
        ))}
      </div>
      {active ? (
        <article
          ref={readerRef}
          className="studio-reader"
          aria-label={active.title}
        >
          <div className="studio-heading">
            <h3>{active.title}</h3>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove study tool
            </button>
          </div>
          {active.fixture ? (
            <p className="studio-badge">
              Development fixture · source excerpts, not a live provider result
            </p>
          ) : null}
          <p className="studio-coverage">
            Created from {active.coverage.usedSourceCount} of{" "}
            {active.coverage.selectedSourceCount} selected sources ·{" "}
            {active.coverage.passageCount} excerpts
          </p>
          <details>
            <summary>Sources used when created</summary>
            <ul>
              {active.sourceVersions.map((s) => (
                <li key={s.versionId}>{s.filename}</li>
              ))}
            </ul>
          </details>
          {active.earlierSourceVersion ? (
            <p>
              Uses an earlier saved source version. Its citations still open
              that version.
            </p>
          ) : null}
          {active.status === "failed" ? (
            <p className="studio-error" role="status">
              {active.error?.message ??
                "This artifact could not finish. Create a new request when you are ready."}
            </p>
          ) : null}
          {active.content?.sections?.map((section) => (
            <section key={section.id}>
              <h4>{section.heading}</h4>
              <RichText text={section.text} />
              {citations(section.citations)}
            </section>
          ))}
          {card ? (
            <div className="studio-card">
              <p>
                Card {cursor + 1} of {items.length}
                {active.progress.knownCardIds.includes(card.id)
                  ? " · Known"
                  : ""}
              </p>
              <RichText text={card.front} />
              <button
                className="secondary"
                onClick={() => setFlipped((v) => !v)}
                aria-expanded={flipped}
              >
                {flipped ? "Hide answer" : "Reveal answer"}
              </button>
              {flipped ? (
                <>
                  <RichText text={card.back} />
                  {citations(card.citations)}
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void progress({
                        knownCardIds: active.progress.knownCardIds.includes(
                          card.id,
                        )
                          ? active.progress.knownCardIds.filter(
                              (id) => id !== card.id,
                            )
                          : [...active.progress.knownCardIds, card.id],
                      })
                    }
                  >
                    {active.progress.knownCardIds.includes(card.id)
                      ? "Study again"
                      : "Mark known"}
                  </button>
                </>
              ) : null}
              {controls}
            </div>
          ) : null}
          {question ? (
            <div className="studio-quiz">
              <p>
                Self-study check · saved separately from independent practice
              </p>
              <RichText text={question.prompt} />
              <div className="studio-options">
                {question.options.map((option, index) => (
                  <button
                    className="secondary"
                    key={index}
                    disabled={busy || answer !== undefined}
                    aria-pressed={answer === index}
                    onClick={() =>
                      void progress({ answers: { [question.id]: index } })
                    }
                  >
                    <span>{String.fromCharCode(65 + index)}. </span>
                    {option}
                  </button>
                ))}
              </div>
              {answer !== undefined ? (
                <div className="studio-feedback" role="status">
                  <strong>
                    {answer === question.correctIndex
                      ? "Correct"
                      : "Review this idea"}{" "}
                    · answer {String.fromCharCode(65 + question.correctIndex)}
                  </strong>
                  <RichText text={question.explanation} />
                  {citations(question.citations)}
                </div>
              ) : null}
              {controls}
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
