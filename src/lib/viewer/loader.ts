"use client";

/**
 * Local DICOM ingestion: File -> parsed metadata -> grouped series -> imageIds.
 * Parsing uses dicomParser; pixel loading uses the wadouri loader registered
 * by @cornerstonejs/dicom-image-loader (fileManager maps imageId -> File).
 */
import dicomParser from "dicom-parser";
import { wadouri } from "@cornerstonejs/dicom-image-loader";

export interface SeriesInfo {
  seriesUid: string;
  seriesNumber: number;
  description: string;
  modality: string;
  imageIds: string[];
  instanceCount: number;
  thumbImageId: string | null;
  defaultWindowWidth: number | null;
  defaultWindowCenter: number | null;
}

export interface StudyInfo {
  studyUid: string;
  patientName: string;
  patientId: string;
  studyDate: string;
  studyDescription: string;
  accessionNumber: string;
  series: SeriesInfo[];
  createdAt: number;
}

export interface ParsedFile {
  file: File;
  imageId: string;
  studyUid: string;
  seriesUid: string;
  seriesNumber: number;
  seriesDescription: string;
  modality: string;
  instanceNumber: number;
  sopUid: string;
  patientName: string;
  patientId: string;
  studyDate: string;
  studyDescription: string;
  accessionNumber: string;
  windowCenter: number | null;
  windowWidth: number | null;
}

function getString(ds: dicomParser.DataSet, tag: string): string {
  try {
    const v = ds.string(tag);
    return v ? String(v).replace(/\0+$/, "").trim() : "";
  } catch {
    return "";
  }
}

function getFloat(ds: dicomParser.DataSet, tag: string): number | null {
  try {
    const v = ds.floatString(tag) ?? NaN;
    return Number.isFinite(v) ? v : null;
  } catch {
    try {
      const i = ds.intString(tag) ?? NaN;
      return Number.isFinite(i) ? i : null;
    } catch {
      return null;
    }
  }
}

export function parseDicomBuffer(buffer: ArrayBuffer, file: File): ParsedFile {
  const ds = dicomParser.parseDicom(new Uint8Array(buffer));
  const imageId = wadouri.fileManager.add(file);

  return {
    file,
    imageId,
    studyUid: getString(ds, "x0020000d") || "no-study-uid",
    seriesUid: getString(ds, "x0020000e") || "no-series-uid",
    seriesNumber: Math.trunc(getFloat(ds, "x00200011") ?? 1),
    seriesDescription: getString(ds, "x0008103e") || "Series",
    modality: getString(ds, "x00080060") || "OT",
    instanceNumber: Math.trunc(getFloat(ds, "x00200013") ?? 0),
    sopUid: getString(ds, "x00080018"),
    patientName: formatPersonName(getString(ds, "x00100010")) || "Unknown",
    patientId: getString(ds, "x00100020") || "-",
    studyDate: formatDicomDate(getString(ds, "x00080020")),
    studyDescription: getString(ds, "x00081030") || "Study",
    accessionNumber: getString(ds, "x00080050") || "-",
    windowCenter: getFloat(ds, "x00281050"),
    windowWidth: getFloat(ds, "x00281051"),
  };
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

/** Group parsed files into studies -> series, sorted by instance number. */
export function groupIntoStudies(parsed: ParsedFile[]): StudyInfo[] {
  const studies = new Map<string, StudyInfo>();
  const seriesMap = new Map<string, SeriesInfo>();
  const instanceOrder = new Map<string, string>();

  for (const p of parsed) {
    let study = studies.get(p.studyUid);
    if (!study) {
      study = {
        studyUid: p.studyUid,
        patientName: p.patientName,
        patientId: p.patientId,
        studyDate: p.studyDate,
        studyDescription: p.studyDescription,
        accessionNumber: p.accessionNumber,
        series: [],
        createdAt: Date.now(),
      };
      studies.set(p.studyUid, study);
    }

    const seriesKey = `${p.studyUid}|${p.seriesUid}`;
    let series = seriesMap.get(seriesKey);
    if (!series) {
      series = {
        seriesUid: p.seriesUid,
        seriesNumber: p.seriesNumber,
        description: p.seriesDescription,
        modality: p.modality,
        imageIds: [],
        instanceCount: 0,
        thumbImageId: null,
        defaultWindowWidth: p.windowWidth,
        defaultWindowCenter: p.windowCenter,
      };
      seriesMap.set(seriesKey, series);
      study.series.push(series);
    }
    series.imageIds.push(p.imageId);
    series.instanceCount += 1;
    if (!series.thumbImageId) series.thumbImageId = p.imageId;
    instanceOrder.set(p.imageId, String(p.instanceNumber).padStart(10, "0"));
  }

  for (const study of studies.values()) {
    for (const s of study.series) {
      s.imageIds.sort((a, b) =>
        (instanceOrder.get(a) ?? "").localeCompare(instanceOrder.get(b) ?? "")
      );
    }
    study.series.sort((a, b) => a.seriesNumber - b.seriesNumber);
  }

  return [...studies.values()].sort((a, b) => b.createdAt - a.createdAt);
}
