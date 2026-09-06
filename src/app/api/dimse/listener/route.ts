import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import {
  getListenerConfig,
  saveListenerConfig,
  startListener,
  stopListener,
  listenerStatus,
} from "@/lib/server/dimse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/dimse/listener — built-in DICOM listener status + stats. */
export async function GET(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;
  const cfg = await getListenerConfig();
  return NextResponse.json(listenerStatus(cfg));
}

/**
 * PUT /api/dimse/listener — update listener settings and apply them
 * (start / stop / restart as needed). Body: { enabled?, aeTitle?, port?,
 * forwardToGateway? }
 */
export async function PUT(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const prev = await getListenerConfig();
    const cfg = await saveListenerConfig({
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      aeTitle: typeof body.aeTitle === "string" ? body.aeTitle : undefined,
      port: typeof body.port === "number" ? body.port : undefined,
      forwardToGateway:
        typeof body.forwardToGateway === "boolean" ? body.forwardToGateway : undefined,
    });

    const identityChanged = cfg.aeTitle !== prev.aeTitle || cfg.port !== prev.port;

    if (cfg.enabled && identityChanged) stopListener();
    if (cfg.enabled && !listenerStatus().running) {
      const r = await startListener();
      if (!r.running) {
        return NextResponse.json(
          { ...listenerStatus(cfg), error: r.error },
          { status: 409 }
        );
      }
    }
    if (!cfg.enabled && listenerStatus().running) stopListener();

    return NextResponse.json(listenerStatus(cfg));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save listener settings";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
