import { NextResponse } from "next/server";
import { requireBartender } from "@/lib/auth";

// The logged-in bartender's own linked member (if any). The POS uses this to give
// the on-shift bartender their free drinks when they charge their own card.
export async function GET() {
  const user = await requireBartender();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ memberId: user.memberId ?? null });
}
