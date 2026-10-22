import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requirePpp, isOverallAdmin } from "@/lib/auth";
import { siteOrigin } from "@/lib/site";
import { ASSOCIATION_LABEL } from "@/lib/associations";
import SiteNav, { type NavLink } from "@/components/SiteNav";

export const metadata: Metadata = { title: "PPP Admin" };

// The PPP admin (bar system, Stress and Dimensie) on ppp.51vo.nl. Wraps every
// page under /ppp/admin/* and enforces a PPP admin login server-side. A Stress or
// Dimensie login only sees its own association's data; the overall admin sees all.
export default async function PppAdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePpp();

  if (!ctx) {
    redirect("/ppp/login?from=/ppp/admin");
  }

  const { user, scope } = ctx;
  const overall = isOverallAdmin(user);
  // Things only the Stress side has (Dimensie can't see them).
  const stressSide = scope === null || scope === "stress";

  const footer: NavLink[] = [
    { href: "/ppp", label: "Bar POS", icon: "🍺" },
    { href: "/wallstreet", label: "Wall Street board", icon: "📈" },
  ];
  if (user.sssAccess) {
    footer.push({ href: `${siteOrigin("sss", (await headers()).get("host"))}/admin`, label: "SSS admin ↗", icon: "🍫", external: true });
  }

  return (
    <div className="flex min-h-screen bg-gray-950 text-white">
      <SiteNav
        title="PPP Admin"
        subtitle="Bar system"
        logo={scope === "dimensie" ? "/dimensie-logo.png" : "/stress-logo.svg"}
        badge={scope ? ASSOCIATION_LABEL[scope] : "All associations"}
        accent="amber"
        home="/ppp/admin/dashboard"
        loginPath="/ppp/login"
        sections={[
          {
            title: null,
            links: [
              { href: "/ppp/admin/dashboard", label: "Dashboard", icon: "📊" },
              { href: "/ppp/admin/activities", label: "Borrels", icon: "📅" },
              { href: "/ppp/admin/invoices", label: "Invoices", icon: "🧾" },
              { href: "/ppp/admin/members", label: "Members", icon: "👥" },
              { href: "/ppp/admin/roles", label: "Member roles", icon: "🎟️" },
              { href: "/ppp/admin/bartenders", label: "Bartenders", icon: "🧑‍🍳" },
            ],
          },
          {
            title: "Bar",
            links: [
              { href: "/ppp/admin/products", label: "Drinks", icon: "🍺" },
              ...(stressSide ? [{ href: "/ppp/admin/external-cards", label: "External cards", icon: "🏷️" }] : []),
              { href: "/ppp/admin/sbz", label: "SBZ prices", icon: "🧾" },
            ],
          },
          ...(overall ? [{ title: "System", links: [{ href: "/ppp/admin/accounts", label: "Accounts", icon: "🔑" }] }] : []),
        ]}
        footer={footer}
      />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
