"use client";

/**
 * Toolbar: tool selection, window presets, orientation & view actions.
 * Desktop: horizontal bar under the viewport. Mobile-friendly sizing.
 */
import { useViewerStore, type ToolId } from "@/lib/viewer/store";
import { viewerActions, WINDOW_PRESETS } from "@/lib/viewer/api";
import { cn } from "@/lib/utils";

const TOOLS: Array<{ id: ToolId; label: string; glyph: string; title: string }> = [
  { id: "windowlevel", label: "W/L", glyph: "◐", title: "Window/Level (drag)" },
  { id: "zoom", label: "Zoom", glyph: "🔍", title: "Zoom (left drag or pinch)" },
  { id: "pan", label: "Pan", glyph: "✥", title: "Pan (middle drag)" },
  { id: "stackscroll", label: "Scroll", glyph: "≡", title: "Stack scroll (drag)" },
  { id: "length", label: "Length", glyph: "⟝", title: "Length measurement" },
  { id: "angle", label: "Angle", glyph: "∠", title: "Angle measurement" },
  { id: "ellipse", label: "ROI", glyph: "◯", title: "Ellipse ROI" },
  { id: "rectangle", label: "Rect", glyph: "▭", title: "Rectangle ROI" },
  { id: "arrow", label: "Arrow", glyph: "➤", title: "Arrow annotation" },
  { id: "probe", label: "Probe", glyph: "✛", title: "Pixel probe" },
];

const btn =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded px-2 text-[11px] font-medium transition-colors disabled:opacity-40";

export default function Toolbar() {
  const activeTool = useViewerStore((s) => s.activeTool);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const hasStudy = useViewerStore((s) => s.studies.length > 0);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-800 bg-zinc-950/95 px-2 py-1.5 backdrop-blur">
      {/* tools */}
      <div className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            title={t.title}
            onClick={() => setActiveTool(t.id)}
            className={cn(
              btn,
              activeTool === t.id
                ? "bg-teal-500/20 text-teal-300 ring-1 ring-teal-400/60"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            )}
          >
            <span className="text-xs leading-none">{t.glyph}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="hidden h-5 w-px bg-zinc-800 sm:block" />

      {/* window presets */}
      <div className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {WINDOW_PRESETS.map((p) => (
          <button
            key={p.name}
            disabled={!hasStudy}
            title={`${p.name}: WW ${p.ww} / WC ${p.wc}`}
            onClick={() => viewerActions.setPreset(p)}
            className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-teal-300")}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="hidden h-5 w-px bg-zinc-800 sm:block" />

      {/* view actions */}
      <div className="flex items-center gap-0.5">
        <button
          disabled={!hasStudy}
          title="Scroll previous"
          onClick={() => viewerActions.scroll(-1)}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          ▲
        </button>
        <button
          disabled={!hasStudy}
          title="Scroll next"
          onClick={() => viewerActions.scroll(1)}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          ▼
        </button>
        <button
          disabled={!hasStudy}
          title="Rotate 90° CW"
          onClick={() => viewerActions.rotate(90)}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          ⟳
        </button>
        <button
          disabled={!hasStudy}
          title="Flip horizontal"
          onClick={() => viewerActions.flip("h")}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          ⇋
        </button>
        <button
          disabled={!hasStudy}
          title="Invert"
          onClick={() => {
            viewerActions.setInvert(true);
            setTimeout(() => viewerActions.setInvert(false), 1200);
          }}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          ◐ Inv
        </button>
        <button
          disabled={!hasStudy}
          title="Fit to window"
          onClick={() => viewerActions.fit()}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          Fit
        </button>
        <button
          disabled={!hasStudy}
          title="Reset view"
          onClick={() => viewerActions.reset()}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
