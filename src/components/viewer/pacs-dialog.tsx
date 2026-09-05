"use client";

/**
 * PACS search dialog: queries the Orthanc gateway via the app proxy (QIDO-RS),
 * then pulls the selected study (WADO-URI per instance) through the same proxy.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { queryStudies, fetchStudyAsFiles, type PacsStudy } from "@/lib/viewer/pacs";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onFiles: (files: File[]) => void;
  onProgress: (p: { done: number; total: number; label: string }) => void;
}

export default function PacsDialog({ open, onOpenChange, onFiles, onProgress }: Props) {
  const [patientName, setPatientName] = useState("");
  const [patientId, setPatientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PacsStudy[] | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);

  async function runQuery() {
    setBusy(true);
    setError(null);
    try {
      const rows = await queryStudies({
        patientName: patientName || undefined,
        patientId: patientId || undefined,
        limit: 40,
      });
      setResults(rows);
      if (rows.length === 0) setError("No matching studies found on the PACS.");
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message}. If this is a fresh deployment, configure ORTHANC_URL in the stack environment (deploy/docker-compose.yml) and verify the remote PACS is registered in deploy/orthanc.json.`
          : "Query failed"
      );
    } finally {
      setBusy(false);
    }
  }

  async function pull(study: PacsStudy) {
    setBusy(true);
    setPulling(study.studyUid);
    setError(null);
    try {
      const files = await fetchStudyAsFiles(study.studyUid, (done, total, label) =>
        onProgress({ done, total, label })
      );
      onFiles(files);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retrieve failed");
    } finally {
      setBusy(false);
      setPulling(null);
      onProgress({ done: 0, total: 0, label: "" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-200 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-teal-300">Query PACS</DialogTitle>
          <DialogDescription className="text-zinc-500">
            Searches the DICOM gateway (Orthanc) over DICOMweb. Retrieved studies
            are cached on the NAS and served to this viewer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Patient name (e.g. DEMO)"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            className="h-8 flex-1 border-zinc-800 bg-zinc-900 text-sm"
            onKeyDown={(e) => e.key === "Enter" && runQuery()}
          />
          <Input
            placeholder="Patient ID"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            className="h-8 w-32 border-zinc-800 bg-zinc-900 text-sm"
            onKeyDown={(e) => e.key === "Enter" && runQuery()}
          />
          <Button
            size="sm"
            onClick={runQuery}
            disabled={busy}
            className="h-8 bg-teal-600 text-white hover:bg-teal-500"
          >
            {busy && !pulling ? "Searching…" : "Search"}
          </Button>
        </div>

        {error && (
          <div className="rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs leading-4 text-amber-300">
            {error}
          </div>
        )}

        {results && results.length > 0 && (
          <ScrollArea className="max-h-64 rounded border border-zinc-800">
            <div className="divide-y divide-zinc-900">
              {results.map((st) => (
                <div
                  key={st.studyUid}
                  className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-zinc-900"
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
                    {pulling === st.studyUid ? "Retrieving…" : "Open"}
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
