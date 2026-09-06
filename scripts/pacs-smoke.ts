/**
 * PACS loopback smoke test (Phase 3.5).
 *
 * Exercises the built-in DIMSE stack end-to-end without any external PACS:
 *   1. start the listener (C-STORE/C-FIND/C-ECHO SCP)
 *   2. C-ECHO round trip
 *   3. C-STORE push of 3 sample instances -> inbox rows + files on disk
 *   4. C-FIND (runFind SCU -> our own SCP) -> study row returned
 *   5. cleanup (rows, files, config restored)
 *
 * Run: bun scripts/pacs-smoke.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDimse } from "../src/lib/server/dimse";
import {
  getListenerConfig,
  saveListenerConfig,
  startListener,
  stopListener,
  runEcho,
  runFind,
  receivedDir,
} from "../src/lib/server/dimse";
import { db } from "../src/lib/db";

const PORT = 4114;
const AE = "DVVTEST";

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function main() {
  const m = await getDimse();
  const sampleDir = path.join(process.cwd(), "public", "samples", "phantom-ct");
  const samples = (await fs.readdir(sampleDir)).filter((f) => f.endsWith(".dcm")).slice(0, 3);
  if (samples.length < 3) fail("need 3 sample dcm files");
  console.log(`samples: ${samples.join(", ")}`);

  const prevCfg = await getListenerConfig();
  await saveListenerConfig({ enabled: true, aeTitle: AE, port: PORT });
  const start = await startListener();
  if (!start.running) fail(`listener did not start: ${start.error}`);
  console.log(`listener running on :${PORT} as ${AE}`);

  // 1) C-ECHO round trip
  const echo = await runEcho({ aeTitle: AE, host: "127.0.0.1", port: PORT });
  if (!echo.ok) fail(`C-ECHO failed: ${echo.error}`);
  console.log(`C-ECHO ok (${echo.ms} ms)`);

  // 2) C-STORE the 3 samples into our own listener
  const client: InstanceType<typeof m.Client> = new m.Client();
  let stored = 0;
  for (const f of samples) {
    const req = new m.requests.CStoreRequest(path.join(sampleDir, f));
    req.on("response", (res: { getStatus(): number }) => {
      if (res.getStatus() === m.constants.Status.Success) stored += 1;
      else console.log("store status:", res.getStatus());
    });
    client.addRequest(req);
  }
  await new Promise<void>((resolve, reject) => {
    client.on("networkError", (e: Error) => reject(e));
    const iv = setInterval(() => {
      if (stored >= samples.length) {
        clearInterval(iv);
        resolve();
      }
    }, 200);
    setTimeout(() => {
      clearInterval(iv);
      stored >= samples.length ? resolve() : reject(new Error("C-STORE timeout"));
    }, 30000);
    client.send("127.0.0.1", PORT, "SMOKESCU", AE, { connectTimeout: 10000 });
  });
  if (stored !== samples.length) fail(`stored ${stored}/${samples.length}`);
  console.log(`C-STORE ok: ${stored}/${samples.length} instances accepted`);

  // 3) inbox rows + files
  const studyRow = await db.receivedStudy.findFirst();
  if (!studyRow) fail("no ReceivedStudy row");
  const instRows = await db.receivedInstance.findMany();
  if (instRows.length !== samples.length) fail(`expected ${samples.length} instances, got ${instRows.length}`);
  const seriesRows = await db.receivedSeries.findMany();
  if (seriesRows.length !== 1) fail(`expected 1 series, got ${seriesRows.length}`);
  for (const r of instRows) {
    const stat = await fs.stat(r.filePath).catch(() => null);
    if (!stat) fail(`file missing on disk: ${r.filePath}`);
    if (!r.filePath.startsWith(receivedDir())) fail(`file outside inbox: ${r.filePath}`);
  }
  console.log(
    `inbox ok: study "${studyRow.patientName}" (${studyRow.modalities}), ${seriesRows.length} series, ${instRows.length} instances, files on disk`
  );

  // 4) C-FIND via our SCU against our SCP
  const found = await runFind({ aeTitle: AE, host: "127.0.0.1", port: PORT }, { patientName: "phantom" });
  if (found.length === 0) fail("C-FIND returned no rows");
  if (found[0].studyUid !== studyRow.studyUid) fail("C-FIND returned wrong study");
  console.log(
    `C-FIND ok: ${found.length} match — ${found[0].patientName} · ${found[0].studyDescription} · ${found[0].modalities}`
  );

  // 5) cleanup — restore config, wipe inbox
  stopListener();
  await saveListenerConfig({ enabled: prevCfg.enabled, aeTitle: prevCfg.aeTitle, port: prevCfg.port });
  await db.receivedInstance.deleteMany({});
  await db.receivedSeries.deleteMany({});
  await db.receivedStudy.deleteMany({});
  await fs.rm(receivedDir(), { recursive: true, force: true });
  console.log("cleanup ok — config restored, inbox wiped");

  console.log("\nALL PACS SMOKE TESTS PASSED");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
