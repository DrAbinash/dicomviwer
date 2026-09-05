import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/server/config";
import { requireSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/auto-pull
 *
 * Monitoring endpoint for the Settings → Auto-Pull tab:
 *  - lastCycle: summary written by the most recent auto-puller heartbeat
 *  - events:    recent per-study activity (pulled / skipped / failed)
 */
const EVENT_LIMIT = 40;

export async function GET(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;

  const s = await getSettings(["autopull.lastHeartbeatAt", "autopull.lastCycle"]);

  let lastCycle: unknown = null;
  if (s["autopull.lastCycle"]) {
    try {
      lastCycle = JSON.parse(s["autopull.lastCycle"]);
    } catch {
      lastCycle = null;
    }
  }

  const events = await db.autoPullEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: EVENT_LIMIT,
  });

  return NextResponse.json({
    lastHeartbeatAt: s["autopull.lastHeartbeatAt"] ?? null,
    lastCycle,
    events,
    tokenProtected: !!process.env.AUTO_PULL_TOKEN,
  });
}
