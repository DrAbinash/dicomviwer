import type { Metadata, Viewport } from "next";
import "./globals.css";
import LicenseGate from "@/components/license-gate";
import { getLicenseStatus } from "@/lib/server/license";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "DICOM Viewer",
  description:
    "Self-hosted web DICOM viewer - pull studies from your PACS and read them anywhere. RadiAnt-inspired, deployable on Synology NAS.",
  applicationName: "DICOM Viewer",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DICOM Viewer",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#09090b",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Trial/licensing gate: with no valid license the app is never rendered -
  // only the activation screen (see src/lib/server/license.ts).
  const license = getLicenseStatus();
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        {license.state === "valid" ? children : <LicenseGate status={license} />}
      </body>
    </html>
  );
}
