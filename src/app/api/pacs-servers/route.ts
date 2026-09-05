import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateServerInput, registerWithGateway } from "@/lib/server/pacs-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/pacs-servers — list user-configured PACS connections. */
export async function GET() {
  const servers = await db.pacsServer.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      aeTitle: true,
      host: true,
      port: true,
      notes: true,
      lastStatus: true,
      lastTestAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ servers });
}

/** POST /api/pacs-servers — add a PACS connection (IP / AE Title / Port). */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const v = validateServerInput(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const { name, aeTitle, host, port, notes } = v.data;

  const dup = await db.pacsServer.findUnique({ where: { aeTitle } });
  if (dup) {
    return NextResponse.json(
      { error: `A PACS server with AE Title "${aeTitle}" already exists.` },
      { status: 409 }
    );
  }

  try {
    const server = await db.pacsServer.create({
      data: { name, aeTitle, host, port, notes },
    });
    // Register as a DICOM modality on the gateway (best effort — user can
    // still save while the gateway is offline and retest later).
    const reg = await registerWithGateway(aeTitle, host, port);
    return NextResponse.json({ server, registered: reg.registered, registeredError: reg.error });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save PACS server";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
