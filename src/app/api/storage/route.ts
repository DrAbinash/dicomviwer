import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import {
  ensureRetentionScheduler,
  getRetentionSettings,
  lastAutoRun,
  saveRetentionSettings,
  schedulerInfo,
  storageStats,
  type RetentionSettings,
} from "@/lib/server/storage-retention";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/storage — inbox/DB disk stats + retention settings + scheduler state. */
export async function GET(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;
  ensureRetentionScheduler(); // lazy background cleanup start
  const [stats, settings, lastRun] = await Promise.all([
    storageStats(),
    getRetentionSettings(),
    lastAutoRun(),
  ]);
  return NextResponse.json({ stats, settings, lastRun, scheduler: schedulerInfo() });
}

/** PUT /api/storage — save retention rules. Body: RetentionSettings. */
export async function PUT(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;
  let body: Partial<RetentionSettings>;
  try {
    body = (await req.json()) as Partial<RetentionSettings>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const saved = await saveRetentionSettings({
    enabled: Boolean(body.enabled),
    maxAgeDays: body.maxAgeDays ?? 0,
    maxStudies: body.maxStudies ?? 0,
    maxDiskMb: body.maxDiskMb ?? 0,
  });
  ensureRetentionScheduler();
  return NextResponse.json({ ok: true, settings: saved });
}
