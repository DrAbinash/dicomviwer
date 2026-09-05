"use client";

/**
 * "?" dialog listing every keyboard shortcut. The list is generated from the
 * same data-driven map the key handler uses (lib/viewer/shortcuts.ts), so it
 * can never drift from actual behaviour.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildShortcuts } from "@/lib/viewer/shortcuts";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export default function ShortcutsDialog({ open, onOpenChange }: Props) {
  const defs = buildShortcuts();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-200 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-teal-300">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-zinc-500">
            Horos/RadiAnt-style hotkeys. Number keys pick tools, Alt+number picks layouts.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-zinc-900 text-xs">
          {defs.map((d) => (
            <li key={`${d.keys}-${d.label}`} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-zinc-400">{d.label}</span>
              <kbd className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-teal-300">
                {d.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
