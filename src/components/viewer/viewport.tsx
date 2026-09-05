"use client";

/**
 * Cornerstone3D stack viewport with RadiAnt-style tool bindings:
 *  - left drag / one-finger drag : active tool (W/L default)
 *  - right drag / pinch          : zoom
 *  - middle drag                 : pan
 *  - wheel                       : stack scroll
 * Overlays: patient info (TL), window + zoom (TR), series info (BL),
 * slice position (BR) - updated from cornerstone events.
 */
import { useEffect, useRef, useState } from "react";
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
import { useViewerStore, getActiveSeries, type ToolId } from "@/lib/viewer/store";
import { registerToolGroup, registerViewport } from "@/lib/viewer/api";
import { ensureCornerstone } from "@/lib/viewer/init";

const RENDERING_ENGINE_ID = "dicomviewer-engine";
const VIEWPORT_ID = "CT_STACK";
const TOOLGROUP_ID = "stack-tools";

interface OverlayState {
  ww: number;
  wc: number;
  zoom: number;
  slice: number;
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

export default function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RenderingEngine | null>(null);
  const [ready, setReady] = useState(false);

  const studies = useViewerStore((s) => s.studies);
  const activeStudyUid = useViewerStore((s) => s.activeStudyUid);
  const activeSeriesUid = useViewerStore((s) => s.activeSeriesUid);
  const activeTool = useViewerStore((s) => s.activeTool);
  const { study, series } = getActiveSeries(studies, activeStudyUid, activeSeriesUid);

  const [overlay, setOverlay] = useState<OverlayState>({
    ww: 0, wc: 0, zoom: 100, slice: 1,
  });
  const overlayRef = useRef(setOverlay);
  useEffect(() => {
    overlayRef.current = setOverlay;
  }, [setOverlay]);
  const cleanupRef = useRef<(() => void) | null>(null);
  const baselineScaleRef = useRef<number | null>(null);

  /* ------------------------------------------------ create engine + tools */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let toolGroup: ToolGroupManager.ToolGroupType | null = null;
    let engine: RenderingEngine | null = null;

    async function boot() {
      await ensureCornerstone();
      if (containerRef.current !== container) return; // unmounted while initing

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

      engine.enableElement({
        viewportId: VIEWPORT_ID,
        type: Enums.ViewportType.STACK,
        element: container,
        defaultOptions: { background: [0, 0, 0] as Types.Point3 },
      });

      const viewport = engine.getViewport(VIEWPORT_ID);
      registerViewport(viewport);

      const tg = ToolGroupManager.createToolGroup(TOOLGROUP_ID);
      if (tg) {
        tg.addTool(WindowLevelTool.toolName);
        tg.addTool(ZoomTool.toolName);
        tg.addTool(PanTool.toolName);
        // StackScrollTool serves both wheel scrolling and drag scrolling in v5
        tg.addTool(StackScrollTool.toolName);
        tg.addTool(LengthTool.toolName);
        tg.addTool(AngleTool.toolName);
        tg.addTool(EllipticalROITool.toolName);
        tg.addTool(RectangleROITool.toolName);
        tg.addTool(ArrowAnnotateTool.toolName);
        tg.addTool(ProbeTool.toolName);
        tg.addViewport(VIEWPORT_ID, RENDERING_ENGINE_ID);
        toolGroup = tg;
        registerToolGroup(tg);
      }

      const updateOverlay = () => {
        const vp = engineRef.current?.getViewport(VIEWPORT_ID);
        if (!vp) return;
        const props = vp.getProperties();
        const cam = vp.getCamera();
        const sliceIndex =
          (vp as { getCurrentImageIdIndex?: () => number }).getCurrentImageIdIndex?.() ?? 0;
        const baseline = baselineScaleRef.current;
        const zoom =
          baseline && cam.parallelScale
            ? Math.round((baseline / cam.parallelScale) * 100)
            : 100;
        overlayRef.current((o) => ({
          ...o,
          ww: Math.round((props.voiRange?.upper ?? 0) - (props.voiRange?.lower ?? 0)),
          wc: Math.round(((props.voiRange?.upper ?? 0) + (props.voiRange?.lower ?? 0)) / 2),
          zoom,
          slice: sliceIndex + 1,
        }));
      };

      const onNewImage = (evt: Event) => {
        const detail = (evt as CustomEvent<{ imageIdIndex: number }>).detail;
        overlayRef.current((o) => ({ ...o, slice: (detail?.imageIdIndex ?? 0) + 1 }));
        updateOverlay();
      };

      // v5 dispatches viewport events on the ELEMENT, not the global target
      container.addEventListener(Enums.Events.VOI_MODIFIED, updateOverlay);
      container.addEventListener(Enums.Events.CAMERA_MODIFIED, updateOverlay);
      container.addEventListener(Enums.Events.STACK_NEW_IMAGE, onNewImage);
      // debug handle (harmless in prod, used by e2e verification)
      (window as unknown as { __csEventTarget?: unknown }).__csEventTarget = eventTarget;
      (window as unknown as { __csViewport?: unknown }).__csViewport = viewport;
      (window as unknown as { __csToolGroup?: unknown }).__csToolGroup = tg;
      cleanupRef.current = () => {
        container.removeEventListener(Enums.Events.VOI_MODIFIED, updateOverlay);
        container.removeEventListener(Enums.Events.CAMERA_MODIFIED, updateOverlay);
        container.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onNewImage);
      };
      setReady(true);
    }

    boot();

    // keep the canvas matched to the element size (window resizes, orientation
    // changes, sidebar toggle)
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
    ro.observe(container);

    return () => {
      setReady(false);
      ro.disconnect();
      cancelAnimationFrame(rafId);
      cleanupRef.current?.();
      cleanupRef.current = null;
      ToolGroupManager.destroyToolGroup(TOOLGROUP_ID);
      engine?.destroy();
      engineRef.current = null;
      registerViewport(null);
      registerToolGroup(null);
    };
  }, []);

  /* -------------------------------------------------- react to tool change */
  useEffect(() => {
    const tg = ToolGroupManager.getToolGroup(TOOLGROUP_ID);
    if (!tg) return;

    const allTools = [
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
    const target = toolNameFor(activeTool);
    // v5: setToolPassive only strips exact PRIMARY_BINDINGS shapes; pass
    // removeAllBindings so previously-bound tools fully demote.
    const demote = (name: string) =>
      tg.setToolPassive(name, { removeAllBindings: true } as never);

    for (const name of allTools) {
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

  /* --------------------------------------------------- react to series load */
  useEffect(() => {
    async function loadStack() {
      const vp = engineRef.current?.getViewport(VIEWPORT_ID);
      if (!vp || !series || series.imageIds.length === 0) return;
      await (vp as Types.IStackViewport).setStack(series.imageIds, 0);
      // apply the series' embedded default window (falls back to a CT default)
      const ww = series.defaultWindowWidth ?? 1600;
      const wc = series.defaultWindowCenter ?? 400;
      vp.setProperties({ voiRange: { lower: wc - ww / 2, upper: wc + ww / 2 } });
      // record the fit baseline for the zoom % readout, then fit
      vp.resetCamera();
      baselineScaleRef.current = vp.getCamera().parallelScale || null;
      // preload neighbouring slices so wheel/scrolling feels instant
      try {
        utilities.stackPrefetch.enable(containerRef.current as HTMLElement);
      } catch {
        /* prefetch is best-effort */
      }
      vp.render();
      overlayRef.current((o) => ({
        ...o,
        slice: 1,
        ww: Math.round(ww),
        wc: Math.round(wc),
      }));
    }
    loadStack();
  }, [series?.seriesUid, series?.instanceCount]);

  const patientLabel = study ? `${study.patientName}  |  ${study.patientId}` : "";
  const studyLabel = study ? `${study.studyDescription}  ${study.studyDate}` : "";
  const seriesLabel = series ? `${series.modality} - ${series.description}` : "";

  return (
    <div className="relative h-full w-full bg-black">
      <div
        ref={containerRef}
        data-viewport-uid={VIEWPORT_ID}
        className="h-full w-full touch-none select-none"
        onContextMenu={(e) => e.preventDefault()}
      />

      {series && (
        <>
          <div className="pointer-events-none absolute left-2 top-2 text-[11px] leading-4 text-teal-300/90 sm:text-xs sm:leading-5">
            <div className="font-medium text-teal-200">{patientLabel}</div>
            <div className="text-zinc-400">{studyLabel}</div>
          </div>
          <div className="pointer-events-none absolute right-2 top-2 text-right text-[11px] leading-4 text-teal-300/90 sm:text-xs sm:leading-5">
            <div>WW {overlay.ww} / WC {overlay.wc}</div>
            <div className="text-zinc-400">{overlay.zoom}%</div>
          </div>
          <div className="pointer-events-none absolute bottom-2 left-2 text-[11px] leading-4 text-zinc-400 sm:text-xs sm:leading-5">
            <div>{seriesLabel}</div>
          </div>
          <div className="pointer-events-none absolute bottom-2 right-2 text-right text-[11px] leading-4 text-teal-300/90 sm:text-xs sm:leading-5">
            <div>Img {overlay.slice} / {series.imageIds.length}</div>
          </div>
        </>
      )}
    </div>
  );
}

export { VIEWPORT_ID, RENDERING_ENGINE_ID };
