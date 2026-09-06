import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LICENSE_PUBLIC_SPKI_B64 } from "./license-public";

/**
 * Trial / perpetual licensing for the Windows build.
 *
 * The vendor (you) signs short license payloads with an Ed25519 private key
 * that lives ONLY in the offline "license admin kit". The app embeds the
 * matching public key and refuses to run (web UI, every API route, and the
 * DICOM listener) while no valid key is installed:
 *
 *   state "none"    no license.key found -> activation screen
 *   state "invalid" key present but signature/payload broken
 *   state "expired" trial key, expiry date has passed
 *   state "locked"  clock rolled back (anti-tamper) -> needs a FRESH key
 *   state "valid"   run normally
 *
 * Key format (single line, easy to paste/e-mail):
 *   base64url(JSON payload) "." base64url(Ed25519 signature over payload bytes)
 *   payload = { v:1, typ:"trial"|"perpetual", name, exp?: "YYYY-MM-DD",
 *               iat: "YYYY-MM-DD", notes? }
 *
 * Anti-tamper: a sidecar state file records the highest clock value ever
 * seen. If the current clock is more than CLOCK_SLACK behind that maximum,
 * the license locks until the vendor issues a fresh key (activation resets
 * the state file - the "fresh key unlocks a locked box" workflow).
 *
 * Everything here is synchronous and file-based (no DB) so it can be called
 * from API routes, server components AND the dcmjs-dimse SCP callbacks.
 */

export type LicenseState = "valid" | "none" | "expired" | "invalid" | "locked";

export interface LicensePayload {
  v: 1;
  typ: "trial" | "perpetual";
  name: string;
  exp?: string; // ISO date, trial only
  iat?: string;
  notes?: string;
}

export interface LicenseStatus {
  state: LicenseState;
  /** "Trial" until shown while valid; edition label for the UI. */
  edition?: string;
  name?: string;
  typ?: "trial" | "perpetual";
  exp?: string;
  notes?: string;
  daysLeft?: number;
  message: string;
}

const CLOCK_SLACK_MS = 48 * 3600 * 1000; // tolerate +/- timezone/cmos drift
const MEMO_MS = 30_000;
const DAY_MS = 24 * 3600 * 1000;

/* ------------------------------ key material ----------------------------- */

function publicKey() {
  return createPublicKey({
    key: Buffer.from(LICENSE_PUBLIC_SPKI_B64, "base64"),
    format: "der",
    type: "spki",
  });
}

/* ------------------------------ file layout ------------------------------ */

export function licenseFilePath(): string {
  if (process.env.DVV_LICENSE_FILE) return path.resolve(process.env.DVV_LICENSE_FILE);
  const dir = process.env.DVV_DATA_DIR
    ? path.resolve(process.env.DVV_DATA_DIR)
    : process.cwd();
  return path.join(dir, "license.key");
}

function tamperFilePath(): string {
  return path.join(path.dirname(licenseFilePath()), ".licstate.json");
}

interface TamperState {
  max?: number; // highest Date.now() ever observed
  seen?: number; // last time we persisted (throttle)
  locked?: boolean;
}

function readTamper(): TamperState {
  try {
    const raw = readFileSync(tamperFilePath(), "utf8");
    const s = JSON.parse(raw) as TamperState;
    return typeof s === "object" && s ? s : {};
  } catch {
    return {};
  }
}

function writeTamper(s: TamperState): void {
  try {
    mkdirSync(path.dirname(tamperFilePath()), { recursive: true });
    writeFileSync(tamperFilePath(), JSON.stringify(s), { mode: 0o600 });
  } catch {
    /* read-only fs: tamper tracking degrades gracefully */
  }
}

/* ------------------------------- verification ---------------------------- */

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function verifyLicenseKey(key: string):
  | { ok: true; payload: LicensePayload }
  | { ok: false; error: string } {
  const clean = key.trim().replace(/\s+/g, "");
  if (!clean) return { ok: false, error: "License key is empty." };
  const dot = clean.indexOf(".");
  if (dot <= 0 || dot === clean.length - 1)
    return { ok: false, error: "License key format is invalid." };

  let payloadBuf: Buffer;
  let sigBuf: Buffer;
  try {
    payloadBuf = b64urlDecode(clean.slice(0, dot));
    sigBuf = b64urlDecode(clean.slice(dot + 1));
  } catch {
    return { ok: false, error: "License key is not decodable." };
  }

  let payload: LicensePayload;
  try {
    payload = JSON.parse(payloadBuf.toString("utf8")) as LicensePayload;
  } catch {
    return { ok: false, error: "License payload is corrupted." };
  }
  if (payload?.v !== 1 || (payload.typ !== "trial" && payload.typ !== "perpetual") ||
      typeof payload.name !== "string" || !payload.name.trim())
    return { ok: false, error: "License payload is not a valid viewer license." };

  let ok = false;
  try {
    ok = cryptoVerify(null, payloadBuf, publicKey(), sigBuf);
  } catch {
    ok = false;
  }
  if (!ok) return { ok: false, error: "License signature check failed - key not issued by the vendor." };
  return { ok: true, payload };
}

function payloadToStatus(payload: LicensePayload, state: LicenseState, message: string): LicenseStatus {
  const now = Date.now();
  const expMs = payload.exp ? Date.parse(`${payload.exp}T23:59:59Z`) : NaN;
  const daysLeft =
    state === "valid" && Number.isFinite(expMs)
      ? Math.max(0, Math.ceil((expMs - now) / DAY_MS))
      : undefined;
  return {
    state,
    edition: payload.typ === "perpetual" ? "Perpetual license" : "Trial license",
    name: payload.name,
    typ: payload.typ,
    exp: payload.exp,
    notes: payload.notes,
    daysLeft,
    message,
  };
}

/* --------------------------------- status -------------------------------- */

let memo: { at: number; status: LicenseStatus } | null = null;

export function invalidateLicenseMemo(): void {
  memo = null;
}

/**
 * Current license state. Sync + memoized (30 s) so DIMSE callbacks and
 * server components can call it freely; activation invalidates the memo.
 */
export function getLicenseStatus(): LicenseStatus {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.status;

  const status = computeStatus();
  memo = { at: Date.now(), status };
  return status;
}

function computeStatus(): LicenseStatus {
  const now = Date.now();

  // 1. anti-tamper: clock must never move backwards past the slack window
  const t = readTamper();
  if (t.locked) {
    return {
      state: "locked",
      message:
        "License locked: the system clock was rolled back. Ask your supplier for a fresh license key and activate it to unlock.",
    };
  }
  const max = typeof t.max === "number" ? t.max : 0;
  if (max > 0 && now < max - CLOCK_SLACK_MS) {
    writeTamper({ ...t, locked: true });
    return {
      state: "locked",
      message:
        "License locked: the system clock was rolled back. Ask your supplier for a fresh license key and activate it to unlock.",
    };
  }
  if (now > (t.seen ?? 0) + 60_000) writeTamper({ max: Math.max(max, now), seen: now });

  // 2. read + verify key file
  const file = licenseFilePath();
  if (!existsSync(file)) {
    return {
      state: "none",
      message: "No license key installed. Paste the key you received to start the trial.",
    };
  }
  let key: string;
  try {
    key = readFileSync(file, "utf8");
  } catch {
    return { state: "invalid", message: "License file exists but cannot be read." };
  }
  const v = verifyLicenseKey(key);
  if (!v.ok) return { state: "invalid", message: v.error };

  const p = v.payload;
  if (p.typ === "perpetual")
    return payloadToStatus(p, "valid", `Licensed to ${p.name} (perpetual).`);

  const expMs = p.exp ? Date.parse(`${p.exp}T23:59:59Z`) : NaN;
  if (!Number.isFinite(expMs))
    return { state: "invalid", message: "Trial license has no expiry date - key rejected." };
  if (now > expMs)
    return payloadToStatus(
      p,
      "expired",
      `Trial for ${p.name} expired on ${p.exp}. Contact your supplier for a fresh key - your data is kept.`
    );
  return payloadToStatus(
    p,
    "valid",
    `Licensed to ${p.name} - trial valid until ${p.exp} (${daysLeftStr(expMs, now)} left).`
  );
}

function daysLeftStr(expMs: number, now: number): string {
  const d = Math.ceil((expMs - now) / DAY_MS);
  return d === 1 ? "1 day" : `${d} days`;
}

/* ------------------------------- activation ------------------------------ */

/** Validate + persist a key. Fresh keys also clear a clock-tamper lock. */
export function activateLicense(
  key: string
): { ok: true; status: LicenseStatus } | { ok: false; error: string; status: LicenseStatus } {
  const v = verifyLicenseKey(key);
  if (!v.ok) return { ok: false, error: v.error, status: getLicenseStatus() };

  const p = v.payload;
  if (p.typ === "trial") {
    const expMs = p.exp ? Date.parse(`${p.exp}T23:59:59Z`) : NaN;
    if (!Number.isFinite(expMs))
      return { ok: false, error: "Trial key has no expiry date.", status: getLicenseStatus() };
    if (Date.now() > expMs)
      return {
        ok: false,
        error: `This trial key already expired on ${p.exp}. Ask for a fresh key.`,
        status: getLicenseStatus(),
      };
  }

  const file = licenseFilePath();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, key.trim() + "\n", { mode: 0o600 });
  } catch (e) {
    return {
      ok: false,
      error: `Cannot write license file (${e instanceof Error ? e.message : e}).`,
      status: getLicenseStatus(),
    };
  }
  // a fresh, valid key re-arms the box
  writeTamper({ max: Date.now(), seen: Date.now(), locked: false });
  invalidateLicenseMemo();

  const s = getLicenseStatus();
  return { ok: true, status: s };
}

/** Remove the installed key (Settings > License, session required). */
export function deactivateLicense(): void {
  try {
    rmSync(licenseFilePath(), { force: true });
  } catch {
    /* ignore */
  }
  invalidateLicenseMemo();
}

/* --------------------- vendor-side signing (kit only) -------------------- */

/**
 * Mirror of the keygen tool, used by repo smoke tests. The PRIVATE key is
 * never part of the deployed app; this helper only runs in the sandbox when
 * the key file is explicitly provided.
 */
export function signPayloadForTest(payload: LicensePayload, privatePemPath: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const pem = readFileSync(privatePemPath, "utf8");
  const sig = cryptoSign(null, body, createPrivateKey(pem));
  return `${body.toString("base64url")}.${sig.toString("base64url")}`;
}
