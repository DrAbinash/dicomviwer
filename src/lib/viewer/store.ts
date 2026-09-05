"use client";

/**
 * Viewer session state (client-side only).
 *
 * Phase 2 additions:
 *  - layouts: grid id + per-cell series assignment (RadiAnt/Horos style
 *    tiles; the active tile receives thumbnails and tool actions)
 *  - cine: loop playback with user-set fps and direction, persisted in
 *    localStorage (no hardcoded playback values - defaults only)
 */
import { create } from "zustand";
import type { StudyInfo, SeriesInfo } from "./loader";
import { cellCount, getLayout } from "./layouts";

export type ToolId =
  | "windowlevel"
  | "zoom"
  | "pan"
  | "crosshair"
  | "length"
  | "angle"
  | "ellipse"
  | "rectangle"
  | "arrow"
  | "probe"
  | "stackscroll";

export type CineDirection = "forward" | "backward" | "oscillate";

export interface LoadProgress {
  active: boolean;
  label: string;
  done: number;
  total: number;
}

/** localStorage keys - single place so nothing leaks into components. */
export const CINE_PREFS_KEY = "dvv_cine_prefs_v1";

interface CinePrefs {
  fps: number;
  direction: CineDirection;
}

export function loadCinePrefs(): CinePrefs {
  if (typeof window === "undefined") return { fps: 15, direction: "forward" };
  try {
    const raw = window.localStorage.getItem(CINE_PREFS_KEY);
    if (!raw) return { fps: 15, direction: "forward" };
    const p = JSON.parse(raw) as Partial<CinePrefs>;
    const fps = Math.min(60, Math.max(1, Math.round(Number(p.fps) || 15)));
    const direction: CineDirection =
      p.direction === "backward" || p.direction === "oscillate" ? p.direction : "forward";
    return { fps, direction };
  } catch {
    return { fps: 15, direction: "forward" };
  }
}

function saveCinePrefs(p: CinePrefs) {
  try {
    window.localStorage.setItem(CINE_PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode - prefs just won't persist */
  }
}

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

  // cine
  cinePlaying: boolean;
  cineFps: number;
  cineDirection: CineDirection;

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

  // cine actions
  toggleCine: () => void;
  stopCine: () => void;
  setCineFps: (fps: number) => void;
  setCineDirection: (d: CineDirection) => void;
  initCinePrefs: () => void;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  studies: [],
  activeStudyUid: null,
  activeSeriesUid: null,
  activeTool: "windowlevel",
  loading: { active: false, label: "", done: 0, total: 0 },
  error: null,
  sidebarOpen: true,

  layoutId: "1x1",
  cellSeries: [null],
  activeCell: 0,

  cinePlaying: false,
  cineFps: 15,
  cineDirection: "forward",

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

  setLayout: (id) =>
    set((state) => {
      const n = cellCount(id);
      if (n === state.cellSeries.length && state.layoutId === id) {
        return { layoutId: id, activeCell: Math.min(state.activeCell, n - 1) };
      }
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
      };
    }),

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

  /* ---------------------------- cine actions ---------------------------- */

  toggleCine: () => set((s) => ({ cinePlaying: !s.cinePlaying })),
  stopCine: () => set({ cinePlaying: false }),
  setCineFps: (fps) => {
    const clamped = Math.min(60, Math.max(1, Math.round(fps) || 15));
    set({ cineFps: clamped });
    saveCinePrefs({ fps: clamped, direction: get().cineDirection });
  },
  setCineDirection: (d) => {
    set({ cineDirection: d });
    saveCinePrefs({ fps: get().cineFps, direction: d });
  },
  initCinePrefs: () => {
    const p = loadCinePrefs();
    set({ cineFps: p.fps, cineDirection: p.direction });
  },
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

export { getLayout };
