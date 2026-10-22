import { NextResponse } from "next/server";
import { requireBartender, isOverallAdmin } from "@/lib/auth";

// The logged-in PPP user: their own linked member (the POS uses it to give the
// on-shift bartender their free drinks when they charge their own card) and the
// association they work for (null = every association, the overall admin), which
// the PPP admin pages use to show the right options.
export async function GET() {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    memberId: user.memberId ?? null,
    role: user.role,
    associationId: user.associationId ?? null,
    overall: isOverallAdmin(user),
  });
}
