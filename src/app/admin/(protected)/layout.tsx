import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireSss, isOverallAdmin } from "@/lib/auth";
import { siteOrigin } from "@/lib/site";
import SiteNav, { type NavLink } from "@/components/SiteNav";

// The SSS admin (snack system, Stress only) on snacks.51vo.nl. Wraps every page
// under /admin/* and enforces an SSS login server-side — the page HTML is never
// sent to anyone else. The bar system has its own admin on the PPP site.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireSss();

  if (!admin) {
    redirect("/admin/login");
  }

  const overall = isOverallAdmin(admin);
  const footer: NavLink[] = [{ href: "/", label: "Kiosk", icon: "🖥️" }];
  if (admin.pppAccess) {
    footer.push({ href: `${siteOrigin("ppp", (await headers()).get("host"))}/ppp/admin`, label: "PPP admin ↗", icon: "🍺", external: true });
  }

  return (
    <div className="flex min-h-screen bg-gray-950 text-white">
      <SiteNav
        title="SSS Admin"
        subtitle="Stress Snack System"
        accent="blue"
        home="/admin"
        loginPath="/admin/login"
        sections={[
          {
            title: null,
            links: [
              { href: "/admin", label: "Dashboard", icon: "📊" },
              { href: "/admin/members", label: "Members", icon: "👥" },
              { href: "/admin/products", label: "Products", icon: "🍫" },
              { href: "/admin/invoices", label: "Invoices", icon: "🧾" },
            ],
          },
          ...(overall ? [{ title: "System", links: [{ href: "/admin/accounts", label: "Accounts", icon: "🔑" }] }] : []),
        ]}
        footer={footer}
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
