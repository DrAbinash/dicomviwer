/**
 * Grid layouts (Phase 2, Horos-inspired).
 *
 * The list is data-driven on purpose: add an entry here and the toolbar,
 * keyboard shortcuts and viewport grid pick it up everywhere - no scattered
 * conditionals, nothing hardcoded in components.
 */
export interface LayoutDef {
  id: string;
  rows: number;
  cols: number;
  label: string;
}

export const LAYOUTS: LayoutDef[] = [
  { id: "1x1", rows: 1, cols: 1, label: "1×1" },
  // MPR is special-cased in <DicomViewer>: renders tri-planar volume viewports
  // instead of stack tiles (Phase 3). rows/cols drive the grid only.
  { id: "mpr", rows: 1, cols: 3, label: "MPR" },
  { id: "1x2", rows: 1, cols: 2, label: "1×2" },
  { id: "2x1", rows: 2, cols: 1, label: "2×1" },
  { id: "2x2", rows: 2, cols: 2, label: "2×2" },
  { id: "3x3", rows: 3, cols: 3, label: "3×3" },
  { id: "4x4", rows: 4, cols: 4, label: "4×4" },
];

export function getLayout(id: string): LayoutDef {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
}

export function cellCount(id: string): number {
  const l = getLayout(id);
  return l.rows * l.cols;
}
