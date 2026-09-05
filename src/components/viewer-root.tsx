"use client";

/**
 * Client shell for the viewer app. Server Components can't use
 * `next/dynamic` with ssr:false, so the (session-checked) server page
 * renders this wrapper which lazily mounts the Cornerstone-based viewer.
 */
import dynamic from "next/dynamic";

const DicomViewer = dynamic(() => import("@/components/dicom-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[100dvh] w-full items-center justify-center bg-zinc-950">
      <div className="text-sm text-zinc-500">Loading DICOM Viewer…</div>
    </div>
  ),
});

export default function ViewerRoot() {
  return <DicomViewer />;
}
