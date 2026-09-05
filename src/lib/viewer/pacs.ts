"use client";

/**
 * Minimal DICOMweb client. All requests go through /api/pacs (a Next.js API
 * route that proxies to Orthanc), so no CORS and no credentials in the client.
 *
 * QIDO-RS for search, WADO-URI for instance retrieval (Orthanc supports both
 * natively); every retrieved instance becomes a local File that flows through
 * the same loader pipeline as drag-and-dropped files.
 */

export interface PacsStudy {
  studyUid: string;
  patientName: string;
  patientId: string;
  studyDate: string;
  studyDescription: string;
  accessionNumber: string;
  modalities: string;
  seriesCount: string;
}

export interface PacsSeries {
  seriesUid: string;
  seriesNumber: number;
  description: string;
  modality: string;
  instanceCount: number;
}

function tag(ds: Record<string, unknown>, key: string): {
  Value?: Array<string | number>;
} {
  return (ds[key] ?? {}) as { Value?: Array<string | number> };
}

function first(ds: Record<string, unknown>, key: string): string {
  const v = tag(ds, key).Value;
  return v && v.length > 0 ? String(v[0]) : "";
}

export function isPacsConfigured(): Promise<boolean> {
  return fetch("/api/pacs/health")
    .then((r) => r.ok)
    .catch(() => false);
}

export async function queryStudies(params: {
  patientName?: string;
  patientId?: string;
  dateFrom?: string;
  dateTo?: string;
  modality?: string;
  limit?: number;
}): Promise<PacsStudy[]> {
  const q = new URLSearchParams();
  if (params.patientName) q.set("PatientName", `*${params.patientName}*`);
  if (params.patientId) q.set("PatientID", `*${params.patientId}*`);
  if (params.dateFrom) q.set("StudyDate", `${params.dateFrom}-${params.dateTo || params.dateFrom}`);
  if (params.modality) q.set("ModalitiesInStudy", params.modality);
  q.set("includefield", "00081030,00080050,00080061,00201206");
  q.set("limit", String(params.limit ?? 50));

  const res = await fetch(`/api/pacs/studies?${q.toString()}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `QIDO-RS failed (${res.status})`);
  }
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.map((ds) => ({
    studyUid: first(ds, "0020000D"),
    patientName: formatPersonName(first(ds, "00100010")) || "Unknown",
    patientId: first(ds, "00100020") || "-",
    studyDate: formatDicomDate(first(ds, "00080020")),
    studyDescription: first(ds, "00081030") || "Study",
    accessionNumber: first(ds, "00080050") || "-",
    modalities: first(ds, "00080061"),
    seriesCount: first(ds, "00201206") || "?",
  }));
}

export async function querySeries(studyUid: string): Promise<PacsSeries[]> {
  const res = await fetch(
    `/api/pacs/studies/${encodeURIComponent(studyUid)}/series?includefield=0008103E,00080060,00200011,00201209`
  );
  if (!res.ok) throw new Error(`QIDO-RS series failed (${res.status})`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows
    .map((ds) => ({
      seriesUid: first(ds, "0020000E"),
      seriesNumber: parseInt(first(ds, "00200011") || "1", 10) || 1,
      description: first(ds, "0008103E") || "Series",
      modality: first(ds, "00080060") || "OT",
      instanceCount: parseInt(first(ds, "00201209") || "0", 10) || 0,
    }))
    .sort((a, b) => a.seriesNumber - b.seriesNumber);
}

/** Retrieve one instance as a File via WADO-URI (through the proxy). */
export async function fetchInstanceFile(
  studyUid: string,
  seriesUid: string,
  sopUid: string
): Promise<File> {
  const q = new URLSearchParams({
    requestType: "WADO",
    studyUID: studyUid,
    seriesUID: seriesUid,
    objectUID: sopUid,
    contentType: "application/dicom",
  });
  const res = await fetch(`/api/pacs/wado?${q.toString()}`);
  if (!res.ok) throw new Error(`WADO-URI failed (${res.status})`);
  const blob = await res.blob();
  return new File([blob], `${sopUid}.dcm`, { type: "application/dicom" });
}

export async function fetchStudyAsFiles(
  studyUid: string,
  onProgress?: (done: number, total: number, label: string) => void
): Promise<File[]> {
  const series = await querySeries(studyUid);
  const files: File[] = [];
  let total = 0;
  for (const s of series) total += Math.max(s.instanceCount, 1);

  let done = 0;
  for (const s of series) {
    const q = new URLSearchParams({
      includefield: "00080018,00200013",
      limit: "2000",
    });
    const res = await fetch(
      `/api/pacs/studies/${encodeURIComponent(studyUid)}/series/${encodeURIComponent(
        s.seriesUid
      )}/instances?${q.toString()}`
    );
    if (!res.ok) throw new Error(`QIDO-RS instances failed (${res.status})`);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    for (const ds of rows) {
      const sopUid = first(ds, "00080018");
      if (!sopUid) continue;
      const f = await fetchInstanceFile(studyUid, s.seriesUid, sopUid);
      files.push(f);
      done += 1;
      onProgress?.(done, total, `${s.modality} ${s.description}`);
    }
  }
  return files;
}

function formatPersonName(raw: string): string {
  if (!raw) return "";
  const parts = raw.split("^").filter(Boolean);
  if (parts.length === 0) return raw;
  if (parts.length === 1) return parts[0];
  return `${parts[1]} ${parts[0]}`;
}

function formatDicomDate(raw: string): string {
  if (!/^\d{8}$/.test(raw)) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}
