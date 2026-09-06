import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GSPS-style measurement persistence.
 *
 * GET    /api/annotations?studyUid=..&seriesUid=..  -> { annotations: [...] }
 * GET    /api/annotations?studyUid=..               -> { keys: [seriesUid, ...] }
 * PUT    /api/annotations { studyUid, seriesUid, payload }  -> upsert
 * DELETE /api/annotations?studyUid=..&seriesUid=..  -> remove one series set
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024; // 4 MB guard

export async function GET(req: NextRequest) {
  const studyUid = req.nextUrl.searchParams.get("studyUid");
  const seriesUid = req.nextUrl.searchParams.get("seriesUid");
  if (!studyUid) {
    return NextResponse.json({ error: "studyUid is required" }, { status: 400 });
  }

  try {
    if (!seriesUid) {
      const rows = await db.annotationSet.findMany({
        where: { studyUid },
        select: { seriesUid: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      });
      return NextResponse.json({ keys: rows });
    }

    const row = await db.annotationSet.findUnique({
      where: { studyUid_seriesUid: { studyUid, seriesUid } },
    });
    return NextResponse.json({
      annotations: row ? JSON.parse(row.payload) : [],
      updatedAt: row?.updatedAt ?? null,
    });
  } catch (e) {
    console.error("annotations GET failed", e);
    return NextResponse.json(
      { error: "Measurement store unavailable" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  let body: { studyUid?: string; seriesUid?: string; payload?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { studyUid, seriesUid, payload } = body;
  if (!studyUid || !seriesUid || !Array.isArray(payload)) {
    return NextResponse.json(
      { error: "studyUid, seriesUid and payload (array) are required" },
      { status: 400 }
    );
  }
  const json = JSON.stringify(payload);
  if (json.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  try {
    const row = await db.annotationSet.upsert({
      where: { studyUid_seriesUid: { studyUid, seriesUid } },
      create: { studyUid, seriesUid, payload: json },
      update: { payload: json },
    });
    return NextResponse.json({
      ok: true,
      updatedAt: row.updatedAt,
      count: payload.length,
    });
  } catch (e) {
    console.error("annotations PUT failed", e);
    return NextResponse.json(
      { error: "Measurement store unavailable" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const studyUid = req.nextUrl.searchParams.get("studyUid");
  const seriesUid = req.nextUrl.searchParams.get("seriesUid");
  if (!studyUid || !seriesUid) {
    return NextResponse.json(
      { error: "studyUid and seriesUid are required" },
      { status: 400 }
    );
  }
  try {
    await db.annotationSet.deleteMany({
      where: { studyUid, seriesUid },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("annotations DELETE failed", e);
    return NextResponse.json(
      { error: "Measurement store unavailable" },
      { status: 500 }
    );
  }
}
