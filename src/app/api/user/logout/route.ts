import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { MEMBER_COOKIE } from "@/lib/member-auth";

// POST /api/user/logout — ends the member portal session.
export async function POST() {
  const token = (await cookies()).get(MEMBER_COOKIE)?.value;
  if (token) await prisma.memberSession.deleteMany({ where: { token } });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(MEMBER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
