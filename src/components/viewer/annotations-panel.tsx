"use client";

/**
 * Annotations panel (Horos-inspired ROI/measurements list): every completed
 * Cornerstone measurement is listed with its value; a button clears all
 * annotations across tiles. Values are extracted defensively - ROI tools
 * cache their stats asynchronously.
 */
import { useEffect, useState } from "react";
import { eventTarget } from "@cornerstonejs/core";
import { Enums as ToolsEnums, annotation } from "@cornerstonejs/tools";
import { useViewerStore } from "@/lib/viewer/store";
import { Button } from "@/components/ui/button";

interface AnnotationRow {
  uid: string;
  tool: string;
  value: string;
}

function describe(a: unknown): { tool: string; value: string } {
  const ann = a as {
    metadata?: { toolName?: string };
    data?: {
      length?: number;
      angle?: number;
      label?: string;
      cachedStats?: Record<string, { mean?: number; stdDev?: number; max?: number; min?: number; area?: number }>;
    };
  };
  const tool = ann.metadata?.toolName ?? "annotation";
  const d = ann.data;
  if (typeof d?.length === "number") return { tool, value: `${d.length.toFixed(1)} mm` };
  if (typeof d?.angle === "number") return { tool, value: `${d.angle.toFixed(1)}°` };
  const first = d?.cachedStats ? Object.values(d.cachedStats)[0] : undefined;
  if (first) {
    const bits: string[] = [];
    if (typeof first.mean === "number") bits.push(`μ ${first.mean.toFixed(1)}`);
    if (typeof first.stdDev === "number") bits.push(`σ ${first.stdDev.toFixed(1)}`);
    if (typeof first.area === "number") bits.push(`${first.area.toFixed(1)} mm²`);
    if (bits.length > 0) return { tool, value: bits.join(" · ") };
  }
  if (d?.label) return { tool, value: d.label };
  return { tool, value: "—" };
}

function readAll(): AnnotationRow[] {
  try {
    const all = annotation.state.getAllAnnotations() as unknown[];
    return all
      .filter((a) => {
        const meta = (a as { metadata?: { hidden?: boolean } })?.metadata;
        return !meta?.hidden;
      })
      .map((a) => {
        const uid = (a as { annotationUID?: string }).annotationUID ?? Math.random().toString(36).slice(2);
        const { tool, value } = describe(a);
        return { uid, tool, value };
      });
  } catch {
    return [];
  }
}

export default function AnnotationsPanel() {
  const open = useViewerStore((s) => s.annotationsOpen);
  const [rows, setRows] = useState<AnnotationRow[]>([]);

  // refresh when opened and whenever the active cell changes (annotations
  // are per-frame-of-reference, so the visible set depends on the tile)
  const activeCell = useViewerStore((s) => s.activeCell);
  useEffect(() => {
    if (!open) return;
    const refresh = () => setRows(readAll());
    const t = setTimeout(refresh, 0); // deferred: no setState during effect body
    const onCompleted = () => setTimeout(refresh, 50); // stats are cached async
    const onRemoved = () => refresh();
    eventTarget.addEventListener(ToolsEnums.Events.ANNOTATION_COMPLETED, onCompleted);
    eventTarget.addEventListener(ToolsEnums.Events.ANNOTATION_MODIFIED, onCompleted);
    eventTarget.addEventListener(ToolsEnums.Events.ANNOTATION_REMOVED, onRemoved);
    return () => {
      clearTimeout(t);
      eventTarget.removeEventListener(ToolsEnums.Events.ANNOTATION_COMPLETED, onCompleted);
      eventTarget.removeEventListener(ToolsEnums.Events.ANNOTATION_MODIFIED, onCompleted);
      eventTarget.removeEventListener(ToolsEnums.Events.ANNOTATION_REMOVED, onRemoved);
    };
  }, [activeCell, open]);

  if (!open) return null;

  return (
    <div className="absolute right-2 top-1/3 z-20 w-56 rounded border border-zinc-800 bg-zinc-950/95 text-xs shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-zinc-800 px-2.5 py-1.5">
        <span className="font-medium text-teal-300">Measurements ({rows.length})</span>
        <button
          onClick={() => useViewerStore.getState().toggleAnnotations()}
          className="text-zinc-500 hover:text-zinc-200"
          title="Close panel"
        >
          ✕
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto px-2.5 py-1.5">
        {rows.length === 0 ? (
          <p className="py-2 text-zinc-600">
            No measurements yet. Pick Length / Angle / ROI and drag on a tile.
          </p>
        ) : (
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.uid} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-zinc-400">{r.tool}</span>
                <span className="shrink-0 font-mono text-teal-300">{r.value}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-zinc-800 p-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-6 w-full border-zinc-700 text-[11px] text-zinc-300 hover:bg-zinc-800"
          onClick={() => {
            try {
              annotation.state.removeAllAnnotations();
            } catch {
              /* ignore */
            }
            setRows([]);
          }}
        >
          Clear all
        </Button>
      </div>
    </div>
  );
}
