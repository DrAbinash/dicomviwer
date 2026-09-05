"use client";

/**
 * Imperative bridge between React toolbar/UI and the Cornerstone viewports +
 * tool group that live inside <Viewport>. A tiny singleton registry keeps
 * components decoupled without prop drilling.
 *
 * Actions apply to the ACTIVE tile; when the store's sync flag is set
 * (RadiAnt "link" behaviour) scroll/cine/W-L/invert fan out to every tile
 * that has a series loaded.
 */
import type { Types } from "@cornerstonejs/core";
import { ToolGroupManager } from "@cornerstonejs/tools";
import { StackViewport } from "@cornerstonejs/core";

/** Cornerstone v5 ships no top-level ToolGroup type - derive it. */
type ToolGroupType = NonNullable<ReturnType<typeof ToolGroupManager.createToolGroup>>;

interface ViewportEntry {
  vp: Types.IStackViewport;
  element: HTMLElement;
}

const entries = new Map<number, ViewportEntry>();
let toolGroup: ToolGroupType | null = null;
let activeCell = 0;
const invertedCells = new Set<number>();

/** Set by <Viewport> so actions can read the sync toggle without prop drilling. */
let syncPredicate: () => boolean = () => false;
export function registerSyncPredicate(fn: () => boolean) {
  syncPredicate = fn;
}
function syncOn(): boolean {
  try {
    return syncPredicate();
  } catch {
    return false;
  }
}

export function registerViewport(cellIndex: number, vp: Types.IStackViewport | null, element?: HTMLElement) {
  if (!vp) {
    entries.delete(cellIndex);
    return;
  }
  if (!element) return;
  entries.set(cellIndex, { vp, element });
}

export function registerToolGroup(t: ToolGroupType | null) {
  toolGroup = t;
}
export function getToolGroup() {
  return toolGroup;
}

export function setActiveViewportCell(cellIndex: number) {
  activeCell = cellIndex;
}
export function getActiveCell() {
  return activeCell;
}

export function getViewport(cellIndex?: number): Types.IStackViewport | null {
  const idx = cellIndex ?? activeCell;
  return entries.get(idx)?.vp ?? null;
}

export function getViewportEntries(): Array<{ cellIndex: number; vp: Types.IStackViewport; element: HTMLElement }> {
  return [...entries.entries()].map(([cellIndex, e]) => ({ cellIndex, ...e }));
}

/** Cells that actually have an image stack loaded. */
function loadedEntries() {
  return getViewportEntries().filter(({ vp }) => {
    try {
      return (vp as StackViewport).getImageIds?.().length > 0;
    } catch {
      return false;
    }
  });
}

export interface WindowPreset {
  name: string;
  ww: number;
  wc: number;
}

function applyVoiTo(vp: Types.IStackViewport, lower: number, upper: number) {
  vp.setProperties({ voiRange: { lower, upper } });
  vp.render();
}

export const viewerActions = {
  setPreset(p: WindowPreset) {
    const lower = p.wc - p.ww / 2;
    const upper = p.wc + p.ww / 2;
    if (syncOn()) {
      for (const { vp } of loadedEntries()) applyVoiTo(vp, lower, upper);
    } else {
      const vp = getViewport();
      if (vp) applyVoiTo(vp, lower, upper);
    }
  },
  setWindowRange(ww: number, wc: number) {
    viewerActions.setPreset({ name: "", ww, wc });
  },
  /** Persistent invert toggle (Horos-style), tracked per tile. */
  toggleInvert(): boolean {
    const now = !invertedCells.has(activeCell);
    invertedCells.delete(activeCell);
    if (now) invertedCells.add(activeCell);
    const targets = syncOn() ? loadedEntries() : [{ cellIndex: activeCell, vp: getViewport()! }];
    for (const { cellIndex, vp } of targets) {
      if (!vp) continue;
      const value = invertedCells.has(cellIndex) || (syncOn() && now);
      if (syncOn()) {
        if (now) invertedCells.add(cellIndex);
        else invertedCells.delete(cellIndex);
      }
      vp.setProperties({ invert: value });
      vp.render();
    }
    return now;
  },
  isInverted(cell = activeCell): boolean {
    return invertedCells.has(cell);
  },
  clearInvertState() {
    invertedCells.clear();
  },
  /** Smooth (linear) vs pixelated (nearest) interpolation. */
  setInterpolation(smooth: boolean) {
    for (const { vp } of getViewportEntries()) {
      try {
        // Cornerstone InterpolationType: 1 = LINEAR, 0 = NEAREST
        vp.setProperties({ interpolationType: smooth ? 1 : 0 });
        vp.render();
      } catch {
        /* older builds - ignore */
      }
    }
  },
  fit() {
    const vp = getViewport();
    if (!vp) return;
    vp.resetCamera();
    vp.render();
  },
  fitAll() {
    for (const { vp } of getViewportEntries()) {
      vp.resetCamera();
      vp.render();
    }
  },
  reset() {
    const targets = syncOn() ? loadedEntries() : [{ vp: getViewport()! }];
    for (const { vp } of targets) {
      if (!vp) continue;
      vp.resetCamera();
      vp.setProperties({ invert: false });
      vp.render();
    }
    if (syncOn()) invertedCells.clear();
    else invertedCells.delete(activeCell);
  },
  rotate(deltaDeg: number) {
    const vp = getViewport();
    if (!vp) return;
    const current = vp.getRotation?.() ?? 0;
    const rotation = (current + deltaDeg + 360) % 360;
    (vp as unknown as { setRotation?: (r: number) => void }).setRotation?.(rotation);
    vp.render();
  },
  flip(axis: "h" | "v") {
    const vp = getViewport();
    if (!vp) return;
    const cam = vp.getCamera();
    if (axis === "h") {
      vp.setCamera({ flipHorizontal: !cam.flipHorizontal });
    } else {
      vp.setCamera({ flipVertical: !cam.flipVertical });
    }
    vp.render();
  },
  /** Scroll the active tile (or every loaded tile when sync is on). */
  scroll(delta: number) {
    const targets = syncOn() ? loadedEntries() : [{ vp: getViewport()! }];
    for (const { vp } of targets) {
      if (!vp) continue;
      (vp as StackViewport).scroll(delta);
      vp.render?.();
    }
  },
  /** Jump to a specific slice index (0-based) on the active tile. */
  scrollToIndex(index: number) {
    const vp = getViewport() as StackViewport | null;
    if (!vp) return;
    try {
      const count = vp.getImageIds().length;
      vp.setImageIdIndex(Math.max(0, Math.min(count - 1, Math.round(index))));
    } catch {
      /* ignore */
    }
  },
  /** Current slice index (0-based) of the active tile, or 0. */
  currentSliceIndex(): number {
    const vp = getViewport() as StackViewport | null;
    if (!vp) return 0;
    return (
      (vp as unknown as { getCurrentImageIdIndex?: () => number }).getCurrentImageIdIndex?.() ?? 0
    );
  },
  /** Download the active tile's canvas as a PNG (Horos "Export image"). */
  snapshot(): boolean {
    const entry = getViewportEntries().find(({ cellIndex }) => cellIndex === activeCell);
    if (!entry) return false;
    const canvas = entry.element.querySelector("canvas");
    if (!canvas) return false;
    try {
      const url = (canvas as HTMLCanvasElement).toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      const vp = entry.vp as StackViewport;
      let meta = "slice";
      try {
        meta = `slice${(vp as unknown as { getCurrentImageIdIndex?: () => number }).getCurrentImageIdIndex?.() ?? 0}`;
      } catch {
        /* keep default */
      }
      a.download = `dicomviewer_${new Date().toISOString().replace(/[:.]/g, "-")}_${meta}.png`;
      a.click();
      return true;
    } catch {
      return false;
    }
  },
};

/** A newly loaded stack starts with a clean invert slate for that tile. */
export function clearCellInvert(cellIndex: number) {
  invertedCells.delete(cellIndex);
}
