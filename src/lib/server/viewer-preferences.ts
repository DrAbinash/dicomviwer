import { getSettings, setSetting } from "./config";

/**
 * Viewer preferences — everything the viewer UI treats as "defaults" lives
 * here instead of being hardcoded in components:
 *
 *   - window/level presets (name + WW + WC) shown in the toolbar
 *   - default layout, cine fps/direction, overlay visibility,
 *     smooth interpolation, sync behaviour
 *
 * Stored as a single JSON blob in AppSetting["viewer.preferences"].
 * Seed values are generic RadiAnt/Horos-style CT defaults; sites edit them
 * in Settings > Viewer (or any admin can PUT to /api/viewer-preferences).
 */

const KEY = "viewer.preferences";

export interface WindowPresetDef {
  name: string;
  ww: number;
  wc: number;
}

export interface ViewerPreferences {
  presets: WindowPresetDef[];
  defaults: {
    layoutId: string;
    cineFps: number;
    cineDirection: "forward" | "backward" | "oscillate";
    showOverlays: boolean;
    smoothInterpolation: boolean;
  };
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

/** Generic seed presets — overridden by whatever the site configures. */
const SEED: ViewerPreferences = {
  presets: [
    { name: "Lung", ww: 1600, wc: -600 },
    { name: "Bone", ww: 2500, wc: 480 },
    { name: "Brain", ww: 80, wc: 40 },
    { name: "Abdomen", ww: 400, wc: 50 },
    { name: "Mediastinum", ww: 350, wc: 50 },
    { name: "Angio", ww: 600, wc: 300 },
    { name: "Soft", ww: 400, wc: 40 },
    { name: "Liver", ww: 150, wc: 60 },
  ],
  defaults: {
    layoutId: "1x1",
    cineFps: 15,
    cineDirection: "forward",
    showOverlays: true,
    smoothInterpolation: true,
  },
};

function sanitize(raw: unknown): ViewerPreferences {
  const out: ViewerPreferences = JSON.parse(JSON.stringify(SEED));
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Partial<ViewerPreferences>;

  if (Array.isArray(obj.presets)) {
    const presets: WindowPresetDef[] = [];
    for (const p of obj.presets) {
      if (!p || typeof p !== "object") continue;
      const name = String((p as WindowPresetDef).name ?? "").trim().slice(0, 24);
      const ww = clamp((p as WindowPresetDef).ww, 1, 20000, 0);
      const wc = clamp((p as WindowPresetDef).wc, -10000, 10000, 0);
      if (!name || ww <= 0) continue;
      presets.push({ name, ww, wc });
    }
    if (presets.length > 0) out.presets = presets.slice(0, 24);
  }

  if (obj.defaults && typeof obj.defaults === "object") {
    const d = obj.defaults as Partial<ViewerPreferences["defaults"]>;
    if (typeof d.layoutId === "string" && /^\d+x\d+$/.test(d.layoutId)) {
      out.defaults.layoutId = d.layoutId;
    }
    out.defaults.cineFps = clamp(d.cineFps, 1, 60, SEED.defaults.cineFps);
    if (
      d.cineDirection === "forward" ||
      d.cineDirection === "backward" ||
      d.cineDirection === "oscillate"
    ) {
      out.defaults.cineDirection = d.cineDirection;
    }
    if (typeof d.showOverlays === "boolean") out.defaults.showOverlays = d.showOverlays;
    if (typeof d.smoothInterpolation === "boolean") {
      out.defaults.smoothInterpolation = d.smoothInterpolation;
    }
  }

  return out;
}

export async function getViewerPreferences(): Promise<ViewerPreferences> {
  try {
    const rows = await getSettings([KEY]);
    if (!rows[KEY]) return SEED;
    return sanitize(JSON.parse(rows[KEY]));
  } catch {
    return SEED; // db unreachable - serve seed rather than failing the viewer
  }
}

export async function saveViewerPreferences(p: ViewerPreferences): Promise<ViewerPreferences> {
  const clean = sanitize(p);
  await setSetting(KEY, JSON.stringify(clean));
  return clean;
}
