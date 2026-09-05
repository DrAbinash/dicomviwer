import { NextRequest, NextResponse } from "next/server";
import { getGatewayConfig, basicAuth } from "@/lib/server/config";

/**
 * DICOMweb proxy toward Orthanc.
 *
 * The browser talks only to this route (/api/pacs/...); the route forwards to
 * `${gateway}/dicom-web/...` with basic-auth credentials. This removes CORS
 * entirely and keeps gateway credentials out of client code.
 *
 * Gateway connection comes from getGatewayConfig(): Settings-UI values stored
 * in the app database first, deployment environment (ORTHANC_URL /
 * ORTHANC_USERNAME / ORTHANC_PASSWORD from deploy/docker-compose.yml) as
 * fallback.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function proxy(req: NextRequest, path: string[]) {
  // Special endpoint: reports whether the gateway is configured (no proxying).
  if (path.length === 1 && path[0] === "health") {
    const cfg = await getGatewayConfig();
    return NextResponse.json({ configured: !!cfg });
  }

  const cfg = await getGatewayConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          "DICOM gateway not configured. Open Settings and set the Orthanc gateway URL (or set ORTHANC_URL in the deployment environment).",
        configured: false,
      },
      { status: 501 }
    );
  }

  const incoming = new URL(req.url);

  // QIDO-RS/WADO-RS live under /dicom-web/, but WADO-URI is served at the
  // plugin's WadoRoot (default /wado in deploy/orthanc.json) - not nested.
  const wadoRoot = process.env.ORTHANC_WADO_ROOT || "/wado";
  const target =
    path[0] === "wado"
      ? `${cfg.base}${wadoRoot}${incoming.search}`
      : `${cfg.base}/dicom-web/${path.map(encodeURIComponent).join("/")}${incoming.search}`;

  const headers: Record<string, string> = {
    Authorization: basicAuth(cfg),
    Accept: req.headers.get("accept") || "*/*",
  };

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    // @ts-expect-error - duplex is required for streaming request bodies
    duplex: "half",
  });

  const resHeaders = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) resHeaders.set("content-type", ct);
  const cl = upstream.headers.get("content-length");
  if (cl) resHeaders.set("content-length", cl);

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path || []);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path || []);
}
