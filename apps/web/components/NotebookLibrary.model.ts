export type NotebookCourse = {
  id: string;
  name: string;
  sourceCount?: number;
  createdAt?: string | number;
  updatedAt?: string | number;
};
export type NotebookLesson = {
  id: string;
  courseId: string;
  title?: string;
  goal?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
};
export type NotebookEntry = {
  course: NotebookCourse;
  sourceCount?: number;
  lessonCount: number;
  latestLesson?: NotebookLesson;
  updatedAt?: string | number;
  index: number;
};
export type NotebookSort = "updated" | "name" | "sources";
export type NotebookFilter = "all" | "with-sources" | "with-lessons" | "empty";
const time = (value?: string | number) => {
  const number =
    typeof value === "number" ? value : value ? Date.parse(value) : 0;
  return Number.isFinite(number) ? number : 0;
};
const searchable = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export function notebookEntries(
  courses: NotebookCourse[],
  lessons: NotebookLesson[],
): NotebookEntry[] {
  return courses.map((course, index) => {
    const own = [
      ...new Map(
        lessons
          .filter((lesson) => lesson.courseId === course.id)
          .map((lesson) => [lesson.id, lesson]),
      ).values(),
    ];
    const latestLesson = own
      .map((lesson, order) => ({ lesson, order }))
      .sort(
        (a, b) =>
          time(b.lesson.updatedAt ?? b.lesson.createdAt) -
            time(a.lesson.updatedAt ?? a.lesson.createdAt) || b.order - a.order,
      )[0]?.lesson;
    const candidates = [
      course.updatedAt,
      latestLesson?.updatedAt,
      latestLesson?.createdAt,
      course.createdAt,
    ].filter(
      (value): value is string | number =>
        value !== undefined && time(value) > 0,
    );
    const updatedAt = candidates.sort((a, b) => time(b) - time(a))[0];
    return {
      course,
      index,
      latestLesson,
      lessonCount: own.length,
      updatedAt,
      sourceCount:
        Number.isInteger(course.sourceCount) && course.sourceCount! >= 0
          ? course.sourceCount
          : undefined,
    };
  });
}

export function visibleNotebooks(
  entries: NotebookEntry[],
  query: string,
  filter: NotebookFilter,
  sort: NotebookSort,
): NotebookEntry[] {
  const tokens = searchable(query).trim().split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => {
      if (
        filter === "with-sources" &&
        !(entry.sourceCount !== undefined && entry.sourceCount > 0)
      )
        return false;
      if (filter === "with-lessons" && entry.lessonCount === 0) return false;
      if (
        filter === "empty" &&
        !(entry.sourceCount === 0 && entry.lessonCount === 0)
      )
        return false;
      const text = searchable(
        [entry.course.name, entry.latestLesson?.title, entry.latestLesson?.goal]
          .filter(Boolean)
          .join(" "),
      );
      return tokens.every((token) => text.includes(token));
    })
    .sort((a, b) => {
      if (sort === "name")
        return (
          a.course.name.localeCompare(b.course.name, "en", {
            numeric: true,
            sensitivity: "base",
          }) || a.index - b.index
        );
      if (sort === "sources")
        return (
          (b.sourceCount ?? -1) - (a.sourceCount ?? -1) || a.index - b.index
        );
      return time(b.updatedAt) - time(a.updatedAt) || a.index - b.index;
    });
}

export function openNotebook(
  entry: NotebookEntry,
  actions: {
    onOpenCourse: (id: string) => void;
    onOpenLesson: (id: string) => void;
  },
) {
  if (entry.latestLesson) actions.onOpenLesson(entry.latestLesson.id);
  else actions.onOpenCourse(entry.course.id);
}

export async function renameNotebook(
  course: NotebookCourse,
  draft: string,
  onRename: (id: string, name: string) => Promise<unknown>,
) {
  const name = draft.trim();
  if (!name || name.length > 100)
    throw Error("Use a notebook name between 1 and 100 characters.");
  if (name !== course.name) await onRename(course.id, name);
  return name;
}
