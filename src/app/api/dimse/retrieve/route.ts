import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { startRetrieveJob } from "@/lib/server/dimse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dimse/retrieve — pull a study from a remote PACS directly into
 * this viewer's inbox. Runs as an in-process job; poll /api/dimse/jobs/[id].
 *
 * method:
 *  - "cget"  (default) — this viewer issues C-GET and receives the
 *    sub-operations on the same association. The remote needs no
 *    registration of this viewer.
 *  - "cmove" — this viewer asks the remote to push to the built-in listener
 *    (must be running, and the remote must know our AE title + port).
 */
export async function POST(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const serverId = String(body.serverId ?? "");
  const studyUid = String(body.studyUid ?? "").trim();
  const method = body.method === "cmove" ? "cmove" : "cget";

  if (!studyUid || !/^[0-9.]+$/.test(studyUid)) {
    return NextResponse.json({ error: "A valid Study Instance UID is required." }, { status: 400 });
  }
  const server = await db.pacsServer.findUnique({ where: { id: serverId } });
  if (!server) {
    return NextResponse.json({ error: "PACS server not found." }, { status: 404 });
  }

  try {
    const jobId = await startRetrieveJob({
      peer: { aeTitle: server.aeTitle, host: server.host, port: server.port },
      studyUid,
      method,
    });
    return NextResponse.json({ jobId, method });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Retrieve failed to start";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
