import { NextRequest, NextResponse } from "next/server";
import {
  getAccount,
  saveAccount,
  verifyPassword,
} from "@/lib/server/auth";
import { requireSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AE_LIKE_RE = /^[A-Za-z0-9_.-]{1,32}$/;

/**
 * PUT /api/auth/credentials - change the viewer login (Settings > Security).
 * Requires the CURRENT password; then any of the session cookies keep working
 * (same secret, no forced re-login unless the user wants one).
 */
export async function PUT(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const currentPassword = String(body.currentPassword ?? "");
  const newUsername = String(body.newUsername ?? "").trim();
  const newPassword = String(body.newPassword ?? "");

  const account = await getAccount();
  if (!account || !verifyPassword(currentPassword, account.passwordHash)) {
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 403 }
    );
  }

  const username = newUsername || account.username;
  if (username.length < 2 || username.length > 32 || !AE_LIKE_RE.test(username)) {
    return NextResponse.json(
      { error: "Username must be 2-32 characters (letters, digits, . _ -)." },
      { status: 400 }
    );
  }

  if (newPassword && newPassword.length < 4) {
    return NextResponse.json(
      { error: "New password must be at least 4 characters." },
      { status: 400 }
    );
  }
  if (!newPassword && newUsername === account.username) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  await saveAccount(username, newPassword || currentPassword);
  return NextResponse.json({ ok: true, username });
}
