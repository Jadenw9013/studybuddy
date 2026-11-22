"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  notebookEntries,
  openNotebook,
  renameNotebook,
  visibleNotebooks,
  type NotebookCourse,
  type NotebookFilter,
  type NotebookLesson,
  type NotebookSort,
} from "./NotebookLibrary.model";
import "./notebook-library.css";
export type { NotebookCourse, NotebookLesson } from "./NotebookLibrary.model";

export interface NotebookLibraryProps {
  courses: NotebookCourse[];
  lessons: NotebookLesson[];
  onOpenCourse: (id: string) => void;
  onOpenLesson: (id: string) => void;
  onCreate: () => void | Promise<unknown>;
  /** Persist with PATCH /api/courses/:id and reject on failure. */
  onRenameCourse: (id: string, name: string) => Promise<unknown>;
  loading?: boolean;
}
function Glyph({
  name,
}: {
  name: "book" | "plus" | "search" | "grid" | "list" | "rename" | "close";
}) {
  const paths = {
    book: "M5 3h12a2 2 0 0 1 2 2v16H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3m1 0v14m-4 1h15",
    plus: "M12 5v14M5 12h14",
    search: "M20 20l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    grid: "M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z",
    list: "M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01",
    rename: "m4 16 11-11 4 4L8 20l-5 1Zm9-9 4 4M16 4l1-1a2 2 0 0 1 3 3l-1 1",
    close: "m6 6 12 12M6 18 18 6",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
const count = (number: number, noun: string) =>
  `${number} ${noun}${number === 1 ? "" : "s"}`;
const dateLabel = (value?: string | number, timeZone = "UTC") =>
  value === undefined
    ? null
    : new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone,
      }).format(new Date(value));
const tone = (id: string) =>
  ["lilac", "mint", "sand", "rose", "blue"][
    Array.from(id).reduce(
      (sum, character) => sum + character.charCodeAt(0),
      0,
    ) % 5
  ];

export default function NotebookLibrary({
  courses,
  lessons,
  onOpenCourse,
  onOpenLesson,
  onCreate,
  onRenameCourse,
  loading = false,
}: NotebookLibraryProps) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState<NotebookFilter>("all"),
    [sort, setSort] = useState<NotebookSort>("updated");
  const [timeZone, setTimeZone] = useState("UTC");
  useEffect(
    () => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone),
    [],
  );
  const [view, setView] = useState<"grid" | "list">("grid"),
    [creating, setCreating] = useState(false),
    [actionError, setActionError] = useState("");
  const [renaming, setRenaming] = useState<NotebookCourse | null>(null),
    [draft, setDraft] = useState(""),
    [saving, setSaving] = useState(false),
    [renameError, setRenameError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    nameInput = useRef<HTMLInputElement>(null),
    renameTitle = useId();
  const entries = notebookEntries(courses, lessons),
    visible = visibleNotebooks(entries, query, filter, sort);
  useEffect(() => {
    if (!renaming) return;
    const modal = dialog.current!;
    modal.showModal();
    nameInput.current?.focus();
    nameInput.current?.select();
    return () => modal.close();
  }, [renaming?.id]);
  const create = async () => {
    if (creating) return;
    setCreating(true);
    setActionError("");
    try {
      await onCreate();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "This notebook could not be created. Try again.",
      );
    } finally {
      setCreating(false);
    }
  };
  return (
    <section className="notebook-library" aria-label="Notebook library">
      <header className="nl-header">
        <div>
          <h1>My notebooks</h1>
          <p>Keep your coursework, sources and lessons together.</p>
        </div>
        <button
          className="nl-create"
          onClick={() => void create()}
          disabled={creating || loading}
        >
          <Glyph name="plus" />
          {creating ? "Creating…" : "Create notebook"}
        </button>
      </header>
      <div className="nl-search">
        <Glyph name="search" />
        <label className="nl-sr-only" htmlFor={`${renameTitle}-search`}>
          Search notebooks
        </label>
        <input
          id={`${renameTitle}-search`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notebooks"
          disabled={loading}
        />
        {query && (
          <button
            aria-label="Clear notebook search"
            onClick={() => setQuery("")}
          >
            <Glyph name="close" />
          </button>
        )}
      </div>
      <div className="nl-toolbar">
        <div className="nl-filters" role="group" aria-label="Filter notebooks">
          {(
            [
              ["all", "All notebooks"],
              ["with-sources", "With sources"],
              ["with-lessons", "With lessons"],
              ["empty", "Empty"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              disabled={loading}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="nl-view-options">
          <label className="nl-sort">
            Sort by
            <select
              aria-label="Sort notebooks"
              value={sort}
              onChange={(event) => setSort(event.target.value as NotebookSort)}
              disabled={loading}
            >
              <option value="updated">Recently updated</option>
              <option value="name">Name A–Z</option>
              <option value="sources">Most sources</option>
            </select>
          </label>
          <div
            className="nl-view-toggle"
            role="group"
            aria-label="Notebook view"
          >
            <button
              aria-label="Grid view"
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
            >
              <Glyph name="grid" />
            </button>
            <button
              aria-label="List view"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <Glyph name="list" />
            </button>
          </div>
        </div>
      </div>
      {actionError && (
        <p className="nl-error" role="alert">
          {actionError}
        </p>
      )}
      {loading ? (
        <p className="nl-status" role="status">
          Loading notebooks…
        </p>
      ) : (
        <>
          <p className="nl-result-count" role="status">
            {query || filter !== "all"
              ? `${visible.length} of ${count(entries.length, "notebook")}`
              : count(entries.length, "notebook")}
          </p>
          {visible.length ? (
            <ul
              className={`nl-notebooks nl-${view}`}
              aria-label="Your notebooks"
            >
              {visible.map((entry) => (
                <li
                  key={entry.course.id}
                  className={`nl-notebook nl-tone-${tone(entry.course.id)}`}
                  data-course-id={entry.course.id}
                >
                  <button
                    className="nl-notebook-open"
                    aria-label={`${entry.latestLesson ? "Resume" : "Open"} notebook ${entry.course.name}`}
                    onClick={() =>
                      openNotebook(entry, { onOpenCourse, onOpenLesson })
                    }
                  >
                    <span className="nl-notebook-glyph">
                      <Glyph name="book" />
                    </span>
                    <span className="nl-notebook-name">
                      {entry.course.name}
                    </span>
                    <span className="nl-notebook-action">
                      {entry.latestLesson ? "Resume lesson" : "Open notebook"}
                    </span>
                  </button>
                  <button
                    className="nl-rename"
                    aria-label={`Rename notebook ${entry.course.name}`}
                    onClick={() => {
                      setRenaming(entry.course);
                      setDraft(entry.course.name);
                      setRenameError("");
                    }}
                  >
                    <Glyph name="rename" />
                  </button>
                  <div className="nl-notebook-meta">
                    <button
                      onClick={() => onOpenCourse(entry.course.id)}
                      aria-label={`Open sources for ${entry.course.name}`}
                    >
                      {entry.sourceCount === undefined
                        ? "Open sources"
                        : count(entry.sourceCount, "source")}
                    </button>
                    <span>{count(entry.lessonCount, "lesson")}</span>
                    {dateLabel(entry.updatedAt, timeZone) && (
                      <time dateTime={new Date(entry.updatedAt!).toISOString()}>
                        Updated {dateLabel(entry.updatedAt, timeZone)}
                      </time>
                    )}
                    {entry.sourceCount === undefined && (
                      <span className="nl-count-unknown">
                        Source count unavailable
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="nl-empty">
              <span className="nl-empty-icon">
                <Glyph name="book" />
              </span>
              <h2>
                {entries.length
                  ? "No matching notebooks"
                  : "Your first notebook starts here"}
              </h2>
              <p>
                {entries.length
                  ? "Try a different search or filter."
                  : "Create a notebook, add your sources and start a lesson."}
              </p>
              {entries.length ? (
                <button
                  className="nl-secondary"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </button>
              ) : (
                <button
                  className="nl-create"
                  onClick={() => void create()}
                  disabled={creating}
                >
                  <Glyph name="plus" />
                  Create notebook
                </button>
              )}
            </div>
          )}
        </>
      )}
      <dialog
        ref={dialog}
        className="nl-rename-dialog"
        aria-labelledby={renameTitle}
        onCancel={(event) => {
          if (saving) event.preventDefault();
          else setRenaming(null);
        }}
        onClose={() => {
          if (!dialog.current?.open) setRenaming(null);
        }}
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!renaming || saving) return;
            setSaving(true);
            setRenameError("");
            try {
              await renameNotebook(renaming, draft, onRenameCourse);
              dialog.current?.close();
            } catch (error) {
              setRenameError(
                error instanceof Error
                  ? error.message
                  : "This name could not be saved. Try again.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <h2 id={renameTitle}>Rename notebook</h2>
          <label>
            Notebook name
            <input
              ref={nameInput}
              value={draft}
              maxLength={100}
              required
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          {renameError && (
            <p className="nl-error" role="alert">
              {renameError}
            </p>
          )}
          <div className="nl-dialog-actions">
            <button
              className="nl-secondary"
              type="button"
              disabled={saving}
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            <button
              className="nl-create"
              type="submit"
              disabled={saving || !draft.trim()}
            >
              {saving ? "Saving…" : "Save name"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
