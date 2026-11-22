"use client";
import { useEffect, useRef, useState } from "react";
export default function PdfPreview({
  url,
  pageIndex,
}: {
  url: string;
  pageIndex: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let task: any,
      render: any,
      cancel = false;
    async function load() {
      try {
        setError("");
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw Error("Source removed or unavailable.");
        task = pdfjs.getDocument({
          data: new Uint8Array(await response.arrayBuffer()),
        });
        const pdf = await task.promise;
        const page = await pdf.getPage(pageIndex + 1);
        if (cancel || !ref.current) return;
        const viewport = page.getViewport({ scale: 1.2 });
        ref.current.width = viewport.width;
        ref.current.height = viewport.height;
        render = page.render({ canvas: ref.current, viewport });
        await render.promise;
      } catch (e: any) {
        if (!cancel) setError(e.message ?? "This page could not be opened.");
      }
    }
    void load();
    return () => {
      cancel = true;
      render?.cancel();
      void task?.destroy();
    };
  }, [url, pageIndex]);
  return (
    <>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <canvas
          ref={ref}
          aria-label={`PDF physical page ${pageIndex + 1}`}
          className="pdf-page"
        />
      )}
    </>
  );
}
