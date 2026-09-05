"use client";

/**
 * Cornerstone3D singleton initialisation.
 * Must run in the browser only (guarded by the dynamic ssr:false import chain).
 */
import { init as csCoreInit } from "@cornerstonejs/core";
import { init as csToolsInit } from "@cornerstonejs/tools";
import { init as initImageLoader } from "@cornerstonejs/dicom-image-loader";

type InitState = "idle" | "starting" | "ready" | "error";

let initPromise: Promise<void> | null = null;
let state: InitState = "idle";
let lastError: string | null = null;

export function getInitState(): { state: InitState; error: string | null } {
  return { state, error: lastError };
}

export async function ensureCornerstone(): Promise<void> {
  if (state === "ready") return;
  if (initPromise) return initPromise;

  state = "starting";
  initPromise = (async () => {
    try {
      csCoreInit({} as never);
      csToolsInit();
      initImageLoader({});
      state = "ready";
    } catch (e) {
      state = "error";
      lastError = e instanceof Error ? e.message : String(e);
      throw e;
    }
  })();

  return initPromise;
}
