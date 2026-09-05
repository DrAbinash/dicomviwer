"use client";

/**
 * Viewer session state (client-side only).
 */
import { create } from "zustand";
import type { StudyInfo, SeriesInfo } from "./loader";

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

export interface LoadProgress {
  active: boolean;
  label: string;
  done: number;
  total: number;
}

interface ViewerState {
  studies: StudyInfo[];
  activeStudyUid: string | null;
  activeSeriesUid: string | null;
  activeTool: ToolId;
  loading: LoadProgress;
  error: string | null;
  sidebarOpen: boolean;

  setStudies: (s: StudyInfo[]) => void;
  addStudies: (s: StudyInfo[]) => void;
  setActiveStudy: (uid: string) => void;
  setActiveSeries: (uid: string) => void;
  setActiveTool: (t: ToolId) => void;
  setLoading: (p: Partial<LoadProgress>) => void;
  setError: (e: string | null) => void;
  toggleSidebar: () => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  studies: [],
  activeStudyUid: null,
  activeSeriesUid: null,
  activeTool: "windowlevel",
  loading: { active: false, label: "", done: 0, total: 0 },
  error: null,
  sidebarOpen: true,

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
    set((state) => ({
      activeStudyUid: uid,
      activeSeriesUid:
        state.studies.find((s) => s.studyUid === uid)?.series[0]?.seriesUid ??
        null,
    })),
  setActiveSeries: (uid) => set({ activeSeriesUid: uid }),
  setActiveTool: (t) => set({ activeTool: t }),
  setLoading: (p) =>
    set((state) => ({
      loading: { ...state.loading, ...p, active: p.active ?? state.loading.active },
    })),
  setError: (e) => set({ error: e }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
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
