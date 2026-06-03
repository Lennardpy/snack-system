import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

// This layout wraps every page under /admin/* and enforces authentication
// server-side — meaning even the page HTML is never sent to unauthenticated users.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();

  if (!admin) {
    redirect("/admin/login");
  }

  return <>{children}</>;
}
