"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Chart from "./Chart";
import Equation from "./Equation";
import CreateChart from "./CreateChart";
import Illustrations from "./Illustrations";
import PdfPreview from "./PdfPreview";
import RichText from "./RichText";
import NotebookPreview from "./NotebookPreview";
import Icon from "./Icon";
import NotebookLibrary from "./NotebookLibrary";
import SourcesPanel from "./SourcesPanel";
import SavedNotes from "./SavedNotes";
import StudioPanel from "./StudioPanel";
import { LiveAudio } from "./live";
import { mapPoint } from "../../../packages/board/index";
const id = () => crypto.randomUUID();
const sourceLocation = (locator: any) =>
  locator.pageIndex !== undefined
    ? `physical page ${locator.pageIndex + 1}`
    : locator.physicalPage !== undefined
      ? `physical page ${locator.physicalPage}`
      : locator.cellId
        ? `cell ${locator.cellId}`
        : locator.dsa
          ? `DSA ${locator.nodeId ? "node " + locator.nodeId : (locator.section ?? "structure")}`
          : locator.rowStart !== undefined
            ? `rows ${locator.rowStart}–${locator.rowEnd ?? locator.rowStart}`
            : locator.lineStart !== undefined
              ? `lines ${locator.lineStart}–${locator.lineEnd ?? locator.lineStart}`
              : "source excerpt";
async function api(
  url: string,
  method = "GET",
  body?: any,
  onProgress?: (stage: string) => void,
) {
  const streaming = url.endsWith("/messages") && method === "POST";
  const r = await fetch(url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body instanceof FormData
        ? {}
        : body
          ? {
              "Content-Type": "application/json",
              ...(streaming ? { Accept: "application/x-ndjson" } : {}),
            }
          : {},
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (r.headers.get("Content-Type")?.includes("application/x-ndjson")) {
    const reader = r.body!.getReader(),
      decoder = new TextDecoder();
    let pending = "";
    let result: any;
    for (;;) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === "error") throw Error(event.message);
        if (event.type === "complete") result = event.result;
        if (event.stage) onProgress?.(event.stage);
      }
      if (done) break;
    }
    if (!result)
      throw Error(
        "The connection ended before the reply was confirmed. Reopen the saved lesson.",
      );
    return result;
  }
  const data = await r.json();
  if (!r.ok) throw Error(data.message ?? "This action could not finish.");
  return data;
}
const prompts: Record<string, string> = {
  histogram:
    "A new bin contains 4 of 20 scores and is 5 score units wide. What are its relative frequency and density? Explain how bar area represents probability.",
  probability:
    "Of 12 evening students, 3 commute by train. What is P(train | evening)? State the conditioning group.",
  regression:
    "A fitted line predicts y = 5 + 2x. How much does predicted y change when x increases by 3 units? Explain the slope.",
};
export default function Workspace() {
  const router = useRouter(),
    pathname = usePathname();
  const [config, setConfig] = useState<any>({ mode: "loading" }),
    [me, setMe] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [adult, setAdult] = useState(false),
    [consent, setConsent] = useState(false),
    [sample, setSample] = useState(false);
  const [courseData, setCourseData] = useState<any>(null),
    [current, setCurrent] = useState<any>(null),
    [contextLoadError, setContextLoadError] = useState<{
      path: string;
      message: string;
    } | null>(null),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [sourcesOpen, setSourcesOpen] = useState(false),
    [citation, setCitation] = useState<any>(null),
    [practiceAnswer, setPracticeAnswer] = useState(""),
    [practiceResult, setPracticeResult] = useState<any>(null),
    [hint, setHint] = useState(""),
    [topic, setTopic] = useState("histogram");
  const [voiceStatus, setVoiceStatus] = useState("Text only"),
    [caption, setCaption] = useState(""),
    [capturing, setCapturing] = useState(false),
    [point, setPoint] = useState<any>(null),
    [pastedImage, setPastedImage] = useState<string | null>(null),
    [pair, setPair] = useState<any>(null),
    [companion, setCompanion] = useState<any>(null),
    [replacement, setReplacement] = useState(""),
    [pairReceipt, setPairReceipt] = useState(""),
    [pendingNotebookAction, setPendingNotebookAction] = useState<string | null>(
      null,
    );
  const [pane, setPaneState] = useState<
    "materials" | "visuals" | "practice" | "tools" | null
  >(null);
  const [libraryMode, setLibraryMode] = useState(true),
    [mobileTab, setMobileTab] = useState<"sources" | "chat" | "studio">("chat"),
    [sourceBusy, setSourceBusy] = useState(false),
    [notesReload, setNotesReload] = useState(0),
    [noteCreate, setNoteCreate] = useState(0);
  const [studioExpanded,setStudioExpanded]=useState(false);
  const [scopeDraft, setScopeDraft] = useState<{
    lessonId: string;
    ids: string[];
  } | null>(null);
  const scopeRequest = useRef(0);
  const [notebookModal, setNotebookModal] = useState<string | null>(null),
    [notebookName, setNotebookName] = useState(""),
    [notebookSaving, setNotebookSaving] = useState(false);
  function setPane(
    value: "materials" | "visuals" | "practice" | "tools" | null,
  ) {
    setPaneState(value);
    setMobileTab(value ? "studio" : "chat");
  }
  const [railOpen, setRailOpen] = useState(false),
    [materialId, setMaterialId] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState(""),
    [progress, setProgress] = useState("");
  const [cellContext, setCellContext] = useState<{
    cellId: string;
    label: string;
    text: string;
    filename: string;
  } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null),
    conversationRef = useRef<HTMLDivElement>(null),
    studioHomeRef=useRef<HTMLDivElement>(null);
  const routeRef = useRef(pathname),
    pendingTarget = useRef<string | null>(null);
  const workEpoch = useRef(0),
    expectedTaskRoute = useRef<string | null>(null);
  const captureLifecycle = useRef(0),
    workspaceRef = useRef<HTMLElement>(null),
    railRef = useRef<HTMLElement>(null);
  routeRef.current = pathname;
  useEffect(() => {
    if (current?.board) setPane("visuals");
  }, [current?.board?.id]);
  useEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [current?.messages?.length, pendingQuestion]);
  const live = useRef<LiveAudio | null>(null),
    voiceLesson = useRef<string | null>(null),
    video = useRef<HTMLVideoElement>(null),
    capture = useRef<MediaStream | null>(null),
    captureId = useRef(""),
    frameId = useRef(""),
    imageRef = useRef<HTMLImageElement>(null),
    attemptId = useRef(id()),
    dialog = useRef<HTMLDialogElement>(null),
    sourceDialog = useRef<HTMLDialogElement>(null),
    notebookDialog = useRef<HTMLDialogElement>(null),
    sourceButton = useRef<HTMLButtonElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = notebookDialog.current;
    if (notebookModal && !element?.open) element?.showModal();
    else if (!notebookModal && element?.open) element.close();
  }, [notebookModal]);
  const lessonId = pathname.match(/^\/lessons\/([^/]+)/)?.[1],
    routeCourseId = pathname.match(/^\/courses\/([^/]+)/)?.[1],
    courseId = routeCourseId ?? current?.courseId ?? courseData?.course?.id;
  const contextPending = Boolean(
    lessonId
      ? current?.id !== lessonId || courseData?.course?.id !== current?.courseId
      : routeCourseId && courseData?.course?.id !== routeCourseId,
  );
  const contextFailure =
    contextLoadError?.path === pathname ? contextLoadError.message : null;
  const isRecap = pathname.endsWith("/recap"),
    isSettings = pathname === "/settings";
  useEffect(() => {
    scopeRequest.current++;
    setSourceBusy(false);
    setScopeDraft(null);
    setCellContext(null);
    setMaterialId("");
    setPracticeAnswer("");
    setPracticeResult(null);
    setHint("");
    setPair(null);
    setCompanion(null);
    setPendingNotebookAction(null);
    setPairReceipt("");
  }, [lessonId, courseId]);
  useEffect(() => {
    if (expectedTaskRoute.current && pathname !== expectedTaskRoute.current) {
      workEpoch.current++;
      expectedTaskRoute.current = null;
      pendingTarget.current = null;
      setBusy(false);
      setPendingQuestion("");
      setProgress("");
    }
    if (
      pendingTarget.current &&
      !pathname.startsWith(`/lessons/${pendingTarget.current}`)
    ) {
      setPendingQuestion("");
      setBusy(false);
      setProgress("");
    }
  }, [pathname]);
  useEffect(() => {
    if (window.innerWidth <= 650) {
      if (pane) workspaceRef.current?.focus();
      else composerRef.current?.focus();
    }
  }, [pane]);
  useEffect(() => {
    if (railOpen)
      railRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [railOpen]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]"))
        return;
      if (railOpen) {
        setRailOpen(false);
        composerRef.current?.focus();
      } else if (pane) {
        setPane(null);
        composerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [pane, railOpen]);
  useEffect(
    () => () => {
      if (pastedImage) URL.revokeObjectURL(pastedImage);
    },
    [pastedImage],
  );
  useEffect(() => {
    if (!pendingNotebookAction || !current) return;
    const timer = setInterval(() => {
      void api(
        `/api/lessons/${current.id}/companion/actions/${pendingNotebookAction}`,
      )
        .then((r) => {
          setPairReceipt(
            r.status +
              (r.revision !== undefined
                ? ` · notebook revision ${r.revision}`
                : ""),
          );
          if (
            ![
              "checking_edit",
              "preview_requested",
              "previewed",
              "preview",
            ].includes(r.status)
          )
            setPendingNotebookAction(null);
        })
        .catch(() =>
          setPairReceipt(
            "Checking edit. Reconnect the same notebook and query this action before trying again.",
          ),
        );
    }, 1000);
    return () => clearInterval(timer);
  }, [pendingNotebookAction, current?.id]);
  async function refreshMe() {
    try {
      setMe(await api("/api/me"));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }
  async function refreshLesson(isCurrent = () => true) {
    if (!lessonId) return;
    const snapshot = await api(`/api/lessons/${lessonId}`);
    if (!isCurrent() || !routeRef.current.startsWith(`/lessons/${lessonId}`))
      return;
    const l = snapshot.lesson ?? snapshot;
    const data = await api(`/api/courses/${l.courseId}`);
    if (!isCurrent() || !routeRef.current.startsWith(`/lessons/${lessonId}`))
      return;
    setCurrent(l);
    setCourseData(data);
  }
  async function loadRouteContext(isCurrent = () => true) {
    const origin = pathname;
    setContextLoadError(null);
    try {
      if (lessonId) await refreshLesson(isCurrent);
      else if (routeCourseId) {
        const data = await api(`/api/courses/${routeCourseId}`);
        if (isCurrent() && routeRef.current === origin) setCourseData(data);
      }
    } catch (e: any) {
      if (isCurrent() && routeRef.current === origin) {
        setContextLoadError({ path: origin, message: e.message });
        setNotice(e.message);
      }
    }
  }
  useEffect(() => {
    void api("/api/config")
      .then(setConfig)
      .catch((e) => setNotice(e.message));
    void refreshMe();
    return () => {
      live.current?.stop();
      capture.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (!me) return;
    let active = true;
    setNotice("");
    void loadRouteContext(() => active);
    return () => {
      active = false;
    };
  }, [pathname, me?.email]);
  useEffect(() => {
    if (!courseData?.sources.some((s: any) => s.status === "indexing")) return;
    const t = setInterval(
      () =>
        void api(`/api/courses/${courseData.course.id}`)
          .then(setCourseData)
          .catch(() => {}),
      800,
    );
    return () => clearInterval(t);
  }, [courseData?.sources, courseData?.course?.id]);
  useEffect(() => {
    return () => {
      captureLifecycle.current++;
      if (voiceLesson.current === lessonId) {
        live.current?.stop();
        live.current = null;
        voiceLesson.current = null;
      }
      capture.current?.getTracks().forEach((t) => t.stop());
      capture.current = null;
      setCapturing(false);
      setPoint(null);
      if (lessonId) {
        void api(`/api/lessons/${lessonId}/capture`, "DELETE").catch(() => {});
        void api(`/api/lessons/${lessonId}/companion`, "DELETE").catch(
          () => {},
        );
      }
    };
  }, [lessonId]);
  useEffect(() => {
    if (!point) return;
    const t = setTimeout(() => setPoint(null), 2500);
    return () => clearTimeout(t);
  }, [point]);
  useEffect(() => {
    if (citation) dialog.current?.showModal();
  }, [citation]);
  useEffect(() => {
    if (sourcesOpen) sourceDialog.current?.showModal();
  }, [sourcesOpen]);
  async function act(fn: () => Promise<any>) {
    const origin = routeRef.current;
    setNotice("");
    try {
      return await fn();
    } catch (e: any) {
      if (routeRef.current === origin) setNotice(e.message);
      return null;
    }
  }
  function beginWork() {
    expectedTaskRoute.current = routeRef.current;
    return ++workEpoch.current;
  }
  function ownsWork(token: number) {
    return workEpoch.current === token;
  }
  function navigate(path: string, preserveWork = false) {
    if (!preserveWork) {
      workEpoch.current++;
      expectedTaskRoute.current = null;
      pendingTarget.current = null;
      setBusy(false);
      setPendingQuestion("");
      setProgress("");
    }
    router.push(path);
  }
  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    await act(async () => {
      if (!sent) {
        if (config.mode === "fixture") setSent(true);
        else {
          await api("/api/auth/code", "POST", { email });
          setSent(true);
        }
        return;
      }
      await api("/api/auth/verify", "POST", { email, code, adult, consent });
      await refreshMe();
    });
  }
  async function createCourse(sampleCourse = false) {
    const token = beginWork();
    await act(async () => {
      const c = await api("/api/courses", "POST", {
        name: sampleCourse ? "Statistics · sample course" : "New assignment",
      });
      if (sampleCourse) await api(`/api/courses/${c.id}/sample`, "POST");
      if (!ownsWork(token)) return;
      await refreshMe();
      const data = await api(`/api/courses/${c.id}`);
      if (!ownsWork(token)) return;
      expectedTaskRoute.current = `/courses/${c.id}`;
      navigate(`/courses/${c.id}`, true);
      setCourseData(data);
    });
  }
  function newDraft() {
    setCurrent(null);
    setCourseData(null);
    setQuestion("");
    setCellContext(null);
    setPane(null);
    setLibraryMode(false);
    navigate("/");
    setRailOpen(false);
  }
  async function openNotebook(course: string) {
    const saved = me?.lessons
      ?.filter((item: any) => item.courseId === course)
      .at(-1);
    setLibraryMode(false);
    setPaneState(null);
    setMobileTab("sources");
    if (saved) {
      navigate(`/lessons/${saved.id}`);
      return;
    }
    const token = beginWork();
    await act(async () => {
      const lesson = await api("/api/lessons", "POST", {
        courseId: course,
        goal: "Understand my coursework",
      });
      if (!ownsWork(token)) return;
      await refreshMe();
      if (!ownsWork(token)) return;
      navigate(`/lessons/${lesson.id}`);
    });
  }
  async function saveNotebook(event: React.FormEvent) {
    event.preventDefault();
    if (!notebookName.trim() || notebookSaving) return;
    const token = beginWork(),
      target = notebookModal;
    setNotebookSaving(true);
    await act(async () => {
      if (target === "new") {
        const course = await api("/api/courses", "POST", {
          name: notebookName.trim(),
        });
        const lesson = await api("/api/lessons", "POST", {
          courseId: course.id,
          goal: "Understand my coursework",
        });
        if (!ownsWork(token)) return;
        setNotebookModal(null);
        setLibraryMode(false);
        setCurrent(lesson);
        setCourseData(await api(`/api/courses/${course.id}`));
        if (!ownsWork(token)) return;
        await refreshMe();
        if (!ownsWork(token)) return;
        navigate(`/lessons/${lesson.id}`);
      } else if (target) {
        const course = await api(`/api/courses/${target}`, "PATCH", {
          name: notebookName.trim(),
        });
        if (!ownsWork(token)) return;
        setCourseData((data: any) =>
          data?.course.id === target
            ? { ...data, course: { ...data.course, ...course } }
            : data,
        );
        setNotebookModal(null);
        await refreshMe();
      }
    });
    setNotebookSaving(false);
  }
  async function selectSources(sourceIds: string[] | null) {
    if (!current || sourceBusy || contextPending) return;
    const target = current.id,
      origin = routeRef.current;
    const requestToken = ++scopeRequest.current;
    setScopeDraft({
      lessonId: target,
      ids: sourceIds ?? ready.map((source: any) => source.id),
    });
    setSourceBusy(true);
    if (live.current && !live.current.closed) {
      live.current.stop();
      live.current = null;
      voiceLesson.current = null;
      setVoiceStatus("Text only");
      setCaption("");
    }
    await act(async () => {
      await api(`/api/lessons/${target}/sources`, "PATCH", {
        sourceIds,
        expectedRevision: current.sourceSelectionRevision ?? 0,
      });
      if (routeRef.current === origin) await refreshLesson();
    });
    if (requestToken === scopeRequest.current) {
      setSourceBusy(false);
      setScopeDraft(null);
    }
  }
  async function saveAnswer(message: any) {
    if (!current) return;
    const target = current.id,
      origin = routeRef.current;
    await act(async () => {
      await api(`/api/lessons/${target}/notes`, "POST", {
        fromMessageId: message.id,
        clientNoteId: id(),
      });
      if (origin !== routeRef.current) return;
      setNotesReload((value) => value + 1);
      setPaneState(null);
      setMobileTab("studio");
      setNotice("Saved to your notes.");
    });
  }
  async function copyAnswer(text: string) {
    await act(async () => {
      await navigator.clipboard.writeText(text);
      setNotice("Response copied.");
    });
  }
  async function screenLesson() {
    await act(async () => {
      const c = await api("/api/courses", "POST", {
        name: "Untitled screen lesson",
      });
      const l = await api("/api/lessons", "POST", {
        courseId: c.id,
        goal: "Understand the selected screen evidence",
      });
      await refreshMe();
      navigate(`/lessons/${l.id}`);
      setNotice(
        "Choose Share a window or paste an image into Your work. No course sources are linked yet.",
      );
    });
  }
  async function startLesson() {
    if (contextPending) return;
    const token = beginWork();
    await act(async () => {
      const l = await api("/api/lessons", "POST", {
        courseId: courseData.course.id,
      });
      await refreshMe();
      if (!ownsWork(token)) return;
      navigate(`/lessons/${l.id}`);
    });
  }
  async function ensureLesson(filename?: string, token = beginWork()) {
    const origin = routeRef.current;
    const check = () => {
      if (!ownsWork(token) || routeRef.current !== origin)
        throw Error(
          "The previous action was cancelled when you changed conversations.",
        );
    };
    check();
    const referencedLesson = origin.match(/^\/lessons\/([^/]+)/)?.[1];
    if (referencedLesson) {
      if (
        current?.id !== referencedLesson ||
        courseData?.course?.id !== current?.courseId
      )
        throw Error(
          "Your saved lesson is still loading. Wait a moment, then try again.",
        );
      return current;
    }
    const referencedCourse = origin.match(/^\/courses\/([^/]+)/)?.[1];
    if (referencedCourse && courseData?.course?.id !== referencedCourse)
      throw Error(
        "Your course is still loading. Wait a moment, then try again.",
      );
    let cid = courseData?.course?.id;
    if (!cid || pathname === "/" || pathname === "/courses") {
      const c = await api("/api/courses", "POST", {
        name:
          filename
            ?.replace(/\.[^.]+$/, "")
            .replace(/[_-]+/g, " ")
            .slice(0, 80) || "New conversation",
      });
      cid = c.id;
    }
    check();
    const l = await api("/api/lessons", "POST", {
      courseId: cid,
      goal: "Understand my coursework",
    });
    const data = await api(`/api/courses/${cid}`);
    check();
    pendingTarget.current = l.id;
    expectedTaskRoute.current = `/lessons/${l.id}`;
    setCurrent(l);
    setCourseData(data);
    navigate(`/lessons/${l.id}`, true);
    await refreshMe();
    if (!ownsWork(token))
      throw Error(
        "The previous action was cancelled when you changed conversations.",
      );
    return l;
  }
  async function upload(files: FileList | null) {
    if (!files?.length || contextPending) return;
    const list = Array.from(files);
    const token = beginWork();
    setBusy(true);
    setProgress("Uploading your files…");
    try {
      const l = await ensureLesson(list[0].name, token);
      if (!ownsWork(token)) return;
      for (let i = 0; i < list.length; i += 3) {
        if (!ownsWork(token)) return;
        const f = new FormData();
        for (const file of list.slice(i, i + 3)) f.append("files", file);
        await api(`/api/courses/${l.courseId}/uploads`, "POST", f);
      }
      const data = await api(`/api/courses/${l.courseId}`);
      if (ownsWork(token) && routeRef.current.startsWith(`/lessons/${l.id}`)) {
        setCourseData(data);
        setPane("materials");
      }
    } catch (e: any) {
      if (ownsWork(token)) setNotice(e.message);
    } finally {
      if (ownsWork(token)) {
        expectedTaskRoute.current = null;
        pendingTarget.current = null;
        setBusy(false);
        setProgress("");
      }
    }
  }
  async function action(type: string, args: any = {}, target?: string) {
    if (contextPending)
      throw Error(
        "Your saved lesson is still loading. Wait a moment, then try again.",
      );
    if (!current) return;
    const receipt = await api(`/api/lessons/${current.id}/actions`, "POST", {
      actionId: type === "practice.record" ? attemptId.current : id(),
      sessionId: current.id,
      turnEpoch: current.epoch,
      type,
      targetId: target ?? current.board?.id ?? current.id,
      expectedRevision: current.board?.revision ?? 0,
      args,
    });
    await refreshLesson();
    return receipt;
  }
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy || contextPending) return;
    const q = question.trim();
    const token = beginWork();
    let targetId: string | null = null,
      finished = false;
    const context = cellContext
      ? `\n\nSelected uploaded cell (${cellContext.filename}, ${cellContext.cellId}):\n${cellContext.text.slice(0, 2500)}`
      : "";
    if ((q + context).length > 4000) {
      setNotice(
        "Keep your question under 1,400 characters when attaching a notebook cell.",
      );
      return;
    }
    setQuestion("");
    setPendingQuestion(q);
    setBusy(true);
    setProgress("Finding relevant coursework…");
    live.current?.stop();
    live.current = null;
    setVoiceStatus("Text only");
    try {
      const l = await ensureLesson(undefined, token);
      if (!ownsWork(token)) return;
      targetId = l.id;
      pendingTarget.current = l.id;
      await api(
        `/api/lessons/${l.id}/messages`,
        "POST",
        { clientMessageId: id(), text: q + context },
        (stage) => {
          if (!ownsWork(token) || finished) return;
          if (stage === "visual_computed")
            void api(`/api/lessons/${l.id}`)
              .then((snapshot) => {
                if (
                  ownsWork(token) &&
                  !finished &&
                  routeRef.current.startsWith(`/lessons/${l.id}`)
                ) {
                  setCurrent(snapshot.lesson ?? snapshot);
                  setPane("visuals");
                }
              })
              .catch(() => {});
          setProgress(
            stage === "provider_stream"
              ? "Writing your explanation…"
              : stage === "visual_check"
                ? "Calculating your visual…"
                : stage === "visual_computed"
                  ? "Your visual is ready. Explaining this step…"
                  : "Checking the lesson…",
          );
        },
      );
      finished = true;
      const snapshot = await api(`/api/lessons/${l.id}`);
      if (ownsWork(token) && routeRef.current.startsWith(`/lessons/${l.id}`)) {
        const data = await api(`/api/courses/${l.courseId}`);
        if (!ownsWork(token)) return;
        setCurrent(snapshot.lesson ?? snapshot);
        setCourseData(data);
        setCellContext(null);
      }
      await refreshMe();
    } catch (e: any) {
      if (
        ownsWork(token) &&
        (!targetId || routeRef.current.startsWith(`/lessons/${targetId}`))
      ) {
        setNotice(e.message);
        setQuestion(q);
        if (lessonId) await refreshLesson().catch(() => {});
      }
    } finally {
      finished = true;
      if (ownsWork(token)) {
        expectedTaskRoute.current = null;
        pendingTarget.current = null;
        setBusy(false);
        setPendingQuestion("");
        setProgress("");
        composerRef.current?.focus();
      }
    }
  }
  async function paint(revision: number) {
    if (!current) return;
    await api(`/api/lessons/${current.id}/paint`, "POST", { revision }).catch(
      () => {},
    );
    live.current?.send({
      type: "metric",
      name: "board_render_proxy",
      revision,
    });
  }
  async function openCitation(c: any) {
    await act(async () => {
      await action("source.open", {
        sourceId: c.sourceId,
        versionId: c.versionId,
        passageId: c.passageId,
      });
      setCitation(c);
    });
  }
  async function practice() {
    await act(async () => {
      await action("practice.present", { skill: topic });
      attemptId.current = id();
      setPracticeAnswer("");
      setPracticeResult(null);
      setHint("");
    });
  }
  async function submitPractice(skip = false) {
    await act(async () => {
      const r = await action(
        "practice.record",
        { answer: practiceAnswer, skip },
        current.practice.id,
      );
      setPracticeResult(r);
    });
  }
  function stopCapture() {
    captureLifecycle.current++;
    if (pastedImage) URL.revokeObjectURL(pastedImage);
    setPastedImage(null);
    capture.current?.getTracks().forEach((t) => t.stop());
    capture.current = null;
    if (video.current) video.current.srcObject = null;
    setCapturing(false);
    setPoint(null);
    frameId.current = "";
    if (current)
      void api(`/api/lessons/${current.id}/capture`, "DELETE").catch(() => {});
  }
  async function pasteImage(e: React.ClipboardEvent) {
    const image = Array.from(e.clipboardData.files).find((f) =>
      f.type.startsWith("image/"),
    );
    if (!image) return;
    e.preventDefault();
    stopCapture();
    captureId.current = id();
    setPastedImage(URL.createObjectURL(image));
    setCapturing(true);
  }
  async function share() {
    await act(async () => {
      const lifecycle = ++captureLifecycle.current,
        selectedRoute = routeRef.current;
      if (!navigator.mediaDevices?.getDisplayMedia)
        throw Error(
          "Screen sharing is unavailable in this browser. Use text or paste a saved excerpt.",
        );
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      if (
        lifecycle !== captureLifecycle.current ||
        selectedRoute !== routeRef.current
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      capture.current = stream;
      captureId.current = id();
      stream.getVideoTracks()[0].onended = stopCapture;
      setCapturing(true);
      setPoint(null);
      setTimeout(() => {
        if (video.current) {
          video.current.srcObject = stream;
          void video.current.play();
        }
      }, 0);
    });
  }
  useEffect(() => {
    if (capturing && capture.current && video.current) {
      video.current.srcObject = capture.current;
      void video.current.play().catch(() => {});
    }
  }, [pane, capturing]);
  async function inspectFrame() {
    if ((!video.current && !imageRef.current) || !current) return;
    await act(async () => {
      const v = imageRef.current ?? video.current!;
      const w = v instanceof HTMLImageElement ? v.naturalWidth : v.videoWidth,
        h = v instanceof HTMLImageElement ? v.naturalHeight : v.videoHeight;
      const c = document.createElement("canvas");
      c.width = Math.min(1280, w);
      c.height = Math.round((c.width * h) / w);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      frameId.current = id();
      await api(`/api/lessons/${current.id}/capture`, "POST", {
        captureId: captureId.current,
        frameId: frameId.current,
      });
      if (live.current?.ws?.readyState === 1)
        live.current.send({
          type: "frame",
          captureId: captureId.current,
          frameId: frameId.current,
          mimeType: "image/jpeg",
          data: c.toDataURL("image/jpeg", 0.7).split(",")[1],
        });
      else
        setNotice(
          "Frame selected locally. Start a configured voice lesson to ask the provider about it.",
        );
      setPoint(null);
    });
  }
  async function pointPreview(e: React.MouseEvent<HTMLDivElement>) {
    const v = imageRef.current ?? video.current;
    if (!v || !frameId.current) return;
    const selectedCapture = captureId.current,
      selectedFrame = frameId.current;
    const rect = e.currentTarget.getBoundingClientRect(),
      p = mapPoint(
        e.clientX - rect.left,
        e.clientY - rect.top,
        rect.width,
        rect.height,
        v instanceof HTMLImageElement ? v.naturalWidth : v.videoWidth,
        v instanceof HTMLImageElement ? v.naturalHeight : v.videoHeight,
      );
    if (!p) return;
    await act(async () => {
      await action("screen.point", {
        captureId: captureId.current,
        frameId: frameId.current,
        ...p,
      });
      if (
        captureId.current === selectedCapture &&
        frameId.current === selectedFrame
      )
        setPoint({ left: e.clientX - rect.left, top: e.clientY - rect.top });
    });
  }
  async function toggleVoice(selectedLesson?: any) {
    if (live.current && !live.current.closed) {
      live.current.stop();
      live.current = null;
      setVoiceStatus("Text only");
      return;
    }
    await act(async () => {
      const target = selectedLesson ?? current;
      const referencedLesson =
        routeRef.current.match(/^\/lessons\/([^/]+)/)?.[1];
      if (!target || (referencedLesson && target.id !== referencedLesson))
        throw Error(
          "Your saved lesson is still loading. Wait a moment, then try again.",
        );
      const audio = new LiveAudio(
        setVoiceStatus,
        setCaption,
        (event) =>
          void api(`/api/lessons/${target.id}`)
            .then((snapshot) => {
              if (
                live.current === audio &&
                routeRef.current.startsWith(`/lessons/${target.id}`)
              ) {
                setCurrent(snapshot.lesson ?? snapshot);
                if (event?.name?.startsWith("board.")) setPane("visuals");
              }
            })
            .catch(() => {}),
      );
      live.current = audio;
      try {
        voiceLesson.current = target.id;
        await audio.start(target.id, config.apiOrigin);
      } catch (e) {
        live.current = null;
        setVoiceStatus("Text only");
        throw e;
      }
    });
  }
  async function pause() {
    if (!current) {
      stopCapture();
      return;
    }
    live.current?.stop();
    live.current = null;
    stopCapture();
    await act(async () => {
      await api(`/api/lessons/${current.id}/interrupt`, "POST", {
        quiet: true,
      });
      await api(`/api/lessons/${current.id}/companion`, "DELETE");
      await refreshLesson();
      setVoiceStatus("Paused");
    });
  }
  async function logout() {
    await pause();
    await api("/api/auth/logout", "POST");
    setMe(null);
    setCurrent(null);
    setCourseData(null);
    navigate("/");
  }
  async function replaceSource(s: any, file: File) {
    const token = beginWork(),
      cid = courseData.course.id;
    setBusy(true);
    try {
      const data = new FormData();
      data.append("files", file);
      await api(`/api/courses/${cid}/uploads?replace=${s.id}`, "POST", data);
      const updated = await api(`/api/courses/${cid}`);
      if (ownsWork(token)) setCourseData(updated);
    } catch (e: any) {
      if (ownsWork(token)) setNotice(e.message);
    } finally {
      if (ownsWork(token)) {
        expectedTaskRoute.current = null;
        setBusy(false);
      }
    }
  }
  async function deleteSource(s: any) {
    const origin = routeRef.current,
      cid = courseData.course.id;
    if (
      !window.confirm(
        `Delete ${s.name} and all versions? Copied source excerpts and derived charts will be removed from this course's lessons. Downloaded copies cannot be recalled.`,
      )
    )
      return;
    await act(async () => {
      await api(`/api/sources/${s.id}`, "DELETE");
      const data = await api(`/api/courses/${cid}`);
      if (routeRef.current === origin) setCourseData(data);
      if (current) await refreshLesson();
    });
  }
  const sampleBoard = {
    id: "preview",
    revision: 1,
    kind: "histogram",
    column: "Score",
    mode: "count",
    result: {
      edges: [0, 10, 20, 30, 40],
      counts: [2, 3, 2, 3],
      bins: [2, 3, 2, 3].map((count, i) => ({
        lower: i * 10,
        upper: (i + 1) * 10,
        count,
        mass: count / 10,
        density: count / 100,
      })),
      included: 10,
      missing: 0,
      outside: 0,
    },
  };
  if (loading)
    return (
      <main className="entry">
        <p role="status">Opening your study workspace…</p>
      </main>
    );
  if (!me && config.authentication === "local_test")
    return (
      <main className="entry">
        <h1>Open local test workspace</h1>
        <p>
          The local service could not open your workspace. Check that Docker and
          Supabase are running, then retry.
        </p>
        <button onClick={() => void refreshMe()}>Retry workspace</button>
      </main>
    );
  if (!me)
    return (
      <main className="entry">
        <a className="brand" href="/">
          Live Tutor <span>Statistics workspace</span>
        </a>
        <div className="entry-grid">
          <section>
            <h1>What are you working on?</h1>
            <p className="lead">
              Bring the lecture, your notebook, and the question that stopped
              you.
            </p>
            <div className="sample-excerpt">
              <p>“My histogram peaks at 3. The lecture peaks at 0.03.”</p>
              <p>
                Compare the same scores and bins. Find the source. Then try a
                different problem yourself.
              </p>
            </div>
            <button onClick={() => setSample(!sample)} className="secondary">
              {sample ? "Close sample" : "Try a sample before signing in"}
            </button>
            {sample && (
              <>
                <p className="status-tag">
                  Static sample · no model or saved progress
                </p>
                <Chart board={sampleBoard} />
              </>
            )}
          </section>
          <section className="signin">
            <h2>Bring an assignment</h2>
            <p>
              Your files are private to your account. Relevant excerpts, live
              audio and selected screen frames may be sent to Google Gemini. Raw
              audio and screen frames are not stored by this app.
            </p>
            {config.mode === "fixture" && (
              <p className="fixture">
                Development fixture · local sign-in code 246810. No live
                provider responses.
              </p>
            )}
            <form onSubmit={signIn}>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              {sent && (
                <label>
                  One-time code
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={adult}
                  required
                  onChange={(e) => setAdult(e.target.checked)}
                />
                I am 18 or older and am an invited pilot participant.
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={consent}
                  required
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I understand private file storage and the provider processing
                described above.
              </label>
              <button type="submit">{sent ? "Sign in" : "Send a code"}</button>
              {sent && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setSent(false);
                    setCode("");
                  }}
                >
                  Request another code
                </button>
              )}
            </form>
            {notice && (
              <p role="alert" className="notice">
                {notice}
              </p>
            )}
          </section>
        </div>
      </main>
    );
  const ready =
    courseData?.sources.flatMap((s: any) =>
      s.status.startsWith("ready") ? [s] : s.published ? [s.published] : [],
    ) ?? [];
  const material =
    ready.find((s: any) => s.id === materialId) ??
    ready.find((s: any) => s.notebook) ??
    ready[0];
  const isLibrary = pathname === "/" && libraryMode;
  const selectedSourceIds =
    scopeDraft && scopeDraft.lessonId === current?.id
      ? scopeDraft.ids
      : current?.selectedSourceIds == null
        ? ready.map((source: any) => source.id)
        : ready
            .filter((source: any) =>
              current.selectedSourceIds.includes(source.id),
            )
            .map((source: any) => source.id);
  const messages =
    current?.messages?.filter(
      (m: any) => m.role === "student" || m.role === "tutor",
    ) ?? [];
  const lessonTitle = contextPending
    ? "Loading your saved lesson…"
    : (messages
        .find((m: any) => m.role === "student")
        ?.text.split("\n")[0]
        .slice(0, 68) ?? "Your study space");
  const voiceActive = Boolean(live.current && !live.current.closed);
  const voiceReady = config.liveAvailable === true && me.remainingSeconds > 0;
  const interrupt = () => {
    if (live.current && !live.current.closed) {
      live.current.interrupt();
      return;
    }
    void act(async () => {
      if (current) {
        await api(`/api/lessons/${current.id}/interrupt`, "POST", {});
        await refreshLesson();
      }
    });
  };
  const voicePanel = (
    <section className="voice-panel" aria-label="Voice lesson">
      <div className="voice-session" role="status">
        <span className="voice-pulse" />
        <span>{voiceStatus}</span>
        <button type="button" className="secondary" onClick={interrupt}>
          Interrupt tutor
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => void toggleVoice()}
        >
          Stop voice
        </button>
      </div>
      {caption && <p className="live-caption">Live caption: {caption}</p>}
    </section>
  );
  const composer = (
    <div className="composer-dock">
      {cellContext && (
        <div className="context-chip">
          <Icon name="book" size={16} />
          <span>
            {cellContext.filename} · {cellContext.label}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Remove selected cell"
            onClick={() => setCellContext(null)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      <form className="composer" onSubmit={ask}>
        <label htmlFor="question" className="sr-only">
          Ask about your work
        </label>
        <textarea
          ref={composerRef}
          id="question"
          rows={2}
          maxLength={4000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question, or bring your coursework…"
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (question.trim() && !busy && !contextPending)
                e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="composer-actions">
          <div className="composer-tools">
            <button
              type="button"
              className="icon-button"
              aria-label="Attach course files"
              title="Attach coursework or a DSA JSON dataset"
              disabled={busy || contextPending}
              onClick={() => fileInput.current?.click()}
            >
              <Icon name="paperclip" />
            </button>
            <button
              type="button"
              className="text-button workspace-button"
              disabled={contextPending}
              onClick={() => setPane(pane ? null : "materials")}
              aria-expanded={Boolean(pane && !contextPending)}
            >
              <Icon name="book" size={17} />
              Workspace
            </button>
          </div>
          <div className="composer-tools">
            {busy ? (
              <button
                type="button"
                className="icon-button"
                aria-label="Stop response"
                onClick={interrupt}
              >
                <Icon name="stop" />
              </button>
            ) : (
              <button
                type="button"
                className="voice-button"
                disabled={(!voiceReady || contextPending) && !voiceActive}
                title={
                  contextPending
                    ? "Your saved lesson is loading. Voice will be available when it is ready."
                    : !voiceReady
                      ? me.remainingSeconds <= 0
                        ? "No voice minutes remain in this workspace."
                        : (config.providerReadiness?.voice?.reason ??
                          "Voice is unavailable in this environment")
                      : "Start a voice conversation"
                }
                onClick={() =>
                  void act(async () => {
                    await toggleVoice(await ensureLesson());
                  })
                }
                aria-label={voiceActive ? "Stop voice" : "Start live"}
              >
                <Icon name="voice" />
                <span>Voice</span>
              </button>
            )}
            <button
              type="submit"
              className="send-button"
              disabled={busy || contextPending || !question.trim()}
              aria-label="Ask"
            >
              <Icon name="arrow" />
            </button>
          </div>
        </div>
      </form>
      <p className="composer-note" role={contextPending ? "status" : undefined}>
        {contextPending
          ? contextFailure
            ? "Your saved lesson could not load. Retry before continuing."
            : "Loading your saved lesson and sources. You can draft a question while you wait."
          : voiceReady
            ? "Voice and text share your lesson."
            : "Text available · voice setup pending."}{" "}
        <span>Check explanations against your sources.</span>
      </p>
      <input
        ref={fileInput}
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload course files"
        type="file"
        disabled={busy || contextPending}
        multiple
        accept=".pdf,.csv,.txt,.md,.ipynb,.json"
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
  return (
    <div
      className={`shell notebook-shell ${isLibrary ? "library-shell" : ""} ${pane && !contextPending ? "has-workspace" : ""} ${railOpen ? "rail-open" : ""} ${!contextPending && current?.board?.kind === "dsa" && pane === "visuals" ? "dsa-workspace" : ""}`}
      data-mobile-tab={mobileTab}
      data-workspace-view={pane ?? "studio"}
      data-studio-expanded={studioExpanded}
    >
      <a className="skip-link" href="#main">
        Skip to lesson
      </a>
      <aside
        hidden={!railOpen}
        ref={railRef}
        className="rail"
        aria-label="Courses and conversations"
      >
        <a className="brand" href="/">
          <span className="brand-mark">
            <Icon name="sparkle" size={23} />
          </span>
          <span>
            Live Tutor<small>Think it through.</small>
          </span>
        </a>
        <button className="new-chat" onClick={newDraft}>
          <Icon name="plus" />
          New draft
        </button>
        <div className="rail-scroll">
          <nav aria-label="Saved work">
            <p className="rail-label">COURSES</p>
            {me.courses.map((c: any) => (
              <button
                className={`course-link ${courseData?.course.id === c.id ? "selected" : ""}`}
                key={c.id}
                onClick={() => {
                  setCurrent(null);
                  navigate(`/courses/${c.id}`);
                  setRailOpen(false);
                  setPane("materials");
                }}
              >
                <Icon name="book" size={17} />
                <span>{c.name}</span>
              </button>
            ))}
            {me.lessons.length > 0 && (
              <>
                <p className="rail-label">RECENT CONVERSATIONS</p>
                {me.lessons
                  .slice()
                  .reverse()
                  .slice(0, 12)
                  .map((l: any) => (
                    <button
                      className={`course-link ${current?.id === l.id ? "selected" : ""}`}
                      key={l.id}
                      onClick={() => {
                        navigate(`/lessons/${l.id}`);
                        setRailOpen(false);
                      }}
                    >
                      <span>{l.title ?? l.goal}</span>
                    </button>
                  ))}
              </>
            )}
          </nav>
        </div>
        <div className="rail-bottom">
          <button
            className="nav-item"
            onClick={() => {
              navigate("/settings");
              setRailOpen(false);
            }}
          >
            <Icon name="settings" />
            Settings & data
          </button>
          <div className="account">
            <span className="avatar">
              {me.authentication === "local_test"
                ? "L"
                : me.email?.[0]?.toUpperCase()}
            </span>
            <div>
              <strong>
                {me.authentication === "local_test"
                  ? "Local workspace"
                  : "Your workspace"}
              </strong>
              <small>
                {me.authentication === "local_test"
                  ? "Sign-in skipped for testing"
                  : "Adult pilot"}
              </small>
            </div>
          </div>
          {me.authentication !== "local_test" && (
            <button className="text-button" onClick={() => void logout()}>
              Sign out
            </button>
          )}
        </div>
      </aside>
      {railOpen && (
        <button
          className="rail-backdrop"
          aria-label="Close navigation"
          onClick={() => setRailOpen(false)}
        />
      )}
      <main id="main" className="main">
        <header className="topbar">
          <div className="header-title">
            <button
              className="icon-button notebook-back"
              aria-label="All notebooks"
              title="All notebooks"
              onClick={() => {
                setLibraryMode(true);
                setPaneState(null);
                void refreshMe();
                navigate("/");
              }}
            >
              <Icon name={isLibrary ? "book" : "back"} size={22} />
            </button>
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={railOpen}
              onClick={() => setRailOpen(!railOpen)}
            >
              <Icon name="menu" />
            </button>
            <div>
              <p className="breadcrumb">
                {contextPending
                  ? "Loading notebook"
                  : isLibrary
                    ? "Live Tutor"
                    : "Live Tutor / notebook"}
              </p>
              <h1>
                {isSettings
                  ? "Settings & data"
                  : isRecap
                    ? "Your progress"
                    : isLibrary
                      ? "Live Tutor"
                      : (courseData?.course.name ?? lessonTitle)}
              </h1>
            </div>
          </div>
          <div className="header-actions">
            <button
              className="icon-button"
              aria-label="New conversation"
              title="Start a new draft"
              onClick={newDraft}
            >
              <Icon name="plus" />
            </button>
            <button
              className="icon-button"
              aria-label="Settings & data"
              title="Settings & data"
              onClick={() => navigate("/settings")}
            >
              <Icon name="settings" />
            </button>
            {courseData && !contextPending && !isLibrary && (
              <button
                className="secondary"
                ref={sourceButton}
                onClick={() => setSourcesOpen(true)}
              >
                Sources ({courseData.sources.length})
              </button>
            )}
            {current && !isRecap && !isLibrary && (
              <button
                className="icon-button"
                title="Lesson recap"
                aria-label="Recap"
                onClick={() => navigate(`/lessons/${current.id}/recap`)}
              >
                <Icon name="check" />
              </button>
            )}
          </div>
        </header>
        {config.mode === "fixture" && (
          <div className="fixture compact">
            Development fixture · scripted replies, no live provider.
          </div>
        )}
        {notice && (
          <div role="alert" className="notice">
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss"
              onClick={() => setNotice("")}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        {current?.quiet && (
          <p role="status" className="quiet-status">
            Paused · work silently
          </p>
        )}
        {capturing && (
          <div className="active-share-stop">
            <span>Sharing your selected window</span>
            <button className="danger" onClick={stopCapture}>
              Stop sharing window
            </button>
          </div>
        )}
        {voiceActive && voicePanel}
        {isLibrary ? (
          <NotebookLibrary
            courses={me.courses}
            lessons={me.lessons}
            onOpenCourse={(course) => void openNotebook(course)}
            onOpenLesson={(lesson) => {
              setLibraryMode(false);
              setPaneState(null);
              setMobileTab("chat");
              navigate(`/lessons/${lesson}`);
            }}
            onCreate={() => {
              setNotebookName("");
              setNotebookModal("new");
            }}
            onRenameCourse={async (course, name) => {
              await api(`/api/courses/${course}`, "PATCH", { name });
              await refreshMe();
            }}
          />
        ) : isSettings ? (
          <section className="settings">
            <h2>Private course storage</h2>
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(me.preferences?.liveTranscript)}
                onChange={(e) =>
                  void act(async () => {
                    await api("/api/preferences", "PATCH", {
                      liveTranscript: e.target.checked,
                    });
                    await refreshMe();
                  })
                }
              />
              Save completed live captions to my lesson. Off by default; this
              never records raw audio or screen frames.
            </label>
            <p>
              Your uploads and confirmed lesson state are saved. Google Gemini
              receives only the excerpts, audio and selected frames required for
              the active lesson. Recording is off.
            </p>
            <p>
              {Math.floor(me.remainingSeconds / 60)} live minutes remaining.
              Fixture allowances are synthetic.
            </p>
            <p>
              Provider retention, hosting backup expiry, real payment
              fulfillment and deployment remain unverified until staging
              acceptance.
            </p>
            <button
              className="secondary"
              onClick={() => {
                const blob = new Blob(
                  [
                    JSON.stringify(
                      { courses: me.courses, lesson: current },
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json" },
                );
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "lesson-recap.json";
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              Export current lesson
            </button>
            <p>
              Delete a source from Sources. This revokes future reads and clears
              derived source excerpts in its course.
            </p>
            <button
              className="danger"
              onClick={() =>
                void act(async () => {
                  if (
                    !confirm(
                      "Delete your account, all courses, sources and saved lessons?",
                    )
                  )
                    return;
                  await api("/api/account", "DELETE");
                  setMe(null);
                  navigate("/");
                })
              }
            >
              Delete account and data
            </button>
          </section>
        ) : isRecap && current ? (
          <section className="recap">
            <h2>
              {current.attempts.length
                ? "Your attempt ledger"
                : "No independent attempt recorded yet"}
            </h2>
            <p>
              A worked example is useful practice. Independent evidence comes
              from your own answer to a new problem.
            </p>
            {current.attempts.map((a: any) => (
              <article className="attempt" key={a.id}>
                <h3>
                  {a.skill} ·{" "}
                  {a.independent
                    ? "Independent first response"
                    : "Assisted response"}
                </h3>
                <p>{a.answer || "Skipped"}</p>
                <p>
                  {a.skipped
                    ? "Skipped; evidence is insufficient."
                    : `Numeric check: ${a.result.numeric ? "correct" : "needs another look"}. Reasoning: ${a.result.reasoning ? "supported" : "unclear or incomplete"}.`}
                </p>
                <p className="small">Attempt {a.id}</p>
              </article>
            ))}
            <button onClick={() => navigate(`/lessons/${current.id}`)}>
              Resume the problem
            </button>
          </section>
        ) : (
          <>
            <nav className="notebook-mobile-tabs" aria-label="Notebook panels">
              {(["sources", "chat", "studio"] as const).map((tab) => (
                <button
                  key={tab}
                  aria-pressed={mobileTab === tab}
                  onClick={() => setMobileTab(tab)}
                >
                  {tab === "sources"
                    ? "Sources"
                    : tab === "chat"
                      ? "Chat"
                      : "Studio"}
                </button>
              ))}
            </nav>
            <div className="lesson-layout">
              <SourcesPanel
                sources={contextPending ? [] : (courseData?.sources ?? [])}
                selectedIds={selectedSourceIds}
                disabled={contextPending}
                busy={sourceBusy || busy}
                onSelection={(ids) => void selectSources(ids)}
                onPreview={(source) => {
                  setMaterialId(source.id);
                  setPane("materials");
                }}
                onAdd={() => fileInput.current?.click()}
                onCreateNote={() => {
                  if (current) {
                    setPaneState(null);
                    setMobileTab("studio");
                    setNoteCreate((value) => value + 1);
                  } else
                    void act(async () => {
                      await ensureLesson();
                      setPaneState(null);
                      setMobileTab("studio");
                      setNoteCreate((value) => value + 1);
                    });
                }}
                onManage={() => setSourcesOpen(true)}
              />
              <div
                className={`chat-column ${pane && !contextPending ? "workspace-open" : ""}`}
              >
                <header className="chat-panel-header">
                  <h2>Chat</h2>
                  <div>
                    <span>
                      {selectedSourceIds.length}{" "}
                      {selectedSourceIds.length === 1 ? "source" : "sources"}
                    </span>
                    {current && (
                      <button
                        className="icon-button"
                        aria-label="New chat in this notebook"
                        title="New chat in this notebook"
                        onClick={() => void startLesson()}
                        disabled={busy || contextPending}
                      >
                        <Icon name="plus" size={18} />
                      </button>
                    )}
                  </div>
                </header>
                <div className="conversation-scroll" ref={conversationRef}>
                  {contextPending ? (
                    <section
                      className="lesson-primer"
                      data-testid="lesson-loading"
                    >
                      <h2>
                        {contextFailure
                          ? "Your saved lesson could not load"
                          : "Loading your saved lesson…"}
                      </h2>
                      <p>
                        {contextFailure
                          ? "Retry to restore the saved conversation and its sources."
                          : "Restoring your conversation and sources. You can draft your next question below."}
                      </p>
                      {contextFailure && (
                        <button
                          className="secondary"
                          onClick={() => {
                            setNotice("");
                            void loadRouteContext();
                          }}
                        >
                          Retry loading lesson
                        </button>
                      )}
                    </section>
                  ) : messages.length === 0 &&
                    !pendingQuestion &&
                    !voiceActive &&
                    !current?.board ? (
                    <section className="welcome">
                      <div className="welcome-mark">
                        <Icon name="sparkle" size={32} />
                      </div>
                      <p className="eyebrow">
                        A LITTLE CLARITY GOES A LONG WAY
                      </p>
                      <h2>
                        {courseData?.course.name ??
                          "What are we learning today?"}
                      </h2>
                      <p>
                        {ready.length
                          ? `${selectedSourceIds.length} selected sources, ready to explore. Ask a question, compare ideas or turn your material into a study tool.`
                          : "Bring a question or add your coursework. Your sources, conversations and study materials stay together."}
                      </p>
                      <div className="suggestions">
                        <button
                          onClick={() => {
                            setQuestion(
                              ready.length
                                ? "Summarize the main ideas in my selected sources and cite the evidence."
                                : "Help me understand this assignment step by step.",
                            );
                            composerRef.current?.focus();
                          }}
                        >
                          <Icon name="book" />
                          <span>
                            {ready.length
                              ? "Summarize my sources"
                              : "Understand my coursework"}
                            <small>
                              {ready.length
                                ? "Start with the key ideas"
                                : "Start with a question or a file"}
                            </small>
                          </span>
                          <Icon name="arrow" size={17} />
                        </button>
                        <button
                          onClick={() => {
                            setQuestion(
                              ready.some((source: any) => source.dsa)
                                ? "Explain BFS on my undirected graph starting at A, one displayed step at a time."
                                : ready.length
                                  ? "Explain a key relationship in my selected sources using an appropriate visual."
                                  : "Show vectors u = [2, 2] and v = [-1, 3], and explain the projection of u onto v.",
                            );
                            composerRef.current?.focus();
                          }}
                        >
                          <Icon name="chart" />
                          <span>
                            Make it visual
                            <small>Explore a computed model</small>
                          </span>
                          <Icon name="arrow" size={17} />
                        </button>
                      </div>
                      {!courseData && (
                        <button
                          className="text-button sample-link"
                          onClick={() => void createCourse(true)}
                        >
                          Try the included statistics course{" "}
                          <Icon name="arrow" size={15} />
                        </button>
                      )}
                      {courseData && !current && (
                        <button
                          className="secondary"
                          onClick={() => void startLesson()}
                        >
                          Open lesson
                        </button>
                      )}
                    </section>
                  ) : (
                    <section
                      className="conversation"
                      aria-label="Lesson conversation"
                    >
                      {messages.length === 0 && (
                        <div className="lesson-primer">
                          <span className="eyebrow">YOUR LIVE WORKSPACE</span>
                          <h2>
                            {current?.board?.kind === "dsa"
                              ? "See the algorithm unfold."
                              : "Let’s work through it."}
                          </h2>
                          <p>
                            {current?.board?.kind === "dsa"
                              ? "Ask about a node, compare BFS and DFS, or use Next step to inspect the queue and visited nodes."
                              : "Speak or type a question. Relevant visuals open beside the explanation."}
                          </p>
                        </div>
                      )}
                      {messages.map((m: any) => (
                        <article
                          key={m.id}
                          className={
                            m.role === "student"
                              ? "student-message"
                              : "tutor-message"
                          }
                        >
                          <div className="message-author">
                            {m.role === "tutor" && (
                              <span className="tutor-avatar">
                                <Icon name="sparkle" size={17} />
                              </span>
                            )}
                            <strong>
                              {m.role === "student"
                                ? "You"
                                : m.fixture
                                  ? "Tutor · development fixture"
                                  : "Live Tutor"}
                            </strong>
                          </div>
                          <RichText
                            text={
                              m.role === "student"
                                ? m.text.split(
                                    "\n\nSelected uploaded cell (",
                                  )[0]
                                : m.text
                            }
                          />
                          {m.role === "student" &&
                            m.text.includes("\n\nSelected uploaded cell (") && (
                              <details className="message-cell-context">
                                <summary>Attached notebook cell</summary>
                                <RichText
                                  text={
                                    m.text.split(
                                      "\n\nSelected uploaded cell (",
                                    )[1]
                                  }
                                />
                              </details>
                            )}
                          {m.status === "failed" && (
                            <p className="message-failed">
                              The reply did not finish. You can edit your
                              question and try again.
                            </p>
                          )}
                          {m.citations?.map((c: any) => (
                            <button
                              className="citation"
                              key={c.passageId}
                              onClick={() => void openCitation(c)}
                            >
                              <Icon name="book" size={15} />
                              {c.filename} · {sourceLocation(c.locator)}
                            </button>
                          ))}
                          {m.receipt && (
                            <button
                              className="visual-receipt"
                              onClick={() => setPane("visuals")}
                            >
                              <Icon name="chart" size={17} />
                              Open computed visual
                              <Icon name="arrow" size={15} />
                            </button>
                          )}
                          {m.role === "tutor" && m.status !== "failed" && (
                            <div className="answer-actions">
                              <button
                                className="text-button"
                                aria-label="Save response to note"
                                onClick={() => void saveAnswer(m)}
                              >
                                <Icon name="note" size={16} />
                                Save to note
                              </button>
                              <button
                                className="icon-button"
                                aria-label="Copy response"
                                title="Copy response"
                                onClick={() => void copyAnswer(m.text)}
                              >
                                <Icon name="copy" size={16} />
                              </button>
                              <button
                                className="icon-button"
                                aria-label="Download response"
                                title="Download response"
                                onClick={() => {
                                  const blob = new Blob([m.text], {
                                      type: "text/markdown",
                                    }),
                                    url = URL.createObjectURL(blob),
                                    link = document.createElement("a");
                                  link.href = url;
                                  link.download = "tutor-response.md";
                                  link.click();
                                  setTimeout(
                                    () => URL.revokeObjectURL(url),
                                    1000,
                                  );
                                }}
                              >
                                <Icon name="download" size={16} />
                              </button>
                            </div>
                          )}
                        </article>
                      ))}
                      {pendingQuestion &&
                        !messages.some(
                          (m: any) => m.text === pendingQuestion,
                        ) && (
                          <article className="student-message pending-message">
                            <div className="message-author">
                              <strong>You</strong>
                            </div>
                            <p>{pendingQuestion}</p>
                          </article>
                        )}
                    </section>
                  )}
                  {busy && (
                    <p role="status" className="thinking">
                      <span className="thinking-dot" />
                      {progress || "Checking your work…"}
                    </p>
                  )}
                </div>
                {composer}
              </div>
              <aside className="notebook-studio" aria-label="Studio">
                <header className="notebook-panel-header">
                  <h2>Studio</h2>
                  <button className="icon-button studio-expand" aria-label="Expand Studio" aria-pressed={studioExpanded} title={studioExpanded?'Restore Studio size':'Expand Studio'} onClick={()=>setStudioExpanded(value=>!value)}><Icon name="expand" size={18}/></button>
                  <button
                    className="icon-button"
                    aria-label="Studio home"
                    title="Studio home"
                    onClick={() => {
                      setPaneState(null);
                      setMobileTab("studio");
                      requestAnimationFrame(()=>studioHomeRef.current?.scrollTo({top:0,behavior:'auto'}));
                    }}
                  >
                    <Icon name="grid" size={18} />
                  </button>
                </header>
                {pane && !contextPending && (
                  <aside
                    ref={workspaceRef}
                    tabIndex={-1}
                    className="workspace"
                    aria-label="Lesson workspace"
                  >
                    <header className="workspace-header">
                      <nav aria-label="Workspace views">
                        {(
                          [
                            ["materials", "Materials"],
                            ["visuals", "Visuals"],
                            ["practice", "Practice"],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            className={pane === value ? "selected" : ""}
                            aria-pressed={pane === value}
                            onClick={() => setPane(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </nav>
                      <button
                        className="icon-button"
                        aria-label="Close workspace"
                        onClick={() => setPane(null)}
                      >
                        <Icon name="close" size={18} />
                      </button>
                    </header>
                    <div className="workspace-body">
                      {pane === "materials" ? (
                        <>
                          <div className="panel-heading">
                            <h2>Your materials</h2>
                            <button
                              className="icon-button"
                              aria-label="Add materials"
                              onClick={() => fileInput.current?.click()}
                            >
                              <Icon name="plus" />
                            </button>
                          </div>
                          {ready.length > 0 ? (
                            <>
                              <label className="material-picker">
                                File
                                <select
                                  aria-label="Select material"
                                  value={material?.id ?? ""}
                                  onChange={(e) =>
                                    setMaterialId(e.target.value)
                                  }
                                >
                                  {ready.map((s: any) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {material?.notebook ? (
                                <NotebookPreview
                                  key={material.id}
                                  notebook={material.notebook}
                                  filename={material.name}
                                  onAsk={(context) => {
                                    setCellContext({
                                      ...context,
                                      filename: material.name,
                                    });
                                    setQuestion(
                                      "Help me understand this cell.",
                                    );
                                    if (window.innerWidth <= 650) setPane(null);
                                    setTimeout(
                                      () => composerRef.current?.focus(),
                                      0,
                                    );
                                  }}
                                />
                              ) : material?.passages?.length ? (
                                <section className="material-excerpts">
                                  <h3>{material.name}</h3>
                                  {material.passages
                                    .slice(0, 40)
                                    .map((p: any) => (
                                      <article key={p.id}>
                                        <RichText text={p.text} />
                                        <button
                                          className="citation"
                                          onClick={() =>
                                            setCitation({
                                              sourceId: material.id,
                                              versionId: material.versionId,
                                              filename: material.name,
                                              passageId: p.id,
                                              text: p.text,
                                              locator: p.locator,
                                            })
                                          }
                                        >
                                          Open{" "}
                                          {p.locator.pageIndex !== undefined
                                            ? `physical page ${p.locator.pageIndex + 1}`
                                            : p.locator.rowStart
                                              ? `rows ${p.locator.rowStart}–${p.locator.rowEnd}`
                                              : "source location"}
                                        </button>
                                      </article>
                                    ))}
                                </section>
                              ) : (
                                <p>
                                  No readable preview is available. Check
                                  Sources for the processing status.
                                </p>
                              )}
                            </>
                          ) : (
                            <div className="workspace-empty">
                              <Icon name="book" size={28} />
                              <h3>Bring your coursework</h3>
                              <p>
                                PDF, Jupyter notebook, CSV, text or DSA JSON. Up
                                to 25 MB per file. Code is read without running
                                it.
                              </p>
                              <button
                                className="secondary"
                                onClick={() => fileInput.current?.click()}
                              >
                                Attach files
                              </button>
                            </div>
                          )}
                          {courseData?.sources.some(
                            (s: any) => s.status === "indexing",
                          ) && (
                            <p role="status">
                              Processing your attachments. Ready files are
                              available now.
                            </p>
                          )}
                          <button
                            className="text-button"
                            onClick={() => setSourcesOpen(true)}
                          >
                            Manage files & versions
                          </button>
                        </>
                      ) : pane === "visuals" ? (
                        current ? (
                          <>
                            <div className="panel-heading">
                              <h2>
                                {current.board
                                  ? "Your computed visual"
                                  : "Explore a model"}
                              </h2>
                              <span className="small">
                                {current.board
                                  ? `Revision ${current.board.revision}`
                                  : "Calculated, then rendered"}
                              </span>
                            </div>
                            <Chart
                              board={current.board}
                              onPaint={paint}
                              onPatch={(args) =>
                                act(() => action("board.patch", args))
                              }
                            />
                            {current.board && (
                              <label>
                                Chart title{" "}
                                <input
                                  key={`${current.board.id}:${current.board.revision}`}
                                  maxLength={120}
                                  defaultValue={current.board.label ?? ""}
                                  placeholder="Add a title"
                                  onBlur={(e) => {
                                    if (
                                      e.target.value !==
                                      (current.board.label ?? "")
                                    )
                                      void act(() =>
                                        action("board.patch", {
                                          label: e.target.value,
                                        }),
                                      );
                                  }}
                                />
                              </label>
                            )}
                            {current.board?.sourceId && (
                              <p className="small">
                                Dataset:{" "}
                                {
                                  ready.find(
                                    (s: any) => s.id === current.board.sourceId,
                                  )?.name
                                }{" "}
                                · version{" "}
                                {current.board.sourceVersionId?.slice(0, 8)}
                              </p>
                            )}
                            {!current.board && (
                              <CreateChart
                                sources={ready}
                                onCreate={(args) =>
                                  act(() => action("board.create", args, id()))
                                }
                              />
                            )}
                            {current.board && (
                              <CreateChart
                                key={`${current.board.id}:${current.board.kind}:${current.board.sourceId ?? ""}`}
                                mode="replace"
                                sources={ready}
                                defaultKind={current.board.kind}
                                defaultSourceId={current.board.sourceId}
                                defaultAlgorithm={current.board.algorithm}
                                defaultStartNode={current.board.startNode}
                                defaultTargetValue={current.board.targetValue}
                                onCreate={(args) =>
                                  act(() => action("board.replace", args))
                                }
                              />
                            )}
                            {current.board?.kind === "histogram" && (
                              <div className="chart-controls">
                                <label>
                                  Bins
                                  <input
                                    aria-label="Bin count"
                                    type="range"
                                    min="1"
                                    max="20"
                                    value={current.board.result.bins.length}
                                    onChange={(e) =>
                                      void act(() =>
                                        action("board.patch", {
                                          binCount: Number(e.target.value),
                                        }),
                                      )
                                    }
                                  />
                                  <output>
                                    {current.board.result.bins.length}
                                  </output>
                                </label>
                                <div className="button-row">
                                  <button
                                    aria-pressed={
                                      current.board.mode !== "density"
                                    }
                                    className="secondary"
                                    onClick={() =>
                                      void act(() =>
                                        action("board.patch", {
                                          mode: "count",
                                        }),
                                      )
                                    }
                                  >
                                    Count
                                  </button>
                                  <button
                                    aria-pressed={
                                      current.board.mode === "density"
                                    }
                                    className="secondary"
                                    onClick={() =>
                                      void act(() =>
                                        action("board.patch", {
                                          mode: "density",
                                        }),
                                      )
                                    }
                                  >
                                    Density
                                  </button>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      void act(() => action("board.undo"))
                                    }
                                  >
                                    Undo board change
                                  </button>
                                </div>
                                <Equation />
                              </div>
                            )}

                            {current.board?.kind !== "histogram" &&
                              current.board && (
                                <button
                                  className="text-button"
                                  disabled={!current.board.history?.length}
                                  onClick={() =>
                                    void act(() => action("board.undo"))
                                  }
                                >
                                  Undo board change
                                </button>
                              )}
                            <Illustrations
                              lesson={current}
                              available={config.illustrationsAvailable === true}
                              estimateUsd={
                                config.illustrationEstimateUsd ?? null
                              }
                              api={api}
                            />
                          </>
                        ) : (
                          <div className="workspace-empty">
                            <Icon name="chart" size={28} />
                            <h3>Ask for a visual</h3>
                            <p>
                              Describe vectors, or upload data for a histogram
                              or regression plot. The tutor uses checked
                              calculations.
                            </p>
                            <button
                              className="secondary"
                              onClick={() =>
                                void ensureLesson().catch((e) =>
                                  setNotice(e.message),
                                )
                              }
                            >
                              Open visual tools
                            </button>
                          </div>
                        )
                      ) : pane === "practice" ? (
                        current ? (
                          <>
                            <p className="small">
                              Reviewed practice library · histograms,
                              probability and regression. Your uploaded
                              assignment is kept separately.
                            </p>
                            <div className="practice">
                              <div className="panel-heading">
                                <h3>Try it without help</h3>
                                <select
                                  aria-label="Practice topic"
                                  value={topic}
                                  onChange={(e) => setTopic(e.target.value)}
                                >
                                  <option value="histogram">Histograms</option>
                                  <option value="probability">
                                    Conditional probability
                                  </option>
                                  <option value="regression">Regression</option>
                                </select>
                              </div>
                              {current.practice ? (
                                <>
                                  <p>
                                    {current.practice.prompt ??
                                      prompts[current.practice.skill]}
                                  </p>
                                  <label>
                                    Your answer and reasoning
                                    <textarea
                                      value={practiceAnswer}
                                      onChange={(e) =>
                                        setPracticeAnswer(e.target.value)
                                      }
                                      placeholder="Prediction, units, and why"
                                    />
                                  </label>
                                  <div className="button-row">
                                    <button
                                      className="secondary"
                                      onClick={() => void submitPractice()}
                                    >
                                      Record my attempt
                                    </button>
                                    <button
                                      className="text-button"
                                      onClick={() =>
                                        void act(async () => {
                                          const h = await api(
                                            `/api/lessons/${current.id}/hint`,
                                            "POST",
                                          );
                                          setHint(h.hint);
                                          await refreshLesson();
                                        })
                                      }
                                    >
                                      Give me a hint
                                    </button>
                                    <button
                                      className="text-button"
                                      onClick={() => void submitPractice(true)}
                                    >
                                      Skip
                                    </button>
                                  </div>
                                  {hint && <p role="status">Hint: {hint}</p>}
                                  {practiceResult && (
                                    <p role="status" className="feedback">
                                      {practiceResult.skipped
                                        ? "Skipped."
                                        : `${practiceResult.independent ? "Independent" : "Assisted"} response recorded. Numeric check ${practiceResult.result.numeric ? "correct" : "needs another look"}.`}{" "}
                                      {practiceResult.solution}
                                    </p>
                                  )}
                                  <button
                                    className="text-button"
                                    onClick={() => void practice()}
                                  >
                                    Start another practice item
                                  </button>
                                </>
                              ) : (
                                <>
                                  <p>
                                    Predict a result on different data before
                                    seeing the solution. Your first response is
                                    saved separately from hints.
                                  </p>
                                  <button
                                    className="secondary"
                                    onClick={() => void practice()}
                                  >
                                    Start independent practice
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        ) : (
                          <p>
                            Start a conversation to record practice in your
                            lesson.
                          </p>
                        )
                      ) : (
                        <>
                          <h2>Lesson tools</h2>
                          <p className="small">
                            Share only the window you choose. A frame is sent
                            when you explicitly select it.
                          </p>
                          <div className="button-row">
                            <button
                              className="secondary"
                              onClick={() =>
                                capturing ? stopCapture() : void share()
                              }
                            >
                              {capturing ? "Stop sharing" : "Share a window"}
                            </button>
                            <button
                              className="secondary"
                              onClick={() => void pause()}
                            >
                              Pause tutor
                            </button>
                            <button
                              className="secondary"
                              onClick={() =>
                                void act(async () =>
                                  setPair(
                                    await api(
                                      `/api/lessons/${current.id}/pair`,
                                      "POST",
                                    ),
                                  ),
                                )
                              }
                            >
                              Pair notebook
                            </button>
                          </div>
                          {capturing && (
                            <>
                              <div
                                className="capture-preview"
                                onClick={pointPreview}
                              >
                                {pastedImage ? (
                                  <img
                                    ref={imageRef}
                                    src={pastedImage}
                                    alt="Pasted task image"
                                  />
                                ) : (
                                  <video
                                    ref={video}
                                    muted
                                    playsInline
                                    aria-label="Selected window preview"
                                    onResize={() => {
                                      setPoint(null);
                                      frameId.current = "";
                                    }}
                                  />
                                )}
                                {point && (
                                  <span
                                    className="preview-point"
                                    style={point}
                                    aria-label="Selected point"
                                  />
                                )}
                              </div>
                              <button
                                className="secondary"
                                onClick={() => void inspectFrame()}
                              >
                                Select current frame
                              </button>
                              <button
                                className="text-button"
                                onClick={() =>
                                  void act(async () => {
                                    await action("screen.point", {
                                      captureId: captureId.current,
                                      frameId: frameId.current,
                                      x: 0.5,
                                      y: 0.5,
                                    });
                                    setPoint({ left: "50%", top: "50%" });
                                  })
                                }
                              >
                                Point at preview center
                              </button>
                            </>
                          )}
                          <div
                            className="paste-target"
                            tabIndex={0}
                            onPaste={pasteImage}
                          >
                            Paste an image here to share a task screenshot.
                          </div>
                          {pair && (
                            <div className="grant">
                              <h3>Pair only your JupyterLab instance</h3>
                              <p>
                                Paste this single-use connection URL in the
                                local Tutor panel. Uploaded notebooks remain
                                read-only.
                              </p>
                              <textarea
                                aria-label="Companion connection URL"
                                readOnly
                                value={pair.url}
                              />
                              <button
                                className="text-button"
                                onClick={() =>
                                  void act(async () => {
                                    const c = await api(
                                      `/api/lessons/${current.id}/companion`,
                                    );
                                    setCompanion(c);
                                    if (c.snapshot)
                                      setReplacement(c.snapshot.source);
                                  })
                                }
                              >
                                Check paired notebook
                              </button>
                              {companion?.snapshot && (
                                <>
                                  <p>
                                    {companion.snapshot.notebookPath} · cell{" "}
                                    {companion.snapshot.cellId}
                                  </p>
                                  <label>
                                    Focus a notebook cell
                                    <select
                                      aria-label="Paired notebook cell"
                                      value={companion.snapshot.cellId}
                                      onChange={(e) =>
                                        void act(async () => {
                                          const cellId = e.target.value;
                                          await api(
                                            `/api/lessons/${current.id}/companion/actions`,
                                            "POST",
                                            {
                                              actionId: id(),
                                              turnEpoch: current.epoch,
                                              type: "notebook.focus",
                                              args: { cellId },
                                            },
                                          );
                                          for (
                                            let attempt = 0;
                                            attempt < 12;
                                            attempt++
                                          ) {
                                            await new Promise((r) =>
                                              setTimeout(r, 150),
                                            );
                                            const paired = await api(
                                              `/api/lessons/${current.id}/companion`,
                                            );
                                            if (
                                              paired.snapshot?.cellId === cellId
                                            ) {
                                              setCompanion(paired);
                                              setReplacement(
                                                paired.snapshot.source,
                                              );
                                              return;
                                            }
                                          }
                                          throw Error(
                                            "The notebook did not confirm that cell. Check it locally.",
                                          );
                                        })
                                      }
                                    >
                                      {(
                                        companion.snapshot.cells ?? [
                                          {
                                            cellId: companion.snapshot.cellId,
                                            cellIndex:
                                              companion.snapshot.cellIndex,
                                          },
                                        ]
                                      ).map((cell: any) => (
                                        <option
                                          key={cell.cellId}
                                          value={cell.cellId}
                                        >
                                          Cell {cell.cellIndex + 1}:{" "}
                                          {cell.cellId}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label>
                                    Proposed replacement
                                    <textarea
                                      value={replacement}
                                      onChange={(e) =>
                                        setReplacement(e.target.value)
                                      }
                                    />
                                  </label>
                                  <button
                                    className="secondary"
                                    onClick={() =>
                                      void act(async () => {
                                        const actionId = id();
                                        await api(
                                          `/api/lessons/${current.id}/companion/actions`,
                                          "POST",
                                          {
                                            actionId,
                                            turnEpoch: current.epoch,
                                            type: "notebook.propose",
                                            args: { replacement },
                                          },
                                        );
                                        setPendingNotebookAction(actionId);
                                        setPairReceipt(
                                          "Preview requested. Apply or Keep mine in JupyterLab.",
                                        );
                                      })
                                    }
                                  >
                                    Preview edit in notebook
                                  </button>
                                  <p role="status">{pairReceipt}</p>
                                </>
                              )}
                              <button
                                className="danger"
                                onClick={() =>
                                  void act(async () => {
                                    await api(
                                      `/api/lessons/${current.id}/companion`,
                                      "DELETE",
                                    );
                                    setPair(null);
                                    setCompanion(null);
                                  })
                                }
                              >
                                Stop notebook access
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <footer className="workspace-footer">
                      <button
                        className="text-button"
                        aria-pressed={pane === "tools"}
                        disabled={!current}
                        onClick={() => setPane("tools")}
                      >
                        <Icon name="screen" size={16} />
                        Screen & notebook tools
                      </button>
                      {current && (
                        <button
                          className="text-button"
                          onClick={() =>
                            void pause().then(() =>
                              navigate(`/lessons/${current.id}/recap`),
                            )
                          }
                        >
                          End lesson
                        </button>
                      )}
                    </footer>
                  </aside>
                )}
                {!pane && !contextPending && (
                  <div className="studio-home" ref={studioHomeRef}>
                    <div className="studio-live-tools">
                      <button onClick={() => setPane("visuals")}>
                        <span className="studio-tool-symbol tool-visual">
                          <Icon name="chart" />
                        </span>
                        <span>
                          Visual explainer
                          <small>Explore a computed model</small>
                        </span>
                      </button>
                      <button
                        disabled={!voiceReady}
                        title={
                          !voiceReady
                            ? "Voice is unavailable in this environment"
                            : undefined
                        }
                        onClick={() =>
                          void act(async () => {
                            await toggleVoice(await ensureLesson());
                          })
                        }
                      >
                        <span className="studio-tool-symbol tool-voice">
                          <Icon name="voice" />
                        </span>
                        <span>
                          Live lesson
                          <small>
                            {voiceReady
                              ? "Talk it through together"
                              : "Voice unavailable"}
                          </small>
                        </span>
                      </button>
                    </div>
                    {current ? (
                      <>
                        <StudioPanel
                          key={current.id}
                          lessonId={current.id}
                          disabled={
                            !selectedSourceIds.length ||
                            contextPending ||
                            sourceBusy
                          }
                          onCitation={(citation) => void openCitation(citation)}
                          onUpdate={() => void refreshLesson()}
                        />
                        <SavedNotes
                          key={"notes:" + current.id}
                          lessonId={current.id}
                          reload={notesReload}
                          createSignal={noteCreate}
                          onCitation={(citation) => void openCitation(citation)}
                        />
                      </>
                    ) : (
                      <div className="studio-start">
                        <Icon name="sparkle" size={26} />
                        <h3>Turn your sources into understanding</h3>
                        <p>
                          Add your first source or start a conversation to
                          create study materials.
                        </p>
                        <button
                          className="secondary"
                          onClick={() => fileInput.current?.click()}
                        >
                          Add sources
                        </button>
                      </div>
                    )}
                    <div className="studio-bottom-actions">
                      <button
                        className="text-button"
                        disabled={!current}
                        onClick={() => setPane("practice")}
                      >
                        <Icon name="quiz" size={17} />
                        Independent practice
                      </button>
                      <button
                        className="text-button"
                        disabled={!current}
                        onClick={() => setPane("tools")}
                      >
                        <Icon name="screen" size={17} />
                        Screen & notebook tools
                      </button>
                    </div>
                  </div>
                )}
                {contextPending && (
                  <p className="studio-loading">Loading your notebook…</p>
                )}
              </aside>
            </div>
          </>
        )}
      </main>
      <dialog
        ref={notebookDialog}
        className="notebook-name-dialog"
        aria-labelledby="notebook-name-title"
        onCancel={(event) => {
          if (notebookSaving) event.preventDefault();
          else setNotebookModal(null);
        }}
        onClose={() => {
          if (!notebookSaving) setNotebookModal(null);
        }}
      >
        <form onSubmit={saveNotebook}>
          <div className="panel-heading">
            <h2 id="notebook-name-title">
              {notebookModal === "new"
                ? "Create a notebook"
                : "Rename notebook"}
            </h2>
            <button
              className="icon-button"
              aria-label="Close notebook dialog"
              type="button"
              disabled={notebookSaving}
              onClick={() => setNotebookModal(null)}
            >
              <Icon name="close" />
            </button>
          </div>
          <p>
            Keep the sources, conversations and study materials for one topic
            together.
          </p>
          <label>
            Notebook name
            <input
              autoFocus
              required
              maxLength={100}
              value={notebookName}
              onChange={(event) => setNotebookName(event.target.value)}
              placeholder="For example, Data structures & algorithms"
            />
          </label>
          <div className="dialog-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => setNotebookModal(null)}
              disabled={notebookSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={notebookSaving || !notebookName.trim()}
            >
              {notebookSaving
                ? "Saving…"
                : notebookModal === "new"
                  ? "Create notebook"
                  : "Save name"}
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={sourceDialog}
        className="sources-dialog"
        aria-labelledby="sources-title"
        onCancel={() => {
          setSourcesOpen(false);
        }}
        onClose={() => {
          setSourcesOpen(false);
          sourceButton.current?.focus();
        }}
      >
        <div className="panel-heading">
          <h2 id="sources-title">Course sources</h2>
          <button onClick={() => sourceDialog.current?.close()}>
            Close sources
          </button>
        </div>
        <p>
          Files are privately stored. Only relevant excerpts are sent for
          tutoring. Delete a source to revoke new reads.
        </p>
        <input
          aria-label="Upload more course files"
          type="file"
          disabled={busy || contextPending}
          multiple
          accept=".pdf,.csv,.txt,.md,.ipynb,.json"
          onChange={(e) => void upload(e.target.files)}
        />
        <SourceRows
          sources={courseData?.sources ?? []}
          onDelete={deleteSource}
          onReplace={replaceSource}
        />
      </dialog>
      <dialog
        ref={dialog}
        className="citation-dialog"
        aria-labelledby="citation-title"
        onCancel={() => setCitation(null)}
        onClose={() => setCitation(null)}
      >
        {citation && (
          <>
            <div className="panel-heading">
              <h2 id="citation-title">{citation.filename}</h2>
              <button onClick={() => dialog.current?.close()}>
                Return to problem
              </button>
            </div>
            <p>
              Version {citation.versionId.slice(0, 8)} ·{" "}
              {sourceLocation(citation.locator)}
            </p>
            <blockquote>
              <RichText text={citation.text} />
            </blockquote>
            {citation.locator.pageIndex !== undefined && (
              <PdfPreview
                url={`/api/sources/${citation.sourceId}/versions/${citation.versionId}/content`}
                pageIndex={citation.locator.pageIndex}
              />
            )}
          </>
        )}
      </dialog>
    </div>
  );
}
function SourceRows({
  sources,
  onDelete,
  onReplace,
}: {
  sources: any[];
  onDelete: (s: any) => void;
  onReplace: (s: any, file: File) => void;
}) {
  return (
    <ul className="source-list">
      {sources.map((s) => (
        <li key={s.id}>
          <div>
            <strong>{s.name}</strong>
            <span>
              {s.status === "ready"
                ? "Ready"
                : s.status === "indexing"
                  ? "Indexing"
                  : s.status === "ready_with_skipped_pages"
                    ? "Ready with skipped pages"
                    : "Needs attention"}{" "}
              · version {s.revision}
            </span>
            {s.dataset && (
              <span>
                {s.dataset.rows.length} rows · {s.dataset.columns.join(", ")}
              </span>
            )}
          </div>
          <div>
            <label className="replace-file">
              Replace
              <input
                type="file"
                aria-label={`Replace ${s.name}`}
                accept=".pdf,.csv,.txt,.md,.ipynb,.json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onReplace(s, f);
                }}
              />
            </label>
            <button className="text-button" onClick={() => onDelete(s)}>
              Delete<span className="sr-only"> {s.name}</span>
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
