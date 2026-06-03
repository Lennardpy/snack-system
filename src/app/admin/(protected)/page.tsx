import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function AdminPage() {

  const [members, products, pendingInvoices] = await Promise.all([
    prisma.member.count(),
    prisma.product.count({ where: { published: true, archived: false } }),
    prisma.saleInvoice.count({ where: { status: "CONFIRMED" } }),
  ]);

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-1">SSS</h1>
      <p className="text-gray-600 text-xs mb-8">Stress Snack System</p>

      <div className="grid grid-cols-3 gap-4 mb-10">
        <Stat label="Members" value={members} />
        <Stat label="Published products" value={products} />
        <Stat label="Invoices pending export" value={pendingInvoices} highlight={pendingInvoices > 0} />
      </div>

      <div className="grid grid-cols-2 gap-4 max-w-lg">
        <NavCard href="/admin/members" label="Members" desc="View members, sync from Congressus" />
        <NavCard href="/admin/products" label="Products" desc="Add, edit, publish products" />
        <NavCard href="/admin/invoices" label="Invoices" desc="Review and export to Congressus" />
      </div>
    </main>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-5 ${highlight ? "bg-yellow-900/40 border border-yellow-700" : "bg-gray-800"}`}>
      <p className="text-gray-400 text-sm mb-1">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}

function NavCard({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <Link href={href} className="block bg-gray-800 hover:bg-gray-700 rounded-xl p-5 transition-colors">
      <p className="font-semibold mb-1">{label}</p>
      <p className="text-gray-400 text-sm">{desc}</p>
    </Link>
  );
}
