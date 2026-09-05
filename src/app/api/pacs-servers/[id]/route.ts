import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateServerInput, registerWithGateway, unregisterFromGateway } from "@/lib/server/pacs-server";
import { requireSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/pacs-servers/[id] — update a PACS connection. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const denied = await requireSession(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const v = validateServerInput(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const { name, aeTitle, host, port, notes } = v.data;

  const existing = await db.pacsServer.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "PACS server not found" }, { status: 404 });

  if (existing.aeTitle !== aeTitle) {
    const dup = await db.pacsServer.findUnique({ where: { aeTitle } });
    if (dup) {
      return NextResponse.json(
        { error: `A PACS server with AE Title "${aeTitle}" already exists.` },
        { status: 409 }
      );
    }
  }

  try {
    const server = await db.pacsServer.update({
      where: { id },
      data: {
        name,
        aeTitle,
        host,
        port,
        notes,
        // reset test state until retested
        lastStatus: null,
        lastTestAt: null,
      },
    });
    if (existing.aeTitle !== aeTitle) await unregisterFromGateway(existing.aeTitle);
    const reg = await registerWithGateway(aeTitle, host, port);
    return NextResponse.json({ server, registered: reg.registered, registeredError: reg.error });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update PACS server";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/pacs-servers/[id] — remove a PACS connection. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const denied = await requireSession(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const existing = await db.pacsServer.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "PACS server not found" }, { status: 404 });

  await unregisterFromGateway(existing.aeTitle);
  await db.pacsServer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
