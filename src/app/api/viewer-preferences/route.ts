import { NextRequest, NextResponse } from "next/server";
import { getViewerPreferences, saveViewerPreferences } from "@/lib/server/viewer-preferences";
import { requireSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/viewer-preferences — window presets + viewer defaults (seeded, editable). */
export async function GET(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;
  const prefs = await getViewerPreferences();
  return NextResponse.json(prefs);
}

/** PUT /api/viewer-preferences — save presets / defaults from Settings > Viewer. */
export async function PUT(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const saved = await saveViewerPreferences(body as Parameters<typeof saveViewerPreferences>[0]);
  return NextResponse.json({ ok: true, preferences: saved });
}
