"use client";

import dynamic from "next/dynamic";

const DicomViewer = dynamic(() => import("@/components/dicom-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[100dvh] w-full items-center justify-center bg-zinc-950">
      <div className="text-sm text-zinc-500">Loading DICOM Viewer…</div>
    </div>
  ),
});

export default function Home() {
  return <DicomViewer />;
}
