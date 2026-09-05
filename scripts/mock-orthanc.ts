/**
 * Mock Orthanc gateway + remote PACS — sandbox verification only.
 *
 * Simulates everything the viewer's new PACS-settings feature talks to:
 *   /system, /modalities (CRUD), C-ECHO, C-FIND, C-GET jobs,
 *   DICOMweb QIDO (studies/series/instances) and WADO-URI file serving.
 *
 * The "remote study" it exposes is the bundled sample CT (public/samples/
 * phantom-ct), so a full PACS pull → WADO → render loop can be verified
 * without a real hospital PACS.
 *
 * Run:  bun scripts/mock-orthanc.ts   (listens on :3030)
 */

import dicomParser from "dicom-parser";
import { appendFileSync } from "node:fs";

const PORT = 3030;
const SAMPLE_DIR = "/home/z/my-project/public/samples/phantom-ct";
const MODALITY_AET = "MOCKPACS";
const LOG_FILE = "/tmp/mock-orthanc.log";

function log(msg: string) {
  const line = `[mock-orthanc] ${msg}`;
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    /* ignore */
  }
  console.log(line);
}

interface Instance {
  sopUid: string;
  file: Buffer;
}
interface StoredStudy {
  studyUid: string;
  seriesUid: string;
  instances: Instance[];
}

/* ---------------- load sample study ---------------- */

const BUN: typeof import("bun") = require("bun");
const files = Array.from(
  new Bun.Glob("I*.dcm").scanSync({ cwd: SAMPLE_DIR })
).sort();

let study: StoredStudy | null = null;
{
  const instances: Instance[] = [];
  let studyUid = "";
  let seriesUid = "";
  for (const name of files) {
    const buf = Buffer.from(await BUN.file(`${SAMPLE_DIR}/${name}`).arrayBuffer());
    try {
      const ds = dicomParser.parseDicom(new Uint8Array(buf));
      // NB: dicom-parser tags must be lowercase hex
      const rds = (tag: string) => ds.string(`x${tag.toLowerCase()}`) ?? "";
      studyUid = studyUid || rds("0020000D");
      seriesUid = seriesUid || rds("0020000E");
      const sop = rds("00080018");
      if (sop) instances.push({ sopUid: sop, file: buf });
    } catch {
      /* skip unparsable file */
    }
  }
  study = { studyUid, seriesUid, instances };
}
if (!study || study.instances.length === 0) {
  console.error("[mock-orthanc] no sample instances found - aborting");
  process.exit(1);
}
console.log(
  `[mock-orthanc] loaded ${study.instances.length} instances, study ${study.studyUid}`
);

/* ---------------- in-memory state ---------------- */

const modalities = new Map<string, { AET: string; Host: string; Port: number }>();
modalities.set(MODALITY_AET, { AET: MODALITY_AET, Host: "127.0.0.1", Port: 104 });

const jobs = new Map<string, { progress: number; state: string }>();
let jobCounter = 0;

/* ---------------- helpers ---------------- */

const DCM_TYPE = { "Content-Type": "application/dicom" };
const JSON_TYPE = { "Content-Type": "application/json" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_TYPE });
}

/** Orthanc /modalities/{id}/find answer format (hex tag -> {Type, Value}). */
function findTag(v: string | number): Record<string, unknown> {
  return { Type: Array.isArray(v) ? "String" : typeof v === "number" ? "String" : "String", Value: v };
}

function studyFindAnswers(): unknown[] {
  if (!study) return [];
  return [
    {
      "00080005": findTag("ISO_IR 100"),
      "00080020": findTag("20250110"),
      "00080030": findTag("120000"),
      "00080050": findTag("ACC-MOCK-001"),
      "00080061": findTag("CT"),
      "00081030": findTag("PHANTOM CT MOCK"),
      "00100010": findTag("DEMO^MOCK"),
      "00100020": findTag("MCK-001"),
      "00100040": findTag("M"),
      "0020000D": findTag(study.studyUid),
      "00201206": findTag(1),
      "00201208": findTag(study.instances.length),
    },
  ];
}

/** DICOMweb QIDO format (hex tag -> {vr, Value: []}). */
function qido(tag: string, vr: string, value: string | number[]) {
  return { [tag]: { vr, Value: Array.isArray(value) ? value : [value] } };
}

function studyQidoRow(): unknown {
  if (!study) return {};
  return {
    ...qido("00080005", "CS", "ISO_IR 100"),
    ...qido("00080020", "DA", "20250110"),
    ...qido("00080050", "SH", "ACC-MOCK-001"),
    ...qido("00080061", "CS", ["CT"]),
    ...qido("00081030", "LO", "PHANTOM CT MOCK"),
    ...qido("00100010", "PN", ["DEMO^MOCK"]),
    ...qido("00100020", "LO", "MCK-001"),
    ...qido("0020000D", "UI", study.studyUid),
    ...qido("00201206", "IS", "1"),
    ...qido("00201208", "IS", String(study.instances.length)),
  };
}

function seriesQidoRow(): unknown {
  if (!study) return {};
  return {
    ...qido("00080060", "CS", "CT"),
    ...qido("0008103E", "LO", "MOCK AXIAL 5.0mm"),
    ...qido("0020000E", "UI", study.seriesUid),
    ...qido("00200011", "IS", "1"),
    ...qido("00201209", "IS", String(study.instances.length)),
  };
}

function instanceQidoRows(): unknown[] {
  if (!study) return [];
  return study.instances.map((inst, i) => ({
    ...qido("00080018", "UI", inst.sopUid),
    ...qido("00200013", "IS", String(i + 1)),
  }));
}

/* ---------------- router ---------------- */

BUN.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const p = decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/";
    const m = req.method;
    log(`${m} ${p}${url.search}`);

    // ---------- system ----------
    if (m === "GET" && p === "/system") {
      return json({
        Name: "MockOrthanc",
        Version: "1.12.4-mock",
        DicomAet: "SYNOLOGYVIEWER",
        DicomPort: 4242,
        HttpPort: PORT,
      });
    }

    // ---------- modalities ----------
    if (m === "GET" && p === "/modalities") return json([...modalities.keys()]);
    if (m === "PUT" && p.startsWith("/modalities/")) {
      const id = p.slice("/modalities/".length);
      const body = (await req.json()) as { AET: string; Host: string; Port: number };
      modalities.set(id, { AET: body.AET, Host: body.Host, Port: body.Port });
      log(`modality saved: ${id} -> ${body.AET}@${body.Host}:${body.Port}`);
      return new Response(null, { status: 200 });
    }
    if (m === "GET" && p.startsWith("/modalities/")) {
      const id = p.slice("/modalities/".length);
      const mod = modalities.get(id);
      return mod ? json(mod) : new Response(null, { status: 404 });
    }
    if (m === "DELETE" && p.startsWith("/modalities/")) {
      const id = p.slice("/modalities/".length);
      return modalities.delete(id)
        ? new Response(null, { status: 200 })
        : json({ Message: "Unknown resource" }, 404);
    }

    // echo / find / get / move
    const modMatch = p.match(/^\/modalities\/([^/]+)\/(echo|find|get|move)$/);
    if (modMatch) {
      const [, id, action] = modMatch;
      if (!modalities.has(id) && !modalities.has(id.toUpperCase()))
        return json({ Message: `Unknown modality ${id}` }, 404);
      if (action === "echo") {
        await new Promise((r) => setTimeout(r, 250));
        return new Response(null, { status: 200 });
      }
      if (action === "find") {
        const body = (await req.json()) as { Level?: string };
        if (body.Level !== "Study") return json([], 200);
        await new Promise((r) => setTimeout(r, 150));
        return json(studyFindAnswers());
      }
      // get / move -> start a job
      const jobId = `job-${++jobCounter}`;
      jobs.set(jobId, { progress: 0, state: "Running" });
      return json({ ID: jobId });
    }

    // ---------- jobs ----------
    const jobMatch = p.match(/^\/jobs\/([^/]+)$/);
    if (jobMatch && m === "GET") {
      const job = jobs.get(jobMatch[1]);
      if (!job) return json({ Message: "Unknown job" }, 404);
      if (job.state === "Running") {
        job.progress = Math.min(100, job.progress + 22);
        if (job.progress >= 100) job.state = "Success";
      }
      return json({
        ID: jobMatch[1],
        State: job.state,
        Progress: job.progress / 100,
        ErrorCode: 0,
        ErrorDescription: "",
      });
    }

    // ---------- tools ----------
    if (m === "POST" && p === "/tools/find") {
      const body = (await req.json()) as { Query?: Record<string, string> };
      const uid = body.Query?.StudyInstanceUID;
      if (uid && study && uid !== study.studyUid) return json([], 200);
      return json(["mock-orthanc-study-id"]);
    }

    // ---------- DICOMweb (QIDO / WADO) ----------
    if (m === "GET" && (p === "/dicom-web/studies" || p === "/wado" || p.startsWith("/dicom-web/studies/"))) {
      if (!study) return json([], 200);

      if (p === "/dicom-web/studies") return json([studyQidoRow()]);

      if (p === "/wado") {
        const sop = url.searchParams.get("objectUID") ?? "";
        const inst = study.instances.find((i) => i.sopUid === sop);
        if (!inst) return new Response("unknown objectUID", { status: 404 });
        return new Response(new Uint8Array(inst.file), { headers: DCM_TYPE });
      }

      const rest = p.slice("/dicom-web/studies/".length);
      const parts = rest.split("/");
      // /studies/{uid} or /studies/{uid}/series -> series listing
      if (
        parts[0] === study.studyUid &&
        (parts.length === 1 || (parts.length === 2 && parts[1] === "series"))
      )
        return json([seriesQidoRow()]);
      // /studies/{uid}/series/{suid}/instances -> instance listing
      if (
        parts.length === 4 &&
        parts[0] === study.studyUid &&
        parts[1] === "series" &&
        parts[2] === study.seriesUid &&
        parts[3] === "instances"
      )
        return json(instanceQidoRows());
      return json({ Message: `Mock: unknown DICOMweb path ${p}` }, 404);
    }

    return json({ Message: `Mock: no route for ${m} ${p}` }, 404);
  },
});

console.log(`[mock-orthanc] listening on http://127.0.0.1:${PORT}`);
log(`listening on http://127.0.0.1:${PORT}`);
