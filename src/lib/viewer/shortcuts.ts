"use client";

/**
 * Keyboard shortcuts - single data-driven map consumed by BOTH the global
 * key handler and the help dialog, so the docs can never drift from the
 * behaviour. Horos/RadiAnt-style: number keys pick tools, arrows scroll,
 * space toggles cine, single letters toggle view actions.
 */
import { useViewerStore, type ToolId } from "./store";
import { viewerActions, getViewport } from "./api";
import { LAYOUTS } from "./layouts";

export interface ShortcutDef {
  keys: string; // display form, e.g. "1" or "Shift+F"
  action: () => void;
  label: string;
  /** Only meaningful when a study is loaded. */
  needsStudy?: boolean;
}

/** Tool hotkeys: 1..0 map to the toolbar's tool order (RadiAnt-style). */
export const TOOL_HOTKEYS: Array<{ key: string; tool: ToolId }> = [
  { key: "1", tool: "windowlevel" },
  { key: "2", tool: "zoom" },
  { key: "3", tool: "pan" },
  { key: "4", tool: "stackscroll" },
  { key: "5", tool: "length" },
  { key: "6", tool: "angle" },
  { key: "7", tool: "ellipse" },
  { key: "8", tool: "rectangle" },
  { key: "9", tool: "arrow" },
  { key: "0", tool: "probe" },
];

/** Layout hotkeys: Alt+1..Alt+6 follow the LAYOUTS order (data-driven). */
export const LAYOUT_HOTKEY_COUNT = LAYOUTS.length;

export function buildShortcuts(): ShortcutDef[] {
  const s = useViewerStore.getState;
  const defs: ShortcutDef[] = [];

  for (const { key, tool } of TOOL_HOTKEYS) {
    defs.push({
      keys: key,
      action: () => s().setActiveTool(tool),
      label: `Tool: ${tool.replace("windowlevel", "W/L")}`,
    });
  }

  LAYOUTS.forEach((l, i) => {
    defs.push({
      keys: `Alt+${i + 1}`,
      action: () => s().setLayout(l.id),
      label: `Layout ${l.label}`,
    });
  });

  defs.push(
    {
      keys: "↑ / ↓",
      action: () => viewerActions.scroll(s().syncEnabled ? 1 : 1),
      label: "Scroll slice (sync-aware)",
      needsStudy: true,
    },
    {
      keys: "PgUp / PgDn",
      action: () => viewerActions.scroll(10),
      label: "Scroll 10 slices",
      needsStudy: true,
    },
    {
      keys: "Space",
      action: () => s().toggleCine(),
      label: "Play / pause cine",
      needsStudy: true,
    },
    {
      keys: "+ / -",
      action: () => zoomStep(1),
      label: "Zoom in / out",
      needsStudy: true,
    },
    {
      keys: "i",
      action: () => s().setInverted(viewerActions.toggleInvert()),
      label: "Toggle invert (persistent)",
      needsStudy: true,
    },
    {
      keys: "h",
      action: () => viewerActions.flip("h"),
      label: "Flip horizontal",
      needsStudy: true,
    },
    {
      keys: "v",
      action: () => viewerActions.flip("v"),
      label: "Flip vertical",
      needsStudy: true,
    },
    {
      keys: "r / Shift+R",
      action: () => viewerActions.rotate(90),
      label: "Rotate 90° (Shift = CCW)",
      needsStudy: true,
    },
    {
      keys: "f",
      action: () => viewerActions.fit(),
      label: "Fit active tile",
      needsStudy: true,
    },
    {
      keys: "Shift+F",
      action: () => viewerActions.fitAll(),
      label: "Fit all tiles",
      needsStudy: true,
    },
    {
      keys: "m",
      action: () => s().toggleMaximize(s().activeCell),
      label: "Maximize active tile",
      needsStudy: true,
    },
    {
      keys: "y",
      action: () => s().toggleSync(),
      label: "Sync scroll / cine across tiles",
    },
    {
      keys: "o",
      action: () => s().toggleOverlays(),
      label: "Show / hide text overlays",
    },
    {
      keys: "p",
      action: () => viewerActions.snapshot(),
      label: "Export active tile as PNG",
      needsStudy: true,
    },
    {
      keys: "a",
      action: () => s().toggleAnnotations(),
      label: "Toggle annotations panel",
    },
    {
      keys: "Alt+M",
      action: () => {
        const cur = s().layoutId;
        s().setLayout(cur === "mpr" ? "1x1" : "mpr");
      },
      label: "Toggle tri-planar MPR (slab + MIP)",
    },
    {
      keys: "?",
      action: () => s().setHelpOpen(!s().helpOpen),
      label: "This help",
    }
  );

  return defs;
}

/** Zoom step used by the +/- keys (multiplicative, RadiAnt-like feel). */
export function zoomStep(direction: 1 | -1) {
  const vp = getViewport();
  if (!vp) return;
  const cam = vp.getCamera();
  const scale = cam.parallelScale || 1;
  const factor = direction > 0 ? 1 / 1.2 : 1.2;
  vp.setCamera({ parallelScale: scale * factor });
  vp.render();
}

interface KeyEventDetail {
  key: string;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

/** Handle one keydown; returns true when a shortcut consumed the event. */
export function handleShortcut(ev: KeyEventDetail): boolean {
  const hasStudy = useViewerStore.getState().studies.length > 0;
  const defs = buildShortcuts();
  const target = ev.key.trim();
  if (ev.key === "+" || ev.key === "=") {
    if (!hasStudy) return false;
    zoomStep(1);
    return true;
  }
  if (ev.key === "-" || ev.key === "_") {
    if (!hasStudy) return false;
    zoomStep(-1);
    return true;
  }
  if (ev.key === "ArrowUp") {
    if (!hasStudy) return false;
    viewerActions.scroll(-1);
    return true;
  }
  if (ev.key === "ArrowDown") {
    if (!hasStudy) return false;
    viewerActions.scroll(1);
    return true;
  }
  if (ev.key === "PageUp") {
    if (!hasStudy) return false;
    viewerActions.scroll(-10);
    return true;
  }
  if (ev.key === "PageDown") {
    if (!hasStudy) return false;
    viewerActions.scroll(10);
    return true;
  }
  if (ev.key === " ") {
    if (!hasStudy) return false;
    useViewerStore.getState().toggleCine();
    return true;
  }

  for (const def of defs) {
    if (def.needsStudy && !hasStudy) continue;
    const parts = def.keys.split(" / ");
    for (const combo of parts) {
      const comboAlt = combo.startsWith("Alt+");
      const comboShift = combo.startsWith("Shift+");
      const bare = combo.replace(/^(Alt|Shift)\+/, "");
      if (comboAlt !== ev.alt || comboShift !== ev.shift) continue;
      if (bare.toLowerCase() === target.toLowerCase()) {
        def.action();
        return true;
      }
    }
  }
  return false;
}
