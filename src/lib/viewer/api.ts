"use client";

/**
 * Imperative bridge between React toolbar/UI and the Cornerstone viewport +
 * tool group that live inside <Viewport>. A tiny singleton registry keeps
 * components decoupled without prop drilling.
 */
import type { Types } from "@cornerstonejs/core";
import type { ToolGroup } from "@cornerstonejs/tools";
import { StackViewport } from "@cornerstonejs/core";

let viewport: Types.IStackViewport | null = null;
let toolGroup: ToolGroup | null = null;

export function registerViewport(v: Types.IStackViewport | null) {
  viewport = v;
}
export function registerToolGroup(t: ToolGroup | null) {
  toolGroup = t;
}
export function getViewport() {
  return viewport;
}

export interface WindowPreset {
  name: string;
  ww: number;
  wc: number;
}

export const WINDOW_PRESETS: WindowPreset[] = [
  { name: "Lung", ww: 1600, wc: -600 },
  { name: "Bone", ww: 2500, wc: 480 },
  { name: "Brain", ww: 80, wc: 40 },
  { name: "Abdomen", ww: 400, wc: 50 },
  { name: "Mediastinum", ww: 350, wc: 50 },
  { name: "Angio", ww: 600, wc: 300 },
];

function applyVoi(lower: number, upper: number) {
  if (!viewport) return;
  viewport.setProperties({ voiRange: { lower, upper } });
  viewport.render();
}

export const viewerActions = {
  setPreset(p: WindowPreset) {
    applyVoi(p.wc - p.ww / 2, p.wc + p.ww / 2);
  },
  setWindowRange(ww: number, wc: number) {
    applyVoi(wc - ww / 2, wc + ww / 2);
  },
  setInvert(invert: boolean) {
    if (!viewport) return;
    viewport.setProperties({ invert });
    viewport.render();
  },
  fit() {
    if (!viewport) return;
    // v5: resetCamera restores the fit-to-canvas view
    viewport.resetCamera();
    viewport.render();
  },
  reset() {
    if (!viewport) return;
    viewport.resetCamera();
    viewport.render();
  },
  rotate(deltaDeg: number) {
    if (!viewport) return;
    const current = viewport.getRotation?.() ?? 0;
    const rotation = (current + deltaDeg + 360) % 360;
    (viewport as { setRotation?: (r: number) => void }).setRotation?.(rotation);
    viewport.render();
  },
  flip(axis: "h" | "v") {
    if (!viewport) return;
    const cam = viewport.getCamera();
    if (axis === "h") {
      viewport.setCamera({ flipHorizontal: !cam.flipHorizontal });
    } else {
      viewport.setCamera({ flipVertical: !cam.flipVertical });
    }
    viewport.render();
  },
  scroll(delta: number) {
    if (!viewport) return;
    (viewport as StackViewport).scroll(delta);
  },
};
