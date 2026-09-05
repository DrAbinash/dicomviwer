import { NextRequest, NextResponse } from "next/server";
import { jobStatus, OrthancError } from "@/lib/server/orthanc";
import { requireSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/dicom/jobs/[jobId] — poll an Orthanc job (retrieve progress). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const denied = await requireSession(req);
  if (denied) return denied;
  const { jobId } = await ctx.params;
  try {
    const status = await jobStatus(jobId);
    return NextResponse.json(status);
  } catch (e) {
    const msg = e instanceof OrthancError || e instanceof Error ? e.message : "Job poll failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
