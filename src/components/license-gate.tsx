"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KeyRound, ShieldAlert, ShieldCheck, Clock, RefreshCw } from "lucide-react";

/**
 * Full-screen activation gate rendered by the root layout whenever the
 * license is not "valid". This is what a trial customer sees when the trial
 * is missing, expired, or locked - the rest of the app is not rendered at
 * all, so there is nothing to bypass.
 */

interface LicenseStatus {
  state: "valid" | "none" | "expired" | "invalid" | "locked";
  name?: string;
  exp?: string;
  edition?: string;
  typ?: "trial" | "perpetual";
  daysLeft?: number;
  message: string;
}

const TONE: Record<LicenseStatus["state"], { icon: typeof Clock; cls: string }> = {
  valid: { icon: ShieldCheck, cls: "text-emerald-400" },
  none: { icon: KeyRound, cls: "text-zinc-300" },
  expired: { icon: Clock, cls: "text-red-400" },
  invalid: { icon: ShieldAlert, cls: "text-red-400" },
  locked: { icon: ShieldAlert, cls: "text-amber-400" },
};

export default function LicenseGate({ status }: { status: LicenseStatus }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [current, setCurrent] = useState(status);
  const Icon = TONE[current.state]?.icon ?? KeyRound;
  const tone = TONE[current.state]?.cls ?? "text-zinc-300";

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        license?: LicenseStatus;
      };
      if (res.ok && data.ok && data.license) {
        setCurrent(data.license);
        const l = data.license;
        setDone(
          l.typ === "perpetual"
            ? `Perpetual license activated for ${l.name}.`
            : `Trial activated for ${l.name} - valid until ${l.exp}.`
        );
        setTimeout(() => window.location.reload(), 1600);
      } else {
        setError(data.error || "Activation failed.");
        if (data.license) setCurrent(data.license);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Activation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <Card className="w-full max-w-lg border-zinc-800 bg-zinc-900">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-800">
            <Icon className={`h-7 w-7 ${tone}`} aria-hidden />
          </div>
          <CardTitle className="text-xl text-zinc-100">DICOM Viewer - License</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {done ? (
            <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 text-sm text-emerald-300">
              {done} Reloading...
            </div>
          ) : (
            <>
              <p
                className={`rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm ${
                  current.state === "expired" || current.state === "invalid"
                    ? "text-red-300"
                    : current.state === "locked"
                      ? "text-amber-300"
                      : "text-zinc-300"
                }`}
              >
                {current.message}
              </p>

              <div className="space-y-2">
                <label
                  htmlFor="license-key"
                  className="text-sm font-medium text-zinc-300"
                >
                  License key
                </label>
                <Input
                  id="license-key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Paste the key you received (one line)"
                  className="border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-200"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="text-xs text-zinc-500">
                  The key looks like <span className="font-mono">eyJ....-signature</span> and
                  encodes the licensed site and expiry date. Your studies are kept while the
                  software is locked.
                </p>
              </div>

              {error && (
                <p className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
                  {error}
                </p>
              )}

              <Button
                onClick={activate}
                disabled={busy || key.trim().length < 20}
                className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
              >
                {busy ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Verifying...
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-2 h-4 w-4" aria-hidden /> Activate license
                  </>
                )}
              </Button>

              <p className="text-center text-xs text-zinc-600">
                DICOM Viewer - self-hosted PACS viewer - licensing support: your supplier.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
