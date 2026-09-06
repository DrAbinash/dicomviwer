"use client";

/**
 * Settings dialog — the control panel of the viewer:
 *
 *  1. Gateway   — where the local Orthanc DICOM gateway lives (URL, optional
 *                 basic-auth, gateway AE Title). Every query/retrieve flows
 *                 through this gateway.
 *  2. PACS list — user-added remote PACS servers (AE Title / IP / Port).
 *                 Saving a server registers it as a DICOM modality on the
 *                 gateway; "Test" performs a real C-ECHO handshake.
 *  3. Auto-Pull — Phase 2 poller monitoring: last cycle summary and the
 *                 recent per-study activity written by the auto-puller
 *                 service via its heartbeat.
 *  4. Storage   — inbox/DB disk usage + automatic retention rules
 *                 (delete received studies by age / study count / disk).
 *  5. Security  — change the viewer login (username / password).
 */

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  createServer,
  deleteServer,
  getAutoPullStatus,
  getGatewayInfo,
  getListener,
  listServers,
  saveGatewaySettings,
  saveListener,
  testServer,
  updateCredentials,
  updateServer,
  runCleanupNow,
  getStorageInfo,
  saveRetentionSettings,
  type AutoPullStatus,
  type GatewayInfo,
  type ListenerStatus,
  type PacsServerInfo,
  type StorageInfo,
  type CleanupResult,
} from "@/lib/viewer/pacs";
import ViewerTab from "./viewer-tab";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type EditorState =
  | { mode: "closed" }
  | { mode: "new" }
  | { mode: "edit"; server: PacsServerInfo };

const emptyForm = {
  name: "",
  aeTitle: "",
  host: "",
  port: "104",
  notes: "",
};

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export default function SettingsDialog({ open, onOpenChange }: Props) {
  const [gateway, setGateway] = useState<GatewayInfo | null>(null);
  const [servers, setServers] = useState<PacsServerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // gateway form
  const [gwUrl, setGwUrl] = useState("");
  const [gwUser, setGwUser] = useState("");
  const [gwPass, setGwPass] = useState("");
  const [gwAet, setGwAet] = useState("");
  const [gwBusy, setGwBusy] = useState(false);
  const [gwMsg, setGwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // server form
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // security form
  const [secCurrent, setSecCurrent] = useState("");
  const [secUser, setSecUser] = useState("");
  const [secPass, setSecPass] = useState("");
  const [secBusy, setSecBusy] = useState(false);
  const [secMsg, setSecMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // auto-pull monitoring
  const [autoPull, setAutoPull] = useState<AutoPullStatus | null>(null);
  const [apLoading, setApLoading] = useState(false);

  // built-in DICOM listener
  const [listener, setListener] = useState<ListenerStatus | null>(null);
  const [lisAe, setLisAe] = useState("");
  const [lisPort, setLisPort] = useState("");
  const [lisForward, setLisForward] = useState(true);
  const [lisBusy, setLisBusy] = useState(false);
  const [lisMsg, setLisMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // storage & retention
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [stEnabled, setStEnabled] = useState(false);
  const [stMaxAge, setStMaxAge] = useState("0");
  const [stMaxStudies, setStMaxStudies] = useState("0");
  const [stMaxDiskMb, setStMaxDiskMb] = useState("0");
  const [stBusy, setStBusy] = useState(false);
  const [stMsg, setStMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [stPlan, setStPlan] = useState<CleanupResult | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [g, s, l] = await Promise.all([getGatewayInfo(), listServers(), getListener().catch(() => null)]);
      setGateway(g);
      setServers(s);
      setGwUrl(g.url);
      setGwUser(g.username);
      setGwAet(g.gatewayAet);
      if (l) {
        setListener(l);
        setLisAe(l.config.aeTitle);
        setLisPort(String(l.config.port));
        setLisForward(l.config.forwardToGateway);
      }
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setGwMsg(null);
      setTestMsg(null);
      setConfirmDeleteId(null);
      setEditor({ mode: "closed" });
      setSecMsg(null);
      setSecCurrent("");
      setSecPass("");
      refresh();
    }
  }, [open, refresh]);

  const refreshAutoPull = useCallback(async () => {
    setApLoading(true);
    try {
      setAutoPull(await getAutoPullStatus());
    } catch {
      setAutoPull(null);
    } finally {
      setApLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refreshAutoPull();
  }, [open, refreshAutoPull]);

  const refreshStorage = useCallback(async () => {
    try {
      const info = await getStorageInfo();
      setStorage(info);
      setStEnabled(info.settings.enabled);
      setStMaxAge(String(info.settings.maxAgeDays));
      setStMaxStudies(String(info.settings.maxStudies));
      setStMaxDiskMb(String(info.settings.maxDiskMb));
    } catch {
      setStorage(null);
    }
  }, []);

  useEffect(() => {
    if (open) refreshStorage();
  }, [open, refreshStorage]);

  async function saveRetention() {
    setStBusy(true);
    setStMsg(null);
    try {
      await saveRetentionSettings({
        enabled: stEnabled,
        maxAgeDays: Math.max(0, Math.floor(Number(stMaxAge) || 0)),
        maxStudies: Math.max(0, Math.floor(Number(stMaxStudies) || 0)),
        maxDiskMb: Math.max(0, Math.floor(Number(stMaxDiskMb) || 0)),
      });
      setStMsg({ ok: true, text: "Retention rules saved." });
      await refreshStorage();
    } catch (e) {
      setStMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setStBusy(false);
    }
  }

  async function cleanup(dryRun: boolean) {
    setStBusy(true);
    setStMsg(null);
    try {
      const r = await runCleanupNow(dryRun);
      setStPlan(r);
      setStMsg(
        r.victims.length === 0
          ? { ok: true, text: "Nothing to delete — inbox is within all limits." }
          : dryRun
            ? {
                ok: true,
                text: `Preview: ${r.victims.length} study(ies) would be deleted, freeing ${formatBytes(r.freedBytes)}. Use "Clean up now" to apply.`,
              }
            : {
                ok: true,
                text: `Deleted ${r.deletedStudies} study(ies), freed ${formatBytes(r.freedBytes)}.`,
              }
      );
      await refreshStorage();
    } catch (e) {
      setStMsg({ ok: false, text: e instanceof Error ? e.message : "Cleanup failed" });
    } finally {
      setStBusy(false);
    }
  }

  async function saveSecurity() {
    setSecBusy(true);
    setSecMsg(null);
    try {
      const r = await updateCredentials({
        currentPassword: secCurrent,
        newUsername: secUser || undefined,
        newPassword: secPass || undefined,
      });
      setSecMsg({ ok: true, text: `Saved. The login is now "${r.username}" — use it on the next sign-in.` });
      setSecCurrent("");
      setSecPass("");
      setSecUser("");
    } catch (e) {
      setSecMsg({ ok: false, text: e instanceof Error ? e.message : "Update failed" });
    } finally {
      setSecBusy(false);
    }
  }

  async function saveGateway() {
    setGwBusy(true);
    setGwMsg(null);
    try {
      const r = await saveGatewaySettings({
        url: gwUrl,
        username: gwUser,
        password: gwPass === "" ? undefined : gwPass,
        gatewayAet: gwAet,
      });
      if (r.reachable && r.system) {
        setGwMsg({
          ok: true,
          text: `Saved. Gateway "${r.system.name}" v${r.system.version} reachable (AET ${r.system.dicomAet || "?"}).`,
        });
      } else {
        setGwMsg({ ok: false, text: `Saved, but the gateway did not answer: ${r.error ?? "no response"}` });
      }
      await refresh();
    } catch (e) {
      setGwMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setGwBusy(false);
    }
  }

  /** Toggle / save the built-in DICOM listener (C-STORE SCP). */
  async function applyListener(patch: { enabled?: boolean; aeTitle?: string; port?: number; forwardToGateway?: boolean }) {
    setLisBusy(true);
    setLisMsg(null);
    try {
      const l = await saveListener({
        aeTitle: patch.aeTitle ?? lisAe,
        port: patch.port ?? (Number(lisPort) || undefined),
        forwardToGateway: patch.forwardToGateway ?? lisForward,
        ...patch,
      });
      setListener(l);
      setLisAe(l.config.aeTitle);
      setLisPort(String(l.config.port));
      setLisForward(l.config.forwardToGateway);
      if (l.error) setLisMsg({ ok: false, text: l.error });
      else if (l.running)
        setLisMsg({
          ok: true,
          text: `Listener active on port ${l.config.port} as "${l.config.aeTitle}" — point modalities at this host:port.`,
        });
      else setLisMsg({ ok: true, text: "Listener stopped." });
    } catch (e) {
      setLisMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setLisBusy(false);
    }
  }

  function openNewServer() {
    setForm(emptyForm);
    setFormError(null);
    setEditor({ mode: "new" });
  }

  function openEditServer(s: PacsServerInfo) {
    setForm({
      name: s.name,
      aeTitle: s.aeTitle,
      host: s.host,
      port: String(s.port),
      notes: s.notes ?? "",
    });
    setFormError(null);
    setEditor({ mode: "edit", server: s });
  }

  async function submitServer() {
    setFormBusy(true);
    setFormError(null);
    const payload = {
      name: form.name,
      aeTitle: form.aeTitle,
      host: form.host,
      port: Number(form.port) || 0,
      notes: form.notes || null,
    };
    try {
      const r =
        editor.mode === "edit"
          ? await updateServer(editor.server.id, payload)
          : await createServer(payload);
      if (!r.registered && r.registeredError) {
        setFormError(`Saved, but the gateway could not register it: ${r.registeredError}`);
      }
      setEditor({ mode: "closed" });
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setFormBusy(false);
    }
  }

  async function runTest(s: PacsServerInfo) {
    setTestingId(s.id);
    setTestMsg(null);
    try {
      const r = await testServer(s.id);
      setTestMsg(
        r.ok
          ? { id: s.id, ok: true, text: `C-ECHO OK (${r.ms} ms)` }
          : { id: s.id, ok: false, text: r.error ?? "C-ECHO failed" }
      );
      await refresh();
    } catch (e) {
      setTestMsg({
        id: s.id,
        ok: false,
        text: e instanceof Error ? e.message : "C-ECHO failed",
      });
    } finally {
      setTestingId(null);
    }
  }

  async function removeServer(s: PacsServerInfo) {
    if (confirmDeleteId !== s.id) {
      setConfirmDeleteId(s.id);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await deleteServer(s.id);
      await refresh();
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const inputCls = "h-9 border-zinc-800 bg-zinc-900 text-sm text-zinc-200 placeholder:text-zinc-600";
  const btnPrimary =
    "h-9 bg-teal-600 text-white hover:bg-teal-500 disabled:opacity-50";
  const fmtBytes = (n: number | null) => (n == null ? "—" : formatBytes(n));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-hidden border-zinc-800 bg-zinc-950 text-zinc-200 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-teal-300">Settings</DialogTitle>
          <DialogDescription className="text-zinc-500">
            Configure the DICOM gateway and the remote PACS servers you pull
            studies from. Everything is stored locally on this server.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="pacs" className="flex min-h-0 flex-1 flex-col gap-3">
          <TabsList className="grid w-full grid-cols-6 bg-zinc-900">
            <TabsTrigger value="pacs" className="px-1 data-[state=active]:bg-zinc-800 data-[state=active]:text-teal-300">
              PACS
            </TabsTrigger>
            <TabsTrigger value="gateway" className="px-1 data-[state=active]:bg-zinc-800 data-[state=active]:text-teal-300">
              Gateway
            </TabsTrigger>
            <TabsTrigger value="viewer" className="px-1 data-[state=active]:bg-zinc-800 data-[state=active]:text-teal-300">
              Viewer
            </TabsTrigger>
            <TabsTrigger value="autopull" className="px-1 data-[state=active]:bg-zinc-800 data-[state=active]:text-teal-300">
              Auto-Pull
            </TabsTrigger>
            <TabsTrigger value="storage" className="px-1 data-[state=active]:bg-zinc-800 data-[state=active]:text-teal-300">
              Storage
            </TabsTrigger>
            <TabsTrigger value="security" className="px-1 data-[state=active]:bg-zinc-800 data-[state=active]:text-teal-300">
              Security
            </TabsTrigger>
          </TabsList>

          {/* ------------------------- PACS servers ------------------------- */}
          <TabsContent value="pacs" className="flex min-h-0 flex-col gap-3 data-[state=inactive]:hidden">
            {loading && <div className="text-xs text-zinc-500">Loading…</div>}
            {pageError && (
              <div className="rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
                {pageError}
              </div>
            )}

            {/* --------------------- built-in DICOM listener -------------------- */}
            <div className="rounded border border-teal-900/60 bg-zinc-900/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      listener?.running ? "animate-pulse bg-emerald-400" : "bg-zinc-600"
                    }`}
                    title={listener?.running ? "listening" : "stopped"}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold uppercase tracking-wider text-teal-300">
                      DICOM listener — this viewer as a PACS node
                    </div>
                    <div className="truncate text-[11px] text-zinc-500">
                      {listener?.running
                        ? `Accepting C-STORE / C-ECHO / C-FIND on port ${listener.config.port}`
                        : "Receive studies pushed by modalities or other PACS"}
                    </div>
                  </div>
                </div>
                <Switch
                  checked={listener?.config.enabled ?? false}
                  onCheckedChange={(v) => applyListener({ enabled: v })}
                  disabled={lisBusy}
                />
              </div>

              <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div className="grid gap-1">
                  <Label htmlFor="lis-aet" className="text-xs text-zinc-400">Our AE Title</Label>
                  <Input
                    id="lis-aet"
                    value={lisAe}
                    onChange={(e) => setLisAe(e.target.value.toUpperCase())}
                    placeholder="DICOMVIEWER"
                    className={inputCls}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="lis-port" className="text-xs text-zinc-400">Listen port</Label>
                  <Input
                    id="lis-port"
                    value={lisPort}
                    onChange={(e) => setLisPort(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="4104"
                    inputMode="numeric"
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col justify-end gap-1">
                  <div className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5">
                    <span className="text-[11px] text-zinc-400">Forward to gateway</span>
                    <Switch
                      checked={lisForward}
                      onCheckedChange={(v) => setLisForward(v)}
                      disabled={lisBusy}
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() =>
                      applyListener({
                        aeTitle: lisAe,
                        port: Number(lisPort) || undefined,
                        forwardToGateway: lisForward,
                      })
                    }
                    disabled={lisBusy}
                    className="h-8 bg-teal-600 text-xs text-white hover:bg-teal-500"
                  >
                    {lisBusy ? "Applying…" : "Save & apply"}
                  </Button>
                </div>
              </div>

              {listener?.running && (
                <div className="mt-2 text-[11px] leading-4 text-zinc-500">
                  {listener.stats.instances} instance(s) received since boot
                  {listener.stats.lastReceivedAt
                    ? ` · last ${new Date(listener.stats.lastReceivedAt).toLocaleTimeString()}`
                    : ""}
                  {listener.stats.forwardFailures > 0
                    ? ` · ${listener.stats.forwardFailures} gateway forward failures`
                    : ""}
                </div>
              )}
              {lisMsg && (
                <div
                  className={`mt-2 rounded px-2 py-1 text-xs ${
                    lisMsg.ok
                      ? "bg-emerald-900/30 text-emerald-300"
                      : "bg-rose-950/50 text-rose-300"
                  }`}
                >
                  {lisMsg.text}
                </div>
              )}
              <p className="mt-2 text-[11px] leading-4 text-zinc-600">
                Received studies appear in the Query dialog under "Inbox". If a
                gateway is configured they are also mirrored into its cache.
                Remember to open the listen port in your firewall (and in the
                Synology container port mapping when deployed).
              </p>
            </div>

            {servers.length === 0 && !loading && (
              <div className="rounded border border-zinc-800 bg-zinc-900/60 px-3 py-4 text-center text-xs leading-5 text-zinc-500">
                No PACS servers configured yet.
                <br />
                Add one with the AE Title, IP address and DICOM port of your
                modality or archive.
              </div>
            )}

            {servers.length > 0 && (
              <div className="max-h-[46dvh] w-full min-w-0 overflow-y-auto rounded border border-zinc-800">
                <div className="w-full min-w-0 divide-y divide-zinc-900">
                  {servers.map((s) => {
                    const dot =
                      s.lastStatus === "ok"
                        ? "bg-emerald-400"
                        : s.lastStatus === "fail"
                          ? "bg-rose-500"
                          : "bg-zinc-600";
                    return (
                      <div key={s.id} className="w-full min-w-0 px-3 py-2.5">
                        <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} title={s.lastStatus ?? "untested"} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-zinc-200">
                              {s.name}
                            </div>
                            <div className="truncate text-xs text-zinc-500">
                              {s.aeTitle} @ {s.host}:{s.port}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={testingId === s.id}
                            onClick={() => runTest(s)}
                            className="h-7 border-teal-700/60 px-2 text-xs text-teal-300 hover:bg-teal-900/30"
                          >
                            {testingId === s.id ? "…" : "Test"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEditServer(s)}
                            className="h-7 px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeServer(s)}
                            className={`h-7 px-2 text-xs ${
                              confirmDeleteId === s.id
                                ? "bg-rose-900/50 text-rose-200 hover:bg-rose-900"
                                : "text-zinc-400 hover:bg-zinc-800 hover:text-rose-300"
                            }`}
                          >
                            {confirmDeleteId === s.id ? "Sure?" : "Delete"}
                          </Button>
                        </div>
                        {testMsg?.id === s.id && (
                          <div
                            className={`mt-1.5 w-full rounded px-2 py-1 text-xs ${
                              testMsg.ok
                                ? "bg-emerald-900/30 text-emerald-300"
                                : "bg-rose-950/50 text-rose-300"
                            }`}
                          >
                            {testMsg.text}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {editor.mode !== "closed" ? (
              <div className="rounded border border-teal-900/60 bg-zinc-900/70 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-teal-300">
                  {editor.mode === "new" ? "Add PACS server" : `Edit “${editor.server.name}”`}
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor="pacs-name" className="text-xs text-zinc-400">Display name</Label>
                    <Input
                      id="pacs-name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Hospital PACS"
                      className={inputCls}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="pacs-aet" className="text-xs text-zinc-400">AE Title</Label>
                    <Input
                      id="pacs-aet"
                      value={form.aeTitle}
                      onChange={(e) => setForm({ ...form, aeTitle: e.target.value.toUpperCase() })}
                      placeholder="CONQUESTSRV1"
                      className={`${inputCls} font-mono uppercase`}
                      maxLength={16}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="pacs-host" className="text-xs text-zinc-400">IP address / hostname</Label>
                    <Input
                      id="pacs-host"
                      value={form.host}
                      onChange={(e) => setForm({ ...form, host: e.target.value })}
                      placeholder="192.168.1.100"
                      className={`${inputCls} font-mono`}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="pacs-port" className="text-xs text-zinc-400">DICOM port</Label>
                    <Input
                      id="pacs-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={form.port}
                      onChange={(e) => setForm({ ...form, port: e.target.value })}
                      placeholder="104"
                      className={`${inputCls} font-mono`}
                    />
                  </div>
                  <div className="grid gap-1 sm:col-span-2">
                    <Label htmlFor="pacs-notes" className="text-xs text-zinc-400">Notes (optional)</Label>
                    <Input
                      id="pacs-notes"
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      placeholder="Radiology dept archive, CT/MR only…"
                      className={inputCls}
                    />
                  </div>
                </div>
                {formError && (
                  <div className="mt-2 rounded bg-rose-950/50 px-2 py-1.5 text-xs text-rose-300">
                    {formError}
                  </div>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditor({ mode: "closed" })}
                    className="h-8 text-zinc-400 hover:bg-zinc-800"
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={submitServer} disabled={formBusy} className={btnPrimary}>
                    {formBusy ? "Saving…" : "Save server"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={openNewServer} className="h-9 border-teal-700/60 text-sm text-teal-300 hover:bg-teal-900/30">
                + Add PACS server
              </Button>
            )}

            <p className="text-[11px] leading-4 text-zinc-600">
              Saved servers are registered on the gateway as DICOM modalities,
              so queries use real C-FIND and studies arrive with C-GET/C-MOVE.
              For C-MOVE the remote PACS must also know this viewer&apos;s AE
              Title and port — see the Gateway tab.
            </p>
          </TabsContent>

          {/* --------------------------- Gateway ---------------------------- */}
          <TabsContent value="gateway" className="flex min-h-0 flex-col gap-3 data-[state=inactive]:hidden">
            <div
              className={`rounded border px-3 py-2 text-xs leading-5 ${
                gateway?.reachable
                  ? "border-emerald-800/60 bg-emerald-900/20 text-emerald-300"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-400"
              }`}
            >
              {loading ? (
                "Checking gateway…"
              ) : gateway?.reachable && gateway.system ? (
                <>
                  <span className="font-semibold">{gateway.system.name}</span>
                  {" "}v{gateway.system.version} — reachable at {gateway.url || "(from deployment env)"}
                  <br />
                  DICOM listener: AET <span className="font-mono">{gateway.system.dicomAet || "?"}</span>, port{" "}
                  {gateway.system.dicomPort ?? "?"} · {gateway.modalities.length} modality
                  {gateway.modalities.length === 1 ? "" : "ities"} registered
                </>
              ) : gateway?.configured ? (
                <>Gateway not reachable: {gateway.error ?? "no response"}</>
              ) : (
                <>No gateway configured. Set the URL of the Orthanc service below.</>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              <div className="grid gap-1">
                <Label htmlFor="gw-url" className="text-xs text-zinc-400">
                  Gateway URL (Orthanc HTTP)
                </Label>
                <Input
                  id="gw-url"
                  value={gwUrl}
                  onChange={(e) => setGwUrl(e.target.value)}
                  placeholder="http://192.168.1.50:8042"
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor="gw-user" className="text-xs text-zinc-400">Username (optional)</Label>
                  <Input
                    id="gw-user"
                    value={gwUser}
                    onChange={(e) => setGwUser(e.target.value)}
                    placeholder="orthanc"
                    autoComplete="off"
                    className={inputCls}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="gw-pass" className="text-xs text-zinc-400">
                    Password {gateway?.username ? "(set — blank keeps it)" : "(optional)"}
                  </Label>
                  <Input
                    id="gw-pass"
                    type="password"
                    value={gwPass}
                    onChange={(e) => setGwPass(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="gw-aet" className="text-xs text-zinc-400">
                  Gateway AE Title (C-MOVE target)
                </Label>
                <Input
                  id="gw-aet"
                  value={gwAet}
                  onChange={(e) => setGwAet(e.target.value.toUpperCase())}
                  placeholder="SYNOLOGYVIEWER"
                  className={`${inputCls} font-mono uppercase`}
                  maxLength={16}
                />
                <span className="text-[11px] text-zinc-600">
                  Must match <span className="font-mono">DicomAet</span> in
                  deploy/orthanc.json. Remote PACS that only support C-MOVE
                  need this AE Title + the gateway IP / DICOM port registered
                  on their side.
                </span>
              </div>
            </div>

            {gwMsg && (
              <div
                className={`rounded px-3 py-2 text-xs leading-4 ${
                  gwMsg.ok
                    ? "bg-emerald-900/30 text-emerald-300"
                    : "bg-amber-950/50 text-amber-300"
                }`}
              >
                {gwMsg.text}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-600">
                {gateway?.source === "db"
                  ? "Currently using settings saved here."
                  : gateway?.source === "env"
                    ? "Currently using deployment environment variables."
                    : ""}
              </span>
              <Button onClick={saveGateway} disabled={gwBusy} className={btnPrimary}>
                {gwBusy ? "Testing…" : "Save & test"}
              </Button>
            </div>
          </TabsContent>

          {/* --------------------- viewer preferences ---------------------- */}
          <TabsContent value="viewer" className="flex min-h-0 flex-col gap-3 data-[state=inactive]:hidden">
            <p className="text-xs leading-5 text-zinc-500">
              Window/level presets and viewer defaults shown here are stored on
              the server - every browser and every device gets the same
              configuration. Nothing in the viewer is hardcoded.
            </p>
            <ViewerTab />
          </TabsContent>

          <TabsContent value="autopull" className="flex min-h-0 flex-col gap-3 data-[state=inactive]:hidden">
            {apLoading && <div className="text-xs text-zinc-500">Checking auto-puller…</div>}

            {!apLoading && !autoPull?.lastCycle && (
              <div className="rounded border border-zinc-800 bg-zinc-900/60 px-3 py-4 text-xs leading-5 text-zinc-500">
                No heartbeat received yet. The Phase 2 auto-puller is a separate
                service (<span className="font-mono">deploy/auto-puller</span>) that queries your
                modalities every cycle and pulls missing studies into the
                gateway automatically. Enable it in the deployment .env — every
                cycle then shows up here.
              </div>
            )}

            {!apLoading && autoPull?.lastCycle && (
              <div className="rounded border border-teal-900/60 bg-teal-900/10 px-3 py-2 text-xs leading-5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="font-semibold text-teal-200">
                    Last cycle {new Date(autoPull.lastHeartbeatAt ?? autoPull.lastCycle.finishedAt).toLocaleString()}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      autoPull.lastCycle.status === "ok"
                        ? "bg-emerald-900/40 text-emerald-300"
                        : autoPull.lastCycle.status === "partial"
                          ? "bg-amber-900/40 text-amber-300"
                          : "bg-rose-900/40 text-rose-300"
                    }`}
                  >
                    {autoPull.lastCycle.status}
                  </span>
                </div>
                <div className="mt-1 text-zinc-400">
                  every {autoPull.lastCycle.pollIntervalSeconds || "?"}s · lookback{" "}
                  {autoPull.lastCycle.lookbackDays || "?"}d · target AET{" "}
                  <span className="font-mono text-zinc-300">{autoPull.lastCycle.targetAet || "?"}</span>
                </div>
                <div className="mt-1 flex gap-3 text-zinc-300">
                  <span className="text-emerald-300">{autoPull.lastCycle.pulled} pulled</span>
                  <span className="text-zinc-400">{autoPull.lastCycle.skipped} skipped</span>
                  <span className="text-rose-300">{autoPull.lastCycle.failed} failed</span>
                </div>
                {autoPull.lastCycle.modalities?.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {autoPull.lastCycle.modalities.map((m) => (
                      <span
                        key={m.name}
                        title={m.error || "polled"}
                        className={`rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] ${
                          m.error ? "text-rose-300" : "text-zinc-400"
                        }`}
                      >
                        {m.name}
                        {m.error ? " ⚠" : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {autoPull && autoPull.events.length > 0 && (
              <div className="min-h-0 w-full flex-1 overflow-y-auto rounded border border-zinc-800">
                <div className="divide-y divide-zinc-900">
                  {autoPull.events.map((ev) => (
                    <div key={ev.id} className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-[11px]">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          ev.action === "pulled"
                            ? "bg-emerald-400"
                            : ev.action === "failed"
                              ? "bg-rose-500"
                              : "bg-zinc-600"
                        }`}
                        title={ev.action}
                      />
                      <span className="w-20 shrink-0 truncate font-mono text-zinc-500" title={ev.sourceAet}>
                        {ev.sourceAet}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-zinc-300">
                        {ev.patientName || ev.patientId || ev.studyUid}
                        {ev.patientId ? <span className="text-zinc-600"> · {ev.patientId}</span> : null}
                      </span>
                      <span className="hidden shrink-0 text-zinc-600 sm:inline">{ev.detail}</span>
                      <span className="shrink-0 text-zinc-600">
                        {new Date(ev.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-auto flex items-center justify-between">
              <span className="text-[11px] leading-4 text-zinc-600">
                Configured via env: <span className="font-mono">MODALITIES</span>,{" "}
                <span className="font-mono">POLL_INTERVAL_SECONDS</span>,{" "}
                <span className="font-mono">LOOKBACK_DAYS</span>.
                {autoPull?.tokenProtected ? " Heartbeat is token-protected." : ""}
              </span>
              <Button
                variant="outline"
                onClick={refreshAutoPull}
                className="h-8 shrink-0 border-teal-700/60 px-2 text-xs text-teal-300 hover:bg-teal-900/30"
              >
                Refresh
              </Button>
            </div>
          </TabsContent>

          {/* --------------------------- Storage --------------------------- */}
          <TabsContent value="storage" className="flex min-h-0 flex-col gap-3 data-[state=inactive]:hidden">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Studies", value: storage ? String(storage.stats.studies) : "…" },
                {
                  label: "Instances",
                  value: storage ? String(storage.stats.instances) : "…",
                },
                {
                  label: "Inbox on disk",
                  value: storage ? fmtBytes(storage.stats.inboxBytesOnDisk ?? storage.stats.inboxBytes) : "…",
                },
                {
                  label: "SQLite database",
                  value: storage ? fmtBytes(storage.stats.dbBytes) : "…",
                },
                {
                  label: "Disk free",
                  value: storage ? fmtBytes(storage.stats.diskFreeBytes) : "…",
                },
                {
                  label: "Disk total",
                  value: storage ? fmtBytes(storage.stats.diskTotalBytes) : "…",
                },
              ].map((c) => (
                <div key={c.label} className="rounded border border-zinc-800 bg-zinc-900/70 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">{c.label}</div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-zinc-200">{c.value}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] leading-4 text-zinc-500">
              The viewer stores everything locally in SQLite
              (<span className="font-mono">{storage ? storage.stats.inboxDir.split("/").slice(0, -1).join("/") || "/" : "db/"}</span>
              ) — received study files under the inbox folder, all settings and
              indexes in the database. Retention rules below automatically
              delete old received studies; oldest are always removed first.
            </p>

            <div className="rounded border border-teal-900/60 bg-zinc-900/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wider text-teal-300">
                    Auto-delete received studies
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    Checked every 10 minutes in the background. 0 = keep forever.
                  </div>
                </div>
                <Switch checked={stEnabled} onCheckedChange={setStEnabled} disabled={stBusy} />
              </div>
              <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div className="grid gap-1">
                  <Label htmlFor="st-age" className="text-xs text-zinc-400">Older than (days)</Label>
                  <Input
                    id="st-age"
                    inputMode="numeric"
                    value={stMaxAge}
                    onChange={(e) => setStMaxAge(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="0"
                    className={inputCls}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="st-count" className="text-xs text-zinc-400">Keep max studies</Label>
                  <Input
                    id="st-count"
                    inputMode="numeric"
                    value={stMaxStudies}
                    onChange={(e) => setStMaxStudies(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="0"
                    className={inputCls}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="st-disk" className="text-xs text-zinc-400">Keep max disk (MB)</Label>
                  <Input
                    id="st-disk"
                    inputMode="numeric"
                    value={stMaxDiskMb}
                    onChange={(e) => setStMaxDiskMb(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="0"
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <div className="text-[11px] text-zinc-500">
                  {storage?.lastRun
                    ? `Last auto-run: deleted ${storage.lastRun.deletedStudies} study(ies), freed ${formatBytes(storage.lastRun.freedBytes)}`
                    : "No automatic deletion has run yet."}
                </div>
                <Button onClick={saveRetention} disabled={stBusy} className={btnPrimary}>
                  {stBusy ? "Saving…" : "Save rules"}
                </Button>
              </div>
            </div>

            {stPlan && stPlan.victims.length > 0 && (
              <div className="max-h-36 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/50 p-2">
                {stPlan.victims.map((v) => (
                  <div key={v.studyUid} className="flex items-center justify-between gap-2 py-0.5 text-[11px] text-zinc-400">
                    <span className="min-w-0 truncate">
                      {v.label} <span className="text-zinc-600">({v.reasons.join(", ")})</span>
                    </span>
                    <span className="shrink-0 font-mono text-zinc-500">{formatBytes(v.bytes)}</span>
                  </div>
                ))}
              </div>
            )}

            {stMsg && (
              <div
                className={`rounded px-3 py-2 text-xs leading-4 ${
                  stMsg.ok ? "bg-emerald-900/30 text-emerald-300" : "bg-rose-950/50 text-rose-300"
                }`}
              >
                {stMsg.text}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => cleanup(true)}
                disabled={stBusy}
                className="h-9 border-zinc-800 bg-transparent text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
              >
                Preview cleanup
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm("Permanently delete every study matching the retention rules?")) {
                    void cleanup(false);
                  }
                }}
                disabled={stBusy || !stEnabled}
                className="h-9 border-rose-900/60 bg-transparent text-rose-300 hover:bg-rose-950/40 hover:text-rose-200"
              >
                Clean up now
              </Button>
            </div>
          </TabsContent>

          {/* --------------------------- Security --------------------------- */}
          <TabsContent value="security" className="flex min-h-0 flex-col gap-3 data-[state=inactive]:hidden">
            <p className="text-xs leading-5 text-zinc-500">
              Change the viewer login. Credentials are stored hashed (scrypt) in
              the viewer database and override the deployment&apos;s{" "}
              <span className="font-mono">AUTH_USERNAME</span> /{" "}
              <span className="font-mono">AUTH_PASSWORD</span> defaults.
            </p>
            <div className="grid grid-cols-1 gap-2.5">
              <div className="grid gap-1">
                <Label htmlFor="sec-current" className="text-xs text-zinc-400">
                  Current password
                </Label>
                <Input
                  id="sec-current"
                  type="password"
                  value={secCurrent}
                  onChange={(e) => setSecCurrent(e.target.value)}
                  autoComplete="current-password"
                  className={inputCls}
                  placeholder="••••••••"
                />
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor="sec-user" className="text-xs text-zinc-400">
                    New username (optional)
                  </Label>
                  <Input
                    id="sec-user"
                    value={secUser}
                    onChange={(e) => setSecUser(e.target.value)}
                    placeholder="keep current"
                    autoComplete="off"
                    className={inputCls}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="sec-pass" className="text-xs text-zinc-400">
                    New password (optional)
                  </Label>
                  <Input
                    id="sec-pass"
                    type="password"
                    value={secPass}
                    onChange={(e) => setSecPass(e.target.value)}
                    placeholder="keep current"
                    autoComplete="new-password"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
            {secMsg && (
              <div
                className={`rounded px-3 py-2 text-xs leading-4 ${
                  secMsg.ok ? "bg-emerald-900/30 text-emerald-300" : "bg-rose-950/50 text-rose-300"
                }`}
              >
                {secMsg.text}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={saveSecurity} disabled={secBusy || !secCurrent} className={btnPrimary}>
                {secBusy ? "Saving…" : "Update login"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <Separator className="bg-zinc-800" />
      </DialogContent>
    </Dialog>
  );
}
