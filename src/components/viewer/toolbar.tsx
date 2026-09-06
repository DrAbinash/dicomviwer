"use client";

/**
 * Toolbar: tool selection, window presets (server-backed, editable in
 * Settings > Viewer), orientation & view actions, layout picker, cine
 * controls and the Phase 2.5 toggles: sync, persistent invert, interpolation,
 * overlays, annotations panel, PNG export, fullscreen, shortcuts help.
 *
 * Layouts/presets/shortcuts are all data-driven - adding an entry in
 * lib/viewer/{layouts,preferences,shortcuts} makes it show up here.
 */
import { useEffect, useRef, useState } from "react";
import { cellCount, useViewerStore, findSeriesAnywhere, type ToolId } from "@/lib/viewer/store";
import { viewerActions } from "@/lib/viewer/api";
import { LAYOUTS } from "@/lib/viewer/layouts";
import {
  gsps,
  saveAnnotations,
  fetchSavedAnnotations,
  deleteSavedAnnotations,
  invalidateGspsCache,
  importMeasurements,
} from "@/lib/viewer/gsps";
import { cn } from "@/lib/utils";
import SendDialog from "./send-dialog";

const TOOLS: Array<{ id: ToolId; label: string; glyph: string; title: string }> = [
  { id: "windowlevel", label: "W/L", glyph: "◐", title: "Window/Level (drag)" },
  { id: "zoom", label: "Zoom", glyph: "🔍", title: "Zoom (left drag or pinch)" },
  { id: "pan", label: "Pan", glyph: "✥", title: "Pan (middle drag)" },
  { id: "stackscroll", label: "Scroll", glyph: "≡", title: "Stack scroll (drag)" },
  { id: "length", label: "Length", glyph: "⟝", title: "Length measurement" },
  { id: "angle", label: "Angle", glyph: "∠", title: "Angle measurement" },
  { id: "ellipse", label: "ROI", glyph: "◯", title: "Ellipse ROI (mean/σ/area)" },
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
  const presets = useViewerStore((s) => s.presets);
  const syncEnabled = useViewerStore((s) => s.syncEnabled);
  const toggleSync = useViewerStore((s) => s.toggleSync);
  const inverted = useViewerStore((s) => s.inverted);
  const setInverted = useViewerStore((s) => s.setInverted);
  const showOverlays = useViewerStore((s) => s.showOverlays);
  const toggleOverlays = useViewerStore((s) => s.toggleOverlays);
  const smoothInterpolation = useViewerStore((s) => s.smoothInterpolation);
  const toggleInterpolation = useViewerStore((s) => s.toggleInterpolation);
  const toggleAnnotations = useViewerStore((s) => s.toggleAnnotations);
  const setHelpOpen = useViewerStore((s) => s.setHelpOpen);
  const activeSeriesUid = useViewerStore((s) => s.activeSeriesUid);

  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  /** Distribute the active study's series across all tiles (Horos auto-fill). */
  const fillTiles = () => {
    const state = useViewerStore.getState();
    const study =
      state.studies.find((s) => s.studyUid === state.activeStudyUid) ?? state.studies[0];
    if (!study || study.series.length === 0) return;
    const n = cellCount(state.layoutId);
    const ids = study.series.map((s) => s.seriesUid);
    const cellSeries = Array.from(
      { length: n },
      (_, i) => ids[i % ids.length] ?? null
    );
    useViewerStore.setState({
      cellSeries,
      activeSeriesUid: cellSeries[state.activeCell] ?? ids[0],
    });
  };

  /* -------------------- measurement persistence (Phase 3) --------------- */
  const [toast, setToast] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const activeSeries = findSeriesAnywhere(
    useViewerStore.getState().studies,
    activeSeriesUid
  );

  const onSaveGsps = async () => {
    if (!activeSeries.study || !activeSeries.series) return;
    if (gsps.count() === 0) {
      showFlash("No measurements to save.");
      return;
    }
    const res = await saveAnnotations(
      activeSeries.study.studyUid,
      activeSeries.series.seriesUid
    );
    if (res.ok) {
      invalidateGspsCache(activeSeries.study.studyUid, activeSeries.series.seriesUid);
      showFlash(`Saved ${res.count} measurement(s) to server.`);
    } else {
      showFlash(`Save failed: ${res.error ?? "store unavailable"}`);
    }
  };

  const onLoadGsps = async () => {
    if (!activeSeries.study || !activeSeries.series) return;
    const list = await fetchSavedAnnotations(
      activeSeries.study.studyUid,
      activeSeries.series.seriesUid
    );
    if (list.length === 0) {
      showFlash("No saved measurements for this series.");
      return;
    }
    gsps.clearAll();
    const restored = gsps.restore(list as never);
    showFlash(`Restored ${restored} saved measurement(s).`);
  };

  const onDeleteGsps = async () => {
    if (!activeSeries.study || !activeSeries.series) return;
    const ok = await deleteSavedAnnotations(
      activeSeries.study.studyUid,
      activeSeries.series.seriesUid
    );
    if (ok) invalidateGspsCache(activeSeries.study.studyUid, activeSeries.series.seriesUid);
    showFlash(ok ? "Server copy deleted." : "Delete failed.");
  };

  const onImportGsps = async (file: File) => {
    try {
      const restored = await importMeasurements(file);
      showFlash(`Imported ${restored} measurement(s) from file.`);
    } catch {
      showFlash("Import failed: not a valid annotations JSON file.");
    }
  };

  return (
    <div className="relative flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-800 bg-zinc-950/95 px-2 py-1.5 backdrop-blur">
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

      {/* window presets (server-configured) */}
      <div className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {presets.map((p) => (
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
          title="Scroll previous (↑ / PgUp)"
          onClick={() => viewerActions.scroll(-1)}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          ▲
        </button>
        <button
          disabled={!hasStudy}
          title="Scroll next (↓ / PgDn)"
          onClick={() => viewerActions.scroll(1)}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          ▼
        </button>
        <button
          disabled={!hasStudy}
          title="Rotate 90° CW (r / Shift+R for CCW)"
          onClick={() => viewerActions.rotate(90)}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          ⟳
        </button>
        <button
          disabled={!hasStudy}
          title="Flip horizontal (h)"
          onClick={() => viewerActions.flip("h")}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          ⇋
        </button>
        <button
          disabled={!hasStudy}
          title="Flip vertical (v)"
          onClick={() => viewerActions.flip("v")}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          ⇅
        </button>
        <button
          disabled={!hasStudy}
          title="Toggle invert - persistent (i)"
          onClick={() => setInverted(viewerActions.toggleInvert())}
          className={cn(
            btn,
            inverted
              ? "bg-teal-500/20 text-teal-300 ring-1 ring-teal-400/60"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          )}
        >
          ◐ Inv
        </button>
        <button
          disabled={!hasStudy}
          title={smoothInterpolation ? "Interpolation: smooth (click for pixelated)" : "Interpolation: pixelated (click for smooth)"}
          onClick={toggleInterpolation}
          className={cn(
            btn,
            !smoothInterpolation
              ? "bg-teal-500/20 text-teal-300 ring-1 ring-teal-400/60"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          )}
        >
          {smoothInterpolation ? "Smooth" : "Pixel"}
        </button>
        <button
          disabled={!hasStudy}
          title="Fit to window (active tile) (f)"
          onClick={() => viewerActions.fit()}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          Fit
        </button>
        <button
          disabled={!hasStudy}
          title="Fit all tiles (Shift+F)"
          onClick={() => viewerActions.fitAll()}
          className={cn(btn, "hidden text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 sm:inline-flex")}
        >
          Fit all
        </button>
        <button
          disabled={!hasStudy}
          title="Reset view (camera + invert)"
          onClick={() => {
            viewerActions.reset();
            setInverted(false);
          }}
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
          title={cinePlaying ? "Pause cine loop (Space)" : "Play cine loop (Space)"}
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
        <button
          title="Sync scroll + cine across all tiles (y)"
          onClick={toggleSync}
          className={cn(
            btn,
            syncEnabled
              ? "bg-teal-500/20 text-teal-300 ring-1 ring-teal-400/60"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          )}
        >
          <span className="hidden sm:inline">Sync</span>
          <span className="sm:hidden">⛓</span>
        </button>
      </div>

      <div className="hidden h-5 w-px bg-zinc-800 sm:block" />

      {/* layouts + fill */}
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
        <button
          disabled={!hasStudy}
          title="Fill all tiles with the active study's series"
          onClick={fillTiles}
          className={cn(btn, "ml-1 text-zinc-400 hover:bg-zinc-800 hover:text-teal-300")}
        >
          Fill
        </button>
      </div>

      <div className="hidden h-5 w-px bg-zinc-800 sm:block" />

      {/* misc actions */}
      {/* measurement persistence + DICOM send (Phase 3) */}
      <div className="flex items-center gap-0.5">
        <button
          disabled={!hasStudy}
          title="Save measurements for this series to the server"
          onClick={onSaveGsps}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-teal-300")}
        >
          <span className="hidden sm:inline">⤒ Save</span>
          <span className="sm:hidden">⤒</span>
        </button>
        <button
          disabled={!hasStudy}
          title="Load saved measurements for this series"
          onClick={onLoadGsps}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-teal-300")}
        >
          <span className="hidden sm:inline">⤓ Load</span>
          <span className="sm:hidden">⤓</span>
        </button>
        <button
          disabled={!hasStudy}
          title="Export measurements as JSON (offline GSPS-style file)"
          onClick={() => {
            const st = activeSeries.study;
            const sr = activeSeries.series;
            if (st && sr) {
              gsps.exportJson({
                studyUid: st.studyUid,
                seriesUid: sr.seriesUid,
                patientName: st.patientName,
              });
            }
          }}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          <span className="hidden sm:inline">⇪ Export</span>
          <span className="sm:hidden">⇪</span>
        </button>
        <button
          disabled={!hasStudy}
          title="Import measurements from JSON"
          onClick={() => importInputRef.current?.click()}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          <span className="hidden sm:inline">⇩ Import</span>
          <span className="sm:hidden">⇩</span>
        </button>
        <button
          disabled={!hasStudy}
          title="Delete the server copy for this series"
          onClick={onDeleteGsps}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          ✕
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportGsps(f);
            e.target.value = "";
          }}
        />
        <button
          disabled={!hasStudy}
          title="Send this study/series to a DICOM destination (C-STORE)"
          onClick={() => setSendOpen(true)}
          className={cn(btn, "bg-sky-600/80 text-white hover:bg-sky-500")}
        >
          <span className="hidden sm:inline">⇢ Send</span>
          <span className="sm:hidden">⇢</span>
        </button>
      </div>

      <div className="flex items-center gap-0.5">
        <button
          title="Show / hide text overlays (o)"
          onClick={toggleOverlays}
          className={cn(
            btn,
            showOverlays
              ? "text-teal-300"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          )}
        >
          <span className="hidden sm:inline">Info</span>
          <span className="sm:hidden">ℹ</span>
        </button>
        <button
          title="Measurements panel (a)"
          onClick={toggleAnnotations}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-teal-300")}
        >
          <span className="hidden sm:inline">Measure</span>
          <span className="sm:hidden">📏</span>
        </button>
        <button
          disabled={!hasStudy}
          title="Export active tile as PNG (p)"
          onClick={() => viewerActions.snapshot()}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          <span className="hidden sm:inline">PNG</span>
          <span className="sm:hidden">⬇</span>
        </button>
        <button
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => {
            if (document.fullscreenElement) {
              document.exitFullscreen().catch(() => {});
            } else {
              document.documentElement.requestFullscreen().catch(() => {});
            }
          }}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200")}
        >
          {isFullscreen ? "⤡" : "⛶"}
        </button>
        <button
          title="Keyboard shortcuts (?)"
          onClick={() => setHelpOpen(true)}
          className={cn(btn, "text-zinc-400 hover:bg-zinc-800 hover:text-teal-300")}
        >
          ?
        </button>
      </div>

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 bottom-full mb-1 flex justify-center px-2">
          <div className="rounded border border-teal-700/50 bg-zinc-900/95 px-3 py-1 text-[11px] text-teal-200 shadow-lg">
            {toast}
          </div>
        </div>
      )}

      <SendDialog open={sendOpen} onOpenChange={setSendOpen} />
    </div>
  );
}
