import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/auth/session - current login state for the client shell. */
export async function GET(req: NextRequest) {
  const user = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  return NextResponse.json({ authenticated: !!user, username: user ?? null });
}
