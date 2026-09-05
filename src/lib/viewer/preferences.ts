"use client";

/**
 * Client bridge to /api/viewer-preferences (server-stored window presets +
 * viewer defaults). Per-user overrides (e.g. the user changed fps or toggled
 * overlays) live in localStorage and win over server defaults — nothing is
 * hardcoded in components: seed values come from the server, edits from
 * Settings > Viewer, personal tweaks from localStorage.
 */

export interface WindowPreset {
  name: string;
  ww: number;
  wc: number;
}

export interface ViewerPrefs {
  presets: WindowPreset[];
  defaults: {
    layoutId: string;
    cineFps: number;
    cineDirection: "forward" | "backward" | "oscillate";
    showOverlays: boolean;
    smoothInterpolation: boolean;
  };
}

const UI_OVERRIDES_KEY = "dvv_ui_prefs_v1";

/** Last-resort fallback when the server is unreachable (offline dev). */
export const FALLBACK_PREFS: ViewerPrefs = {
  presets: [
    { name: "Lung", ww: 1600, wc: -600 },
    { name: "Bone", ww: 2500, wc: 480 },
    { name: "Brain", ww: 80, wc: 40 },
    { name: "Abdomen", ww: 400, wc: 50 },
    { name: "Mediastinum", ww: 350, wc: 50 },
    { name: "Angio", ww: 600, wc: 300 },
  ],
  defaults: {
    layoutId: "1x1",
    cineFps: 15,
    cineDirection: "forward",
    showOverlays: true,
    smoothInterpolation: true,
  },
};

export interface UiOverrides {
  cineFps?: number;
  cineDirection?: "forward" | "backward" | "oscillate";
  showOverlays?: boolean;
  smoothInterpolation?: boolean;
  layoutId?: string;
}

export function loadUiOverrides(): UiOverrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(UI_OVERRIDES_KEY);
    return raw ? (JSON.parse(raw) as UiOverrides) : {};
  } catch {
    return {};
  }
}

export function saveUiOverrides(o: UiOverrides) {
  try {
    const merged = { ...loadUiOverrides(), ...o };
    window.localStorage.setItem(UI_OVERRIDES_KEY, JSON.stringify(merged));
  } catch {
    /* private mode - just won't persist */
  }
}

export async function fetchViewerPrefs(): Promise<ViewerPrefs> {
  try {
    const res = await fetch("/api/viewer-preferences", { cache: "no-store" });
    if (!res.ok) throw new Error(`prefs ${res.status}`);
    const data = (await res.json()) as ViewerPrefs;
    if (!Array.isArray(data?.presets) || data.presets.length === 0) throw new Error("empty");
    return data;
  } catch {
    return FALLBACK_PREFS;
  }
}

export function saveViewerPrefs(p: ViewerPrefs): Promise<boolean> {
  return fetch("/api/viewer-preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  })
    .then((r) => r.ok)
    .catch(() => false);
}
