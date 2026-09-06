/**
 * Storage & retention smoke test (run with: bun scripts/storage-smoke.ts)
 *
 * Seeds synthetic received studies, then verifies:
 *   1. storageStats() counts + disk numbers
 *   2. study-count rule keeps the newest N (dry-run deletes nothing)
 *   3. real cleanup deletes files + rows, oldest first
 *   4. age rule (backdated createdAt) selects exactly the old study
 *   5. disk-space rule deletes until under the byte budget
 *   6. disabled retention → no victims
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const TMP = path.resolve("/home/z/my-project/dicomviwer/db/retention-smoke-test");
process.env.DVV_RECEIVED_DIR = TMP;
// NOTE: do NOT override DATABASE_URL here — bun auto-loads the workspace .env
// (absolute path to the live SQLite DB). An explicit relative URL resolves
// against a different directory than the CLI/CLI-generated client expects.

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const ret = await import("../src/lib/server/storage-retention");

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) console.log(`  PASS  ${name}${extra ? " — " + extra : ""}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
}

async function seed(studyUid: string, patient: string, ageDays: number, nFiles: number) {
  await prisma.receivedStudy.create({
    data: {
      studyUid,
      sourceAet: "SMOKESCU",
      patientName: patient,
      patientId: `PID-${patient}`,
      studyDate: "20250101",
      studyDescription: `Smoke ${patient}`,
      modalities: "CT",
      createdAt: new Date(Date.now() - ageDays * 86_400_000),
      updatedAt: new Date(Date.now() - ageDays * 86_400_000),
    },
  });
  await prisma.receivedSeries.create({
    data: { seriesUid: `${studyUid}.1`, studyUid, seriesNumber: 1, modality: "CT", instanceCount: nFiles },
  });
  const dir = path.join(TMP, studyUid);
  await fs.mkdir(dir, { recursive: true });
  for (let i = 0; i < nFiles; i++) {
    const sop = `${studyUid}.${i + 1}`;
    const file = path.join(dir, `${sop}.dcm`);
    // 1 KB of noise per "instance"
    await fs.writeFile(file, Buffer.alloc(1024, i + 1));
    await prisma.receivedInstance.create({
      data: { sopUid: sop, studyUid, seriesUid: `${studyUid}.1`, instanceNumber: i + 1, filePath: file, bytes: 1024 },
    });
  }
}

async function wipeAll() {
  await prisma.receivedInstance.deleteMany({});
  await prisma.receivedSeries.deleteMany({});
  await prisma.receivedStudy.deleteMany({});
  await fs.rm(TMP, { recursive: true, force: true });
}

console.log("== storage & retention smoke ==");

await wipeAll();
await fs.mkdir(TMP, { recursive: true });
// s-old: 40 days, s-mid: 2 days, s-new: 0 days — 2 instances (2 KB) each
await seed("1.2.3.OLD", "OLDEST", 40, 2);
await seed("1.2.3.MID", "MIDDLE", 2, 2);
await seed("1.2.3.NEW", "NEWEST", 0, 2);

// 1 — stats
const stats = await ret.storageStats();
check("stats studies=3", stats.studies === 3);
check("stats instances=6", stats.instances === 6);
check("stats inboxBytes=6144", stats.inboxBytes === 6144);
check("stats inboxBytesOnDisk≈6144", (stats.inboxBytesOnDisk ?? 0) >= 6144, String(stats.inboxBytesOnDisk));
check("stats dbBytes found", (stats.dbBytes ?? 0) > 0, String(stats.dbBytes));
check("stats diskFree found", stats.diskFreeBytes == null || stats.diskFreeBytes > 0, String(stats.diskFreeBytes));
check("stats inboxDir set", stats.inboxDir.length > 0, stats.inboxDir);

// 2 — count rule (keep 2 newest), dry run
await ret.saveRetentionSettings({ enabled: true, maxAgeDays: 0, maxStudies: 2, maxDiskMb: 0 });
let plan = await ret.planCleanup();
check("count rule 1 victim", plan.victims.length === 1 && plan.victims[0].studyUid === "1.2.3.OLD", plan.victims.map((v) => v.studyUid).join(","));
check("victim reason", plan.victims[0]?.reasons.includes("study count limit"));
const dry = await ret.runCleanup({ dryRun: true });
check("dry run deletes nothing", dry.deletedStudies === 0 && dry.victims.length === 1);
check("dry run freedBytes=2048", dry.freedBytes === 2048);
const afterDry = await ret.storageStats();
check("dry run stats unchanged", afterDry.studies === 3);

// 3 — real cleanup
const real = await ret.runCleanup({ triggeredBy: "manual" });
check("real cleanup deletes 1", real.deletedStudies === 1);
check("real cleanup freed=2048", real.freedBytes === 2048);
const afterReal = await ret.storageStats();
check("after cleanup studies=2", afterReal.studies === 2);
check("after cleanup instances=4", afterReal.instances === 4);
const oldDirGone = await fs
  .stat(path.join(TMP, "1.2.3.OLD"))
  .then(() => false)
  .catch(() => true);
check("old study files removed", oldDirGone);

// 4 — age rule (backdated mid study to 40 days)
await prisma.receivedStudy.update({
  where: { studyUid: "1.2.3.MID" },
  data: { createdAt: new Date(Date.now() - 40 * 86_400_000) },
});
await ret.saveRetentionSettings({ enabled: true, maxAgeDays: 30, maxStudies: 0, maxDiskMb: 0 });
plan = await ret.planCleanup();
check("age rule targets MID", plan.victims.length === 1 && plan.victims[0].studyUid === "1.2.3.MID", plan.victims.map((v) => v.studyUid).join(","));
await ret.runCleanup();
check("age rule cleanup studies=1", (await ret.storageStats()).studies === 1);

// 5 — disk rule: BULK is the OLDEST (1 day) with ~1.5 MB of instance bytes;
// 1 MB budget → only the oldest study (BULK) must be selected.
await ret.saveRetentionSettings({ enabled: true, maxAgeDays: 0, maxStudies: 0, maxDiskMb: 0 });
plan = await ret.planCleanup();
check("disk rule no-op when under budget", plan.victims.length === 0);
await seed("1.2.3.BULK", "BULK", 1, 1500); // 1,536,000 bytes of instance metadata, older than NEWEST
await ret.saveRetentionSettings({ enabled: true, maxAgeDays: 0, maxStudies: 0, maxDiskMb: 1 });
plan = await ret.planCleanup();
check("disk rule targets oldest only", plan.victims.length === 1 && plan.victims[0].studyUid === "1.2.3.BULK", plan.victims.map((v) => `${v.studyUid}:${v.reasons.join("/")}`).join(","));
await ret.runCleanup();
check("disk rule cleanup studies=1", (await ret.storageStats()).studies === 1);

// 6 — disabled → no victims regardless
await ret.saveRetentionSettings({ enabled: false, maxAgeDays: 30, maxStudies: 1, maxDiskMb: 0 });
plan = await ret.planCleanup();
check("disabled → no victims", plan.victims.length === 0);

// settings round-trip + lastRun + scheduler info
await ret.saveRetentionSettings({ enabled: true, maxAgeDays: 7, maxStudies: 100, maxDiskMb: 500 });
const loaded = await ret.getRetentionSettings();
check("settings round-trip", loaded.enabled === true && loaded.maxAgeDays === 7 && loaded.maxStudies === 100 && loaded.maxDiskMb === 500);
const lastRun = await ret.lastAutoRun();
check("lastAutoRun persisted", lastRun !== null && lastRun.deletedStudies >= 1);
const sched = ret.schedulerInfo();
check("scheduler info shape", typeof sched.active === "boolean");

await wipeAll();
await prisma.$disconnect();
console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
