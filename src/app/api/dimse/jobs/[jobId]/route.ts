import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { getJob } from "@/lib/server/dimse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/dimse/jobs/[jobId] — poll an in-process DIMSE job (retrieve/send). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  const denied = await requireSession(req);
  if (denied) return denied;
  const { jobId } = await ctx.params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found (expired?)" }, { status: 404 });
  return NextResponse.json(job);
}
