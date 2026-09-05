"use client";

/**
 * Settings > Viewer tab: edit the server-stored window/level presets and the
 * viewer defaults (layout, cine, overlays, interpolation). Everything here is
 * persisted via /api/viewer-preferences and picked up by the toolbar/viewport -
 * no viewer behaviour is hardcoded anywhere else.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useViewerStore } from "@/lib/viewer/store";
import { LAYOUTS } from "@/lib/viewer/layouts";
import {
  fetchViewerPrefs,
  saveViewerPrefs,
  type ViewerPrefs,
} from "@/lib/viewer/preferences";

export default function ViewerTab() {
  const setPresets = useViewerStore((s) => s.setPresets);
  const [draft, setDraft] = useState<ViewerPrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetchViewerPrefs().then((p) => setDraft(p));
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    const ok = await saveViewerPrefs(draft);
    setBusy(false);
    if (ok) {
      setPresets(draft.presets);
      setMsg({ ok: true, text: "Saved — new sessions and the toolbar pick it up immediately." });
    } else {
      setMsg({ ok: false, text: "Save failed — is the server reachable?" });
    }
  }, [draft, setPresets]);

  if (!draft) {
    return <div className="text-xs text-zinc-500">Loading viewer preferences…</div>;
  }

  const updatePreset = (i: number, field: "name" | "ww" | "wc", value: string) => {
    setDraft((d) => {
      if (!d) return d;
      const presets = d.presets.map((p, j) => {
        if (j !== i) return p;
        if (field === "name") return { ...p, name: value };
        return { ...p, [field]: Number(value) || 0 };
      });
      return { ...d, presets };
    });
  };

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      {/* window presets */}
      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Window / level presets
        </div>
        <div className="space-y-1.5">
          {draft.presets.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={p.name}
                onChange={(e) => updatePreset(i, "name", e.target.value)}
                placeholder="Name"
                className="h-8 flex-1 border-zinc-800 bg-zinc-900 text-xs"
              />
              <Input
                type="number"
                value={p.ww}
                onChange={(e) => updatePreset(i, "ww", e.target.value)}
                title="Window width"
                className="h-8 w-20 border-zinc-800 bg-zinc-900 text-xs"
              />
              <Input
                type="number"
                value={p.wc}
                onChange={(e) => updatePreset(i, "wc", e.target.value)}
                title="Window center"
                className="h-8 w-20 border-zinc-800 bg-zinc-900 text-xs"
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-rose-300"
                title="Remove preset"
                onClick={() =>
                  setDraft((d) =>
                    d ? { ...d, presets: d.presets.filter((_, j) => j !== i) } : d
                  )
                }
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 h-7 border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800"
          onClick={() =>
            setDraft((d) =>
              d
                ? { ...d, presets: [...d.presets, { name: "New preset", ww: 400, wc: 40 }] }
                : d
            )
          }
        >
          + Add preset
        </Button>
      </div>

      {/* defaults */}
      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Viewer defaults (new sessions)
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="grid gap-1">
            <Label className="text-xs text-zinc-500">Default layout</Label>
            <select
              value={draft.defaults.layoutId}
              onChange={(e) =>
                setDraft((d) =>
                  d ? { ...d, defaults: { ...d.defaults, layoutId: e.target.value } } : d
                )
              }
              className="h-8 rounded border border-zinc-800 bg-zinc-900 px-1.5 text-xs text-zinc-300"
            >
              {LAYOUTS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-zinc-500">Default cine fps (1–60)</Label>
            <Input
              type="number"
              min={1}
              max={60}
              value={draft.defaults.cineFps}
              onChange={(e) =>
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        defaults: { ...d.defaults, cineFps: Number(e.target.value) || 15 },
                      }
                    : d
                )
              }
              className="h-8 border-zinc-800 bg-zinc-900 text-xs"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-zinc-500">Cine direction</Label>
            <select
              value={draft.defaults.cineDirection}
              onChange={(e) =>
                setDraft((d) =>
                  d
                    ? {
                        ...d,
                        defaults: {
                          ...d.defaults,
                          cineDirection: e.target.value as ViewerPrefs["defaults"]["cineDirection"],
                        },
                      }
                    : d
                )
              }
              className="h-8 rounded border border-zinc-800 bg-zinc-900 px-1.5 text-xs text-zinc-300"
            >
              <option value="forward">Forward →</option>
              <option value="backward">Backward ←</option>
              <option value="oscillate">Oscillate ⇄</option>
            </select>
          </div>
          <div className="flex flex-col justify-end gap-1.5 pb-1">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={draft.defaults.showOverlays}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          defaults: { ...d.defaults, showOverlays: e.target.checked },
                        }
                      : d
                  )
                }
                className="accent-teal-500"
              />
              Show text overlays
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={draft.defaults.smoothInterpolation}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          defaults: { ...d.defaults, smoothInterpolation: e.target.checked },
                        }
                      : d
                  )
                }
                className="accent-teal-500"
              />
              Smooth interpolation
            </label>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={save}
          disabled={busy}
          className="h-8 bg-teal-600 px-4 text-xs text-white hover:bg-teal-500"
        >
          {busy ? "Saving…" : "Save viewer settings"}
        </Button>
        {msg && (
          <span className={`text-xs ${msg.ok ? "text-emerald-400" : "text-rose-400"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
