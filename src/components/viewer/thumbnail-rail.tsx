"use client";

/**
 * Series thumbnail rail: renders a real windowed preview of the middle slice
 * of each series onto a small canvas using the decoded cornerstone image.
 */
import { useEffect, useRef, useState } from "react";
import { imageLoader, Enums } from "@cornerstonejs/core";
import { useViewerStore } from "@/lib/viewer/store";
import type { SeriesInfo, StudyInfo } from "@/lib/viewer/loader";
import { cn } from "@/lib/utils";

async function renderThumbnail(
  imageId: string,
  canvas: HTMLCanvasElement,
  size = 112
) {
  const image = await imageLoader.loadAndCacheImage(imageId);
  const rows = image.rows ?? image.height;
  const cols = image.columns ?? image.width;
  const pixels: ArrayLike<number> = image.getPixelData();

  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const off = document.createElement("canvas");
  off.width = cols;
  off.height = rows;
  const offCtx = off.getContext("2d");
  if (!offCtx) return;

  const imgData = offCtx.createImageData(cols, rows);
  const min = image.minPixelValue ?? 0;
  const max = image.maxPixelValue ?? 255;
  const range = max - min || 1;

  for (let i = 0; i < rows * cols; i++) {
    let v: number;
    if (image.color) {
      const r = pixels[i * 3];
      const g = pixels[i * 3 + 1];
      const b = pixels[i * 3 + 2];
      const j = i * 4;
      imgData.data[j] = r;
      imgData.data[j + 1] = g;
      imgData.data[j + 2] = b;
      imgData.data[j + 3] = 255;
      continue;
    } else {
      v = Math.round(((pixels[i] - min) / range) * 255);
    }
    const j = i * 4;
    imgData.data[j] = v;
    imgData.data[j + 1] = v;
    imgData.data[j + 2] = v;
    imgData.data[j + 3] = 255;
  }
  offCtx.putImageData(imgData, 0, 0);

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / cols, size / rows);
  const w = cols * scale;
  const h = rows * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, (size - w) / 2, (size - h) / 2, w, h);
}

function SeriesThumb({
  study,
  series,
  active,
  onClick,
}: {
  study: StudyInfo;
  series: SeriesInfo;
  active: boolean;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !series.thumbImageId) return;
    let cancelled = false;
    renderThumbnail(series.thumbImageId, canvas).catch(() => {
      if (!cancelled) setErr(true);
    });
    return () => {
      cancelled = true;
    };
  }, [series.thumbImageId]);

  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative w-full shrink-0 rounded-md border p-1.5 text-left transition-colors",
        active
          ? "border-teal-400/80 bg-teal-400/10"
          : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded bg-black">
        {series.thumbImageId && !err ? (
          <canvas ref={canvasRef} className="h-full w-full" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
            {err ? "preview" : "..."}
          </div>
        )}
        <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-medium text-teal-300">
          {series.modality}
        </span>
      </div>
      <div className="mt-1 truncate text-[10px] text-zinc-400">
        {series.description}
      </div>
      <div className="text-[10px] text-zinc-600">
        {series.imageIds.length} img
      </div>
    </button>
  );
}

export default function ThumbnailRail() {
  const studies = useViewerStore((s) => s.studies);
  const activeStudyUid = useViewerStore((s) => s.activeStudyUid);
  const activeSeriesUid = useViewerStore((s) => s.activeSeriesUid);
  const setActiveStudy = useViewerStore((s) => s.setActiveStudy);
  const setActiveSeries = useViewerStore((s) => s.setActiveSeries);

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-2 [scrollbar-width:thin]">
      {studies.length === 0 && (
        <div className="px-2 py-4 text-[11px] leading-4 text-zinc-600">
          No studies loaded yet.
          <br />
          Open files or load the sample study.
        </div>
      )}
      {studies.map((study) => (
        <div key={study.studyUid} className="flex flex-col gap-2">
          <div
            className={cn(
              "cursor-pointer rounded border px-2 py-1.5 text-[10px] leading-3.5 transition-colors",
              study.studyUid === activeStudyUid
                ? "border-teal-400/50 bg-teal-400/5 text-teal-200"
                : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600"
            )}
            onClick={() => setActiveStudy(study.studyUid)}
          >
            <div className="truncate font-medium">{study.patientName}</div>
            <div className="truncate text-zinc-500">
              {study.studyDescription} · {study.studyDate}
            </div>
          </div>
          {study.studyUid === activeStudyUid &&
            study.series.map((s) => (
              <SeriesThumb
                key={s.seriesUid}
                study={study}
                series={s}
                active={s.seriesUid === activeSeriesUid}
                onClick={() => {
                  setActiveStudy(study.studyUid);
                  setActiveSeries(s.seriesUid);
                }}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

export { renderThumbnail };
