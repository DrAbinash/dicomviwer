import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import {
  listModalities,
  sendToModality,
  OrthancError,
} from "@/lib/server/orthanc";

/**
 * DICOM Send (C-STORE SCU) - Phase 3.
 *
 * GET  /api/dicom/send -> configured C-STORE destinations (AE titles)
 * POST /api/dicom/send { targetAe, studyUid, seriesUid? }
 *   -> the gateway C-STORE pushes the cached study/series to the destination
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;

  try {
    const modalities = await listModalities();
    return NextResponse.json({
      destinations: Object.entries(modalities).map(([name, cfg]) => ({
        name,
        aet: cfg.AET ?? name,
        host: cfg.Host,
        port: cfg.Port,
      })),
    });
  } catch (e) {
    const message =
      e instanceof OrthancError
        ? e.message
        : "Could not list destinations on the gateway";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;

  let body: { targetAe?: string; studyUid?: string; seriesUid?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const targetAe = String(body.targetAe ?? "").trim();
  const studyUid = String(body.studyUid ?? "").trim();
  const seriesUid = body.seriesUid ? String(body.seriesUid).trim() : null;
  if (!targetAe || !studyUid) {
    return NextResponse.json(
      { error: "targetAe and studyUid are required" },
      { status: 400 }
    );
  }
  if (!/^[A-Za-z0-9_.\- ]{1,64}$/.test(targetAe)) {
    return NextResponse.json({ error: "Invalid destination name" }, { status: 400 });
  }

  try {
    const result = await sendToModality({ targetAe, studyUid, seriesUid });
    return NextResponse.json({
      ok: true,
      level: result.level,
      instancesSent: result.instancesSent,
      target: targetAe,
    });
  } catch (e) {
    const status = e instanceof OrthancError ? e.status : 500;
    const message =
      e instanceof OrthancError ? e.message : "C-STORE push failed";
    return NextResponse.json({ error: message }, { status });
  }
}
