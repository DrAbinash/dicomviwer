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
import {
  createServer,
  deleteServer,
  getGatewayInfo,
  listServers,
  saveGatewaySettings,
  testServer,
  updateServer,
  type GatewayInfo,
  type PacsServerInfo,
} from "@/lib/viewer/pacs";

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

  const refresh = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [g, s] = await Promise.all([getGatewayInfo(), listServers()]);
      setGateway(g);
      setServers(s);
      setGwUrl(g.url);
      setGwUser(g.username);
      setGwAet(g.gatewayAet);
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
      refresh();
    }
  }, [open, refresh]);

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
          <TabsList className="grid w-full grid-cols-2 bg-zinc-900">
            <TabsTrigger value="pacs" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-teal-300">
              PACS servers
            </TabsTrigger>
            <TabsTrigger value="gateway" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-teal-300">
              Gateway
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
        </Tabs>

        <Separator className="bg-zinc-800" />
      </DialogContent>
    </Dialog>
  );
}
