"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

export default function SourcesPanel({
  sources,
  selectedIds,
  disabled,
  busy,
  onSelection,
  onPreview,
  onAdd,
  onCreateNote,
  onManage,
}: {
  sources: any[];
  selectedIds: string[];
  disabled?: boolean;
  busy?: boolean;
  onSelection: (ids: string[] | null) => void;
  onPreview: (source: any) => void;
  onAdd: () => void;
  onCreateNote: () => void;
  onManage: () => void;
}) {
  const [query, setQuery] = useState("");
  const all = useRef<HTMLInputElement>(null);
  const ready = sources.filter((source) => source.status?.startsWith("ready"));
  const selected = new Set(selectedIds),
    selectedCount = ready.filter((source) => selected.has(source.id)).length;
  useEffect(() => {
    if (all.current)
      all.current.indeterminate =
        selectedCount > 0 && selectedCount < ready.length;
  }, [selectedCount, ready.length]);
  const shown = sources.filter((source) =>
    source.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <aside className="notebook-sources" aria-label="Notebook sources">
      <header className="notebook-panel-header">
        <h2>Sources</h2>
        <button
          className="icon-button"
          aria-label="Manage sources"
          onClick={onManage}
          disabled={disabled}
        >
          <Icon name="settings" size={18} />
        </button>
      </header>
      <div className="source-panel-actions">
        <button className="secondary" onClick={onAdd} disabled={disabled}>
          <Icon name="plus" size={17} />
          Add sources
        </button>
        <button
          className="secondary"
          onClick={onCreateNote}
          disabled={disabled}
        >
          <Icon name="note" size={17} />
          Create note
        </button>
      </div>
      {sources.length > 0 && (
        <>
          <label className="source-search">
            <Icon name="search" size={17} />
            <span className="sr-only">Search sources</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your sources"
            />
          </label>
          <label className="source-select-all">
            <span>
              {busy
                ? "Updating selection…"
                : `${selectedCount} of ${ready.length} selected`}
            </span>
            <span>Select all</span>
            <input
              ref={all}
              type="checkbox"
              aria-label="Select all ready sources"
              checked={ready.length > 0 && selectedCount === ready.length}
              disabled={disabled || busy || !ready.length}
              onChange={(event) =>
                onSelection(event.target.checked ? null : [])
              }
            />
          </label>
        </>
      )}
      <div className="source-panel-list">
        {!sources.length ? (
          <div className="source-empty">
            <span className="empty-source-symbol">
              <Icon name="book" size={30} />
            </span>
            <h3>Your ideas start here</h3>
            <p>
              Add lecture PDFs, notebooks, data or notes to give your tutor
              context.
            </p>
            <button className="secondary" onClick={onAdd} disabled={disabled}>
              Add your first source
            </button>
          </div>
        ) : !shown.length ? (
          <p className="source-no-results">No sources match “{query}”.</p>
        ) : (
          shown.map((source) => {
            const isReady = source.status?.startsWith("ready"),
              extension = source.name.split(".").pop()?.toLowerCase() ?? "file";
            return (
              <div className="notebook-source-row" key={source.id}>
                <button
                  className="source-open"
                  onClick={() => onPreview(source)}
                  disabled={disabled || !isReady}
                  title={source.name}
                  aria-label={`Preview ${source.name}`}
                >
                  <span className={`file-kind file-${extension}`}>
                    {extension === "ipynb"
                      ? "NB"
                      : extension.toUpperCase().slice(0, 4)}
                  </span>
                  <span className="source-row-name">
                    {source.name}
                    {!isReady && (
                      <small>
                        {source.status === "indexing"
                          ? "Processing…"
                          : "Needs attention"}
                      </small>
                    )}
                  </span>
                </button>
                <input
                  type="checkbox"
                  aria-label={`Use ${source.name}`}
                  checked={selected.has(source.id) && isReady}
                  disabled={disabled || busy || !isReady}
                  onChange={(event) =>
                    onSelection(
                      event.target.checked
                        ? [...selectedIds, source.id]
                        : selectedIds.filter((value) => value !== source.id),
                    )
                  }
                />
              </div>
            );
          })
        )}
      </div>
      {sources.length > 0 && (
        <p className="source-panel-footnote">
          {selectedCount
            ? "Answers and study tools use your selected sources."
            : "Choose a source to create grounded study materials."}
        </p>
      )}
    </aside>
  );
}
