"use client";

/**
 * DICOM Send dialog: pick a destination, choose scope (current series or
 * whole study) and trigger a C-STORE push. Two transports are offered:
 *
 *  - Direct   — this viewer speaks C-STORE itself (native DIMSE, no gateway
 *               needed); the payload comes from the local inbox or gateway
 *               cache. Phase 3.5.
 *  - Gateway  — the Orthanc gateway pushes from its cache to a registered
 *               modality AE (classic route).
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
  listServers,
  sendDirect,
  sendToModality,
  type SendDestination,
  type SendOutcome,
} from "@/lib/viewer/send";

type Scope = "series" | "study";

interface DestOption extends SendDestination {
  kind: "direct" | "gateway";
  serverId?: string;
}

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

  const [destinations, setDestinations] = useState<DestOption[] | null>(null);
  const [destError, setDestError] = useState<string | null>(null);
  const [target, setTarget] = useState<string>("");
  const [scope, setScope] = useState<Scope>("series");
  const [sending, setSending] = useState(false);
  const [sendPct, setSendPct] = useState(0);
  const [result, setResult] = useState<SendOutcome | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setDestError(null);
    setDestinations(null);
    setSendPct(0);
    Promise.all([listSendDestinations().catch(() => [] as SendDestination[]), listServers().catch(() => [])])
      .then(([gw, servers]) => {
        const direct: DestOption[] = servers.map((s) => ({
          name: s.name,
          aet: s.aeTitle,
          host: s.host,
          port: s.port,
          kind: "direct" as const,
          serverId: s.id,
        }));
        const directAes = new Set(direct.map((d) => d.aet));
        const viaGateway: DestOption[] = gw
          .filter((d) => !directAes.has(d.aet))
          .map((d) => ({ ...d, kind: "gateway" as const }));
        const list = [...direct, ...viaGateway];
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
    const dest = destinations?.find((d) => d.name === target);
    if (!dest) return;
    setSending(true);
    setSendPct(0);
    setResult(null);
    try {
      if (dest.kind === "direct" && dest.serverId) {
        const outcome = await sendDirect(
          dest.serverId,
          study.studyUid,
          scope === "series" ? series?.seriesUid ?? null : null,
          (pct) => setSendPct(pct)
        );
        setResult(outcome);
      } else {
        const outcome = await sendToModality({
          targetAe: dest.aet,
          studyUid: study.studyUid,
          seriesUid: scope === "series" ? series?.seriesUid ?? null : null,
        });
        setResult(outcome);
      }
    } catch (e) {
      setResult({
        ok: false,
        message: e instanceof Error ? e.message : "Send failed",
      });
    } finally {
      setSending(false);
      setSendPct(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-zinc-800 bg-zinc-950 text-zinc-200">
        <DialogHeader>
          <DialogTitle className="text-teal-300">DICOM Send (C-STORE)</DialogTitle>
          <DialogDescription className="text-zinc-500">
            Push this study to another DICOM node — directly from this viewer
            or via the PACS gateway.
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
                  <option key={`${d.kind}-${d.aet}-${d.name}`} value={d.name}>
                    {d.kind === "direct" ? "Direct: " : "Via gateway: "}
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
              {sending
                ? `Sending… ${sendPct > 0 ? `${sendPct}%` : ""}`
                : `Send to ${target || "…"}`}
            </Button>

            {sending && sendPct > 0 && (
              <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
                <div className="h-full bg-sky-500 transition-all" style={{ width: `${sendPct}%` }} />
              </div>
            )}

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
