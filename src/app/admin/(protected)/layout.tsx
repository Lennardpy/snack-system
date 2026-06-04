import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import AdminNav from "./AdminNav";

// This layout wraps every page under /admin/* and enforces authentication
// server-side — meaning even the page HTML is never sent to unauthenticated users.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();

  if (!admin) {
    redirect("/admin/login");
  }

  return (
    <div className="flex min-h-screen bg-gray-950 text-white">
      <AdminNav />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
