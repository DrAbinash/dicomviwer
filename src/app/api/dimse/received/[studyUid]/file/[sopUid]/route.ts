import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { receivedDir } from "@/lib/server/dimse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UID_RE = /^[0-9a-zA-Z.]+$/;

/**
 * GET /api/dimse/received/[studyUid]/file/[sopUid] — stream one stored
 * instance (application/dicom) so the browser can load it like a file.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ studyUid: string; sopUid: string }> }
) {
  const denied = await requireSession(req);
  if (denied) return denied;
  const { studyUid, sopUid } = await ctx.params;
  if (!UID_RE.test(studyUid) || !UID_RE.test(sopUid))
    return NextResponse.json({ error: "Invalid UID" }, { status: 400 });

  const inst = await db.receivedInstance.findUnique({ where: { sopUid } });
  if (!inst || inst.studyUid !== studyUid)
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });

  const root = path.resolve(receivedDir());
  const file = path.resolve(inst.filePath);
  if (!file.startsWith(root + path.sep))
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  try {
    const buf = await fs.readFile(file);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/dicom",
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Stored file is missing on disk" }, { status: 410 });
  }
}
