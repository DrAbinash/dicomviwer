import { NextRequest, NextResponse } from "next/server";
import {
  getGatewayConfig,
  setSetting,
  deleteSetting,
  getSettings,
} from "@/lib/server/config";
import { trySystemInfo, listModalities, type ModalityConfig } from "@/lib/server/orthanc";
import { requireSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/gateway — gateway status + registered DICOM modalities. */
export async function GET(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;
  const cfg = await getGatewayConfig();
  const s = await getSettings(["gatewayUrl", "gatewayUsername", "gatewayAet"]);
  const sys = cfg ? await trySystemInfo() : null;

  let modalities: Record<string, ModalityConfig> = {};
  if (sys?.ok) {
    try {
      modalities = await listModalities();
    } catch {
      /* unreachable gateway — empty list */
    }
  }

  return NextResponse.json({
    configured: !!cfg,
    url: cfg?.base ?? "",
    username: s.gatewayUsername ?? "",
    gatewayAet: cfg?.gatewayAet ?? "",
    source: cfg?.source ?? null,
    reachable: !!sys?.ok,
    system: sys?.ok
      ? {
          name: sys.info.Name ?? "Orthanc",
          version: sys.info.Version ?? "",
          dicomAet: sys.info.DicomAet ?? "",
          dicomPort: sys.info.DicomPort ?? null,
        }
      : null,
    error: sys && !sys.ok ? sys.error : null,
    modalities: Object.entries(modalities).map(([id, m]) => ({
      id,
      aet: m.AET,
      host: m.Host,
      port: m.Port,
    })),
  });
}

/**
 * PUT /api/gateway — save gateway connection settings from the Settings
 * dialog. Password omitted = keep existing; empty string = clear.
 */
export async function PUT(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = String(body.url ?? "").trim().replace(/\/+$/, "");
  const username = String(body.username ?? "").trim();
  const password = body.password == null ? null : String(body.password);
  const gatewayAet = String(body.gatewayAet ?? "").trim().toUpperCase();

  if (!url) return NextResponse.json({ error: "Gateway URL is required." }, { status: 400 });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Gateway URL must be a valid URL, e.g. http://192.168.1.50:8042" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Gateway URL must start with http:// or https://" }, { status: 400 });
  }
  if (gatewayAet && !/^[A-Z0-9 _-]{1,16}$/.test(gatewayAet)) {
    return NextResponse.json(
      { error: "Gateway AE Title must be 1-16 characters: A-Z, 0-9, space, dash or underscore." },
      { status: 400 }
    );
  }

  await setSetting("gatewayUrl", url);
  await setSetting("gatewayUsername", username);
  if (password === "") {
    await deleteSetting("gatewayPassword");
  } else if (password != null && password.length > 0) {
    await setSetting("gatewayPassword", password);
  }
  if (gatewayAet) await setSetting("gatewayAet", gatewayAet);

  // Immediately probe the gateway so the user gets instant feedback.
  const cfg = await getGatewayConfig();
  const sys = cfg ? await trySystemInfo() : null;
  return NextResponse.json({
    ok: true,
    reachable: !!sys?.ok,
    system: sys?.ok
      ? {
          name: sys.info.Name ?? "Orthanc",
          version: sys.info.Version ?? "",
          dicomAet: sys.info.DicomAet ?? "",
          dicomPort: sys.info.DicomPort ?? null,
        }
      : null,
    error: sys && !sys.ok ? sys.error : null,
  });
}
