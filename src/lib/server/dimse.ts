import { promises as fs, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import dicomParser from "dicom-parser";
import { getLicenseStatus } from "./license";
import type {
  association,
  Client,
  Dataset,
  requests,
  responses,
  Server as ServerClass,
} from "dcmjs-dimse";

type CEchoRequest = requests.CEchoRequest;
type CEchoResponse = responses.CEchoResponse;
type CFindRequest = requests.CFindRequest;
type CFindResponse = responses.CFindResponse;
type CGetRequest = requests.CGetRequest;
type CGetResponse = responses.CGetResponse;
type CMoveRequest = requests.CMoveRequest;
type CMoveResponse = responses.CMoveResponse;
type CStoreRequestShape = requests.CStoreRequest;
type CStoreResponseShape = responses.CStoreResponse;
type AssociationShape = association.Association;
import { db } from "@/lib/db";
import { getSettings, setSetting, getGatewayConfig, basicAuth } from "./config";

/**
 * Built-in PACS node (Phase 3.5).
 *
 * The viewer itself becomes a first-class DICOM node — no external gateway
 * required:
 *
 *  - C-STORE SCP  (`startListener`) — a native DICOM listener. Modalities and
 *    other PACS can push studies straight into the viewer's inbox; every
 *    received instance is stored on disk under db/dicom-received/ and indexed
 *    in SQLite (ReceivedStudy / ReceivedSeries / ReceivedInstance). When an
 *    Orthanc gateway is configured, instances are additionally forwarded into
 *    the gateway so they flow through the whole existing pipeline.
 *  - C-FIND SCP   — the listener also answers study-level queries against the
 *    received inbox, so external PACS can see what this viewer holds.
 *  - C-ECHO SCU   (`runEcho`) — connectivity test, no gateway needed.
 *  - C-FIND SCU   (`runFind`) — study-level query of a remote PACS directly
 *    from this process.
 *  - C-GET / C-MOVE SCU (`startRetrieveJob`) — pull a study from a remote
 *    PACS. C-GET receives the sub-operations on the same association;
 *    C-MOVE asks the remote to push to our own listener.
 *  - C-STORE SCU  (`startSendJob`) — push a held study (inbox or gateway
 *    cache) to another DICOM node.
 *
 * Everything is user-configurable (AE title / port / enable) via the
 * `pacs.listener` AppSetting row. No addresses, ports or AEs are hardcoded.
 */

type DimseModule = typeof import("dcmjs-dimse");

let dimseCache: DimseModule | null = null;

/**
 * Load a CommonJS module at runtime, bypassing webpack's static analysis.
 * dcmjs-dimse uses node:net / node:crypto / node:stream, which the bundler
 * refuses to inline. Strategy: 1) direct-eval require — inside the server
 * bundle this is webpack's runtime require, which resolves externalized
 * packages natively; 2) native dynamic import (Bun / plain ESM runtimes).
 * Results are shape-validated either way.
 */
function normalizeDimse(mod: unknown): DimseModule | null {
  if (!mod || typeof mod !== "object") return null;
  const m = mod as Record<string, unknown>;
  const candidate = ("Client" in m ? m : (m as { default?: unknown }).default) as
    | DimseModule
    | undefined;
  return candidate && typeof candidate === "object" && "Client" in (candidate as object)
    ? candidate
    : null;
}

export async function getDimse(): Promise<DimseModule> {
  if (dimseCache) return dimseCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-eval
    const req = eval("typeof require === 'function' ? require : undefined") as
      | ((id: string) => unknown)
      | undefined;
    if (typeof req === "function") {
      const m = normalizeDimse(req("dcmjs-dimse"));
      if (m) {
        dimseCache = m;
        return m;
      }
    }
  } catch {
    /* fall through to native import */
  }
  try {
    const m = normalizeDimse(await import(/* webpackIgnore: true */ "dcmjs-dimse"));
    if (m) {
      dimseCache = m;
      return m;
    }
  } catch {
    /* handled below */
  }
  throw new Error("dcmjs-dimse could not be loaded in this runtime");
}

/* ----------------------------- configuration ---------------------------- */

const LISTENER_KEY = "pacs.listener";
const AE_RE = /^[A-Z0-9 _-]{1,16}$/;

export interface ListenerConfig {
  enabled: boolean;
  aeTitle: string;
  port: number;
  forwardToGateway: boolean;
}

const DEFAULT_LISTENER: ListenerConfig = {
  enabled: false,
  aeTitle: "DICOMVIEWER",
  // Deployment can pin the listening port via DVV_LISTEN_PORT (docker-compose
  // maps "${DVV_LISTEN_PORT}:${DVV_LISTEN_PORT}"); the Settings UI value
  // (AppSetting) always wins once the user saves it.
  port: Number(process.env.DVV_LISTEN_PORT) > 0 ? Number(process.env.DVV_LISTEN_PORT) : 4104,
  forwardToGateway: true,
};

export async function getListenerConfig(): Promise<ListenerConfig> {
  await ensureAutoStart();
  try {
    const s = await getSettings([LISTENER_KEY]);
    if (!s[LISTENER_KEY]) return { ...DEFAULT_LISTENER };
    const raw = JSON.parse(s[LISTENER_KEY]) as Partial<ListenerConfig>;
    const port = Number(raw.port);
    return {
      enabled: Boolean(raw.enabled),
      aeTitle: String(raw.aeTitle || DEFAULT_LISTENER.aeTitle).toUpperCase().slice(0, 16),
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_LISTENER.port,
      forwardToGateway: raw.forwardToGateway !== false,
    };
  } catch {
    return { ...DEFAULT_LISTENER };
  }
}

let autoStartDone = false;

/**
 * Start the listener on first use if the user enabled it. Called from
 * getListenerConfig (every DIMSE code path flows through it), so the
 * listener comes up after a server restart the first time the viewer or a
 * DIMSE peer touches the module — no boot-time hook needed (and none of the
 * edge-runtime complications of Next's instrumentation hook).
 */
export async function ensureAutoStart(): Promise<void> {
  if (autoStartDone || state.server) return;
  autoStartDone = true; // set first: startListener re-enters getListenerConfig
  try {
    const s = await getSettings([LISTENER_KEY]);
    if (!s[LISTENER_KEY]) return;
    const cfg = JSON.parse(s[LISTENER_KEY]) as Partial<ListenerConfig>;
    if (cfg.enabled && !state.running) {
      const r = await startListener();
      if (!r.running) console.warn("[dimse] auto-start failed:", r.error);
      else console.log(`[dimse] listener auto-started on port ${cfg.port} as ${cfg.aeTitle}`);
    }
  } catch (e) {
    console.warn("[dimse] listener auto-start skipped:", e instanceof Error ? e.message : e);
  }
}

export async function saveListenerConfig(input: Partial<ListenerConfig>): Promise<ListenerConfig> {
  const cur = await getListenerConfig();
  const next: ListenerConfig = {
    enabled: input.enabled ?? cur.enabled,
    aeTitle: String(input.aeTitle ?? cur.aeTitle).trim().toUpperCase().slice(0, 16),
    port: Number.isInteger(input.port) && (input.port as number) > 0 && (input.port as number) < 65536
      ? (input.port as number)
      : cur.port,
    forwardToGateway: input.forwardToGateway ?? cur.forwardToGateway,
  };
  if (!AE_RE.test(next.aeTitle))
    throw new Error("AE Title must be 1-16 characters: A-Z, 0-9, space, dash or underscore.");
  await setSetting(LISTENER_KEY, JSON.stringify(next));
  return next;
}

/* ------------------------------ inbox store ----------------------------- */

export function receivedDir(): string {
  return process.env.DVV_RECEIVED_DIR
    ? path.resolve(process.env.DVV_RECEIVED_DIR)
    : path.resolve(process.cwd(), "db", "dicom-received");
}

function sanitizeUid(uid: string): string {
  return uid.replace(/[^0-9a-zA-Z.]/g, "_").slice(0, 120);
}

function toFilePromise(ds: Dataset, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ds.toFile(file, (err: Error | undefined) => (err ? reject(err) : resolve()));
  });
}

function readStr(ds: dicomParser.DataSet, tag: string): string {
  try {
    return ds.string(tag) || "";
  } catch {
    return "";
  }
}

interface DcmMeta {
  studyUid: string;
  seriesUid: string;
  sopUid: string;
  patientName: string;
  patientId: string;
  patientBirthDate: string;
  patientSex: string;
  studyDate: string;
  studyDescription: string;
  accessionNumber: string;
  seriesNumber: number;
  seriesDescription: string;
  modality: string;
  instanceNumber: number;
}

/** Extract the index metadata from a stored P10 file with dicom-parser. */
function readMeta(file: string): DcmMeta {
  const buf = new Uint8Array(readFileSync(file));
  const ds = dicomParser.parseDicom(buf);
  const num = (tag: string) => {
    const s = readStr(ds, tag);
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    studyUid: readStr(ds, "x0020000d"),
    seriesUid: readStr(ds, "x0020000e"),
    sopUid: readStr(ds, "x00080018"),
    patientName: readStr(ds, "x00100010"),
    patientId: readStr(ds, "x00100020"),
    patientBirthDate: readStr(ds, "x00100030"),
    patientSex: readStr(ds, "x00100040"),
    studyDate: readStr(ds, "x00080020"),
    studyDescription: readStr(ds, "x00081030"),
    accessionNumber: readStr(ds, "x00080050"),
    seriesNumber: num("x00200011") || 1,
    seriesDescription: readStr(ds, "x0008103e"),
    modality: readStr(ds, "x00080060") || "OT",
    instanceNumber: num("x00200013"),
  };
}

async function recomputeModalities(studyUid: string): Promise<void> {
  const series = await db.receivedSeries.findMany({
    where: { studyUid },
    select: { modality: true },
  });
  const mods = Array.from(new Set(series.map((s) => s.modality).filter(Boolean))).join(",");
  await db.receivedStudy.updateMany({ where: { studyUid }, data: { modalities: mods } });
}

/** Best-effort forward of one stored instance into the Orthanc gateway. */
async function forwardToGateway(file: string): Promise<void> {
  const cfg = await getGatewayConfig();
  if (!cfg) return;
  const body = await fs.readFile(file);
  const res = await fetch(`${cfg.base}/instances`, {
    method: "POST",
    headers: { "Content-Type": "application/dicom", Authorization: basicAuth(cfg) },
    body: new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`gateway /instances ${res.status}`);
}

/** Add one inbound C-STORE dataset to the inbox (and optionally the gateway). */
export async function ingestDataset(ds: Dataset, sourceAet: string): Promise<void> {
  const inbox = receivedDir();
  const tmpDir = path.join(inbox, "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `${randomUUID()}.dcm`);
  await toFilePromise(ds, tmp);

  let meta: DcmMeta;
  try {
    meta = readMeta(tmp);
  } finally {
    // file is moved below on success; on parse failure remove the temp copy
  }

  try {
    if (!meta.studyUid || !meta.sopUid)
      throw new Error("dataset has no Study/SOP Instance UID");
    const finalDir = path.join(inbox, sanitizeUid(meta.studyUid));
    await fs.mkdir(finalDir, { recursive: true });
    const final = path.join(finalDir, `${sanitizeUid(meta.sopUid)}.dcm`);
    await fs.rename(tmp, final);

    const bytes = (await fs.stat(final)).size;
    const existed = await db.receivedInstance.findUnique({ where: { sopUid: meta.sopUid } });
    await db.receivedInstance.upsert({
      where: { sopUid: meta.sopUid },
      update: { receivedAt: new Date() },
      create: {
        sopUid: meta.sopUid,
        studyUid: meta.studyUid,
        seriesUid: meta.seriesUid || "unknown",
        instanceNumber: meta.instanceNumber,
        filePath: final,
        bytes,
      },
    });
    if (meta.seriesUid) {
      await db.receivedSeries.upsert({
        where: { seriesUid: meta.seriesUid },
        update: {
          seriesNumber: meta.seriesNumber,
          description: meta.seriesDescription,
          modality: meta.modality,
          ...(existed ? {} : { instanceCount: { increment: 1 } }),
        },
        create: {
          seriesUid: meta.seriesUid,
          studyUid: meta.studyUid,
          seriesNumber: meta.seriesNumber,
          description: meta.seriesDescription,
          modality: meta.modality,
          instanceCount: 1,
        },
      });
    }
    await db.receivedStudy.upsert({
      where: { studyUid: meta.studyUid },
      update: {
        sourceAet: sourceAet || undefined,
        patientName: meta.patientName || undefined,
        patientId: meta.patientId || undefined,
        patientBirthDate: meta.patientBirthDate || undefined,
        patientSex: meta.patientSex || undefined,
        studyDate: meta.studyDate || undefined,
        studyDescription: meta.studyDescription || undefined,
        accessionNumber: meta.accessionNumber || undefined,
      },
      create: {
        studyUid: meta.studyUid,
        sourceAet: sourceAet,
        patientName: meta.patientName,
        patientId: meta.patientId,
        patientBirthDate: meta.patientBirthDate,
        patientSex: meta.patientSex,
        studyDate: meta.studyDate,
        studyDescription: meta.studyDescription,
        accessionNumber: meta.accessionNumber,
        modalities: meta.modality,
      },
    });
    if (!existed) await recomputeModalities(meta.studyUid);

    stats.instances += existed ? 0 : 1;
    stats.lastReceivedAt = new Date().toISOString();

    const cfg = await getListenerConfig();
    if (cfg.forwardToGateway) {
      const gw = await getGatewayConfig();
      if (gw) {
        forwardToGateway(final).catch(() => {
          stats.forwardFailures += 1;
        });
      }
    }
    bumpIngestWatchers(meta.studyUid, existed ? 0 : 1);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/* ------------------------------- listener ------------------------------- */

interface ListenerStats {
  associations: number;
  instances: number;
  forwardFailures: number;
  lastReceivedAt: string | null;
  lastError: string | null;
  startedAt: string | null;
}

const stats: ListenerStats = {
  associations: 0,
  instances: 0,
  forwardFailures: 0,
  lastReceivedAt: null,
  lastError: null,
  startedAt: null,
};

interface ListenerState {
  server: ServerClass | null;
  running: boolean;
  cfg: ListenerConfig | null;
}

const state: ListenerState = { server: null, running: false, cfg: null };

/** C-MOVE retrievals in flight: studyUid -> jobId, used to route progress. */
const activeMoveJobs = new Map<string, string>();
const ingestWatchers = new Map<string, Array<(n: number) => void>>();

function bumpIngestWatchers(studyUid: string, n: number): void {
  const ws = activeMoveJobs.get(studyUid);
  if (!ws) return;
  const fns = ingestWatchers.get(ws);
  if (fns) fns.forEach((f) => f(n));
}

function stripWild(v: string): string {
  return v.replace(/\*/g, "").replace(/\?/g, "").trim();
}

/** Probe a TCP port (so EADDRINUSE never crashes the server process). */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, () => {
      srv.close(() => resolve(true));
    });
  });
}

export async function startListener(): Promise<{ running: boolean; error: string | null }> {
  const { Server, Scp, Dataset, constants, responses } = await getDimse();
  if (state.server) return { running: true, error: null };
  const cfg = await getListenerConfig();

  const free = await probePort(cfg.port);
  if (!free) {
    state.running = false;
    stats.lastError = `Port ${cfg.port} is already in use`;
    return { running: false, error: stats.lastError };
  }

  class DvvScp extends Scp {
    private callingAet = "UNKNOWN";

    associationRequested(association: AssociationShape): void {
      this.callingAet = association.getCallingAeTitle() || "UNKNOWN";
      stats.associations += 1;
      association.setMaxPduLength(65536);
      // Accept every proposed presentation context with its first transfer
      // syntax — we only persist bytes, we never need to decode them here.
      for (const pc of association.getPresentationContexts()) {
        const ctx = association.getPresentationContext(pc.id);
        const ts = ctx.getTransferSyntaxUids();
        ctx.setResult(constants.PresentationContextResult.Accept, ts[0]);
      }
      this.sendAssociationAccept();
    }

    cEchoRequest(request: CEchoRequest, callback: (response: CEchoResponse) => void): void {
      const resp = responses.CEchoResponse.fromRequest(request);
      if (getLicenseStatus().state !== "valid") {
        resp.setStatus(constants.Status.ProcessingFailure);
        try {
          resp.setErrorComment("Viewer license inactive - activate at the web UI");
        } catch {
          /* optional */
        }
        callback(resp);
        return;
      }
      resp.setStatus(constants.Status.Success);
      callback(resp);
    }

    async cFindRequest(
      request: CFindRequest,
      callback: (responses: Array<CFindResponse>) => void
    ): Promise<void> {
      const out: CFindResponse[] = [];
      if (getLicenseStatus().state !== "valid") {
        const resp = responses.CFindResponse.fromRequest(request);
        resp.setStatus(constants.Status.ProcessingFailure);
        try {
          resp.setErrorComment("Viewer license inactive - activate at the web UI");
        } catch {
          /* optional */
        }
        callback([resp]);
        return;
      }
      try {
        const ds = request.getDataset();
        if (!ds) throw new Error("C-FIND identifier dataset missing");
        const q = {
          patientName: stripWild(dsStr(ds, "PatientName")),
          patientId: stripWild(dsStr(ds, "PatientID")),
          patientBirthDate: dsStr(ds, "PatientBirthDate"),
          studyDate: dsStr(ds, "StudyDate"),
          accession: stripWild(dsStr(ds, "AccessionNumber")),
          modality: dsStr(ds, "ModalitiesInStudy").toUpperCase(),
          studyUid: dsStr(ds, "StudyInstanceUID"),
        };
        const where: Record<string, unknown> = {};
        if (q.patientName) where.patientName = { contains: q.patientName };
        if (q.patientId) where.patientId = { contains: q.patientId };
        if (q.patientBirthDate) where.patientBirthDate = q.patientBirthDate;
        if (/^\d{8}-\d{8}$/.test(q.studyDate))
          where.studyDate = { gte: q.studyDate.slice(0, 8), lte: q.studyDate.slice(9) };
        else if (/^\d{8}$/.test(q.studyDate)) where.studyDate = q.studyDate;
        if (q.accession) where.accessionNumber = { contains: q.accession };
        if (q.studyUid) where.studyUid = q.studyUid;
        if (q.modality) where.modalities = { contains: q.modality };

        const rows = await db.receivedStudy.findMany({ where, take: 200 });
        for (const r of rows) {
          const series = await db.receivedSeries.count({ where: { studyUid: r.studyUid } });
          const resp = responses.CFindResponse.fromRequest(request);
          resp.setDataset(
            new Dataset({
              PatientName: r.patientName,
              PatientID: r.patientId,
              PatientBirthDate: r.patientBirthDate,
              PatientSex: r.patientSex,
              StudyDate: r.studyDate,
              StudyTime: "",
              StudyDescription: r.studyDescription,
              AccessionNumber: r.accessionNumber,
              ModalitiesInStudy: r.modalities,
              NumberOfStudyRelatedSeries: String(series),
              StudyInstanceUID: r.studyUid,
            })
          );
          resp.setStatus(constants.Status.Pending);
          out.push(resp);
        }
      } catch (e) {
        stats.lastError = e instanceof Error ? e.message : String(e);
      }
      const fin = responses.CFindResponse.fromRequest(request);
      fin.setStatus(constants.Status.Success);
      out.push(fin);
      callback(out);
    }

    async cStoreRequest(
      request: CStoreRequestShape,
      callback: (response: CStoreResponseShape) => void
    ): Promise<void> {
      const resp = responses.CStoreResponse.fromRequest(request);
      if (getLicenseStatus().state !== "valid") {
        resp.setStatus(constants.Status.ProcessingFailure);
        try {
          resp.setErrorComment("Viewer license inactive - activate at the web UI");
        } catch {
          /* optional */
        }
        callback(resp);
        return;
      }
      try {
        const ds = request.getDataset();
        if (!ds) throw new Error("C-STORE dataset missing");
        await ingestDataset(ds, this.callingAet);
        resp.setStatus(constants.Status.Success);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        stats.lastError = `C-STORE from ${this.callingAet}: ${msg}`;
        resp.setStatus(constants.Status.ProcessingFailure);
        try {
          resp.setErrorComment(msg.slice(0, 120));
        } catch {
          /* optional */
        }
      }
      callback(resp);
    }

    cMoveRequest(
      request: CMoveRequest,
      callback: (responses: Array<CMoveResponse>) => void
    ): void {
      const resp = responses.CMoveResponse.fromRequest(request);
      resp.setStatus(constants.Status.SopClassNotSupported);
      callback([resp]);
    }

    cGetRequest(
      request: CGetRequest,
      callback: (responses: Array<CGetResponse>) => void
    ): void {
      const resp = responses.CGetResponse.fromRequest(request);
      resp.setStatus(constants.Status.SopClassNotSupported);
      callback([resp]);
    }
  }

  const server = new Server(DvvScp);
  server.listen(cfg.port, { associationTimeout: 120000, connectTimeout: 20000 });
  state.server = server;
  state.running = true;
  state.cfg = cfg;
  stats.startedAt = stats.startedAt ?? new Date().toISOString();
  stats.lastError = null;
  return { running: true, error: null };
}

export function stopListener(): void {
  if (state.server) {
    try {
      state.server.close();
    } catch {
      /* ignore */
    }
  }
  state.server = null;
  state.running = false;
}

export function isListenerRunning(): boolean {
  return state.running;
}

export interface ListenerStatus {
  running: boolean;
  config: ListenerConfig;
  stats: ListenerStats;
}

export function listenerStatus(cfg?: ListenerConfig): ListenerStatus {
  return { running: state.running, config: cfg ?? state.cfg ?? DEFAULT_LISTENER, stats };
}

/* --------------------------- dataset helpers ---------------------------- */

type PNPart = { Alphabetic?: string } | string;

/** Read a DICOM element as a flat string from a dcmjs-dimse Dataset. */
export function dsStr(ds: Dataset, keyword: string): string {
  let v: unknown;
  try {
    v = ds.getElement(keyword);
  } catch {
    return "";
  }
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  const flat = (x: PNPart): string => {
    if (typeof x === "string") return x;
    if (x && typeof x === "object" && "Alphabetic" in x) return x.Alphabetic ?? "";
    return "";
  };
  if (Array.isArray(v)) return v.map(flat).filter(Boolean).join("\\");
  return flat(v as PNPart);
}

/* ------------------------------ job registry ---------------------------- */

export interface DimseJob {
  id: string;
  kind: "retrieve" | "send";
  label: string;
  state: "Pending" | "Success" | "Failure";
  progress: number;
  errorCode: number;
  errorDescription: string;
  instancesDone: number;
  instancesTotal: number;
  startedAt: string;
  finishedAt: string | null;
}

const jobs = new Map<string, DimseJob>();

function newJob(kind: DimseJob["kind"], label: string): DimseJob {
  pruneJobs();
  const job: DimseJob = {
    id: randomUUID(),
    kind,
    label,
    state: "Pending",
    progress: 2,
    errorCode: 0,
    errorDescription: "",
    instancesDone: 0,
    instancesTotal: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  return job;
}

function pruneJobs(): void {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [k, j] of jobs) {
    if (j.finishedAt && new Date(j.finishedAt).getTime() < cutoff) jobs.delete(k);
  }
}

export function getJob(id: string): DimseJob | null {
  return jobs.get(id) ?? null;
}

function finishJob(job: DimseJob, ok: boolean, error = "", code = 0): void {
  job.state = ok ? "Success" : "Failure";
  job.errorDescription = error;
  job.errorCode = code;
  job.progress = ok ? 100 : job.progress;
  job.finishedAt = new Date().toISOString();
}

/* -------------------------------- SCU ops -------------------------------- */

export interface DicomPeer {
  aeTitle: string; // called AE (remote)
  host: string;
  port: number;
}

async function ourAe(): Promise<string> {
  const cfg = await getListenerConfig();
  return cfg.aeTitle;
}

function watchdog(ms: number, onFire: () => void): { clear(): void } {
  const t = setTimeout(onFire, ms);
  return { clear: () => clearTimeout(t) };
}

/** C-ECHO SCU — verification, with round-trip latency. */
export function runEcho(peer: DicomPeer): Promise<{ ok: boolean; ms: number; error?: string }> {
  return new Promise(async (resolve) => {
    const m = await getDimse();
    const client: Client = new m.Client();
    const t0 = Date.now();
    let settled = false;
    const done = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      wd.clear();
      resolve({ ok, ms: Date.now() - t0, error });
    };
    const wd = watchdog(12000, () => {
      try {
        client.abort();
      } catch {
        /* ignore */
      }
      done(false, "C-ECHO timed out after 12s");
    });

    const req = new m.requests.CEchoRequest();
    req.on("response", (res: { getStatus(): number }) => {
      done(res.getStatus() === m.constants.Status.Success ? true : false,
        res.getStatus() === m.constants.Status.Success ? undefined : `status ${res.getStatus()}`);
    });
    client.on("networkError", (e: Error) => done(false, e.message));
    client.addRequest(req);
    ourAe()
      .then((ae) => client.send(peer.host, peer.port, ae, peer.aeTitle, { connectTimeout: 10000 }))
      .catch((e) => done(false, e instanceof Error ? e.message : String(e)));
  });
}

export interface RemoteStudyRow {
  studyUid: string;
  patientName: string;
  patientId: string;
  patientBirthDate: string;
  studyDate: string;
  studyDescription: string;
  accessionNumber: string;
  modalities: string;
  seriesCount: string;
}

export interface FindFilters {
  patientName?: string;
  patientId?: string;
  dateFrom?: string;
  dateTo?: string;
  modality?: string;
  accession?: string;
}

function wildcard(v?: string): string {
  const t = (v ?? "").trim();
  return t ? `*${t.replace(/\*/g, "")}*` : "";
}

function dateRange(from?: string, to?: string): string {
  const f = (from ?? "").replace(/-/g, "");
  const t = (to ?? "").replace(/-/g, "");
  if (f && t) return `${f}-${t}`;
  if (f) return `${f}-${f}`;
  if (t) return `${t}-${t}`;
  return "";
}

/** C-FIND SCU — study-level query, spoken directly by this process. */
export function runFind(peer: DicomPeer, filters: FindFilters): Promise<RemoteStudyRow[]> {
  return new Promise(async (resolve, reject) => {
    const m = await getDimse();
    const client: Client = new m.Client();
    const rows: RemoteStudyRow[] = [];
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      wd.clear();
      err ? reject(err) : resolve(rows);
    };
    const wd = watchdog(30000, () => {
      try {
        client.abort();
      } catch {
        /* ignore */
      }
      finish(new Error("C-FIND timed out after 30s"));
    });

    const req = m.requests.CFindRequest.createStudyFindRequest({
      PatientName: wildcard(filters.patientName),
      PatientID: wildcard(filters.patientId),
      PatientBirthDate: "",
      StudyDate: dateRange(filters.dateFrom, filters.dateTo),
      StudyDescription: "",
      AccessionNumber: wildcard(filters.accession),
      ModalitiesInStudy: (filters.modality ?? "").trim().toUpperCase(),
      NumberOfStudyRelatedSeries: "",
      StudyInstanceUID: "",
      StudyTime: "",
      PatientSex: "",
    });
    req.on("response", (res: { getStatus(): number; getDataset(): Dataset | undefined }) => {
      if (res.getStatus() === m.constants.Status.Pending && res.getDataset()) {
        const ds = res.getDataset() as Dataset;
        rows.push({
          studyUid: dsStr(ds, "StudyInstanceUID"),
          patientName: dsStr(ds, "PatientName") || "Unknown",
          patientId: dsStr(ds, "PatientID") || "-",
          patientBirthDate: dsStr(ds, "PatientBirthDate"),
          studyDate: dsStr(ds, "StudyDate"),
          studyDescription: dsStr(ds, "StudyDescription") || "Study",
          accessionNumber: dsStr(ds, "AccessionNumber") || "-",
          modalities: dsStr(ds, "ModalitiesInStudy"),
          seriesCount: dsStr(ds, "NumberOfStudyRelatedSeries") || "?",
        });
      } else if (res.getStatus() === m.constants.Status.Success) {
        finish(null);
      } else if (res.getStatus() !== m.constants.Status.Pending) {
        finish(new Error(`C-FIND failed with status ${res.getStatus()}`));
      }
    });
    client.on("networkError", (e: Error) => finish(new Error(e.message)));
    client.addRequest(req);
    ourAe()
      .then((ae) => client.send(peer.host, peer.port, ae, peer.aeTitle, { connectTimeout: 10000 }))
      .catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
  });
}

/* ------------------------------ retrieve job ---------------------------- */

export interface RetrieveInput {
  peer: DicomPeer;
  studyUid: string;
  method: "cget" | "cmove";
}

/** Start pulling a study from a remote PACS into this viewer's inbox. */
export async function startRetrieveJob(input: RetrieveInput): Promise<string> {
  const { peer, studyUid, method } = input;
  const cfg = await getListenerConfig();
  if (method === "cmove" && !state.running)
    throw new Error(
      "C-MOVE needs this viewer's listener running (Settings → PACS → DICOM listener) so the remote can push to it."
    );
  const label = `${method.toUpperCase()} ${peer.aeTitle}`;
  const job = newJob("retrieve", label);
  job.progress = 5;

  void (async () => {
    const m = await getDimse();
    const client: Client = new m.Client();
    const wd = watchdog(15 * 60_000, () => {
      try {
        client.abort();
      } catch {
        /* ignore */
      }
      finishJob(job, false, "Retrieve timed out after 15 minutes", 4);
      activeMoveJobs.delete(studyUid);
    });
    const onIngest = (n: number) => {
      job.instancesDone += n;
      if (job.instancesTotal > 0)
        job.progress = Math.min(99, Math.round((job.instancesDone / job.instancesTotal) * 100));
    };

    if (method === "cmove") {
      activeMoveJobs.set(studyUid, job.id);
      ingestWatchers.set(job.id, [onIngest]);
    }

    try {
      const req =
        method === "cget"
          ? m.requests.CGetRequest.createStudyGetRequest(studyUid)
          : m.requests.CMoveRequest.createStudyMoveRequest(studyUid, cfg.aeTitle);
      if (method === "cget") {
        // Propose all known storage classes so the remote can push every
        // SOP type it holds (CT, MR, SC, enhanced families, …).
        (req as unknown as { setAddStorageSopClassesToAssociation(v: boolean): void })
          .setAddStorageSopClassesToAssociation(true);
        // C-GET sub-operations arrive on this association:
        client.on(
          "cStoreRequest",
          async (storeReq: { getDataset(): Dataset }, callback: (r: unknown) => void) => {
            const resp = m.responses.CStoreResponse.fromRequest(storeReq as never);
            try {
              await ingestDataset(storeReq.getDataset(), peer.aeTitle);
              resp.setStatus(m.constants.Status.Success);
              job.instancesDone += 1;
              if (job.instancesTotal > 0)
                job.progress = Math.min(99, Math.round((job.instancesDone / job.instancesTotal) * 100));
            } catch (e) {
              resp.setStatus(m.constants.Status.ProcessingFailure);
              job.errorDescription = e instanceof Error ? e.message : String(e);
            }
            callback(resp);
          }
        );
      }
      req.on("response", (res: { getStatus(): number; getCompleted?(): number; getRemaining?(): number; getWarnings?(): number }) => {
        if (res.getStatus() === m.constants.Status.Pending) {
          const done = res.getCompleted?.() ?? job.instancesDone;
          const remaining = res.getRemaining?.() ?? 0;
          job.instancesDone = method === "cget" ? Math.max(job.instancesDone, done) : job.instancesDone;
          const total = done + remaining;
          if (total > job.instancesTotal) job.instancesTotal = total;
          if (total > 0) job.progress = Math.max(5, Math.min(99, Math.round((done / total) * 100)));
        } else if (res.getStatus() === m.constants.Status.Success) {
          activeMoveJobs.delete(studyUid);
          wd.clear();
          finishJob(job, true);
        } else if (res.getStatus() !== m.constants.Status.Pending) {
          activeMoveJobs.delete(studyUid);
          wd.clear();
          finishJob(job, false, `Remote refused the ${method.toUpperCase()} (status ${res.getStatus()})`, res.getStatus());
        }
      });
      client.on("networkError", (e: Error) => {
        activeMoveJobs.delete(studyUid);
        wd.clear();
        finishJob(job, false, e.message, 3);
      });
      const ae = await ourAe();
      client.addRequest(req);
      client.send(peer.host, peer.port, ae, peer.aeTitle, {
        connectTimeout: 10000,
        associationTimeout: 300000,
      });
    } catch (e) {
      activeMoveJobs.delete(studyUid);
      wd.clear();
      finishJob(job, false, e instanceof Error ? e.message : String(e), 2);
    }
  })();

  return job.id;
}

/* -------------------------------- send job ------------------------------- */

async function gatewayStudyFiles(studyUid: string, seriesUid?: string | null): Promise<string[]> {
  const gw = await getGatewayConfig();
  if (!gw) throw new Error("No gateway configured and the study is not in the local inbox.");
  const level = seriesUid ? "Series" : "Study";
  const uid = seriesUid || studyUid;
  const ids = (await fetch(`${gw.base}/tools/find`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: basicAuth(gw) },
    body: JSON.stringify({ Level: level, Expand: false, Query: level === "Study" ? { StudyInstanceUID: uid } : { SeriesInstanceUID: uid } }),
  }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`gateway find ${r.status}`))))) as string[];
  if (!Array.isArray(ids) || ids.length === 0)
    throw new Error("Study is neither in the local inbox nor on the gateway cache.");

  const tmpDir = path.join(os.tmpdir(), "dvv-send", randomUUID());
  await fs.mkdir(tmpDir, { recursive: true });
  const files: string[] = [];
  const resourceId = String(ids[0]);
  const basePath =
    level === "Study"
      ? `${gw.base}/studies/${resourceId}/instances`
      : `${gw.base}/series/${resourceId}/instances`;
  const list = (await fetch(basePath, {
    headers: { Authorization: basicAuth(gw) },
  }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`gateway instances ${r.status}`))))) as Array<{ ID: string }>;
  for (const inst of list) {
    const res = await fetch(`${gw.base}/instances/${inst.ID}/file`, {
      headers: { Authorization: basicAuth(gw) },
    });
    if (!res.ok) throw new Error(`gateway file ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const file = path.join(tmpDir, `${inst.ID}.dcm`);
    await fs.writeFile(file, buf);
    files.push(file);
  }
  return files;
}

export interface SendInput {
  peer: DicomPeer;
  studyUid: string;
  seriesUid?: string | null;
}

/** Push a held study (local inbox first, then gateway cache) to a DICOM node. */
export async function startSendJob(input: SendInput): Promise<string> {
  const { peer, studyUid, seriesUid } = input;
  const where = seriesUid ? { studyUid, seriesUid } : { studyUid };
  const local = await db.receivedInstance.findMany({ where, select: { filePath: true } });
  const label = `C-STORE → ${peer.aeTitle}`;
  const job = newJob("send", label);

  void (async () => {
    const m = await getDimse();
    const client: Client = new m.Client();
    const tmpPrefix = path.join(os.tmpdir(), "dvv-send");
    let files: string[] = [];
    let tmpOwned = false;
    const wd = watchdog(30 * 60_000, () => {
      try {
        client.abort();
      } catch {
        /* ignore */
      }
      finishJob(job, false, "Send timed out after 30 minutes", 4);
    });

    try {
      if (local.length > 0) {
        files = local.map((r) => r.filePath);
      } else {
        files = await gatewayStudyFiles(studyUid, seriesUid);
        tmpOwned = true;
      }
      job.instancesTotal = files.length;
      if (files.length === 0) throw new Error("No instances found for this study/series.");
      job.progress = 5;

      let failed = 0;
      for (const file of files) {
        const req = new m.requests.CStoreRequest(file);
        req.on("response", (res: { getStatus(): number }) => {
          job.instancesDone += 1;
          if (res.getStatus() !== m.constants.Status.Success) failed += 1;
          job.progress = Math.max(5, Math.min(99, Math.round((job.instancesDone / job.instancesTotal) * 100)));
        });
        client.addRequest(req);
      }
      const ae = await ourAe();
      client.on("networkError", (e: Error) => {
        wd.clear();
        finishJob(job, false, e.message, 3);
      });
      client.send(peer.host, peer.port, ae, peer.aeTitle, {
        connectTimeout: 10000,
        associationTimeout: 600000,
      });

      // Wait until every request has a response (or the watchdog fires).
      await new Promise<void>((resolve) => {
        const iv = setInterval(() => {
          if (job.instancesDone >= job.instancesTotal || job.state === "Failure") {
            clearInterval(iv);
            resolve();
          }
        }, 400);
        setTimeout(() => {
          clearInterval(iv);
          resolve();
        }, 29 * 60_000);
      });
      wd.clear();
      if (job.state === "Failure") return;
      if (failed === 0) finishJob(job, true);
      else if (failed < files.length)
        finishJob(job, true, `${failed} of ${files.length} instances were refused by the remote.`);
      else finishJob(job, false, `All ${files.length} instances were refused by the remote.`, 1);
    } catch (e) {
      wd.clear();
      finishJob(job, false, e instanceof Error ? e.message : String(e), 2);
    } finally {
      if (tmpOwned) await fs.rm(tmpPrefix, { recursive: true, force: true }).catch(() => {});
    }
  })();

  return job.id;
}
