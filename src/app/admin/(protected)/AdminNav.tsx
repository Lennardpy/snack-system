"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";

const SECTIONS: { title: string | null; links: { href: string; label: string; icon: string }[] }[] = [
  {
    title: null,
    links: [
      { href: "/admin", label: "Dashboard", icon: "📊" },
      { href: "/admin/members", label: "Members", icon: "👥" },
      { href: "/admin/products", label: "Products", icon: "🍫" },
      { href: "/admin/invoices", label: "Invoices", icon: "🧾" },
    ],
  },
  {
    title: "PPP — Bar",
    links: [
      { href: "/admin/ppp/dashboard", label: "Dashboard", icon: "📊" },
      { href: "/admin/ppp/products", label: "Drinks", icon: "🍺" },
      { href: "/admin/ppp/activities", label: "Activities", icon: "📅" },
      { href: "/admin/ppp/invoices", label: "Invoices", icon: "🧾" },
      { href: "/admin/ppp/roles", label: "Member roles", icon: "🎟️" },
      { href: "/admin/ppp/sbz", label: "SBZ prices", icon: "🧾" },
      { href: "/admin/ppp/bartenders", label: "Bartenders", icon: "🧑‍🍳" },
    ],
  },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin/login");
  }

  return (
    <aside className="sticky top-0 flex h-screen w-60 flex-shrink-0 flex-col border-r border-gray-800 bg-gray-900 p-4">
      <div className="mb-8 flex items-center gap-3 px-2 pt-2">
        <Image src="/stress-logo.svg" alt="Stress" width={36} height={36} priority className="select-none" />
        <div className="leading-tight">
          <p className="font-bold">SSS Admin</p>
          <p className="text-xs text-gray-500">Stress Snack System</p>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {SECTIONS.map((section) => (
          <div key={section.title ?? "main"} className={section.title ? "mt-4" : ""}>
            {section.title && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                {section.title}
              </p>
            )}
            {section.links.map((link) => {
              const active =
                link.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-blue-600 text-white"
                      : "text-gray-300 hover:bg-gray-800 hover:text-white"
                  }`}
                >
                  <span className="text-lg">{link.icon}</span>
                  {link.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        >
          <span className="text-lg">🖥️</span> Kiosk
        </Link>
        <Link
          href="/ppp"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        >
          <span className="text-lg">🍺</span> PPP POS
        </Link>
        <button
          onClick={logout}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-red-300"
        >
          <span className="text-lg">↩︎</span> Log out
        </button>
      </div>
    </aside>
  );
}
