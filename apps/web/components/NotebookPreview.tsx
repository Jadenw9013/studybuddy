"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import RichText from "./RichText";

export interface NotebookCellContext { cellId: string; text: string; label: string }
export interface NotebookPreviewProps {
  notebook: any;
  filename: string;
  onAsk?: (context: NotebookCellContext) => void;
}
interface Cell { id: string; ordinal: number; type: "markdown" | "code" | "raw"; source: string; readable: boolean; label: string }

function sourceText(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every(line => typeof line === "string")) return value.join("");
  return null;
}

export default function NotebookPreview({ notebook, filename, onAsk }: NotebookPreviewProps) {
  const uid = useId();
  const cells = useMemo<Cell[]>(() => !Array.isArray(notebook?.cells) ? [] : notebook.cells.map((cell: any, index: number) => {
    const source = sourceText(cell.source);
    const value = cell.cellType ?? cell.cell_type;
    const type = value === "markdown" || value === "code" ? value : "raw";
    const ordinal = Number.isInteger(cell.ordinal) && cell.ordinal > 0 ? cell.ordinal : index + 1;
    const first = (source ?? "").split(/\r?\n/).find(line => line.trim())?.trim().replace(/^#{1,6}\s+/, "") ?? "Empty cell";
    const description = first.length > 64 ? `${first.slice(0, 64)}…` : first;
    return {
      id: typeof (cell.cellId ?? cell.id) === "string" ? cell.cellId ?? cell.id : `cell-${index + 1}`,
      ordinal, type, source: source ?? "", readable: source !== null,
      label: `Cell ${ordinal}. ${type === "markdown" ? "Notes" : type === "code" ? "Code" : "Text"}: ${description}`,
    };
  }), [notebook]);
  const [selectedId, setSelectedId] = useState(cells[0]?.id ?? "");
  const selectedIndex = Math.max(0, cells.findIndex(cell => cell.id === selectedId));
  const selected = cells[selectedIndex];
  const articles = useRef(new Map<number, HTMLElement>());
  useEffect(() => {
    if (!cells.some(cell => cell.id === selectedId)) setSelectedId(cells[0]?.id ?? "");
  }, [cells, selectedId]);

  function choose(index: number) {
    const cell = cells[index]; if (!cell) return;
    setSelectedId(cell.id);
    const article = articles.current.get(index);
    article?.focus({ preventScroll: true });
    article?.scrollIntoView({ block: "start", behavior: "auto" });
  }

  return (
    <section className="notebook-preview" aria-labelledby={`${uid}-heading`}>
      <header className="notebook-heading">
        <h3 id={`${uid}-heading`}>{filename}</h3>
        <p className="notebook-snapshot">Read-only uploaded notebook</p>
      </header>
      <p className="notebook-intro">Browse the saved source cells and choose one to ask about. Code is shown without running it.</p>
      {cells.length === 0 ? <p className="notebook-empty">No saved cells are available in this notebook preview.</p> : <>
        <nav className="notebook-navigation" aria-label="Notebook cell navigation">
          <label htmlFor={`${uid}-select`}>Jump to a cell
            <select id={`${uid}-select`} value={selected?.id ?? ""} onChange={event => setSelectedId(event.target.value)}>
              {cells.map((cell, index) => <option key={`${cell.id}-${index}`} value={cell.id}>{cell.label}</option>)}
            </select>
          </label>
          <div className="notebook-navigation-actions">
            <button type="button" className="notebook-step" onClick={() => choose(selectedIndex)}>Go to selected cell</button>
            <button type="button" className="notebook-step" disabled={selectedIndex === 0} onClick={() => choose(selectedIndex - 1)}>Previous cell</button>
            <button type="button" className="notebook-step" disabled={selectedIndex === cells.length - 1} onClick={() => choose(selectedIndex + 1)}>Next cell</button>
          </div>
        </nav>
        <p className="notebook-selection-status" role="status" aria-live="polite" aria-atomic="true">Cell {selected?.ordinal} of {cells.length} selected.</p>
        <div className="notebook-scroll" role="region" aria-label={`${filename} saved cells`} tabIndex={0} style={{ maxHeight: "70vh", overflow: "auto" }}>
          {cells.map((cell, index) => (
            <article key={`${cell.id}-${index}`} className={`notebook-cell${selectedId === cell.id ? " notebook-cell-selected" : ""}`}
              id={`${uid}-cell-${index}`} tabIndex={-1} aria-labelledby={`${uid}-cell-${index}-heading`}
              data-cell-id={cell.id} data-cell-type={cell.type} data-selected={selectedId === cell.id}
              onFocusCapture={() => setSelectedId(cell.id)}
              ref={node => { if (node) articles.current.set(index, node); else articles.current.delete(index); }}>
              <header className="notebook-cell-heading">
                <h4 id={`${uid}-cell-${index}-heading`}>Cell {cell.ordinal}</h4>
                <span className="notebook-cell-type">{cell.type === "markdown" ? "Notes" : cell.type === "code" ? "Code" : "Text"}</span>
              </header>
              {!cell.readable ? <p className="notebook-cell-error">This cell's source could not be read.</p>
                : !cell.source.trim() ? <p className="notebook-empty">Empty cell</p>
                : cell.type === "markdown" ? <RichText text={cell.source} headingLevel={4} />
                : <pre className="notebook-code" tabIndex={0} aria-label={`${cell.type === "code" ? "Code" : "Text"} in cell ${cell.ordinal}`} style={{ maxHeight: "24rem", overflow: "auto" }}><code>{cell.source}</code></pre>}
              {cell.type === "markdown" && cell.readable && <details className="notebook-cell-source"><summary>View original cell text</summary><pre tabIndex={0} aria-label={`Original text in cell ${cell.ordinal}`}><code>{cell.source}</code></pre></details>}
              {onAsk && <button type="button" className="notebook-ask" disabled={!cell.readable || !cell.source.trim()}
                aria-label={`Ask about this cell, cell ${cell.ordinal}`} onClick={() => {
                  setSelectedId(cell.id);
                  onAsk({ cellId: cell.id, text: cell.source, label: `${filename}, cell ${cell.ordinal}` });
                }}>Ask about this cell</button>}
            </article>
          ))}
        </div>
      </>}
    </section>
  );
}
