import { NextRequest, NextResponse } from "next/server";

/**
 * DICOMweb proxy toward Orthanc.
 *
 * The browser talks only to this route (/api/pacs/...); the route forwards to
 * `${ORTHANC_URL}/dicom-web/...` with basic-auth credentials taken from the
 * server environment. This removes CORS entirely and keeps PACS gateway
 * credentials out of client code.
 *
 * Deployed via deploy/docker-compose.yml, which sets:
 *   ORTHANC_URL      e.g. http://orthanc:8042
 *   ORTHANC_USERNAME / ORTHANC_PASSWORD
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function upstreamConfig() {
  const url = process.env.ORTHANC_URL;
  if (!url) return null;
  const username = process.env.ORTHANC_USERNAME || "";
  const password = process.env.ORTHANC_PASSWORD || "";
  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  return { base: url.replace(/\/+$/, ""), auth };
}

async function proxy(req: NextRequest, path: string[]) {
  // Special endpoint: reports whether the gateway is configured (no proxying).
  if (path.length === 1 && path[0] === "health") {
    const cfg = upstreamConfig();
    return NextResponse.json({ configured: !!cfg });
  }

  const cfg = upstreamConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          "PACS gateway not configured. Set ORTHANC_URL (and credentials) in the deployment environment - see deploy/docker-compose.yml.",
        configured: false,
      },
      { status: 501 }
    );
  }

  const incoming = new URL(req.url);
  const target = `${cfg.base}/dicom-web/${path.map(encodeURIComponent).join("/")}${incoming.search}`;

  const headers: Record<string, string> = {
    Authorization: `Basic ${cfg.auth}`,
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
