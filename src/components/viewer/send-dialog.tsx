"use client";

/**
 * DICOM Send dialog: pick a destination (AE title configured on the Orthanc
 * gateway), choose scope (current series or whole study) and trigger a
 * C-STORE push from the gateway. Phase 3.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useViewerStore, findSeriesAnywhere } from "@/lib/viewer/store";
import {
  listSendDestinations,
  sendToModality,
  type SendDestination,
  type SendOutcome,
} from "@/lib/viewer/send";

type Scope = "series" | "study";

export default function SendDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const studies = useViewerStore((s) => s.studies);
  const activeSeriesUid = useViewerStore((s) => s.activeSeriesUid);
  const { series, study } = findSeriesAnywhere(studies, activeSeriesUid);

  const [destinations, setDestinations] = useState<SendDestination[] | null>(null);
  const [destError, setDestError] = useState<string | null>(null);
  const [target, setTarget] = useState<string>("");
  const [scope, setScope] = useState<Scope>("series");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendOutcome | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setDestError(null);
    setDestinations(null);
    listSendDestinations()
      .then((list) => {
        setDestinations(list);
        if (list.length > 0) setTarget(list[0].name);
      })
      .catch((e: Error) => {
        setDestError(e.message);
        setDestinations([]);
      });
  }, [open]);

  const onSend = async () => {
    if (!study || !target) return;
    setSending(true);
    setResult(null);
    try {
      const outcome = await sendToModality({
        targetAe: target,
        studyUid: study.studyUid,
        seriesUid: scope === "series" ? series?.seriesUid ?? null : null,
      });
      setResult(outcome);
    } catch (e) {
      setResult({
        ok: false,
        message: e instanceof Error ? e.message : "Send failed",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-zinc-800 bg-zinc-950 text-zinc-200">
        <DialogHeader>
          <DialogTitle className="text-teal-300">DICOM Send (C-STORE)</DialogTitle>
          <DialogDescription className="text-zinc-500">
            Push this study from the PACS gateway to another DICOM node.
          </DialogDescription>
        </DialogHeader>

        {destinations === null && !destError && (
          <div className="py-4 text-center text-xs text-zinc-500">
            Checking gateway destinations…
          </div>
        )}

        {destError && (
          <div className="rounded border border-amber-700/50 bg-amber-950/60 p-3 text-xs leading-5 text-amber-200">
            {destError}
            <div className="mt-2 text-amber-300/80">
              Register C-STORE destinations under Settings &gt; PACS servers
              (they are synced to the gateway), then try again.
            </div>
          </div>
        )}

        {destinations !== null && !destError && (
          <div className="space-y-4 text-xs">
            <div className="rounded border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="font-medium text-zinc-200">
                {study?.patientName ?? "No study loaded"}
              </div>
              <div className="text-zinc-500">
                {study
                  ? `${study.studyDescription} · ${study.studyDate}`
                  : "Load a study first."}
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                Destination
              </span>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="h-9 w-full rounded border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200"
              >
                {destinations.length === 0 && (
                  <option value="">No destinations configured</option>
                )}
                {destinations.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                    {d.aet !== d.name ? ` (${d.aet})` : ""}
                    {d.host ? ` @ ${d.host}:${d.port ?? 104}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                Scope
              </span>
              <div className="flex gap-2">
                {(["series", "study"] as Scope[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScope(s)}
                    className={`h-8 flex-1 rounded border px-2 text-[11px] capitalize ${
                      scope === s
                        ? "border-teal-400/60 bg-teal-500/20 text-teal-300"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {s === "series"
                      ? `Current series${series ? ` (${series.instanceCount} images)` : ""}`
                      : "Whole study"}
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={onSend}
              disabled={!target || sending || !study || destinations.length === 0}
              className="h-9 w-full bg-sky-600 text-xs text-white hover:bg-sky-500"
            >
              {sending ? "Sending…" : `Send to ${target || "…"}`}
            </Button>

            {result && (
              <div
                className={`rounded border p-3 leading-5 ${
                  result.ok
                    ? "border-teal-700/50 bg-teal-950/60 text-teal-200"
                    : "border-amber-700/50 bg-amber-950/60 text-amber-200"
                }`}
              >
                {result.message}
              </div>
            )}

            {destinations.length === 0 && (
              <div className="text-zinc-500">
                No destinations found on the gateway. Add a PACS server in
                Settings (its AE title/host/port is registered as a C-STORE
                destination) and it will appear here.
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
