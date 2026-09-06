"use client";

/**
 * PACS search dialog.
 *
 * Two search modes:
 *  - "Gateway cache" — QIDO-RS against the local Orthanc (studies already
 *    pulled there), instant, then WADO-URI retrieval into the viewer.
 *  - Any user-added PACS (Settings → PACS servers) — real C-FIND performed
 *    by the gateway's SCU, then C-GET/C-MOVE pull into the gateway, then
 *    WADO-URI into the viewer, with live job progress.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchReceivedStudyAsFiles,
  fetchStudyAsFiles,
  findOnRemote,
  listReceived,
  listServers,
  pollRetrieveJob,
  queryStudies,
  startRetrieve,
  type PacsServerInfo,
  type PacsStudy,
  type ReceivedStudyInfo,
  type RetrieveJobStatus,
} from "@/lib/viewer/pacs";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onFiles: (files: File[]) => void;
  onProgress: (p: { done: number; total: number; label: string }) => void;
  onOpenSettings: () => void;
}

const CACHE = "__cache__";
const RECEIVED = "__received__";
const POLL_MS = 1200;
const POLL_MAX_MS = 10 * 60 * 1000; // give huge studies up to 10 minutes

export default function PacsDialog({
  open,
  onOpenChange,
  onFiles,
  onProgress,
  onOpenSettings,
}: Props) {
  const [servers, setServers] = useState<PacsServerInfo[]>([]);
  const [source, setSource] = useState<string>(CACHE);

  const [patientName, setPatientName] = useState("");
  const [patientId, setPatientId] = useState("");
  const [modality, setModality] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [accession, setAccession] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PacsStudy[] | null>(null);
  const [received, setReceived] = useState<ReceivedStudyInfo[]>([]);
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullPct, setPullPct] = useState(0);
  const [pullLabel, setPullLabel] = useState("");
  const cancelled = useRef(false);

  useEffect(() => {
    if (!open) return;
    cancelled.current = false;
    setError(null);
    listServers()
      .then(setServers)
      .catch(() => setServers([]));
    listReceived()
      .then(setReceived)
      .catch(() => setReceived([]));
  }, [open]);

  useEffect(() => () => void (cancelled.current = true), []);

  const runQuery = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const filters = {
        patientName: patientName || undefined,
        patientId: patientId || undefined,
        modality: modality || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        accession: accession || undefined,
      };
      let rows: PacsStudy[];
      if (source === RECEIVED) {
        const t = (v?: string) => (v ?? "").toLowerCase();
        rows = received
          .filter(
            (r) =>
              (!t(patientName) || r.patientName.toLowerCase().includes(t(patientName))) &&
              (!t(patientId) || r.patientId.toLowerCase().includes(t(patientId))) &&
              (!t(modality) || r.modalities.toUpperCase().includes(t(modality).toUpperCase()))
          )
          .map((r) => ({
            studyUid: r.studyUid,
            patientName: r.patientName,
            patientId: r.patientId,
            studyDate: r.studyDate
              ? `${r.studyDate.slice(0, 4)}-${r.studyDate.slice(4, 6)}-${r.studyDate.slice(6, 8)}`
              : "-",
            studyDescription: `${r.studyDescription} · from ${r.sourceAet || "DICOM"}`,
            accessionNumber: "-",
            modalities: r.modalities,
            seriesCount: String(r.seriesCount),
          }));
      } else if (source === CACHE) {
        rows = await queryStudies({ ...filters, limit: 40 });
      } else {
        rows = await findOnRemote(source, filters);
      }
      setResults(rows);
      if (rows.length === 0)
        setError(
          source === CACHE
            ? "No matching studies in the gateway cache. Try pulling from a PACS first."
            : "No matching studies found on this PACS."
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query failed");
    } finally {
      setBusy(false);
    }
  }, [patientName, patientId, modality, dateFrom, dateTo, accession, source]);

  /** Poll the Orthanc retrieve job until it finishes (or the dialog closes). */
  const waitJob = useCallback(
    async (jobId: string, label: string): Promise<RetrieveJobStatus> => {
      const t0 = Date.now();
      for (;;) {
        if (cancelled.current) throw new Error("Cancelled");
        await new Promise((r) => setTimeout(r, POLL_MS));
        const st = await pollRetrieveJob(jobId);
        setPullPct(Math.max(4, st.progress));
        onProgress({
          done: Math.max(1, Math.round(st.progress)),
          total: 100,
          label: `Retrieving ${label} (${st.progress}%)`,
        });
        if (st.state === "Success") return st;
        if (st.state === "Failure" || st.state === "Paused") {
          throw new Error(
            st.errorDescription ||
              `Retrieve job ${st.state.toLowerCase()} on the gateway (code ${st.errorCode}).`
          );
        }
        if (Date.now() - t0 > POLL_MAX_MS) throw new Error("Retrieve timed out.");
      }
    },
    [onProgress]
  );

  const pull = useCallback(
    async (study: PacsStudy) => {
      setBusy(true);
      setPulling(study.studyUid);
      setError(null);
      setPullPct(4);
      try {
        if (source === RECEIVED) {
          setPullLabel(`${study.patientName} · ${study.studyDescription}`);
          const files = await fetchReceivedStudyAsFiles(study.studyUid, (done, total, label) =>
            onProgress({ done, total, label })
          );
          onFiles(files);
          onOpenChange(false);
          return;
        }
        if (source !== CACHE) {
          setPullLabel(`${study.patientName} · ${study.studyDescription}`);
          onProgress({
            done: 1,
            total: 100,
            label: `Pulling from PACS: ${study.patientName}…`,
          });
          const jobId = await startRetrieve(source, study.studyUid, "cget");
          await waitJob(jobId, study.patientName);
          // The direct retrieve lands in this viewer's inbox — open from
          // there first; fall back to the gateway cache for legacy flows.
          try {
            const files = await fetchReceivedStudyAsFiles(study.studyUid, (done, total, label) =>
              onProgress({ done, total, label })
            );
            if (files.length > 0) {
              onFiles(files);
              onOpenChange(false);
              return;
            }
          } catch {
            /* fall through to gateway WADO */
          }
        }
        // Study is (now) in the gateway — stream it into the viewer via WADO.
        const files = await fetchStudyAsFiles(study.studyUid, (done, total, label) =>
          onProgress({ done, total, label })
        );
        onFiles(files);
        onOpenChange(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Retrieve failed";
        setError(
          msg.includes("C-GET") || /get/i.test(msg)
            ? `${msg} — Tip: some PACS only support C-MOVE. Register this viewer's AE Title and DICOM port on the PACS, then retry.`
            : msg
        );
      } finally {
        setBusy(false);
        setPulling(null);
        setPullPct(0);
        setPullLabel("");
        onProgress({ done: 0, total: 0, label: "" });
      }
    },
    [source, waitJob, onFiles, onOpenChange, onProgress]
  );

  const isRemote = source !== CACHE && source !== RECEIVED;
  const isInbox = source === RECEIVED;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-hidden border-zinc-800 bg-zinc-950 text-zinc-200 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-teal-300">Query PACS</DialogTitle>
          <DialogDescription className="text-zinc-500">
            Search this viewer's inbox, the gateway cache or any configured
            PACS. Retrieved studies open directly in the viewer.
          </DialogDescription>
        </DialogHeader>

        {/* source selector */}
        <div className="flex items-center gap-2">
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="h-9 flex-1 border-zinc-800 bg-zinc-900 text-sm text-zinc-200">
              <SelectValue placeholder="Choose source" />
            </SelectTrigger>
            <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-200">
              <SelectItem value={RECEIVED}>Inbox — received by this viewer (DICOM)</SelectItem>
              <SelectItem value={CACHE}>Gateway cache (already pulled)</SelectItem>
              {servers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} · {s.aeTitle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={onOpenSettings}
            className="h-9 shrink-0 border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Manage
          </Button>
        </div>

        {/* query fields */}
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="Patient name"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            className="h-9 border-zinc-800 bg-zinc-900 text-sm"
            onKeyDown={(e) => e.key === "Enter" && runQuery()}
          />
          <Input
            placeholder="Patient ID"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            className="h-9 border-zinc-800 bg-zinc-900 text-sm"
            onKeyDown={(e) => e.key === "Enter" && runQuery()}
          />
          {isRemote && (
            <>
              <Input
                placeholder="Modality (CT, MR…)"
                value={modality}
                onChange={(e) => setModality(e.target.value.toUpperCase())}
                className="h-9 border-zinc-800 bg-zinc-900 text-sm"
                onKeyDown={(e) => e.key === "Enter" && runQuery()}
              />
              <div className="flex items-center gap-1.5">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  title="Date from"
                  className="h-9 border-zinc-800 bg-zinc-900 text-xs text-zinc-300"
                />
                <span className="text-xs text-zinc-600">→</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  title="Date to"
                  className="h-9 border-zinc-800 bg-zinc-900 text-xs text-zinc-300"
                />
              </div>
            </>
          )}
          {(isRemote || isInbox) && (
            <Input
              placeholder="Accession number"
              value={accession}
              onChange={(e) => setAccession(e.target.value)}
              className="col-span-2 h-9 border-zinc-800 bg-zinc-900 text-sm sm:col-span-1"
              onKeyDown={(e) => e.key === "Enter" && runQuery()}
            />
          )}
          <Button
            onClick={runQuery}
            disabled={busy}
            className="col-span-2 h-9 bg-teal-600 text-sm text-white hover:bg-teal-500 sm:col-span-1"
          >
            {busy && !pulling ? "Searching…" : "Search"}
          </Button>
        </div>

        {/* retrieve progress */}
        {pulling && (
          <div className="rounded border border-teal-800/60 bg-teal-950/30 px-3 py-2">
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-teal-200">{pullLabel || "Retrieving…"}</span>
              <span className="text-teal-300">{pullPct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
              <div
                className="h-full bg-teal-500 transition-all"
                style={{ width: `${pullPct}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs leading-4 text-amber-300">
            {error}
          </div>
        )}

        {results && results.length > 0 && (
          <div className="max-h-[38dvh] w-full min-w-0 overflow-y-auto rounded border border-zinc-800">
            <div className="w-full min-w-0 divide-y divide-zinc-900">
              {results.map((st) => (
                <div
                  key={st.studyUid}
                  className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 hover:bg-zinc-900"
                >
                  <div className="min-w-0 text-xs">
                    <div className="truncate font-medium text-zinc-200">
                      {st.patientName}{" "}
                      <span className="text-zinc-500">({st.patientId})</span>
                    </div>
                    <div className="truncate text-zinc-500">
                      {st.studyDescription} · {st.studyDate} · {st.modalities || "—"} ·{" "}
                      {st.seriesCount} series
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => pull(st)}
                    className="h-7 shrink-0 border-teal-700/60 text-teal-300 hover:bg-teal-900/30"
                  >
                    {pulling === st.studyUid
                      ? `${pullPct}%`
                      : isRemote
                        ? "Pull & Open"
                        : "Open"}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {servers.length === 0 && source !== RECEIVED && (
          <p className="text-[11px] leading-4 text-zinc-600">
            No PACS servers configured yet — open{" "}
            <button
              onClick={onOpenSettings}
              className="text-teal-400 underline underline-offset-2 hover:text-teal-300"
            >
              Settings
            </button>{" "}
            to add one with its AE Title, IP address and port.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
