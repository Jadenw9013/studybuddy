"use client";
import { useEffect, useId, useRef, useState } from "react";
import RichText from "./RichText";
import Icon from "./Icon";

type Note = {
  id: string;
  title: string;
  content: string;
  revision: number;
  citations: any[];
  updatedAt: string;
};
export default function SavedNotes({
  lessonId,
  reload = 0,
  createSignal = 0,
  onCitation,
}: {
  lessonId: string;
  reload?: number;
  createSignal?: number;
  onCitation: (citation: any) => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]),
    [editing, setEditing] = useState<Note | null>(null),
    [open, setOpen] = useState(false),
    [title, setTitle] = useState(""),
    [content, setContent] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const epoch = useRef(0),
    lastCreate = useRef(0),
    titleRef = useRef<HTMLInputElement>(null),
    draftId = useRef("");
  const titleId = useId(),
    contentId = useId();
  const request = async (url: string, method = "GET", body?: unknown) => {
    const response = await fetch(url, {
      method,
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok)
      throw Error(data.message ?? "This note could not be saved.");
    return data;
  };
  async function load(token = epoch.current) {
    const data = await request(`/api/lessons/${lessonId}/notes`);
    if (epoch.current === token) setNotes(data.notes ?? data);
  }
  useEffect(() => {
    const token = ++epoch.current;
    setOpen(false);
    setError("");
    void load(token).catch((e) => {
      if (epoch.current === token) setError(e.message);
    });
    return () => {
      epoch.current++;
    };
  }, [lessonId, reload]);
  function begin(note: Note | null) {
    draftId.current = crypto.randomUUID();
    setEditing(note);
    setTitle(note?.title ?? "");
    setContent(note?.content ?? "");
    setError("");
    setOpen(true);
    setTimeout(() => titleRef.current?.focus(), 0);
  }
  useEffect(() => {
    if (createSignal > lastCreate.current) {
      lastCreate.current = createSignal;
      begin(null);
    }
  }, [createSignal]);
  const save = async () => {
    const token = epoch.current;
    setBusy(true);
    setError("");
    try {
      await request(
        `/api/lessons/${lessonId}/notes${editing ? "/" + editing.id : ""}`,
        editing ? "PATCH" : "POST",
        {
          title: title.trim() || "Untitled note",
          content,
          ...(editing
            ? { expectedRevision: editing.revision }
            : { clientNoteId: draftId.current || crypto.randomUUID() }),
        },
      );
      if (token !== epoch.current) return;
      setOpen(false);
      await load(token);
    } catch (e) {
      if (token === epoch.current)
        setError(
          e instanceof Error ? e.message : "The note could not be saved.",
        );
    } finally {
      if (token === epoch.current) setBusy(false);
    }
  };
  return (
    <section className="saved-notes" aria-label="Saved notes">
      <header>
        <h3>
          Notes <span>{notes.length}</span>
        </h3>
        <button
          className="icon-button"
          aria-label="Create a note"
          onClick={() => begin(null)}
        >
          <Icon name="plus" size={18} />
        </button>
      </header>
      {error && (
        <p role="alert" className="studio-error">
          {error}
        </p>
      )}
      {open ? (
        <form
          className="note-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={titleId}>Note title</label>
          <input
            id={titleId}
            ref={titleRef}
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Untitled note"
          />
          <label htmlFor={contentId}>Your note</label>
          <textarea
            id={contentId}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            maxLength={20000}
            rows={9}
            required
            placeholder="Write something worth remembering…"
          />
          <div className="button-row">
            <button disabled={busy || !content.trim()} type="submit">
              {busy ? "Saving…" : "Save note"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : notes.length ? (
        notes.map((note) => (
          <details className="saved-note" key={note.id}>
            <summary>
              <Icon name="note" size={18} />
              <span>{note.title}</span>
            </summary>
            <div className="saved-note-content">
              <RichText text={note.content} />
              {note.citations?.map((citation) => (
                <button
                  className="citation"
                  key={citation.passageId}
                  onClick={() => onCitation(citation)}
                >
                  {citation.filename ?? "View source"}
                </button>
              ))}
              <div className="note-actions">
                <button className="text-button" onClick={() => begin(note)}>
                  Edit
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    const blob = new Blob(
                        [`# ${note.title}\n\n${note.content}`],
                        { type: "text/markdown" },
                      ),
                      url = URL.createObjectURL(blob),
                      a = document.createElement("a");
                    a.href = url;
                    a.download =
                      note.title.replace(/[^a-z0-9 -]/gi, "").slice(0, 60) +
                      ".md";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  Download
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    if (!confirm("Delete this saved note?")) return;
                    const token = epoch.current;
                    void request(
                      `/api/lessons/${lessonId}/notes/${note.id}`,
                      "DELETE",
                      { expectedRevision: note.revision },
                    )
                      .then(() => load(token))
                      .catch((e) => {
                        if (epoch.current === token) setError(e.message);
                      });
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </details>
        ))
      ) : (
        <div className="notes-empty">
          <Icon name="note" size={24} />
          <p>
            Save a useful answer or write a note.
            <br />
            It stays with this lesson.
          </p>
        </div>
      )}
    </section>
  );
}
