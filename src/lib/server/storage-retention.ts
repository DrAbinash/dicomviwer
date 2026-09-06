import { promises as fsp } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { getSettings, setSetting } from "@/lib/server/config";
import { receivedDir } from "@/lib/server/dimse";

/**
 * Local storage management for the built-in PACS inbox:
 *
 *  - Stats        — how much disk the inbox + SQLite DB occupy, free space
 *                   left on the volume that holds them.
 *  - Retention    — automatic deletion of old received studies ("backup
 *                   pruning") driven by three independent, optional limits:
 *                     1. max age in days
 *                     2. maximum number of studies kept
 *                     3. maximum disk space (MB) the inbox may occupy
 *                   Oldest studies are deleted first; every rule is
 *                   independent and a study may be matched by several.
 *  - Scheduler    — a lazy background timer (every 10 min) that enforces the
 *                   configured rules without any user interaction.
 *
 * Settings are persisted in AppSetting under the key "storage.retention";
 * the result of the last automatic run is stored under "storage.retention.lastRun".
 */

export const RETENTION_KEY = "storage.retention";
export const RETENTION_LASTRUN_KEY = "storage.retention.lastRun";

export interface RetentionSettings {
  enabled: boolean;
  /** Delete studies older than this many days. 0 = keep forever. */
  maxAgeDays: number;
  /** Keep at most this many studies in the inbox. 0 = unlimited. */
  maxStudies: number;
  /** Keep inbox below this many megabytes. 0 = unlimited. */
  maxDiskMb: number;
}

export interface VictimInfo {
  studyUid: string;
  label: string;
  bytes: number;
  ageDays: number;
  reasons: string[];
}

export interface CleanupResult {
  dryRun: boolean;
  deletedStudies: number;
  freedBytes: number;
  victims: VictimInfo[];
  remainingStudies: number;
  remainingBytes: number;
  triggeredBy: "manual" | "scheduler";
  at: string;
}

export interface StorageStats {
  studies: number;
  series: number;
  instances: number;
  inboxBytes: number;
  inboxBytesOnDisk: number | null;
  dbBytes: number | null;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  inboxDir: string;
  oldestReceivedAt: string | null;
  newestReceivedAt: string | null;
}

const DEFAULT_SETTINGS: RetentionSettings = {
  enabled: false,
  maxAgeDays: 0,
  maxStudies: 0,
  maxDiskMb: 0,
};

const SCHED_INTERVAL_MS = 10 * 60 * 1000; // enforce every 10 minutes
const SCHED_FIRST_DELAY_MS = 30 * 1000; // first pass shortly after boot

// ---------------------------------------------------------------- settings

export async function getRetentionSettings(): Promise<RetentionSettings> {
  const raw = (await getSettings([RETENTION_KEY]))[RETENTION_KEY];
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<RetentionSettings>;
    return sanitize(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function clampInt(v: unknown, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), max);
}

export function sanitize(v: Partial<RetentionSettings>): RetentionSettings {
  return {
    enabled: Boolean(v.enabled),
    maxAgeDays: clampInt(v.maxAgeDays, 36500), // ~100 years
    maxStudies: clampInt(v.maxStudies, 1_000_000),
    maxDiskMb: clampInt(v.maxDiskMb, 100 * 1024 * 1024), // 100 TB in MB
  };
}

export async function saveRetentionSettings(s: RetentionSettings): Promise<RetentionSettings> {
  const clean = sanitize(s);
  await setSetting(RETENTION_KEY, JSON.stringify(clean));
  return clean;
}

// ------------------------------------------------------------------- stats

async function dirSizeRecursive(dir: string): Promise<number> {
  let total = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSizeRecursive(p);
    else {
      try {
        total += (await fsp.stat(p)).size;
      } catch {
        /* file vanished mid-scan */
      }
    }
  }
  return total;
}

async function statFsOrNull(p: string): Promise<{ free: number; total: number } | null> {
  try {
    // fs.statfs — Node >= 18.15 / modern Bun
    const mod = (await import("node:fs/promises")) as unknown as {
      statfs?: (p: string) => Promise<{ bsize: number; bavail: number; blocks: number }>;
    };
    if (typeof mod.statfs !== "function") return null;
    const s = await mod.statfs(p);
    return {
      free: s.bsize * s.bavail,
      total: s.bsize * s.blocks,
    };
  } catch {
    return null;
  }
}

/** Best-effort size of the SQLite database file. */
async function dbFileBytes(): Promise<number | null> {
  const candidates: string[] = [];
  const url = process.env.DATABASE_URL || "";
  if (url.startsWith("file:")) {
    const raw = url.slice(5);
    // Prisma resolves relative file: URLs against the schema directory.
    candidates.push(path.resolve(process.cwd(), "prisma", raw));
    candidates.push(path.resolve(process.cwd(), raw));
  }
  candidates.push(path.resolve(process.cwd(), "db", "custom.db"));
  candidates.push(path.resolve(process.cwd(), "db", "dicomviewer.db"));
  for (const c of candidates) {
    try {
      return (await fsp.stat(c)).size;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

export async function storageStats(): Promise<StorageStats> {
  const [studies, series, instances, agg] = await Promise.all([
    db.receivedStudy.count(),
    db.receivedSeries.count(),
    db.receivedInstance.count(),
    db.receivedInstance.aggregate({ _sum: { bytes: true } }),
  ]);
  const oldest = await db.receivedStudy.findFirst({
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const newest = await db.receivedStudy.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const dir = receivedDir();
  const [inboxOnDisk, dbBytes, fsInfo] = await Promise.all([
    dirSizeRecursive(dir).catch(() => null),
    dbFileBytes(),
    statFsOrNull(dir),
  ]);

  return {
    studies,
    series,
    instances,
    inboxBytes: agg._sum.bytes ?? 0,
    inboxBytesOnDisk: inboxOnDisk,
    dbBytes,
    diskFreeBytes: fsInfo?.free ?? null,
    diskTotalBytes: fsInfo?.total ?? null,
    inboxDir: dir,
    oldestReceivedAt: oldest ? oldest.createdAt.toISOString() : null,
    newestReceivedAt: newest ? newest.createdAt.toISOString() : null,
  };
}

// ----------------------------------------------------------------- cleanup

async function bytesByStudy(): Promise<Map<string, number>> {
  const grouped = await db.receivedInstance.groupBy({
    by: ["studyUid"],
    _sum: { bytes: true },
  });
  return new Map(grouped.map((g) => [g.studyUid, g._sum.bytes ?? 0]));
}

/**
 * Compute which studies the current retention rules would delete.
 * Oldest studies are always the first candidates.
 */
export async function planCleanup(): Promise<{
  settings: RetentionSettings;
  victims: VictimInfo[];
  totalStudies: number;
  totalBytes: number;
}> {
  const settings = await getRetentionSettings();
  const now = Date.now();

  const studies = await db.receivedStudy.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      studyUid: true,
      patientName: true,
      patientId: true,
      studyDate: true,
      studyDescription: true,
      createdAt: true,
    },
  });
  const bytes = await bytesByStudy();

  const totalStudies = studies.length;
  const totalBytes = studies.reduce((sum, s) => sum + (bytes.get(s.studyUid) ?? 0), 0);

  if (!settings.enabled) {
    return { settings, victims: [], totalStudies, totalBytes };
  }

  const victims = new Map<string, VictimInfo>();
  const addVictim = (s: (typeof studies)[number], reason: string) => {
    const existing = victims.get(s.studyUid);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      return;
    }
    victims.set(s.studyUid, {
      studyUid: s.studyUid,
      label:
        [s.patientName || "Unknown", s.studyDescription || s.studyDate || s.patientId]
          .filter(Boolean)
          .join(" · ") || s.studyUid,
      bytes: bytes.get(s.studyUid) ?? 0,
      ageDays: Math.max(0, Math.floor((now - s.createdAt.getTime()) / 86_400_000)),
      reasons: [reason],
    });
  };

  // Rule 1 — age: everything older than maxAgeDays.
  if (settings.maxAgeDays > 0) {
    const cutoff = now - settings.maxAgeDays * 86_400_000;
    for (const s of studies) if (s.createdAt.getTime() < cutoff) addVictim(s, "older than limit");
  }

  // Rule 2 — study count: keep the newest N, drop the rest.
  if (settings.maxStudies > 0 && totalStudies > settings.maxStudies) {
    const overflow = totalStudies - settings.maxStudies;
    for (const s of studies.slice(0, overflow)) addVictim(s, "study count limit");
  }

  // Rule 3 — disk space: delete oldest until the inbox fits maxDiskMb.
  if (settings.maxDiskMb > 0 && totalBytes > settings.maxDiskMb * 1024 * 1024) {
    let budget = totalBytes - settings.maxDiskMb * 1024 * 1024;
    for (const s of studies) {
      if (budget <= 0) break;
      const b = bytes.get(s.studyUid) ?? 0;
      addVictim(s, "disk space limit");
      budget -= b;
    }
  }

  return { settings, victims: [...victims.values()], totalStudies, totalBytes };
}

/** Remove one study's files (inside the inbox only) + all DB rows. */
async function deleteStudyData(studyUid: string): Promise<number> {
  const dir = path.join(receivedDir(), studyUid);
  const root = path.resolve(receivedDir());
  const target = path.resolve(dir);
  if (target.startsWith(root)) {
    await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
  }
  // Sum bytes first so the caller can report freed space accurately.
  const agg = await db.receivedInstance.aggregate({
    where: { studyUid },
    _sum: { bytes: true },
  });
  await db.receivedInstance.deleteMany({ where: { studyUid } });
  await db.receivedSeries.deleteMany({ where: { studyUid } });
  await db.receivedStudy.deleteMany({ where: { studyUid } });
  return agg._sum.bytes ?? 0;
}

/**
 * Enforce the retention rules. With dryRun=true nothing is deleted —
 * the exact plan is returned (used by the Settings UI preview).
 */
export async function runCleanup(
  opts: { dryRun?: boolean; triggeredBy?: "manual" | "scheduler" } = {}
): Promise<CleanupResult> {
  const plan = await planCleanup();
  const victims = plan.victims;
  const dryRun = Boolean(opts.dryRun);
  const triggeredBy = opts.triggeredBy ?? "manual";

  let freed = 0;
  if (!dryRun) {
    for (const v of victims) freed += await deleteStudyData(v.studyUid);
  } else {
    freed = victims.reduce((s, v) => s + v.bytes, 0);
  }

  const result: CleanupResult = {
    dryRun,
    deletedStudies: dryRun ? 0 : victims.length,
    freedBytes: freed,
    victims,
    remainingStudies: plan.totalStudies - (dryRun ? 0 : victims.length),
    remainingBytes: plan.totalBytes - freed,
    triggeredBy,
    at: new Date().toISOString(),
  };

  if (!dryRun && victims.length > 0) {
    // Persist for the Settings > Storage "last automatic run" line.
    await setSetting(
      RETENTION_LASTRUN_KEY,
      JSON.stringify({
        at: result.at,
        deletedStudies: result.deletedStudies,
        freedBytes: result.freedBytes,
        triggeredBy,
      })
    ).catch(() => {});
  }
  return result;
}

// --------------------------------------------------------------- scheduler

interface SchedulerState {
  timer: ReturnType<typeof setInterval> | null;
  nextRunAt: number | null;
  running: boolean;
  lastRunAt: string | null;
  lastDeleted: number | null;
}

const globalForSched = globalThis as unknown as { dvvRetentionSched?: SchedulerState };

function schedState(): SchedulerState {
  if (!globalForSched.dvvRetentionSched) {
    globalForSched.dvvRetentionSched = {
      timer: null,
      nextRunAt: null,
      running: false,
      lastRunAt: null,
      lastDeleted: null,
    };
  }
  return globalForSched.dvvRetentionSched;
}

async function scheduledPass(): Promise<void> {
  const st = schedState();
  if (st.running) return; // previous pass still in flight
  st.running = true;
  st.nextRunAt = null;
  try {
    const settings = await getRetentionSettings();
    if (!settings.enabled) return;
    const res = await runCleanup({ triggeredBy: "scheduler" });
    st.lastRunAt = res.at;
    st.lastDeleted = res.deletedStudies;
    if (res.deletedStudies > 0) {
      console.log(
        `[retention] auto-deleted ${res.deletedStudies} studies, freed ${(res.freedBytes / 1048576).toFixed(1)} MB`
      );
    }
  } catch (err) {
    console.error("[retention] scheduled cleanup failed:", err);
  } finally {
    st.running = false;
    st.nextRunAt = Date.now() + SCHED_INTERVAL_MS;
  }
}

/**
 * Lazily start the retention scheduler (guarded so repeated API-route
 * imports cannot spawn multiple timers). No-op timers are cheap: the pass
 * exits immediately when retention is disabled.
 */
export function ensureRetentionScheduler(): void {
  const st = schedState();
  if (st.timer) return;
  st.nextRunAt = Date.now() + SCHED_FIRST_DELAY_MS;
  st.timer = setInterval(() => {
    void scheduledPass();
  }, SCHED_INTERVAL_MS);
  // Do not keep the Node process alive just for retention.
  (st.timer as unknown as { unref?: () => void }).unref?.();
  setTimeout(() => void scheduledPass(), SCHED_FIRST_DELAY_MS).unref?.();
}

export function schedulerInfo(): { active: boolean; nextRunAt: string | null; lastRunAt: string | null } {
  const st = schedState();
  return {
    active: Boolean(st.timer),
    nextRunAt: st.nextRunAt ? new Date(st.nextRunAt).toISOString() : null,
    lastRunAt: st.lastRunAt,
  };
}

export async function lastAutoRun(): Promise<{ at: string; deletedStudies: number; freedBytes: number } | null> {
  const raw = (await getSettings([RETENTION_LASTRUN_KEY]))[RETENTION_LASTRUN_KEY];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
