import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOverallAdmin } from "@/lib/auth";
import { parseAccess, accountView, accountSelect } from "@/lib/accounts";

// Change an admin login's site access / association. Body: { sssAccess, pppAccess, associationId }
// Your own account can't be changed here, so you can't lock yourself out.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireOverallAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (id === admin.id) return NextResponse.json({ error: "You can't change your own account" }, { status: 400 });
  const access = parseAccess(await req.json().catch(() => ({})));
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: 400 });

  const { count } = await prisma.user.updateMany({ where: { id, role: "ADMIN" }, data: access });
  if (count === 0) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  // Sign them out everywhere, so the new access applies right away.
  await prisma.session.deleteMany({ where: { userId: id } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: accountSelect });
  return NextResponse.json({ account: accountView(user, admin.id) });
}

// Delete an admin login (sessions and invite token cascade).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireOverallAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (id === admin.id) return NextResponse.json({ error: "You can't delete your own account" }, { status: 400 });
  const { count } = await prisma.user.deleteMany({ where: { id, role: "ADMIN" } });
  if (count === 0) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
