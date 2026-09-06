import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { ensureRetentionScheduler, runCleanup } from "@/lib/server/storage-retention";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/storage/cleanup — run the retention rules right now.
 * Body: { dryRun?: boolean } (default true so the UI preview is safe).
 */
export async function POST(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;
  ensureRetentionScheduler();
  let dryRun = true;
  try {
    const body = (await req.json()) as { dryRun?: boolean };
    dryRun = Boolean(body?.dryRun);
  } catch {
    /* no body → safe default (dry run) */
  }
  const result = await runCleanup({ dryRun, triggeredBy: "manual" });
  return NextResponse.json(result);
}
