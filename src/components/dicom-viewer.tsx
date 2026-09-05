"use client";

/**
 * DICOM Viewer - top-level client composition.
 * Header actions, thumbnail rail, viewport, toolbar, PACS dialog.
 * Files come from: drag & drop, file picker, bundled sample study, or PACS.
 */
import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useViewerStore } from "@/lib/viewer/store";
import {
  parseDicomBuffer,
  groupIntoStudies,
  type ParsedFile,
} from "@/lib/viewer/loader";
import { ensureCornerstone } from "@/lib/viewer/init";
import { cn } from "@/lib/utils";

const Viewport = dynamic(() => import("./viewer/viewport"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-black text-xs text-zinc-600">
      initialising renderer…
    </div>
  ),
});
const ThumbnailRail = dynamic(() => import("./viewer/thumbnail-rail"), { ssr: false });
const Toolbar = dynamic(() => import("./viewer/toolbar"), { ssr: false });
const PacsDialog = dynamic(() => import("./viewer/pacs-dialog"), { ssr: false });
const SettingsDialog = dynamic(() => import("./viewer/settings-dialog"), { ssr: false });

const SAMPLE_COUNT = 30;

export default function DicomViewer() {
  const addStudies = useViewerStore((s) => s.addStudies);
  const setActiveStudy = useViewerStore((s) => s.setActiveStudy);
  const loading = useViewerStore((s) => s.loading);
  const setLoading = useViewerStore((s) => s.setLoading);
  const error = useViewerStore((s) => s.error);
  const setError = useViewerStore((s) => s.setError);
  const sidebarOpen = useViewerStore((s) => s.sidebarOpen);
  const toggleSidebar = useViewerStore((s) => s.toggleSidebar);
  const studyCount = useViewerStore((s) => s.studies.length);

  const [pacsOpen, setPacsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ingestFiles = useCallback(
    (files: File[]) => {
      setError(null);
      const dcmFiles = files.filter(
        (f) => f.name.toLowerCase().endsWith(".dcm") || f.type === "application/dicom"
      );
      if (dcmFiles.length === 0) {
        setError("No DICOM files found. Supported: .dcm (Part-10) files.");
        return;
      }
      setLoading({ active: true, label: "Parsing DICOM…", done: 0, total: dcmFiles.length });

      // Parse asynchronously in chunks to keep the UI responsive.
      (async () => {
        const parsed: ParsedFile[] = [];
        const CHUNK = 8;
        for (let i = 0; i < dcmFiles.length; i += CHUNK) {
          const slice = dcmFiles.slice(i, i + CHUNK);
          const results = await Promise.all(
            slice.map(async (f) => {
              const buf = await f.arrayBuffer();
              try {
                return parseDicomBuffer(buf, f);
              } catch {
                return null;
              }
            })
          );
          for (const r of results) if (r) parsed.push(r);
          setLoading({
            active: true,
            label: "Parsing DICOM…",
            done: Math.min(i + CHUNK, dcmFiles.length),
            total: dcmFiles.length,
          });
        }

        if (parsed.length === 0) {
          setError("Files could not be parsed as DICOM Part-10.");
          setLoading({ active: false, label: "" });
          return;
        }

        const studies = groupIntoStudies(parsed);
        addStudies(studies);
        setActiveStudy(studies[0].studyUid);
        setLoading({ active: false, label: "" });
      })();
    },
    [addStudies, setActiveStudy, setError, setLoading]
  );

  const loadSample = useCallback(async () => {
    setError(null);
    setLoading({ active: true, label: "Fetching sample study…", done: 0, total: SAMPLE_COUNT });
    try {
      await ensureCornerstone();
      const files: File[] = [];
      for (let i = 1; i <= SAMPLE_COUNT; i++) {
        const res = await fetch(`/samples/phantom-ct/I${String(i).padStart(3, "0")}.dcm`);
        if (!res.ok) throw new Error(`Sample fetch failed (${res.status})`);
        const blob = await res.blob();
        files.push(new File([blob], `I${String(i).padStart(3, "0")}.dcm`, { type: "application/dicom" }));
        setLoading({
          active: true,
          label: "Fetching sample study…",
          done: i,
          total: SAMPLE_COUNT,
        });
      }
      ingestFiles(files);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sample load failed");
      setLoading({ active: false, label: "" });
    }
  }, [ingestFiles, setError, setLoading]);

  const progressPct =
    loading.total > 0 ? Math.round((loading.done / loading.total) * 100) : 0;

  return (
    <div
      className="flex h-[100dvh] w-full flex-col overflow-hidden bg-zinc-950 text-zinc-200"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        ingestFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {/* header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3">
        <button
          onClick={toggleSidebar}
          title="Toggle series panel"
          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <span className="text-base leading-none">☰</span>
        </button>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-wide text-teal-400">
            DICOM<span className="text-zinc-200">Viewer</span>
          </span>
          <span className="hidden text-[10px] text-zinc-600 sm:inline">
            v0.2 · Cornerstone3D
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".dcm,application/dicom"
            className="hidden"
            onChange={(e) => {
              ingestFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="h-8 border-zinc-700 px-2 text-xs text-zinc-300 hover:bg-zinc-800 sm:px-3"
          >
            <span className="sm:hidden">Files</span>
            <span className="hidden sm:inline">Open files</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={loadSample}
            className="h-8 border-zinc-700 px-2 text-xs text-zinc-300 hover:bg-zinc-800 sm:px-3"
          >
            <span className="sm:hidden">Demo</span>
            <span className="hidden sm:inline">Sample study</span>
          </Button>
          <Button
            size="sm"
            onClick={() => setPacsOpen(true)}
            className="h-8 bg-teal-600 px-2 text-xs text-white hover:bg-teal-500 sm:px-3"
          >
            PACS
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSettingsOpen(true)}
            title="Settings — gateway & PACS servers"
            className="h-8 border-zinc-700 px-2 text-xs text-zinc-300 hover:bg-zinc-800 sm:px-3"
          >
            <SettingsIcon className="h-3.5 w-3.5 sm:mr-1" />
            <span className="hidden sm:inline">Settings</span>
          </Button>
        </div>
      </header>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        {/* thumbnail rail */}
        <aside
          className={cn(
            "shrink-0 border-r border-zinc-800 bg-zinc-950 transition-all duration-200",
            sidebarOpen ? "w-36 sm:w-40" : "w-0 overflow-hidden border-r-0"
          )}
        >
          <ThumbnailRail />
        </aside>

        {/* viewport */}
        <main className="relative min-w-0 flex-1">
          <Viewport />

          {/* empty state */}
          {studyCount === 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <div className="text-4xl text-zinc-800">⌗</div>
              <div className="text-sm text-zinc-500">
                Drag &amp; drop DICOM files here, open local files,
                <br className="hidden sm:block" /> load the sample study, or query
                your PACS.
              </div>
            </div>
          )}

          {/* drag hint */}
          {dragOver && (
            <div className="absolute inset-0 flex items-center justify-center border-2 border-dashed border-teal-500/70 bg-teal-500/10 text-sm text-teal-300">
              Drop DICOM files to load
            </div>
          )}

          {/* progress */}
          {loading.active && (
            <div className="absolute inset-x-0 top-0 z-10 bg-zinc-950/90 px-4 py-2 text-xs text-zinc-300 backdrop-blur">
              <div className="mb-1 flex justify-between">
                <span>{loading.label}</span>
                <span className="text-teal-300">
                  {loading.done}/{loading.total || "?"}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded bg-zinc-800">
                <div
                  className="h-full bg-teal-500 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* error */}
          {error && (
            <div className="absolute inset-x-4 top-12 z-10 mx-auto max-w-md rounded border border-amber-700/50 bg-amber-950/90 px-3 py-2 text-xs leading-4 text-amber-200 backdrop-blur">
              <div className="flex items-start justify-between gap-2">
                <span>{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="shrink-0 text-amber-400 hover:text-amber-200"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* toolbar */}
      <Toolbar />

      <PacsDialog
        open={pacsOpen}
        onOpenChange={setPacsOpen}
        onFiles={ingestFiles}
        onProgress={(p) => setLoading({ active: p.total > 0, label: `Retrieving ${p.label}…`, done: p.done, total: p.total })}
        onOpenSettings={() => {
          setPacsOpen(false);
          setSettingsOpen(true);
        }}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
