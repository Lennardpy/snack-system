"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";

// The sidebar of an admin site. The SSS admin and the PPP admin each pass their
// own branding and menu, so the two read as separate systems.

export interface NavLink {
  href: string;
  label: string;
  icon: string;
  external?: boolean; // full URL on the other site (plain <a>)
}
export interface NavSection {
  title: string | null;
  links: NavLink[];
}

export default function SiteNav({
  title,
  subtitle,
  logo = "/stress-logo.svg",
  badge,
  accent,
  home,
  sections,
  footer,
  loginPath,
}: {
  title: string;
  subtitle: string;
  logo?: string; // path in /public; Stress's logo unless the login is another association's
  badge?: string | null; // e.g. the association a PPP login works for
  accent: "blue" | "amber";
  home: string; // the dashboard link (exact-match active state)
  sections: NavSection[];
  footer: NavLink[];
  loginPath: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push(loginPath);
  }

  const activeClass = accent === "amber" ? "bg-amber-600 text-white" : "bg-blue-600 text-white";
  const linkClass =
    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-gray-300 hover:bg-gray-800 hover:text-white";

  return (
    <aside className="sticky top-0 flex h-screen w-60 flex-shrink-0 flex-col overflow-y-auto border-r border-gray-800 bg-gray-900 p-4">
      <div className="mb-8 flex items-center gap-3 px-2 pt-2">
        <Image src={logo} alt="" width={36} height={36} priority className="select-none rounded object-contain" />
        <div className="leading-tight">
          <p className="font-bold">{title}</p>
          <p className="text-xs text-gray-500">{subtitle}</p>
          {badge && (
            <span className="mt-1 inline-block rounded-full bg-teal-900/60 px-2 py-0.5 text-[10px] font-semibold text-teal-300">
              {badge}
            </span>
          )}
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {sections.map((section) => (
          <div key={section.title ?? "main"} className={section.title ? "mt-4" : ""}>
            {section.title && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                {section.title}
              </p>
            )}
            {section.links.map((link) => {
              const active = link.href === home ? pathname === home : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={active ? `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${activeClass}` : linkClass}
                >
                  <span className="text-lg">{link.icon}</span>
                  {link.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 pt-4">
        {footer.map((link) =>
          link.external ? (
            <a key={link.href} href={link.href} className={`${linkClass} text-gray-400`}>
              <span className="text-lg">{link.icon}</span> {link.label}
            </a>
          ) : (
            <Link key={link.href} href={link.href} className={`${linkClass} text-gray-400`}>
              <span className="text-lg">{link.icon}</span> {link.label}
            </Link>
          )
        )}
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
