import {readyLessonSources,lessonContextMessages,lessonContextBoard,type State,type Lesson} from './store.ts';
import { boundedTutorInput } from "../../../packages/tutor/index.ts";

export const VOICE_CONTEXT_MAX_CHARS = 18000;
const text = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : "";
/** Course content stays in retrieval. The live connection receives a bounded,
 * valid snapshot, never complete uploads, chart history or a sliced JSON string. */
export function voiceLessonContext(
  state: State,
  lesson: Lesson,
  pairedNotebook?: unknown,
) {
  const sources = readyLessonSources(state,lesson);
  const ordered = [...sources].sort(
    (a, b) =>
      2 * Number(b.id === lesson.board?.sourceId) +
      Number(b.id === lesson.activeSource?.id) -
      (2 * Number(a.id === lesson.board?.sourceId) +
        Number(a.id === lesson.activeSource?.id)),
  );
  const books = ordered.filter((s) => s.notebook);
  const packed = boundedTutorInput({
    question: "",
    goal: lesson.goal,
    board: lessonContextBoard(state,lesson),
    attempts: [],
    passages: [],
    notebook: books.map((s) => ({
      ...s.notebook,
      sourceId: s.id,
      versionId: s.versionId,
    })),
    history: lessonContextMessages(lesson)
      .filter((m) => m.role === "student" || m.role === "tutor")
      .slice(-4),
    datasets: ordered
      .filter((s) => s.dataset)
      .map((s) => ({
        sourceId: s.id,
        versionId: s.versionId,
        name: text(s.name, 100),
        columns: s.dataset!.columns.slice(0, 10).map((c) => text(c, 80)),
        numericColumns: s
          .dataset!.numericColumns.slice(0, 10)
          .map((c) => text(c, 80)),
        rowCount: s.dataset!.rows.length,
      })),
    dsaSources: ordered
      .filter((s) => s.dsa)
      .slice(0, 4)
      .map((s) => ({
        sourceId: s.id,
        versionId: s.versionId,
        name: text(s.name, 100),
        dsa: s.dsa!,
      })),
    pairedNotebook,
  });
  const selected = ordered.find((s) => s.id === lesson.activeSource?.id);
  const version =
    selected &&
    [selected, ...(selected.previous ?? [])].find(
      (s) => s.versionId === lesson.activeSource?.versionId,
    );
  const passage = version?.passages.find(
    (p) => p.id === lesson.activeSource?.passageId,
  );
  const result: any = {
    goal: packed.goal,
    epoch: lesson.epoch,
    board: packed.board,
    paintedRevision: lesson.paintedRevision,
    source: selected?lesson.activeSource:undefined,
    sourceSelection:{selectedSourceIds:lesson.selectedSourceIds??null,revision:lesson.sourceSelectionRevision??0},
    selectedExcerpt: passage
      ? { text: text(passage.text, 1000), locator: passage.locator }
      : undefined,
    practice: lesson.practice
      ? {
          id: lesson.practice.id,
          skill: lesson.practice.skill,
          prompt: text(lesson.practice.prompt, 700),
          hintDepth: lesson.practice.hintDepth,
        }
      : undefined,
    attempts: lesson.attempts.slice(-3).map((a) => ({
      id: a.id,
      skill: a.skill,
      independent: a.independent,
      skipped: a.skipped,
      result: { numeric: a.result?.numeric, reasoning: a.result?.reasoning },
    })),
    pairedNotebook: packed.pairedNotebook,
    recentTurns: packed.history ?? [],
    notebook: packed.notebook,
    datasets: packed.datasets,
    dsaSources: packed.dsaSources ?? [],
    materials: ordered.slice(0, 25).map((s) => ({
      sourceId: s.id,
      versionId: s.versionId,
      name: text(s.name, 100),
      kind: s.dsa
        ? "dsa"
        : s.notebook
          ? "notebook"
          : s.dataset
            ? "dataset"
            : "document",
    })),
    materialsTotal: sources.length,
    contextExcerpted: true,
  };
  const tooLarge = () =>
    JSON.stringify(result).length > VOICE_CONTEXT_MAX_CHARS;
  while (tooLarge() && result.notebook.length) result.notebook.pop();
  while (tooLarge() && result.recentTurns.length) result.recentTurns.shift();
  while (tooLarge() && result.dsaSources.length > 1) result.dsaSources.pop();
  if (tooLarge() && pairedNotebook) {
    const paired = pairedNotebook as any;
    result.pairedNotebook = {
      cellId: text(paired.cellId, 128),
      revision: paired.revision,
      sourceOmitted: true,
    };
  }
  while (tooLarge() && result.materials.length) result.materials.pop();
  while (tooLarge() && result.datasets.length) result.datasets.pop();
  if (tooLarge()) delete result.selectedExcerpt;
  if (tooLarge()) {
    result.board = lesson.board
      ? {
          id: lesson.board.id,
          kind: lesson.board.kind,
          revision: lesson.board.revision,
          sourceId: lesson.board.sourceId,
          detailsOmitted: true,
        }
      : null;
    result.goal = text(lesson.goal, 100);
  }
  // Remaining fields are trusted identifiers, numbers and capped prompts. Fail
  // explicitly if an unexpected internal shape ever defeats that bound.
  if (tooLarge())
    throw Object.assign(
      Error("Choose a smaller active problem before starting voice."),
      { code: "voice_context_too_large" },
    );
  return result;
}
