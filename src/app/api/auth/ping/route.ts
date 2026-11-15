import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// Keep-alive for an admin page that's in use without other requests (e.g. while
// filling in a form): reading the session slides its expiry. 401 once it ended.
export async function GET() {
  const session = await getSession();
  return NextResponse.json({ ok: !!session }, { status: session ? 200 : 401, headers: { "Cache-Control": "no-store" } });
}
