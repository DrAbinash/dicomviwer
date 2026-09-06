import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { ensureRetentionScheduler } from "@/lib/server/storage-retention";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/dimse/received — list studies in this viewer's DICOM inbox. */
export async function GET(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;
  ensureRetentionScheduler(); // lazy background cleanup start
  const studies = await db.receivedStudy.findMany({
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  const series = await db.receivedSeries.groupBy({
    by: ["studyUid"],
    _count: { _all: true },
    _sum: { instanceCount: true },
  });
  const byStudy = new Map(
    series.map((s) => [s.studyUid, { series: s._count._all, instances: s._sum.instanceCount ?? 0 }])
  );
  return NextResponse.json({
    studies: studies.map((s) => ({
      studyUid: s.studyUid,
      sourceAet: s.sourceAet,
      patientName: s.patientName || "Unknown",
      patientId: s.patientId || "-",
      studyDate: s.studyDate,
      studyDescription: s.studyDescription || "Study",
      modalities: s.modalities,
      seriesCount: byStudy.get(s.studyUid)?.series ?? 0,
      instanceCount: byStudy.get(s.studyUid)?.instances ?? 0,
      receivedAt: s.updatedAt.toISOString(),
    })),
  });
}
