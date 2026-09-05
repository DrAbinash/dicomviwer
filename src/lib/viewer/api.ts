"use client";

/**
 * Imperative bridge between React toolbar/UI and the Cornerstone viewports +
 * tool group that live inside <Viewport>. A tiny singleton registry keeps
 * components decoupled without prop drilling.
 *
 * Phase 2 (layouts): the registry holds one stack viewport per grid tile,
 * keyed by tile index. Every action applies to the ACTIVE tile - clicking a
 * tile moves both the React state and the registry pointer.
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

export interface WindowPreset {
  name: string;
  ww: number;
  wc: number;
}

/**
 * Window presets. RadiAnt-style CT defaults; radiologists can still drag W/L
 * freely afterwards. Data-driven so sites can append their own protocols.
 */
export const WINDOW_PRESETS: WindowPreset[] = [
  { name: "Lung", ww: 1600, wc: -600 },
  { name: "Bone", ww: 2500, wc: 480 },
  { name: "Brain", ww: 80, wc: 40 },
  { name: "Abdomen", ww: 400, wc: 50 },
  { name: "Mediastinum", ww: 350, wc: 50 },
  { name: "Angio", ww: 600, wc: 300 },
];

function applyVoi(lower: number, upper: number) {
  const vp = getViewport();
  if (!vp) return;
  vp.setProperties({ voiRange: { lower, upper } });
  vp.render();
}

export const viewerActions = {
  setPreset(p: WindowPreset) {
    applyVoi(p.wc - p.ww / 2, p.wc + p.ww / 2);
  },
  setWindowRange(ww: number, wc: number) {
    applyVoi(wc - ww / 2, wc + ww / 2);
  },
  setInvert(invert: boolean) {
    const vp = getViewport();
    if (!vp) return;
    vp.setProperties({ invert });
    vp.render();
  },
  fit() {
    const vp = getViewport();
    if (!vp) return;
    // v5: resetCamera restores the fit-to-canvas view
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
    const vp = getViewport();
    if (!vp) return;
    vp.resetCamera();
    vp.render();
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
  scroll(delta: number) {
    const vp = getViewport();
    if (!vp) return;
    (vp as StackViewport).scroll(delta);
  },
};
