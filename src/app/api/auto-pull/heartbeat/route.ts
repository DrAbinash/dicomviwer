import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { setSetting } from "@/lib/server/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auto-pull/heartbeat
 *
 * Called by the Phase 2 auto-puller service (deploy/auto-puller) after every
 * poll cycle. Two purposes:
 *   1. liveness — "the puller ran at <time>, found X studies, pulled Y"
 *   2. activity log — one AutoPullEvent row per detected study
 *
 * Body shape (sent by auto_puller.py):
 * {
 *   status: "ok" | "partial" | "error",
 *   startedAt, finishedAt,                      // ISO timestamps
 *   pollIntervalSeconds, lookbackDays,
 *   targetAet,                                   // gateway AE title used for C-MOVE
 *   modalities: [{ name, enabled, error }],      // per-modality cycle outcome
 *   events: [{ sourceAet, studyUid, patientName, patientId,
 *              studyDescription, accessionNumber, action, detail }]
 * }
 */

const MAX_EVENTS_PER_HEARTBEAT = 200;

interface HeartbeatEvent {
  sourceAet?: string;
  studyUid?: string;
  patientName?: string;
  patientId?: string;
  studyDescription?: string;
  accessionNumber?: string;
  action?: string;
  detail?: string;
}

export async function POST(req: NextRequest) {
  // Optional shared-secret check. Set AUTO_PULL_TOKEN in the viewer env and
  // the same value in the puller's HEARTBEAT_TOKEN to lock this endpoint down.
  const expected = (process.env.AUTO_PULL_TOKEN || "").trim();
  if (expected) {
    const got = (req.headers.get("x-auto-pull-token") || "").trim();
    if (got !== expected) {
      return NextResponse.json({ error: "Invalid auto-pull token" }, { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status = ["ok", "partial", "error"].includes(String(body.status))
    ? String(body.status)
    : "ok";
  const startedAt = String(body.startedAt ?? "");
  const finishedAt = String(body.finishedAt ?? new Date().toISOString());
  const pollInterval = Number(body.pollIntervalSeconds ?? 0) || 0;
  const lookbackDays = Number(body.lookbackDays ?? 0) || 0;
  const targetAet = String(body.targetAet ?? "").slice(0, 64);

  const modalities = Array.isArray(body.modalities) ? body.modalities : [];
  const modalitySummary = modalities
    .slice(0, 50)
    .map((m) => {
      const o = (m ?? {}) as Record<string, unknown>;
      return {
        name: String(o.name ?? "?").slice(0, 64),
        enabled: !!o.enabled,
        error: String(o.error ?? "").slice(0, 200),
      };
    });

  const rawEvents = Array.isArray(body.events) ? (body.events as HeartbeatEvent[]) : [];
  const valid = rawEvents
    .filter((e) => e && typeof e === "object" && String(e.studyUid || "").trim())
    .slice(0, MAX_EVENTS_PER_HEARTBEAT)
    .map((e) => ({
      sourceAet: String(e.sourceAet ?? "unknown").slice(0, 64),
      studyUid: String(e.studyUid).trim().slice(0, 128),
      patientName: String(e.patientName ?? "").slice(0, 192),
      patientId: String(e.patientId ?? "").slice(0, 128),
      studyDescription: String(e.studyDescription ?? "").slice(0, 192),
      accessionNumber: String(e.accessionNumber ?? "").slice(0, 64),
      action: ["pulled", "skipped", "failed"].includes(String(e.action))
        ? String(e.action)
        : "skipped",
      detail: String(e.detail ?? "").slice(0, 500),
    }));

  try {
    if (valid.length > 0) {
      await db.autoPullEvent.createMany({ data: valid });
    }

    await setSetting("autopull.lastHeartbeatAt", new Date().toISOString());
    await setSetting(
      "autopull.lastCycle",
      JSON.stringify({
        status,
        startedAt,
        finishedAt,
        pollIntervalSeconds: pollInterval,
        lookbackDays,
        targetAet,
        modalities: modalitySummary,
        eventCount: valid.length,
        pulled: valid.filter((e) => e.action === "pulled").length,
        skipped: valid.filter((e) => e.action === "skipped").length,
        failed: valid.filter((e) => e.action === "failed").length,
      })
    );

    return NextResponse.json({ ok: true, accepted: valid.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to record heartbeat" },
      { status: 500 }
    );
  }
}
