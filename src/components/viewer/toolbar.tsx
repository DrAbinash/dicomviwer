"use client";

/**
 * Toolbar: tool selection, window presets, orientation & view actions,
 * layout picker (Phase 2) and cine controls (Phase 2).
 * Desktop: horizontal bar under the viewport. Mobile-friendly sizing.
 *
 * Layouts and cine prefs are data-driven from lib/viewer/{layouts,store} -
 * adding a layout there is all it takes for it to appear here.
 */
import { useViewerStore, type ToolId } from "@/lib/viewer/store";
import { viewerActions, WINDOW_PRESETS } from "@/lib/viewer/api";
import { LAYOUTS } from "@/lib/viewer/layouts";
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

/** Tiny visual preview of a grid layout (rows × cols of dots). */
function LayoutGlyph({ rows, cols }: { rows: number; cols: number }) {
  return (
    <span
      className="grid gap-px"
      style={{ gridTemplateColumns: `repeat(${cols}, 4px)`, gridTemplateRows: `repeat(${rows}, 4px)` }}
      aria-hidden
    >
      {Array.from({ length: rows * cols }, (_, i) => (
        <span key={i} className="block h-1 w-1 rounded-[1px] bg-current" />
      ))}
    </span>
  );
}

export default function Toolbar() {
  const activeTool = useViewerStore((s) => s.activeTool);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const hasStudy = useViewerStore((s) => s.studies.length > 0);
  const layoutId = useViewerStore((s) => s.layoutId);
  const setLayout = useViewerStore((s) => s.setLayout);
  const cinePlaying = useViewerStore((s) => s.cinePlaying);
  const toggleCine = useViewerStore((s) => s.toggleCine);
  const cineFps = useViewerStore((s) => s.cineFps);
  const setCineFps = useViewerStore((s) => s.setCineFps);
  const cineDirection = useViewerStore((s) => s.cineDirection);
  const setCineDirection = useViewerStore((s) => s.setCineDirection);

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
          title="Fit to window (active tile)"
          onClick={() => viewerActions.fit()}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          Fit
        </button>
        <button
          disabled={!hasStudy}
          title="Fit all tiles"
          onClick={() => viewerActions.fitAll()}
          className={cn(btn, "hidden text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 sm:inline-flex")}
        >
          Fit all
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

      <div className="hidden h-5 w-px bg-zinc-800 sm:block" />

      {/* cine (Horos-inspired loop playback) */}
      <div className="flex items-center gap-0.5">
        <button
          disabled={!hasStudy}
          title={cinePlaying ? "Pause cine loop" : "Play cine loop (active tile)"}
          onClick={toggleCine}
          className={cn(
            btn,
            cinePlaying
              ? "bg-teal-500/20 text-teal-300 ring-1 ring-teal-400/60"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-teal-300"
          )}
        >
          {cinePlaying ? "⏸" : "▶"}
          <span className="hidden sm:inline">Cine</span>
        </button>
        {cinePlaying && (
          <>
            <span className="ml-1 hidden items-center gap-1 text-[10px] text-zinc-500 sm:flex">
              fps
              <input
                type="range"
                min={1}
                max={60}
                step={1}
                value={cineFps}
                onChange={(e) => setCineFps(Number(e.target.value))}
                className="h-1 w-20 accent-teal-500"
                title="Frames per second"
              />
              <span className="w-6 tabular-nums text-teal-300">{cineFps}</span>
            </span>
            <select
              value={cineDirection}
              onChange={(e) => setCineDirection(e.target.value as typeof cineDirection)}
              title="Playback direction"
              className="h-7 rounded border border-zinc-800 bg-zinc-900 px-1 text-[11px] text-zinc-300"
            >
              <option value="forward">→</option>
              <option value="backward">←</option>
              <option value="oscillate">⇄</option>
            </select>
          </>
        )}
      </div>

      <div className="hidden h-5 w-px bg-zinc-800 sm:block" />

      {/* layouts (Horos-style grid) */}
      <div className="flex items-center gap-0.5" title="Viewport layout">
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            title={`${l.label} layout`}
            onClick={() => setLayout(l.id)}
            className={cn(
              btn,
              layoutId === l.id
                ? "bg-teal-500/20 text-teal-300 ring-1 ring-teal-400/60"
                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            )}
          >
            <LayoutGlyph rows={l.rows} cols={l.cols} />
            <span className="hidden lg:inline">{l.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
