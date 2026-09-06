import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSettings, setSetting } from "./config";
import { getLicenseStatus } from "./license";

/**
 * Phase 2 login - self-hosted session auth for the viewer.
 *
 * Everything is configurable, nothing hardcoded per-site:
 *  - Credentials live in the AppSetting table (auth.username / auth.passwordHash,
 *    scrypt-hashed). On first boot they are seeded from the AUTH_USERNAME /
 *    AUTH_PASSWORD environment variables (deploy .env defaults: admin/admin,
 *    loudly documented as "change me") and can be changed any time in
 *    Settings > Security.
 *  - Session = HMAC-signed cookie. The signing secret comes from the
 *    AUTH_SECRET env var, or is auto-generated and persisted in the DB on
 *    first use (survives restarts, survives rebuilds, no secrets in code).
 *  - TTL is configurable via AUTH_TTL_HOURS (default 7 days).
 *
 * Machine-to-machine endpoints (auto-puller heartbeat) do NOT use this -
 * they authenticate with the AUTO_PULL_TOKEN shared secret instead.
 */

export const SESSION_COOKIE = "dvv_session";
const SESSION_TTL_HOURS = Number(process.env.AUTH_TTL_HOURS || "168") || 168;
const SESSION_VERSION = "v1";

/* ----------------------------- credentials ----------------------------- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
    const expected = Buffer.from(hashHex, "hex");
    return hash.length === expected.length && timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}

export interface ViewerAccount {
  username: string;
  passwordHash: string;
}

/** Account row from the DB, seeding from env on very first call. */
export async function getAccount(): Promise<ViewerAccount | null> {
  const s = await getSettings(["auth.username", "auth.passwordHash"]);
  if (s["auth.username"] && s["auth.passwordHash"]) {
    return { username: s["auth.username"], passwordHash: s["auth.passwordHash"] };
  }

  // First boot: seed from deployment env (documented defaults: admin/admin).
  const envUser = (process.env.AUTH_USERNAME || "admin").trim() || "admin";
  const envPass = process.env.AUTH_PASSWORD || "admin";
  const account: ViewerAccount = {
    username: envUser,
    passwordHash: hashPassword(envPass),
  };
  await setSetting("auth.username", account.username);
  await setSetting("auth.passwordHash", account.passwordHash);
  console.warn(
    "[auth] seeded initial login from environment - username '%s'. " +
      "Change the password in Settings > Security or set AUTH_PASSWORD.",
    envUser
  );
  return account;
}

export async function saveAccount(username: string, password: string): Promise<void> {
  await setSetting("auth.username", username.trim() || "admin");
  await setSetting("auth.passwordHash", hashPassword(password));
}

/* ------------------------------- sessions ------------------------------ */

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

async function getSessionSecret(): Promise<string> {
  const envSecret = (process.env.AUTH_SECRET || "").trim();
  if (envSecret) return envSecret;

  // Auto-generated once, then persisted in the DB (no hardcoded secrets).
  const s = await getSettings(["auth.sessionSecret"]);
  if (s["auth.sessionSecret"]) return s["auth.sessionSecret"];

  const generated = randomBytes(32).toString("hex");
  await setSetting("auth.sessionSecret", generated);
  console.warn(
    "[auth] generated a new session secret - set AUTH_SECRET in the env to " +
      "keep logins valid across database resets."
  );
  return generated;
}

interface SessionPayload {
  v: string;
  u: string;
  e: number; // expiry epoch ms
}

export async function createSessionToken(username: string): Promise<string> {
  const secret = await getSessionSecret();
  const payload: SessionPayload = {
    v: SESSION_VERSION,
    u: username,
    e: Date.now() + SESSION_TTL_HOURS * 3600_000,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const secret = await getSessionSecret();
  const expected = createHmac("sha256", secret).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
  } catch {
    return null;
  }
  if (payload.v !== SESSION_VERSION || typeof payload.e !== "number") return null;
  if (payload.e < Date.now()) return null;
  return payload.u;
}

export function cookieOptions(req?: NextRequest) {
  const isHttps =
    req?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isHttps,
    path: "/",
    maxAge: SESSION_TTL_HOURS * 3600,
  };
}

/* ------------------------------- guards -------------------------------- */

/** 401/403 response when unlicensed or no valid session, null when allowed. */
export async function requireSession(req: NextRequest): Promise<NextResponse | null> {
  // Trial gate first: an unlicensed box exposes NOTHING beyond activation.
  const license = getLicenseStatus();
  if (license.state !== "valid") {
    const { NextResponse } = await import("next/server");
    return NextResponse.json(
      { error: "Viewer is not licensed - activate at the main page.", license },
      { status: 403 }
    );
  }
  const user = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) {
    const { NextResponse } = await import("next/server");
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return null;
}

/** For server components: username of the current session, or null. */
export async function getSessionUser(): Promise<string | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}
