import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { receivedDir } from "@/lib/server/dimse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UID_RE = /^[0-9a-zA-Z.]+$/;

/** GET /api/dimse/received/[studyUid] — series + instance index of one study. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ studyUid: string }> }) {
  const denied = await requireSession(req);
  if (denied) return denied;
  const { studyUid } = await ctx.params;
  if (!UID_RE.test(studyUid))
    return NextResponse.json({ error: "Invalid Study Instance UID" }, { status: 400 });

  const study = await db.receivedStudy.findUnique({ where: { studyUid } });
  if (!study) return NextResponse.json({ error: "Study not found in the inbox." }, { status: 404 });

  const series = await db.receivedSeries.findMany({
    where: { studyUid },
    orderBy: { seriesNumber: "asc" },
  });
  const instances = await db.receivedInstance.findMany({
    where: { studyUid },
    orderBy: { instanceNumber: "asc" },
    select: { sopUid: true, seriesUid: true, instanceNumber: true },
  });

  return NextResponse.json({
    study: {
      studyUid: study.studyUid,
      sourceAet: study.sourceAet,
      patientName: study.patientName,
      patientId: study.patientId,
      studyDate: study.studyDate,
      studyDescription: study.studyDescription,
      modalities: study.modalities,
      receivedAt: study.updatedAt.toISOString(),
    },
    series: series.map((s) => ({
      seriesUid: s.seriesUid,
      seriesNumber: s.seriesNumber,
      description: s.description,
      modality: s.modality,
      instanceCount: s.instanceCount,
    })),
    instances: instances.map((i) => ({
      sopUid: i.sopUid,
      seriesUid: i.seriesUid,
      instanceNumber: i.instanceNumber,
      url: `/api/dimse/received/${encodeURIComponent(studyUid)}/file/${encodeURIComponent(i.sopUid)}`,
    })),
  });
}

/** DELETE /api/dimse/received/[studyUid] — forget a received study (files+rows). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ studyUid: string }> }) {
  const denied = await requireSession(req);
  if (denied) return denied;
  const { studyUid } = await ctx.params;
  if (!UID_RE.test(studyUid))
    return NextResponse.json({ error: "Invalid Study Instance UID" }, { status: 400 });

  const dir = path.join(receivedDir(), studyUid);
  // Guard: only delete inside the inbox root.
  if (!path.resolve(dir).startsWith(path.resolve(receivedDir())))
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  await fs.rm(path.resolve(dir), { recursive: true, force: true }).catch(() => {});
  await db.receivedInstance.deleteMany({ where: { studyUid } });
  await db.receivedSeries.deleteMany({ where: { studyUid } });
  await db.receivedStudy.deleteMany({ where: { studyUid } });
  return NextResponse.json({ ok: true });
}
