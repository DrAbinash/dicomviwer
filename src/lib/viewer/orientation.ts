"use client";

/**
 * Patient-relative orientation labels (R/L/A/P/S/I) for a stack viewport,
 * derived from the current image's DICOM ImageOrientationPatient via the
 * Cornerstone metadata provider - the same way Horos/RadiAnt annotate tiles.
 *
 * Radiological convention falls out naturally: the label shown on the right
 * edge is the patient side the image's column axis points toward (e.g. "L"
 * for a standard axial CT, so "R" appears on the viewer's left).
 *
 * Returns null when the metadata is unavailable - the caller simply hides
 * the markers (e.g. raw files without orientation data).
 */
import { metaData } from "@cornerstonejs/core";
import type { Types } from "@cornerstonejs/core";
import type { StackViewport } from "@cornerstonejs/core";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function neg(v: Vec3): Vec3 {
  return { x: -v.x, y: -v.y, z: -v.z };
}

function dominantLabel(v: Vec3): string {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return v.x > 0 ? "L" : "R";
  if (ay >= ax && ay >= az) return v.y > 0 ? "P" : "A";
  return v.z > 0 ? "S" : "I";
}

/** Rotate in-plane by θ degrees (screen-clockwise, matching viewer rotation). */
function rotateInPlane(right: Vec3, up: Vec3, thetaDeg: number): { right: Vec3; up: Vec3 } {
  const t = (thetaDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const right2: Vec3 = {
    x: right.x * c + up.x * s,
    y: right.y * c + up.y * s,
    z: right.z * c + up.z * s,
  };
  const up2: Vec3 = {
    x: up.x * c - right.x * s,
    y: up.y * c - right.y * s,
    z: up.z * c - right.z * s,
  };
  return { right: right2, up: up2 };
}

export function getOrientationLabels(
  vp: Types.IStackViewport | StackViewport | null
): { top: string; left: string } | null {
  if (!vp) return null;
  try {
    const stackVp = vp as StackViewport;
    const idx =
      (stackVp as unknown as { getCurrentImageIdIndex?: () => number }).getCurrentImageIdIndex?.() ?? 0;
    const imageIds = stackVp.getImageIds?.();
    const imageId = imageIds?.[idx];
    if (!imageId) return null;

    const plane = metaData.get("imagePlaneModule", imageId) as
      | { rowCosines?: Types.Point3; columnCosines?: Types.Point3 }
      | undefined;
    if (!plane?.rowCosines || !plane?.columnCosines) return null;

    let right: Vec3 = {
      x: plane.rowCosines[0],
      y: plane.rowCosines[1],
      z: plane.rowCosines[2],
    };
    // screen up = image rows grow downward on screen
    let up: Vec3 = neg({
      x: plane.columnCosines[0],
      y: plane.columnCosines[1],
      z: plane.columnCosines[2],
    });

    const rotation = vp.getRotation?.() ?? 0;
    ({ right, up } = rotateInPlane(right, up, rotation));

    const cam = vp.getCamera();
    if (cam.flipHorizontal) right = neg(right);
    if (cam.flipVertical) up = neg(up);

    return { top: dominantLabel(up), left: dominantLabel(neg(right)) };
  } catch {
    return null;
  }
}
