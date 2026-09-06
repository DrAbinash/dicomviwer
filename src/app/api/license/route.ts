import { NextRequest, NextResponse } from "next/server";
import { activateLicense, getLicenseStatus } from "@/lib/server/license";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public license endpoints - reachable WITHOUT a session so a trial customer
 * can activate the box. Everything else in the app requires a valid license
 * (root layout gate + requireSession + DICOM listener guard).
 */

/** GET /api/license -> current license status (safe, no secrets). */
export async function GET() {
  return NextResponse.json({ license: getLicenseStatus() });
}

/** POST /api/license { key } -> validate + install the key. */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const key = String(body.key ?? "");
  const result = activateLicense(key);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, license: result.status },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, license: result.status });
}
