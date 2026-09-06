"use client";

/**
 * DICOM Send (C-STORE SCU) - Phase 3.
 *
 * Two transports:
 *  - Direct (Phase 3.5): the server process itself speaks C-STORE to the
 *    destination (sendDirect below, /api/dimse/send) — no gateway needed;
 *    payload comes from the local inbox or the gateway cache.
 *  - Gateway: the Orthanc gateway that cached the study acts as the C-STORE
 *    SCU (sendToModality, /api/dicom/send). Both are auth-gated.
 *
 * listServers/sendDirect live in ./pacs and are re-exported here for the
 * send dialog's convenience.
 */

export { listServers, sendDirect } from "./pacs";

export interface SendDestination {
  name: string;
  aet: string;
  host?: string;
  port?: number;
}

export interface SendOutcome {
  ok: boolean;
  message: string;
  instancesSent?: number;
}

export async function listSendDestinations(): Promise<SendDestination[]> {
  const res = await fetch("/api/dicom/send");
  if (!res.ok) {
    let msg = `Could not list destinations (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  const body = (await res.json()) as { destinations?: SendDestination[] };
  return body.destinations ?? [];
}

export async function sendToModality(opts: {
  targetAe: string;
  studyUid: string;
  seriesUid?: string | null;
}): Promise<SendOutcome> {
  const { targetAe, studyUid, seriesUid } = opts;
  const res = await fetch("/api/dicom/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetAe, studyUid, seriesUid }),
  });
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; instancesSent?: number; level?: string; error?: string }
    | null;

  if (!res.ok || !body?.ok) {
    return { ok: false, message: body?.error ?? `C-STORE failed (${res.status})` };
  }
  return {
    ok: true,
    instancesSent: body.instancesSent ?? 0,
    message: `Sent ${body.instancesSent ?? 0} instance(s) of ${
      body.level === "series" ? "series" : "study"
    } to ${targetAe}.`,
  };
}
