import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  cookieOptions,
  createSessionToken,
  getAccount,
  verifyPassword,
} from "@/lib/server/auth";
import { getLicenseStatus } from "@/lib/server/license";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/auth/login { username, password } -> sets the session cookie. */
export async function POST(req: NextRequest) {
  // Trial gate: an unlicensed box must not hand out sessions either.
  const license = getLicenseStatus();
  if (license.state !== "valid") {
    return NextResponse.json(
      { error: "Viewer is not licensed - activate at the main page.", license },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!username || !password) {
    return NextResponse.json(
      { error: "Username and password are required." },
      { status: 400 }
    );
  }

  let account;
  try {
    account = await getAccount();
  } catch (e) {
    return NextResponse.json(
      { error: `Login storage unavailable: ${e instanceof Error ? e.message : e}` },
      { status: 500 }
    );
  }
  if (!account || account.username !== username || !verifyPassword(password, account.passwordHash)) {
    // small delay to blunt brute-force attempts
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const token = await createSessionToken(account.username);
  const res = NextResponse.json({ ok: true, username: account.username });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(req));
  return res;
}
