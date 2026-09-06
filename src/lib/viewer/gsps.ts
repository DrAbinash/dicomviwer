"use client";

/**
 * GSPS-style measurement persistence - Phase 3.
 *
 * Cornerstone annotations are plain JSON objects, so a series' overlay state
 * can be serialised, stored per (studyUid, seriesUid) in SQLite
 * (/api/annotations) and restored losslessly - the web equivalent of a GSPS
 * overlay object. Also supports JSON export/import for offline sharing.
 */
import { annotation, utilities as toolUtils } from "@cornerstonejs/tools";

interface StoredAnnotation {
  annotationUID?: string;
  toolName?: string;
  metadata?: Record<string, unknown> & { toolName?: string };
  data?: Record<string, unknown>;
  isVisible?: boolean;
  invalidated?: boolean;
  isLocked?: boolean;
}

/** The enabled viewport ids that should redraw after a restore. */
const knownViewportIds = new Set<string>();
export function trackGspsViewportId(id: string, enabled: boolean) {
  if (enabled) knownViewportIds.add(id);
  else knownViewportIds.delete(id);
}

/** Force the SVG annotation layer to redraw on every known viewport. */
function redrawAnnotations() {
  try {
    toolUtils.triggerAnnotationRenderForViewportIds([...knownViewportIds]);
  } catch {
    /* best effort */
  }
}

export const gsps = {
  /** All annotations currently in memory, serialisable. */
  serialize(): StoredAnnotation[] {
    try {
      const list = annotation.state.getAllAnnotations() as unknown as StoredAnnotation[];
      return list.map((a) => {
        try {
          return JSON.parse(JSON.stringify(a)) as StoredAnnotation;
        } catch {
          return {
            annotationUID: a.annotationUID,
            toolName: a.toolName ?? a.metadata?.toolName,
            metadata: a.metadata,
            data: a.data,
          };
        }
      });
    } catch {
      return [];
    }
  },

  count(): number {
    try {
      return (annotation.state.getAllAnnotations() as unknown[]).length;
    } catch {
      return 0;
    }
  },

  /** Restore annotations from a stored payload (server or imported file). */
  restore(list: StoredAnnotation[]): number {
    let restored = 0;
    for (const a of list) {
      const toolName = a?.toolName ?? a?.metadata?.toolName;
      if (!toolName || !a?.metadata) continue;
      try {
        annotation.state.addAnnotation(
          {
            ...a,
            toolName,
            // the display filter requires these flags to be set explicitly
            isVisible: a.isVisible ?? true,
            invalidated: a.invalidated ?? false,
            isLocked: a.isLocked ?? false,
          } as never,
          {
            FrameOfReferenceUID:
              (a.metadata.FrameOfReferenceUID as string) ?? "",
            toolName,
          } as never
        );
        restored += 1;
      } catch {
        /* skip malformed entries */
      }
    }
    if (restored > 0) {
      redrawAnnotations();
      // once more after the SVG layer settles (initial render race)
      setTimeout(redrawAnnotations, 350);
    }
    return restored;
  },

  clearAll() {
    try {
      annotation.state.removeAllAnnotations();
    } catch {
      /* noop */
    }
  },

  /** Trigger a JSON download of the current annotations. */
  exportJson(meta: {
    studyUid: string;
    seriesUid: string;
    patientName?: string;
  }) {
    const payload = {
      format: "dvv-annotations",
      version: 1,
      ...meta,
      savedAt: new Date().toISOString(),
      annotations: gsps.serialize(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `annotations-${meta.seriesUid.slice(0, 12)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
};

/* ----------------------------- server bridge ----------------------------- */

export async function fetchSavedAnnotations(
  studyUid: string,
  seriesUid: string
): Promise<unknown[]> {
  const res = await fetch(
    `/api/annotations?studyUid=${encodeURIComponent(
      studyUid
    )}&seriesUid=${encodeURIComponent(seriesUid)}`
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { annotations?: unknown[] };
  return body.annotations ?? [];
}

export async function saveAnnotations(
  studyUid: string,
  seriesUid: string
): Promise<{ ok: boolean; count: number; error?: string }> {
  const payload = gsps.serialize();
  const res = await fetch("/api/annotations", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studyUid, seriesUid, payload }),
  });
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; count?: number; error?: string }
    | null;
  return {
    ok: res.ok && !!body?.ok,
    count: body?.count ?? 0,
    error: body?.error,
  };
}

export async function deleteSavedAnnotations(
  studyUid: string,
  seriesUid: string
): Promise<boolean> {
  const res = await fetch(
    `/api/annotations?studyUid=${encodeURIComponent(
      studyUid
    )}&seriesUid=${encodeURIComponent(seriesUid)}`,
    { method: "DELETE" }
  );
  return res.ok;
}

/** Session cache + de-dup so series revisits don't refetch or double-add. */
const sessionCache = new Map<string, unknown[]>();
const restoredKeys = new Set<string>();

export function invalidateGspsCache(studyUid: string, seriesUid: string) {
  const key = `${studyUid}|${seriesUid}`;
  sessionCache.delete(key);
  restoredKeys.delete(key);
}

/** Restore saved annotations for a series (call after the stack is set). */
export async function autoRestore(
  studyUid: string,
  seriesUid: string
): Promise<number> {
  const key = `${studyUid}|${seriesUid}`;
  let stored: unknown[];
  if (sessionCache.has(key)) {
    stored = sessionCache.get(key) ?? [];
  } else {
    stored = await fetchSavedAnnotations(studyUid, seriesUid);
    sessionCache.set(key, stored);
  }
  if (stored.length === 0 || restoredKeys.has(key)) return 0;
  restoredKeys.add(key);
  return gsps.restore(stored as never);
}

export async function importMeasurements(file: File): Promise<number> {
  const text = await file.text();
  const parsed = JSON.parse(text) as { annotations?: unknown[] };
  const list = Array.isArray(parsed.annotations) ? parsed.annotations : [];
  return gsps.restore(list as never);
}
