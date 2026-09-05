import { getGatewayConfig } from "./config";
import { upsertModality, removeModality } from "./orthanc";

/**
 * Shared validation + gateway registration for user-added PACS servers.
 */

export interface PacsServerInput {
  name: string;
  aeTitle: string;
  host: string;
  port: number;
  notes?: string | null;
}

const AE_RE = /^[A-Z0-9 _-]{1,16}$/;

export function validateServerInput(
  body: unknown
): { ok: true; data: PacsServerInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  const aeTitle = String(b.aeTitle ?? "").trim().toUpperCase();
  const host = String(b.host ?? "").trim();
  const notes = b.notes == null ? null : String(b.notes).trim().slice(0, 500) || null;
  const port = Number(b.port);

  if (!name) return { ok: false, error: "A display name is required." };
  if (name.length > 80) return { ok: false, error: "Name is too long (max 80)." };
  if (!aeTitle) return { ok: false, error: "AE Title is required." };
  if (!AE_RE.test(aeTitle))
    return {
      ok: false,
      error:
        "AE Title must be 1-16 characters: A-Z, 0-9, space, dash or underscore (DICOM standard).",
    };
  if (!host) return { ok: false, error: "IP address / hostname is required." };
  if (/\s/.test(host) || host.length > 253)
    return { ok: false, error: "IP address / hostname looks invalid." };
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return { ok: false, error: "Port must be a number between 1 and 65535." };

  return { ok: true, data: { name, aeTitle, host, port, notes } };
}

/** Best-effort registration into the Orthanc gateway. Never throws. */
export async function registerWithGateway(
  aeTitle: string,
  host: string,
  port: number
): Promise<{ registered: boolean; error?: string }> {
  const cfg = await getGatewayConfig();
  if (!cfg) return { registered: false, error: "Gateway not configured" };
  try {
    await upsertModality(aeTitle, host, port);
    return { registered: true };
  } catch (e) {
    return { registered: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function unregisterFromGateway(aeTitle: string): Promise<void> {
  const cfg = await getGatewayConfig();
  if (!cfg) return;
  try {
    await removeModality(aeTitle);
  } catch {
    /* best effort */
  }
}
