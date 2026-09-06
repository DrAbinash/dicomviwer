"use client";

/**
 * Tri-planar MPR view (Phase 3, Horos/RadiAnt-style).
 *
 * Builds (and caches) a 3D volume from the active series, displays it in
 * three ORTHOGRAPHIC viewports (axial / coronal / sagittal) sharing one tool
 * group, with:
 *  - CrosshairsTool on left drag (synced reference lines + oblique rotation)
 *  - zoom on right drag / pinch, pan on middle drag, scroll wheel slices
 *  - length/angle/ROI measurements that persist like stack measurements
 *  - thick-slab control (0.5–50 mm) with a MIP blend toggle
 *
 * Activated via layout id "mpr"; <DicomViewer> swaps this in for <Viewport>.
 */
import { useEffect, useRef, useState } from "react";
import {
  RenderingEngine,
  Enums,
  volumeLoader,
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
  CrosshairsTool,
  addTool,
  Enums as ToolsEnums,
} from "@cornerstonejs/tools";
const MouseBindings = ToolsEnums.MouseBindings;
import { useViewerStore, findSeriesAnywhere } from "@/lib/viewer/store";
import { autoRestore, trackGspsViewportId } from "@/lib/viewer/gsps";
import { ensureCornerstone } from "@/lib/viewer/init";

const RENDERING_ENGINE_ID = "dicomviewer-mpr-engine";
const TOOLGROUP_ID = "mpr-tools";

const CELLS = [
  { id: "MPR_AXIAL", label: "Axial", orientation: Enums.OrientationAxis.AXIAL },
  { id: "MPR_CORONAL", label: "Coronal", orientation: Enums.OrientationAxis.CORONAL },
  { id: "MPR_SAGITTAL", label: "Sagittal", orientation: Enums.OrientationAxis.SAGITTAL },
] as const;

type ToolGroupType = NonNullable<ReturnType<typeof ToolGroupManager.createToolGroup>>;

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
  CrosshairsTool.toolName,
];

/** seriesUid -> volumeId (volume bodies survive layout toggles). */
const volumeCache = new Map<string, string>();

function setSlabOnAll(engine: RenderingEngine | null, mm: number, mip: boolean) {
  if (!engine) return;
  for (const c of CELLS) {
    try {
      const vp = engine.getViewport(c.id);
      (vp as unknown as { setSlabThickness?: (t: number) => void }).setSlabThickness?.(
        Math.max(0.1, mm)
      );
      (vp as unknown as { setBlendMode?: (m: number) => void }).setBlendMode?.(
        mip
          ? Enums.BlendModes.MAXIMUM_INTENSITY_BLEND
          : Enums.BlendModes.COMPOSITE
      );
      vp.render();
    } catch {
      /* viewport not enabled */
    }
  }
}

export default function ViewportMpr() {
  const gridRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Array<HTMLDivElement | null>>([null, null, null]);
  const engineRef = useRef<RenderingEngine | null>(null);
  const membersRef = useRef(new Set<string>());
  const [ready, setReady] = useState(false);
  const [mipOn, setMipOn] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const studies = useViewerStore((s) => s.studies);
  const activeSeriesUid = useViewerStore((s) => s.activeSeriesUid);
  const activeTool = useViewerStore((s) => s.activeTool);
  const mprSlab = useViewerStore((s) => s.mprSlab);
  const setMprSlabStore = useViewerStore((s) => s.setMprSlab);

  const { series } = findSeriesAnywhere(studies, activeSeriesUid);

  /* ------------------------------ boot ---------------------------------- */
  useEffect(() => {
    let cancelled = false;
    let engine: RenderingEngine | null = null;

    async function boot() {
      await ensureCornerstone();
      if (cancelled || !gridRef.current) return;

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
      addTool(CrosshairsTool);

      engine = new RenderingEngine(RENDERING_ENGINE_ID);
      engineRef.current = engine;

      const tg = ToolGroupManager.createToolGroup(TOOLGROUP_ID);
      if (tg) {
        for (const name of ALL_TOOL_NAMES) tg.addTool(name);
      }
      setReady(true);
    }

    boot();

    let rafId = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        try {
          (engineRef.current as unknown as {
            resizeForRenderingEngine?: (o?: unknown) => void;
          })?.resizeForRenderingEngine?.({ keepCamera: true });
        } catch {
          /* best-effort */
        }
      });
    });
    if (gridRef.current) ro.observe(gridRef.current);

    return () => {
      cancelled = true;
      setReady(false);
      ro.disconnect();
      cancelAnimationFrame(rafId);
      for (const c of CELLS) trackGspsViewportId(c.id, false);
      ToolGroupManager.destroyToolGroup(TOOLGROUP_ID);
      engine?.destroy();
      engineRef.current = null;
    };
  }, []);

  /* ---------------------- enable the 3 volume tiles ---------------------- */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !ready) return;
    const tg = ToolGroupManager.getToolGroup(TOOLGROUP_ID);
    if (!tg) return;

    for (let i = 0; i < 3; i++) {
      const el = cellRefs.current[i];
      const def = CELLS[i];
      if (!el) continue;
      const exists = engine
        .getViewports()
        .some((v) => (v as unknown as { viewportId: string }).viewportId === def.id);
      if (!exists) {
        engine.enableElement({
          viewportId: def.id,
          type: Enums.ViewportType.ORTHOGRAPHIC,
          element: el,
          defaultOptions: {
            orientation: def.orientation,
            background: [0, 0, 0] as Types.Point3,
          },
        });
      }
      const key = `${TOOLGROUP_ID}:${def.id}`;
      if (!membersRef.current.has(key)) {
        try {
          tg.addViewport(def.id, RENDERING_ENGINE_ID);
          membersRef.current.add(key);
        } catch {
          /* already added */
        }
      }
      trackGspsViewportId(def.id, true);
    }
  }, [ready]);

  /* --------------------- build volume + attach tiles --------------------- */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !ready) return;
    if (!series || series.imageIds.length === 0) return;

    let cancelled = false;

    async function attach() {
      setError(null);
      let volumeId = volumeCache.get(series!.seriesUid);
      if (!volumeId) {
        setProgress("Building 3D volume…");
        volumeId = `dvv-mpr-${series!.seriesUid.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        try {
          const volume = (await volumeLoader.createAndCacheVolume(volumeId, {
            imageIds: series!.imageIds,
          })) as unknown as
            | { load: (cb?: (...args: unknown[]) => void) => void }
            | undefined;
          if (!volume) throw new Error("volume loader returned nothing");
          volume.load((...args: unknown[]) => {
            const [done, total] = args as [number, number];
            if (typeof done === "number" && typeof total === "number" && total > 0) {
              setProgress(`Building 3D volume… ${done}/${total}`);
            }
          });
          volumeCache.set(series!.seriesUid, volumeId!);
        } catch (e) {
          console.error("MPR volume build failed", e);
          if (!cancelled) {
            setProgress(null);
            setError(
              "MPR could not build a 3D volume from this series (spatial metadata missing?)."
            );
          }
          return;
        }
      }

      // wait for streaming completion before attaching (best-effort poll)
      const vol = (await volumeLoader.loadVolume(volumeId!).catch(() => null)) as
        | { loadStatus?: { loaded?: boolean } }
        | null;
      if (!cancelled && vol && !vol.loadStatus?.loaded) {
        setProgress("Streaming slices into volume…");
        await new Promise<void>((resolve) => {
          const started = Date.now();
          const poll = setInterval(() => {
            if (cancelled) {
              clearInterval(poll);
              resolve();
              return;
            }
            if (vol.loadStatus?.loaded || Date.now() - started > 120_000) {
              clearInterval(poll);
              resolve();
            }
          }, 250);
        });
      }
      if (cancelled) return;
      setProgress(null);

      const ww = series!.defaultWindowWidth ?? 1600;
      const wc = series!.defaultWindowCenter ?? 400;
      for (const c of CELLS) {
        try {
          const vp = engineRef.current?.getViewport(c.id);
          if (!vp) continue;
          await (vp as Types.IVolumeViewport).setVolumes([{ volumeId: volumeId! }]);
          (vp as unknown as { setProperties: (p: Record<string, unknown>) => void }).setProperties({
            voiRange: { lower: wc - ww / 2, upper: wc + ww / 2 },
          });
          vp.resetCamera();
          vp.render();
        } catch (e) {
          console.error("MPR attach failed", c.id, e);
          if (!cancelled) {
            setError("MPR volume could not be attached to the viewports.");
          }
        }
      }
      if (!cancelled) {
        setSlabOnAll(engineRef.current, mprSlab, mipOn);
        // GSPS-style auto-restore of saved measurements for this series
        const study = studies.find((st) =>
          st.series.some((sr) => sr.seriesUid === series!.seriesUid)
        );
        if (study) {
          autoRestore(study.studyUid, series!.seriesUid).catch(() => {});
        }
      }
    }

    attach();
    return () => {
      cancelled = true;
    };
  }, [ready, series?.seriesUid, series?.instanceCount]);

  /* --------------------------- tool activation --------------------------- */
  useEffect(() => {
    const tg = ToolGroupManager.getToolGroup(TOOLGROUP_ID);
    if (!tg) return;

    // crosshairs is the signature MPR interaction - it stays active unless a
    // specific measurement/navigation tool is chosen
    const MPR_TOOLS = new Set([
      "zoom", "pan", "stackscroll", "length", "angle", "ellipse", "rectangle", "arrow", "probe",
    ]);
    const target = MPR_TOOLS.has(activeTool)
      ? toolNameFor(activeTool)
      : CrosshairsTool.toolName;

    const demote = (name: string) =>
      tg.setToolPassive(name, { removeAllBindings: true } as never);

    for (const name of ALL_TOOL_NAMES) {
      if (name === target) {
        if (name === StackScrollTool.toolName) {
          tg.setToolActive(name, {
            bindings: [
              { mouseButton: MouseBindings.Primary, numTouchPoints: 1 },
              { mouseButton: MouseBindings.Wheel },
            ],
          });
        } else if (name === CrosshairsTool.toolName) {
          tg.setToolActive(name, {
            bindings: [
              { mouseButton: MouseBindings.Primary, numTouchPoints: 1 },
              { mouseButton: MouseBindings.Secondary, numTouchPoints: 2 },
            ],
          });
        } else {
          tg.setToolActive(name, {
            bindings: [{ mouseButton: MouseBindings.Primary, numTouchPoints: 1 }],
          });
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
  }, [activeTool, ready, series?.seriesUid]);

  /* ----------------------------- slab / MIP ------------------------------ */
  useEffect(() => {
    setSlabOnAll(engineRef.current, mprSlab, mipOn);
  }, [mprSlab, mipOn, ready, series?.seriesUid]);

  return (
    <div className="relative h-full w-full bg-zinc-950">
      <div
        ref={gridRef}
        className="grid h-full w-full grid-cols-3 grid-rows-1 gap-px bg-zinc-900"
      >
        {CELLS.map((c, i) => (
          <div
            key={c.id}
            className="relative min-h-0 min-w-0 overflow-hidden bg-black"
          >
            <div
              ref={(el) => {
                cellRefs.current[i] = el;
              }}
              data-viewport-uid={c.id}
              className="h-full w-full touch-none select-none"
              onContextMenu={(e) => e.preventDefault()}
            />
            <div className="pointer-events-none absolute left-2 top-2 text-[11px] font-semibold text-teal-300/90">
              {c.label}
            </div>
            <div className="pointer-events-none absolute bottom-2 right-2 text-[11px] leading-4 text-teal-300/90">
              Slab {mprSlab} mm{mipOn ? " · MIP" : ""}
            </div>
          </div>
        ))}
      </div>

      {/* MIP toggle */}
      <button
        onClick={() => setMipOn((v) => !v)}
        title="Toggle Maximum Intensity Projection for the thick slab"
        className={`absolute right-2 top-2 rounded px-2 py-1 text-[11px] ${
          mipOn
            ? "bg-teal-500/20 text-teal-300 ring-1 ring-teal-400/60"
            : "bg-zinc-950/80 text-zinc-400 hover:text-zinc-200"
        }`}
      >
        MIP
      </button>

      {/* slab thickness slider */}
      <div
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded border border-zinc-800 bg-zinc-950/85 px-3 py-1.5 backdrop-blur"
        title="Thick-slab thickness in mm"
      >
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          Slab
        </span>
        <input
          type="range"
          min={0.5}
          max={50}
          step={0.5}
          value={mprSlab}
          onChange={(e) => setMprSlabStore(Number(e.target.value))}
          className="h-1 w-40 accent-teal-500"
        />
        <span className="w-12 text-[11px] tabular-nums text-zinc-400">
          {mprSlab} mm
        </span>
      </div>

      {(progress || error) && (
        <div
          className={`absolute inset-x-0 top-0 px-4 py-2 text-xs backdrop-blur ${
            error
              ? "bg-amber-950/90 text-amber-200"
              : "bg-zinc-950/90 text-zinc-300"
          }`}
        >
          {error ?? progress}
        </div>
      )}
    </div>
  );
}

function toolNameFor(tool: string): string {
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
      return CrosshairsTool.toolName;
  }
}
