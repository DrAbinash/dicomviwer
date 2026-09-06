"use client";

/**
 * Viewer session state (client-side only).
 *
 * Phase 2: layouts (grid id + per-cell series), cine (fps/direction).
 * Phase 2.5 ("all of them and more"): sync scroll/cine, persistent invert,
 * overlay + interpolation toggles, maximized tile, annotations panel,
 * server-backed window presets and defaults (nothing hardcoded here -
 * seeds come from /api/viewer-preferences, personal tweaks from localStorage).
 */
import { create } from "zustand";
import type { StudyInfo, SeriesInfo } from "./loader";
import { cellCount, getLayout } from "./layouts";
import {
  fetchViewerPrefs,
  loadUiOverrides,
  saveUiOverrides,
  FALLBACK_PREFS,
  type ViewerPrefs,
  type WindowPreset,
} from "./preferences";

export type ToolId =
  | "windowlevel"
  | "zoom"
  | "pan"
  | "stackscroll"
  | "length"
  | "angle"
  | "ellipse"
  | "rectangle"
  | "arrow"
  | "probe";

export type CineDirection = "forward" | "backward" | "oscillate";

export interface LoadProgress {
  active: boolean;
  label: string;
  done: number;
  total: number;
}

export { getLayout, cellCount };

interface ViewerState {
  studies: StudyInfo[];
  activeStudyUid: string | null;
  activeSeriesUid: string | null;
  activeTool: ToolId;
  loading: LoadProgress;
  error: string | null;
  sidebarOpen: boolean;

  // layouts
  layoutId: string;
  cellSeries: (string | null)[]; // explicit series per tile; null = follow active
  activeCell: number;
  maximizedCell: number | null; // double-click a tile to fill the grid with it

  // cine
  cinePlaying: boolean;
  cineFps: number;
  cineDirection: CineDirection;

  // view toggles (Phase 2.5)
  syncEnabled: boolean; // scroll + cine apply to every loaded tile
  inverted: boolean; // persistent invert on the active tile
  showOverlays: boolean;
  smoothInterpolation: boolean;

  // MPR (Phase 3): thick-slab thickness in mm while layoutId === "mpr"
  mprSlab: number;

  // panels / dialogs
  annotationsOpen: boolean;
  helpOpen: boolean;

  // server-backed presets (Settings > Viewer edits these)
  presets: WindowPreset[];
  prefsLoaded: boolean;

  setStudies: (s: StudyInfo[]) => void;
  addStudies: (s: StudyInfo[]) => void;
  setActiveStudy: (uid: string) => void;
  setActiveSeries: (uid: string) => void;
  setActiveTool: (t: ToolId) => void;
  setLoading: (p: Partial<LoadProgress>) => void;
  setError: (e: string | null) => void;
  toggleSidebar: () => void;

  // layout actions
  setLayout: (id: string) => void;
  setActiveCell: (i: number) => void;
  assignSeriesToActiveCell: (seriesUid: string) => void;
  clearCell: (i: number) => void;
  toggleMaximize: (i: number) => void;

  // cine actions
  toggleCine: () => void;
  stopCine: () => void;
  setCineFps: (fps: number) => void;
  setCineDirection: (d: CineDirection) => void;

  // view toggle actions
  toggleSync: () => void;
  setInverted: (v: boolean) => void;
  toggleOverlays: () => void;
  toggleInterpolation: () => void;

  // panels
  toggleAnnotations: () => void;
  setHelpOpen: (v: boolean) => void;

  // MPR (Phase 3)
  setMprSlab: (mm: number) => void;

  // preferences (server seeds + localStorage overrides)
  initViewerPrefs: () => Promise<void>;
  setPresets: (p: WindowPreset[]) => void;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  studies: [],
  activeStudyUid: null,
  activeSeriesUid: null,
  activeTool: "windowlevel",
  loading: { active: false, label: "", done: 0, total: 0 },
  error: null,
  sidebarOpen: true,

  layoutId: FALLBACK_PREFS.defaults.layoutId,
  cellSeries: [null],
  activeCell: 0,
  maximizedCell: null,

  cinePlaying: false,
  cineFps: FALLBACK_PREFS.defaults.cineFps,
  cineDirection: FALLBACK_PREFS.defaults.cineDirection,

  syncEnabled: false,
  inverted: false,
  showOverlays: FALLBACK_PREFS.defaults.showOverlays,
  smoothInterpolation: FALLBACK_PREFS.defaults.smoothInterpolation,

  mprSlab: 1,

  annotationsOpen: false,
  helpOpen: false,

  presets: FALLBACK_PREFS.presets,
  prefsLoaded: false,

  setStudies: (s) => set({ studies: s }),
  addStudies: (incoming) =>
    set((state) => {
      const existing = new Set(state.studies.map((st) => st.studyUid));
      const merged = [
        ...incoming.filter((st) => !existing.has(st.studyUid)),
        ...state.studies,
      ];
      return { studies: merged };
    }),
  setActiveStudy: (uid) =>
    set((state) => {
      const first = state.studies.find((s) => s.studyUid === uid)?.series[0]?.seriesUid ?? null;
      // tile 0 follows the newly selected study; explicit tiles are kept
      const cellSeries = [...state.cellSeries];
      if (cellSeries.length > 0) cellSeries[0] = null;
      return { activeStudyUid: uid, activeSeriesUid: first, cellSeries };
    }),
  setActiveSeries: (uid) => set({ activeSeriesUid: uid }),
  setActiveTool: (t) => set({ activeTool: t }),
  setLoading: (p) =>
    set((state) => ({
      loading: { ...state.loading, ...p, active: p.active ?? state.loading.active },
    })),
  setError: (e) => set({ error: e }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  /* --------------------------- layout actions --------------------------- */

  setLayout: (id) => {
    saveUiOverrides({ layoutId: id });
    set((state) => {
      const n = cellCount(id);
      // preserve explicit assignments; auto-fill new tiles by cycling the
      // series of the active study (Horos-like initial fill)
      const study = state.studies.find((s) => s.studyUid === state.activeStudyUid);
      const seriesList = study?.series ?? [];
      const next: (string | null)[] = [];
      for (let i = 0; i < n; i++) {
        const existing = state.cellSeries[i];
        if (existing !== undefined) {
          next.push(existing);
        } else if (seriesList.length > 0 && i > 0) {
          next.push(seriesList[i % seriesList.length].seriesUid);
        } else {
          next.push(null);
        }
      }
      return {
        layoutId: id,
        cellSeries: next,
        activeCell: Math.min(state.activeCell, n - 1),
        maximizedCell: null,
      };
    });
  },

  setActiveCell: (i) => set({ activeCell: Math.max(0, i) }),

  assignSeriesToActiveCell: (seriesUid) =>
    set((state) => {
      const cellSeries = [...state.cellSeries];
      cellSeries[state.activeCell] = seriesUid;
      return { cellSeries, activeSeriesUid: seriesUid };
    }),

  clearCell: (i) =>
    set((state) => {
      const cellSeries = [...state.cellSeries];
      cellSeries[i] = null;
      return { cellSeries };
    }),

  toggleMaximize: (i) =>
    set((state) => ({ maximizedCell: state.maximizedCell === i ? null : i })),

  /* ---------------------------- cine actions ---------------------------- */

  toggleCine: () => set((s) => ({ cinePlaying: !s.cinePlaying })),
  stopCine: () => set({ cinePlaying: false }),
  setCineFps: (fps) => {
    const clamped = Math.min(60, Math.max(1, Math.round(fps) || 15));
    set({ cineFps: clamped });
    saveUiOverrides({ cineFps: clamped });
  },
  setCineDirection: (d) => {
    set({ cineDirection: d });
    saveUiOverrides({ cineDirection: d });
  },

  /* --------------------------- view toggles ----------------------------- */

  toggleSync: () => set((s) => ({ syncEnabled: !s.syncEnabled })),
  setInverted: (v) => set({ inverted: v }),
  toggleOverlays: () => {
    const v = !get().showOverlays;
    saveUiOverrides({ showOverlays: v });
    set({ showOverlays: v });
  },
  toggleInterpolation: () => {
    const v = !get().smoothInterpolation;
    saveUiOverrides({ smoothInterpolation: v });
    set({ smoothInterpolation: v });
  },

  /* ------------------------------ panels -------------------------------- */

  toggleAnnotations: () => set((s) => ({ annotationsOpen: !s.annotationsOpen })),
  setHelpOpen: (v) => set({ helpOpen: v }),

  setMprSlab: (mm) => set({ mprSlab: Math.max(0.1, Math.round(mm * 10) / 10) }),

  /* --------------------------- preferences ------------------------------ */

  initViewerPrefs: async () => {
    const [prefs, overrides] = await Promise.all([fetchViewerPrefs(), Promise.resolve(loadUiOverrides())]);
    const layoutId = getLayout(overrides.layoutId ?? prefs.defaults.layoutId).id;
    set((state) => ({
      presets: prefs.presets,
      prefsLoaded: true,
      layoutId,
      cellSeries:
        state.cellSeries.length === cellCount(layoutId)
          ? state.cellSeries
          : Array.from({ length: cellCount(layoutId) }, (_, i) => state.cellSeries[i] ?? null),
      cineFps: overrides.cineFps ?? prefs.defaults.cineFps,
      cineDirection: overrides.cineDirection ?? prefs.defaults.cineDirection,
      showOverlays: overrides.showOverlays ?? prefs.defaults.showOverlays,
      smoothInterpolation: overrides.smoothInterpolation ?? prefs.defaults.smoothInterpolation,
    }));
  },

  setPresets: (p) => set({ presets: p }),
}));

export function getActiveSeries(
  studies: StudyInfo[],
  studyUid: string | null,
  seriesUid: string | null
): { study: StudyInfo | null; series: SeriesInfo | null } {
  const study = studies.find((s) => s.studyUid === studyUid) ?? null;
  const series = study?.series.find((x) => x.seriesUid === seriesUid) ?? null;
  return { study, series };
}

/** Flat lookup: seriesUid -> {series, study} across all loaded studies. */
export function findSeriesAnywhere(
  studies: StudyInfo[],
  seriesUid: string | null
): { study: StudyInfo | null; series: SeriesInfo | null } {
  if (!seriesUid) return { study: null, series: null };
  for (const study of studies) {
    const series = study.series.find((x) => x.seriesUid === seriesUid);
    if (series) return { study, series };
  }
  return { study: null, series: null };
}
