"use client";

/**
 * Cornerstone3D multi-viewport grid (Phase 2/2.5, Horos/RadiAnt-style).
 *
 *  - One RenderingEngine hosts up to rows×cols STACK viewports ("tiles").
 *  - One ToolGroup is shared by every tile: tool bindings apply everywhere,
 *    mouse/touch actions act on the active tile (teal outline).
 *  - Tiles are assigned series from the store (cellSeries); tile 0 falls back
 *    to the globally active series. Clicking a thumbnail loads it into the
 *    active tile; double-clicking a tile maximizes it (RadiAnt behaviour).
 *  - Cine: rAF loop at a user-set fps with forward/backward/oscillate
 *    direction; when sync is on every loaded tile plays in lockstep.
 *  - Sync (RadiAnt "link"): scroll, cine and W/L presets fan out to all
 *    loaded tiles.
 *  - Overlays per tile: patient info (TL), orientation markers (edges),
 *    window + zoom (TR), series info (BL), slice + scrubber (BR) - all
 *    toggleable, none of the defaults are hardcoded (server preferences).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RenderingEngine,
  Enums,
  eventTarget,
  type Types,
} from "@cornerstonejs/core";
import {
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
  PanTool,
  StackScrollTool,
  LengthTool,
  AngleTool,
  EllipticalROITool,
  RectangleROITool,
  ArrowAnnotateTool,
  ProbeTool,
  addTool,
  utilities,
  Enums as ToolsEnums,
} from "@cornerstonejs/tools";
const MouseBindings = ToolsEnums.MouseBindings;
import { StackViewport } from "@cornerstonejs/core";
import {
  useViewerStore,
  findSeriesAnywhere,
  type ToolId,
} from "@/lib/viewer/store";
import { getLayout } from "@/lib/viewer/layouts";
import { getOrientationLabels } from "@/lib/viewer/orientation";
import type { SeriesInfo, StudyInfo } from "@/lib/viewer/loader";
import {
  registerViewport,
  registerToolGroup,
  registerSyncPredicate,
  setActiveViewportCell,
  getActiveCell,
  getViewport,
  getViewportEntries,
  viewerActions,
  clearCellInvert,
} from "@/lib/viewer/api";
import { ensureCornerstone } from "@/lib/viewer/init";

const RENDERING_ENGINE_ID = "dicomviewer-engine";
const TOOLGROUP_ID = "stack-tools";

const viewportIdFor = (cell: number) => `CELL_${cell}`;

interface OverlayState {
  ww: number;
  wc: number;
  zoom: number;
  slice: number;
  top?: string;
  left?: string;
}

interface CellMeta {
  patientLabel: string;
  studyLabel: string;
  seriesLabel: string;
  imageCount: number;
}

function primaryBinding() {
  return {
    bindings: [{ mouseButton: MouseBindings.Primary, numTouchPoints: 1 }],
  };
}

function toolNameFor(tool: ToolId): string {
  switch (tool) {
    case "zoom":
      return ZoomTool.toolName;
    case "pan":
      return PanTool.toolName;
    case "stackscroll":
      return StackScrollTool.toolName;
    case "length":
      return LengthTool.toolName;
    case "angle":
      return AngleTool.toolName;
    case "ellipse":
      return EllipticalROITool.toolName;
    case "rectangle":
      return RectangleROITool.toolName;
    case "arrow":
      return ArrowAnnotateTool.toolName;
    case "probe":
      return ProbeTool.toolName;
    default:
      return WindowLevelTool.toolName;
  }
}

const ALL_TOOL_NAMES = [
  WindowLevelTool.toolName,
  ZoomTool.toolName,
  PanTool.toolName,
  StackScrollTool.toolName,
  LengthTool.toolName,
  AngleTool.toolName,
  EllipticalROITool.toolName,
  RectangleROITool.toolName,
  ArrowAnnotateTool.toolName,
  ProbeTool.toolName,
];

export default function Viewport() {
  const gridRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Array<HTMLDivElement | null>>([]);
  const engineRef = useRef<RenderingEngine | null>(null);
  const baselinesRef = useRef<Map<number, number>>(new Map());
  const loadedSeriesRef = useRef<Map<number, string>>(new Map());
  const cellMetaRef = useRef<Map<number, { series: SeriesInfo; study: StudyInfo }>>(new Map());
  const listenersRef = useRef<Map<number, () => void>>(new Map());

  const studies = useViewerStore((s) => s.studies);
  const activeStudyUid = useViewerStore((s) => s.activeStudyUid);
  const activeSeriesUid = useViewerStore((s) => s.activeSeriesUid);
  const activeTool = useViewerStore((s) => s.activeTool);
  const layoutId = useViewerStore((s) => s.layoutId);
  const cellSeries = useViewerStore((s) => s.cellSeries);
  const activeCell = useViewerStore((s) => s.activeCell);
  const maximizedCell = useViewerStore((s) => s.maximizedCell);
  const toggleMaximize = useViewerStore((s) => s.toggleMaximize);
  const cinePlaying = useViewerStore((s) => s.cinePlaying);
  const cineFps = useViewerStore((s) => s.cineFps);
  const cineDirection = useViewerStore((s) => s.cineDirection);
  const syncEnabled = useViewerStore((s) => s.syncEnabled);
  const showOverlays = useViewerStore((s) => s.showOverlays);
  const smoothInterpolation = useViewerStore((s) => s.smoothInterpolation);
  const setActiveCellStore = useViewerStore((s) => s.setActiveCell);
  const initViewerPrefs = useViewerStore((s) => s.initViewerPrefs);

  const layout = getLayout(layoutId);
  // maximize renders a single-cell grid; the other tiles stay mounted but hidden
  const effLayout = maximizedCell !== null ? getLayout("1x1") : layout;
  const nCells = layout.rows * layout.cols;

  const [ready, setReady] = useState(false);
  const [overlays, setOverlays] = useState<Record<number, OverlayState>>({});
  const [cellMeta, setCellMeta] = useState<Record<number, CellMeta>>({});

  useEffect(() => {
    initViewerPrefs();
  }, [initViewerPrefs]);

  /* ------------------------- per-cell overlay update ------------------- */

  const updateOverlay = useCallback((cell: number) => {
    const vp = engineRef.current?.getViewport(viewportIdFor(cell));
    if (!vp) return;
    const props = vp.getProperties();
    const cam = vp.getCamera();
    const sliceIndex =
      (vp as { getCurrentImageIdIndex?: () => number }).getCurrentImageIdIndex?.() ?? 0;
    const baseline = baselinesRef.current.get(cell);
    const zoom =
      baseline && cam.parallelScale ? Math.round((baseline / cam.parallelScale) * 100) : 100;
    const orient = getOrientationLabels(vp as Types.IStackViewport);
    setOverlays((prev) => ({
      ...prev,
      [cell]: {
        ww: Math.round((props.voiRange?.upper ?? 0) - (props.voiRange?.lower ?? 0)),
        wc: Math.round(((props.voiRange?.upper ?? 0) + (props.voiRange?.lower ?? 0)) / 2),
        zoom,
        slice: sliceIndex + 1,
        top: orient?.top,
        left: orient?.left,
      },
    }));
  }, []);

  const attachOverlayListeners = useCallback(
    (cell: number, el: HTMLElement) => {
      const onVoi = () => updateOverlay(cell);
      const onCam = () => updateOverlay(cell);
      const onNewImage = (evt: Event) => {
        const detail = (evt as CustomEvent<{ imageIdIndex: number }>).detail;
        setOverlays((prev) => ({
          ...prev,
          [cell]: {
            ...(prev[cell] ?? { ww: 0, wc: 0, zoom: 100, slice: 1 }),
            slice: (detail?.imageIdIndex ?? 0) + 1,
          },
        }));
        updateOverlay(cell);
      };
      el.addEventListener(Enums.Events.VOI_MODIFIED, onVoi);
      el.addEventListener(Enums.Events.CAMERA_MODIFIED, onCam);
      el.addEventListener(Enums.Events.STACK_NEW_IMAGE, onNewImage);
      listenersRef.current.set(cell, () => {
        el.removeEventListener(Enums.Events.VOI_MODIFIED, onVoi);
        el.removeEventListener(Enums.Events.CAMERA_MODIFIED, onCam);
        el.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onNewImage);
      });
    },
    [updateOverlay]
  );

  /* ---------------------- engine + toolgroup boot ---------------------- */

  useEffect(() => {
    let cancelled = false;
    let engine: RenderingEngine | null = null;

    async function boot() {
      await ensureCornerstone();
      if (cancelled || !gridRef.current) return;

      // v5: register tool classes in the global registry before group addTool
      addTool(WindowLevelTool);
      addTool(ZoomTool);
      addTool(PanTool);
      addTool(StackScrollTool);
      addTool(LengthTool);
      addTool(AngleTool);
      addTool(EllipticalROITool);
      addTool(RectangleROITool);
      addTool(ArrowAnnotateTool);
      addTool(ProbeTool);

      engine = new RenderingEngine(RENDERING_ENGINE_ID);
      engineRef.current = engine;

      const tg = ToolGroupManager.createToolGroup(TOOLGROUP_ID);
      if (tg) {
        for (const name of ALL_TOOL_NAMES) tg.addTool(name);
        registerToolGroup(tg);
      }

      registerSyncPredicate(() => useViewerStore.getState().syncEnabled);

      // debug handle (harmless in prod, used by e2e verification)
      (window as unknown as { __csEventTarget?: unknown }).__csEventTarget = eventTarget;
      Object.defineProperty(window, "__csViewport", {
        get: () => getViewport(),
        configurable: true,
      });
      (window as unknown as { __csToolGroup?: unknown }).__csToolGroup = tg;

      setReady(true);
    }

    boot();

    // keep the canvases matched to the element sizes (resizes, orientation
    // changes, sidebar toggle, layout changes, maximize restore)
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        try {
          engineRef.current?.resize?.();
          engineRef.current?.getViewports().forEach((vp) => vp.resize?.());
          (engineRef.current as unknown as { resizeForRenderingEngine?: (o?: unknown) => void })
            .resizeForRenderingEngine?.({ keepCamera: true });
        } catch {
          /* resize is best-effort */
        }
      });
    });
    if (gridRef.current) ro.observe(gridRef.current);

    return () => {
      cancelled = true;
      setReady(false);
      ro.disconnect();
      cancelAnimationFrame(rafId);
      for (const cleanup of listenersRef.current.values()) cleanup();
      listenersRef.current.clear();
      ToolGroupManager.destroyToolGroup(TOOLGROUP_ID);
      engine?.destroy();
      engineRef.current = null;
      registerToolGroup(null);
    };
  }, []);

  /* --------------------- enable/disable tiles per layout ---------------- */

  useEffect(() => {
    const engine = engineRef.current;
    const tg = ToolGroupManager.getToolGroup(TOOLGROUP_ID);
    if (!engine || !tg || !ready) return;

    // enable tiles 0..n-1
    for (let i = 0; i < nCells; i++) {
      const el = cellRefs.current[i];
      const id = viewportIdFor(i);
      if (!el) continue;
      const exists = engine
        .getViewports()
        .some((v) => (v as unknown as { viewportId: string }).viewportId === id);
      if (exists) continue;
      engine.enableElement({
        viewportId: id,
        type: Enums.ViewportType.STACK,
        element: el,
        defaultOptions: { background: [0, 0, 0] as Types.Point3 },
      });
      tg.addViewport(id, RENDERING_ENGINE_ID);
      const vp = engine.getViewport(id);
      if (vp) registerViewport(i, vp as Types.IStackViewport, el);
      attachOverlayListeners(i, el);
      loadedSeriesRef.current.delete(i); // fresh viewport -> (re)load stack
    }

    // disable tiles beyond the current layout
    for (const vp of engine.getViewports()) {
      const vpId = (vp as unknown as { viewportId: string }).viewportId;
      const m = /^CELL_(\d+)$/.exec(vpId);
      const cell = m ? parseInt(m[1], 10) : -1;
      if (cell >= 0 && cell >= nCells) {
        (tg as unknown as { removeViewports: (...ids: string[]) => unknown }).removeViewports(vpId);
        engine.disableElement(vpId);
        registerViewport(cell, null);
        listenersRef.current.get(cell)?.();
        listenersRef.current.delete(cell);
        loadedSeriesRef.current.delete(cell);
        cellMetaRef.current.delete(cell);
      }
    }
  }, [ready, nCells, attachOverlayListeners]);

  /* --------------------- resolve series per tile ------------------------ */

  // keep the imperative registry's "active tile" in sync with the React
  // store - layout changes clamp the store value, and toolbar layout
  // switches never fire tile pointerdown events.
  useEffect(() => {
    setActiveViewportCell(Math.min(activeCell, Math.max(nCells - 1, 0)));
  }, [activeCell, nCells]);

  const resolved = useMemo(() => {
    const out: Array<{ cell: number; series: SeriesInfo | null; study: StudyInfo | null }> = [];
    for (let i = 0; i < nCells; i++) {
      const uid = cellSeries[i] ?? (i === 0 ? activeSeriesUid : null);
      const { series, study } = findSeriesAnywhere(studies, uid);
      out.push({ cell: i, series, study });
    }
    return out;
  }, [studies, cellSeries, activeSeriesUid, nCells]);

  /* ------------------------ load stacks into tiles ---------------------- */

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    async function loadAll() {
      const smooth = useViewerStore.getState().smoothInterpolation;
      for (const r of resolved) {
        if (cancelled) return;
        if (!r.series || r.series.imageIds.length === 0) continue;
        const loaded = loadedSeriesRef.current.get(r.cell);
        if (loaded === r.series.seriesUid) continue;
        const vp = engineRef.current?.getViewport(viewportIdFor(r.cell)) as
          | Types.IStackViewport
          | undefined;
        if (!vp) continue;

        await vp.setStack(r.series.imageIds, 0);
        clearCellInvert(r.cell);
        // apply the series' embedded default window (falls back to a CT default)
        const ww = r.series.defaultWindowWidth ?? 1600;
        const wc = r.series.defaultWindowCenter ?? 400;
        vp.setProperties({
          voiRange: { lower: wc - ww / 2, upper: wc + ww / 2 },
          invert: false,
          interpolationType: smooth ? 1 : 0,
        });
        // record the fit baseline for the zoom % readout, then fit
        vp.resetCamera();
        baselinesRef.current.set(r.cell, vp.getCamera().parallelScale || 0);
        loadedSeriesRef.current.set(r.cell, r.series.seriesUid);
        if (r.study) {
          cellMetaRef.current.set(r.cell, { series: r.series, study: r.study });
          setCellMeta((prev) => ({
            ...prev,
            [r.cell]: {
              patientLabel: `${r.study!.patientName}  |  ${r.study!.patientId}`,
              studyLabel: `${r.study!.studyDescription}  ${r.study!.studyDate}`,
              seriesLabel: `${r.series!.modality} - ${r.series!.description}`,
              imageCount: r.series!.imageIds.length,
            },
          }));
        }
        // preload neighbouring slices so wheel/scrolling feels instant
        const el = cellRefs.current[r.cell];
        if (el) {
          try {
            utilities.stackPrefetch.enable(el);
          } catch {
            /* prefetch is best-effort */
          }
        }
        vp.render();
        updateOverlay(r.cell);
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [ready, resolved, updateOverlay]);

  /* --------------------------- tool activation -------------------------- */

  useEffect(() => {
    const tg = ToolGroupManager.getToolGroup(TOOLGROUP_ID);
    if (!tg) return;

    const target = toolNameFor(activeTool);
    // v5: setToolPassive only strips exact PRIMARY_BINDINGS shapes; pass
    // removeAllBindings so previously-bound tools fully demote.
    const demote = (name: string) =>
      tg.setToolPassive(name, { removeAllBindings: true } as never);

    for (const name of ALL_TOOL_NAMES) {
      if (name === target) {
        if (name === StackScrollTool.toolName) {
          // active drag scroll + wheel scroll simultaneously
          tg.setToolActive(name, {
            bindings: [
              { mouseButton: MouseBindings.Primary, numTouchPoints: 1 },
              { mouseButton: MouseBindings.Wheel },
            ],
          });
        } else {
          tg.setToolActive(name, primaryBinding());
        }
      } else if (name === ZoomTool.toolName) {
        tg.setToolActive(name, {
          bindings: [{ mouseButton: MouseBindings.Secondary, numTouchPoints: 2 }],
        });
      } else if (name === PanTool.toolName) {
        tg.setToolActive(name, {
          bindings: [{ mouseButton: MouseBindings.Auxiliary }],
        });
      } else if (name === StackScrollTool.toolName) {
        demote(name);
        tg.setToolActive(name, {
          bindings: [{ mouseButton: MouseBindings.Wheel }],
        });
      } else {
        demote(name);
      }
    }
  }, [activeTool, ready, activeSeriesUid]);

  /* --------------------------- interpolation ---------------------------- */

  useEffect(() => {
    if (!ready) return;
    viewerActions.setInterpolation(smoothInterpolation);
  }, [smoothInterpolation, ready]);

  /* -------------------------------- cine -------------------------------- */

  useEffect(() => {
    if (!cinePlaying || !ready) return;
    let raf = 0;
    let last = 0;
    let dir = cineDirection === "backward" ? -1 : 1;

    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      if (t - last < 1000 / cineFps) return;
      last = t;

      if (useViewerStore.getState().syncEnabled) {
        // lockstep playback across every tile that has a stack
        for (const { vp } of getViewportEntries()) {
          const svp = vp as StackViewport;
          const count = svp.getImageIds?.().length ?? 0;
          if (count < 2) continue;
          if (cineDirection === "oscillate") {
            const idx =
              (svp as unknown as { getCurrentImageIdIndex?: () => number }).getCurrentImageIdIndex?.() ?? 0;
            const next = idx + dir;
            if (next < 0 || next > count - 1) dir = -dir;
          }
          svp.scroll(dir);
        }
        return;
      }

      const vp = getViewport() as StackViewport | null; // active tile
      if (!vp) return;
      const meta = cellMetaRef.current.get(getActiveCell());
      const count = meta?.series.imageIds.length ?? 0;
      if (count < 2) return;

      const idx =
        (vp as unknown as { getCurrentImageIdIndex?: () => number }).getCurrentImageIdIndex?.() ?? 0;
      if (cineDirection === "oscillate") {
        const next = idx + dir;
        if (next < 0 || next > count - 1) dir = -dir;
      }
      vp.scroll(dir);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [cinePlaying, cineFps, cineDirection, ready, activeCell]);

  /* ------------------------------ render -------------------------------- */

  const activateCell = (i: number) => {
    setActiveCellStore(i);
    setActiveViewportCell(i);
  };

  // which tile is displayed when a cell is maximized (grid becomes 1x1)
  const shownCell = maximizedCell !== null ? Math.min(maximizedCell, nCells - 1) : null;

  const activeSlice = overlays[activeCell]?.slice ?? 1;

  return (
    <div className="h-full w-full bg-zinc-950">
      <div
        ref={gridRef}
        className="grid h-full w-full gap-px bg-zinc-900"
        style={{
          gridTemplateColumns: `repeat(${effLayout.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${effLayout.rows}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: nCells }, (_, i) => {
          const meta = cellMeta[i];
          const ov = overlays[i];
          const hidden = shownCell !== null && shownCell !== i;
          return (
            <div
              key={i}
              data-cell-index={i}
              className="relative min-h-0 min-w-0 overflow-hidden bg-black"
              style={hidden ? { display: "none" } : undefined}
              onPointerDown={() => activateCell(i)}
              onDoubleClick={() => toggleMaximize(i)}
            >
              <div
                ref={(el) => {
                  cellRefs.current[i] = el;
                }}
                data-viewport-uid={viewportIdFor(i)}
                className="h-full w-full touch-none select-none"
                onContextMenu={(e) => e.preventDefault()}
              />

              {showOverlays && meta && (
                <>
                  <div className="pointer-events-none absolute left-2 top-2 text-[11px] leading-4 text-teal-300/90 sm:text-xs sm:leading-5">
                    <div className="font-medium text-teal-200">{meta.patientLabel}</div>
                    <div className="truncate text-zinc-400">{meta.studyLabel}</div>
                  </div>
                  <div className="pointer-events-none absolute right-2 top-2 text-right text-[11px] leading-4 text-teal-300/90 sm:text-xs sm:leading-5">
                    <div>
                      WW {ov?.ww ?? 0} / WC {ov?.wc ?? 0}
                    </div>
                    <div className="text-zinc-400">{ov?.zoom ?? 100}%</div>
                  </div>
                  <div className="pointer-events-none absolute bottom-2 left-2 text-[11px] leading-4 text-zinc-400 sm:text-xs sm:leading-5">
                    <div className="max-w-[60%] truncate">{meta.seriesLabel}</div>
                  </div>
                </>
              )}

              {/* orientation markers (R/L/A/P) - Horos-style, metadata-driven */}
              {showOverlays && ov?.top && (
                <div className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 text-[11px] font-semibold text-teal-300/90">
                  {ov.top}
                </div>
              )}
              {showOverlays && ov?.left && (
                <div className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-teal-300/90">
                  {ov.left}
                </div>
              )}

              {/* slice counter + scrubber on the active tile (RadiAnt-style) */}
              {showOverlays && meta && (
                <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2 text-right text-[11px] leading-4 text-teal-300/90 sm:text-xs sm:leading-5">
                  <div>Img {ov?.slice ?? 1} / {meta.imageCount}</div>
                </div>
              )}
              {meta && i === activeCell && meta.imageCount > 1 && shownCell === null && (
                <input
                  type="range"
                  min={0}
                  max={meta.imageCount - 1}
                  step={1}
                  value={Math.max(0, activeSlice - 1)}
                  onChange={(e) => viewerActions.scrollToIndex(Number(e.target.value))}
                  onPointerDown={(e) => e.stopPropagation()}
                  title="Scrub slices"
                  className="pointer-events-auto absolute bottom-2 left-1/2 h-1 w-[45%] -translate-x-1/2 accent-teal-500"
                />
              )}
              {meta && i === activeCell && meta.imageCount > 1 && shownCell === i && (
                <input
                  type="range"
                  min={0}
                  max={meta.imageCount - 1}
                  step={1}
                  value={Math.max(0, activeSlice - 1)}
                  onChange={(e) => viewerActions.scrollToIndex(Number(e.target.value))}
                  onPointerDown={(e) => e.stopPropagation()}
                  title="Scrub slices"
                  className="pointer-events-auto absolute bottom-2 left-1/2 h-1 w-[70%] -translate-x-1/2 accent-teal-500"
                />
              )}

              {i === activeCell && nCells > 1 && !hidden && (
                <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-teal-400/70" />
              )}

              {/* maximize hint badge (desktop only) */}
              {meta && nCells > 1 && !hidden && (
                <button
                  title={shownCell === i ? "Restore grid (double-click)" : "Maximize tile (double-click)"}
                  onClick={(e) => {
                    e.stopPropagation();
                    activateCell(i);
                    toggleMaximize(i);
                  }}
                  className="absolute right-1.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded border border-zinc-700/70 bg-zinc-950/70 text-[10px] text-zinc-400 hover:text-teal-300 sm:flex"
                >
                  {shownCell === i ? "⤡" : "⤢"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { RENDERING_ENGINE_ID, viewportIdFor };
