import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, cookieOptions } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/auth/logout - clears the session cookie. */
export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(req), maxAge: 0 });
  return res;
}
