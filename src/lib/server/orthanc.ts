import { getGatewayConfig, basicAuth, type GatewayConfig } from "./config";

/**
 * Minimal Orthanc REST client (server-side only).
 *
 * Used for everything beyond the DICOMweb proxy:
 *  - dynamic registration of user-added PACS servers as DICOM modalities
 *  - C-ECHO connection tests
 *  - C-FIND study queries against remote PACS (via the gateway's SCU)
 *  - C-GET / C-MOVE retrieves (run as Orthanc jobs, polled from the browser)
 */

export class OrthancError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;

async function ocFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<unknown> {
  const cfg = await requireConfig();
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${cfg.base}${path}`, {
      ...rest,
      headers: {
        Authorization: basicAuth(cfg),
        "Content-Type": "application/json",
        ...(rest.headers as Record<string, string> | undefined),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new OrthancError(`Cannot reach the DICOM gateway (${cfg.base}): ${msg}`, 504);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { Message?: string; Details?: string };
      detail = body.Message || body.Details || "";
    } catch {
      /* non-JSON error body */
    }
    throw new OrthancError(
      `Gateway error ${res.status}${detail ? `: ${detail}` : ""}`,
      res.status === 401 || res.status === 403 ? 502 : 502
    );
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requireConfig(): Promise<GatewayConfig> {
  const cfg = await getGatewayConfig();
  if (!cfg) {
    throw new OrthancError(
      "DICOM gateway is not configured. Open Settings and set the Orthanc gateway URL.",
      400
    );
  }
  return cfg;
}

/* ------------------------------------------------------------------ */
/* System / gateway info                                               */
/* ------------------------------------------------------------------ */

export interface GatewaySystem {
  Name?: string;
  Version?: string;
  DicomAet?: string;
  DicomPort?: number;
  HttpPort?: number;
}

export async function systemInfo(): Promise<GatewaySystem> {
  return (await ocFetch("/system")) as GatewaySystem;
}

export async function trySystemInfo(
  timeoutMs = 8000
): Promise<{ ok: true; info: GatewaySystem } | { ok: false; error: string }> {
  try {
    return { ok: true, info: await systemInfo() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------ */
/* DICOM modalities (remote PACS servers)                              */
/* ------------------------------------------------------------------ */

export interface ModalityConfig {
  AET: string;
  Host: string;
  Port: number;
}

export async function listModalities(): Promise<Record<string, ModalityConfig>> {
  const ids = (await ocFetch("/modalities")) as string[];
  const out: Record<string, ModalityConfig> = {};
  for (const id of ids) {
    try {
      out[id] = (await ocFetch(`/modalities/${encodeURIComponent(id)}`)) as ModalityConfig;
    } catch {
      /* skip unreadable entries */
    }
  }
  return out;
}

export async function upsertModality(aeTitle: string, host: string, port: number): Promise<void> {
  await ocFetch(`/modalities/${encodeURIComponent(aeTitle)}`, {
    method: "PUT",
    body: JSON.stringify({
      AET: aeTitle,
      Host: host,
      Port: port,
      Manufacturer: "Generic",
      AllowEcho: true,
      AllowFind: true,
      AllowGet: true,
      AllowMove: true,
      AllowStorage: true,
      AllowTranscoding: true,
    }),
  });
}

export async function removeModality(aeTitle: string): Promise<void> {
  // 404 = already gone, that is fine.
  try {
    await ocFetch(`/modalities/${encodeURIComponent(aeTitle)}`, { method: "DELETE" });
  } catch (e) {
    if (!(e instanceof OrthancError) || !e.message.includes("404")) throw e;
  }
}

export async function echoModality(aeTitle: string): Promise<number> {
  const t0 = Date.now();
  await ocFetch(`/modalities/${encodeURIComponent(aeTitle)}/echo`, {
    method: "POST",
    body: JSON.stringify({}),
    timeoutMs: 30_000,
  });
  return Date.now() - t0;
}

/* ------------------------------------------------------------------ */
/* Remote study query (C-FIND)                                         */
/* ------------------------------------------------------------------ */

/** Orthanc dataset value shape: scalar (string/number) or DICOMweb-style array. */
type Dataset = Record<string, { Value?: unknown } | undefined> & Record<string, unknown>;

function value(ds: Dataset, hex: string): string {
  const v = (ds[hex] as { Value?: unknown } | undefined)?.Value;
  if (v == null) return "";
  if (Array.isArray(v)) return v.length ? String(v[0]) : "";
  return String(v);
}

function personName(raw: string): string {
  if (!raw) return "";
  const parts = raw.split("^").filter(Boolean);
  if (parts.length <= 1) return parts[0] || raw;
  return `${parts[1]} ${parts[0]}`;
}

function dicomDate(raw: string): string {
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
}

export interface RemoteStudy {
  studyUid: string;
  patientName: string;
  patientId: string;
  studyDate: string;
  studyDescription: string;
  accessionNumber: string;
  modalities: string;
  seriesCount: string;
}

export interface RemoteQuery {
  patientName?: string;
  patientId?: string;
  dateFrom?: string;
  dateTo?: string;
  modality?: string;
  accession?: string;
  limit?: number;
}

export async function findStudiesRemote(aeTitle: string, q: RemoteQuery): Promise<RemoteStudy[]> {
  const Query: Record<string, string> = {
    PatientName: q.patientName ? wrapWildcard(q.patientName) : "*",
    PatientID: q.patientId ? wrapWildcard(q.patientId) : "*",
    AccessionNumber: q.accession ? wrapWildcard(q.accession) : "*",
    StudyDate:
      q.dateFrom || q.dateTo
        ? `${(q.dateFrom || "").replace(/-/g, "")}-${(q.dateTo || q.dateFrom || "").replace(/-/g, "")}`
        : "*",
    StudyInstanceUID: "*",
    StudyDescription: q.patientName ? "" : "*", // keep minimal; description wildcards not universal
  };
  // Only include ModalitiesInStudy when the user filters — not all PACS
  // support universal matching on this key.
  if (q.modality) Query.ModalitiesInStudy = q.modality.toUpperCase();

  const rows = (await ocFetch(`/modalities/${encodeURIComponent(aeTitle)}/find`, {
    method: "POST",
    body: JSON.stringify({ Level: "Study", Query, Normalize: true, Short: false }),
    timeoutMs: 90_000,
  })) as unknown;

  if (!Array.isArray(rows)) return [];
  const studies = (rows as Dataset[])
    .map((ds) => ({
      studyUid: value(ds, "0020000D"),
      patientName: personName(value(ds, "00100010")) || "Unknown",
      patientId: value(ds, "00100020") || "-",
      studyDate: dicomDate(value(ds, "00080020")),
      studyDescription: value(ds, "00081030") || value(ds, "0008103E") || "Study",
      accessionNumber: value(ds, "00080050") || "-",
      modalities: value(ds, "00080061") || value(ds, "00080060"),
      seriesCount: value(ds, "00201206") || "?",
    }))
    .filter((s) => s.studyUid);
  const limit = q.limit ?? 50;
  return studies.slice(0, limit);
}

function wrapWildcard(v: string): string {
  return v.includes("*") ? v : `*${v}*`;
}

/* ------------------------------------------------------------------ */
/* Retrieve (C-GET / C-MOVE) as Orthanc jobs                           */
/* ------------------------------------------------------------------ */

export type RetrieveMethod = "cget" | "cmove";

export async function startRetrieve(
  aeTitle: string,
  studyUid: string,
  method: RetrieveMethod,
  targetAet?: string
): Promise<string> {
  const body: Record<string, unknown> = {
    Level: "Study",
    Resource: studyUid,
    Priority: 1,
    Asynchronous: true, // returns a job id we can poll
  };
  if (method === "cmove") {
    const cfg = await getGatewayConfig();
    const target = (targetAet || cfg?.gatewayAet || "").trim();
    if (!target) {
      throw new OrthancError(
        "C-MOVE needs the gateway AE Title. Set it in Settings → Gateway.",
        400
      );
    }
    body.TargetAet = target;
  }
  const endpoint = method === "cget" ? "get" : "move";
  const res = (await ocFetch(`/modalities/${encodeURIComponent(aeTitle)}/${endpoint}`, {
    method: "POST",
    body: JSON.stringify(body),
    timeoutMs: 60_000,
  })) as { ID?: string } | null;
  if (!res?.ID) throw new OrthancError("Gateway did not return a retrieve job id.", 502);
  return res.ID;
}

export interface JobStatus {
  state: "Running" | "Success" | "Failure" | "Paused" | string;
  progress: number; // 0..100
  errorCode: number;
  errorDescription: string;
}

export async function jobStatus(jobId: string): Promise<JobStatus> {
  const j = (await ocFetch(`/jobs/${encodeURIComponent(jobId)}`, { timeoutMs: 20_000 })) as {
    State?: string;
    Progress?: number;
    ErrorCode?: number;
    ErrorDescription?: string;
  };
  const p = typeof j.Progress === "number" ? j.Progress : 0;
  return {
    state: j.State ?? "Unknown",
    progress: j.State === "Success" ? 100 : Math.round(p * 100),
    errorCode: j.ErrorCode ?? 0,
    errorDescription: j.ErrorDescription ?? "",
  };
}

/** Confirm the study is now stored inside the gateway (Orthanc). */
export async function studyInGateway(studyUid: string): Promise<boolean> {
  const ids = (await ocFetch("/tools/find", {
    method: "POST",
    body: JSON.stringify({ Level: "Study", Query: { StudyInstanceUID: studyUid } }),
  })) as unknown;
  return Array.isArray(ids) && ids.length > 0;
}

/* ------------------------------------------------------------------ */
/* DICOM Send (C-STORE SCU) - Phase 3                                  */
/* ------------------------------------------------------------------ */

/**
 * Look up the Orthanc resource id for a study/series that lives on the
 * gateway, then ask the gateway to C-STORE push it to a configured
 * destination modality. Returns the number of instances sent.
 */
export async function sendToModality(opts: {
  targetAe: string;
  studyUid: string;
  seriesUid?: string | null;
}): Promise<{ instancesSent: number; level: "study" | "series" }> {
  const { targetAe, studyUid, seriesUid } = opts;
  const level: "Study" | "Series" = seriesUid ? "Series" : "Study";
  const uid = seriesUid || studyUid;

  const ids = (await ocFetch("/tools/find", {
    method: "POST",
    body: JSON.stringify({
      Level: level,
      Expand: false,
      Query:
        level === "Study"
          ? { StudyInstanceUID: uid }
          : { SeriesInstanceUID: uid },
    }),
  })) as unknown;

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new OrthancError(
      "This study is not stored on the gateway - open it via PACS first (that caches it on the gateway), then send.",
      404
    );
  }
  const resourceId = String(ids[0]);

  const result = (await ocFetch(
    `/modalities/${encodeURIComponent(targetAe)}/store`,
    {
      method: "POST",
      body: JSON.stringify(resourceId),
    }
  )) as { InstancesSent?: number };

  return {
    instancesSent: Number(result?.InstancesSent ?? 0),
    level: level === "Series" ? ("series" as const) : ("study" as const),
  };
}
