"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useCardReader } from "@/lib/useCardReader";
import { activityDiscountedUnitPrice, activityUnitPrice, formatRoleDiscount } from "@/lib/roles";

interface Product {
  id: string;
  name: string;
  price: number;
  specialPrice: number | null;
  imageUrl: string | null;
  color: string | null;
  category: { id: string; name: string; sortOrder: number };
}

interface Activity {
  id: string;
  name: string;
  status: "OPEN" | "CLOSED";
  discountsActive: boolean;
  discounts: { productId: string; priceCents: number }[];
}

interface HistoryInvoice {
  id: string;
  totalCents: number;
  confirmedAt: string;
  member: { firstName: string; lastName: string };
  lines: { quantity: number; unitCents: number; product: { name: string } }[];
}

interface MemberRoleInfo {
  name: string;
  discountPercent: number;
  discountCents: number;
  color: string | null;
}
interface Customer {
  memberId: string;
  firstName: string;
  lastName: string;
  orderCount: number;
  roles: MemberRoleInfo[];
}
type MemberState =
  | { kind: "idle" }
  | { kind: "scanning" }
  | {
      kind: "found";
      id: string;
      firstName: string;
      lastName: string;
      roles: MemberRoleInfo[];
    }
  | { kind: "error"; message: string };

const WS_URL =
  process.env.NEXT_PUBLIC_PPP_CARD_READER_WS_URL ?? "ws://localhost:3000";
const ENV_MODE = process.env.NEXT_PUBLIC_PPP_CARD_READER_MODE === "ws" ? "ws" : "hid";

const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;

export default function PosPage() {
  const router = useRouter();
  const { activityId } = useParams<{ activityId: string }>();

  const [activity, setActivity] = useState<Activity | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeCat, setActiveCat] = useState<string>("all");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [member, setMember] = useState<MemberState>({ kind: "idle" });
  const [tab, setTab] = useState<"cart" | "history">("cart");
  const [history, setHistory] = useState<HistoryInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState("");

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const isOpen = activity?.status === "OPEN";

  // ── Data loading ────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [aRes, pRes] = await Promise.all([
        fetch(`/api/ppp/activities/${activityId}`),
        fetch("/api/ppp/products"),
      ]);
      if (aRes.ok) setActivity((await aRes.json()).activity);
      if (pRes.ok) setProducts((await pRes.json()).products);
    })();
  }, [activityId]);

  // Activity drink specials, keyed by product (only when discounts are active).
  const discountsActive = activity?.discountsActive ?? false;
  const specialMap = useMemo(
    () => new Map((activity?.discounts ?? []).map((d) => [d.productId, d.priceCents])),
    [activity]
  );
  const specialFor = useCallback(
    (productId: string): number | null => (discountsActive ? specialMap.get(productId) ?? null : null),
    [discountsActive, specialMap]
  );

  async function toggleSpecials() {
    if (!activity) return;
    const next = !activity.discountsActive;
    setActivity({ ...activity, discountsActive: next }); // optimistic
    await fetch(`/api/ppp/activities/${activityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discountsActive: next }),
    });
  }

  const loadHistory = useCallback(async () => {
    const [hRes, cRes] = await Promise.all([
      fetch(`/api/ppp/invoices?activityId=${activityId}`),
      fetch(`/api/ppp/activities/${activityId}/customers`),
    ]);
    if (hRes.ok) setHistory((await hRes.json()).invoices);
    if (cRes.ok) setCustomers((await cRes.json()).customers);
  }, [activityId]);

  // Poll order history + customers every 10s while on the page.
  useEffect(() => {
    loadHistory();
    const t = setInterval(loadHistory, 10_000);
    return () => clearInterval(t);
  }, [loadHistory]);

  // Pick a returning customer without scanning their card.
  const selectCustomer = (c: Customer) =>
    setMember({ kind: "found", id: c.memberId, firstName: c.firstName, lastName: c.lastName, roles: c.roles });

  // ── Card scanning ───────────────────────────────────────────────────────────
  const handleScan = useCallback(async (uid: string) => {
    setMember({ kind: "scanning" });
    try {
      const res = await fetch("/api/ppp/card/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid }),
      });
      const d = await res.json();
      if (res.ok) {
        setMember({
          kind: "found",
          id: d.memberId,
          firstName: d.firstName,
          lastName: d.lastName,
          roles: d.roles ?? [],
        });
      } else {
        setMember({ kind: "error", message: d.error ?? "Scan failed" });
      }
    } catch {
      setMember({ kind: "error", message: "Connection error" });
    }
  }, []);

  const { mode, wsStatus } = useCardReader({
    onScan: handleScan,
    wsUrl: WS_URL,
    envMode: ENV_MODE,
    enabled: isOpen && !confirming,
  });

  // ── Cart ops ────────────────────────────────────────────────────────────────
  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const dec = (id: string) =>
    setCart((c) => {
      const next = (c[id] ?? 0) - 1;
      const copy = { ...c };
      if (next <= 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });
  const clearCart = () => setCart({});

  const cartLines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ product: productById.get(id), qty }))
        .filter((l): l is { product: Product; qty: number } => !!l.product),
    [cart, productById]
  );
  const memberRoles = member.kind === "found" ? member.roles : [];
  // "Gross" = effective price (special if set) before role discounts; total = after.
  const grossCents = cartLines.reduce(
    (s, l) => s + activityUnitPrice(l.product, specialFor(l.product.id)) * l.qty,
    0
  );
  const totalCents = cartLines.reduce(
    (s, l) => s + activityDiscountedUnitPrice(l.product, specialFor(l.product.id), memberRoles) * l.qty,
    0
  );
  const hasDiscount = totalCents < grossCents;
  const itemCount = cartLines.reduce((s, l) => s + l.qty, 0);

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  async function confirmOrder() {
    if (member.kind !== "found" || cartLines.length === 0) return;
    setConfirming(true);
    const res = await fetch("/api/ppp/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberId: member.id,
        activityId,
        lines: cartLines.map((l) => ({ productId: l.product.id, quantity: l.qty })),
      }),
    });
    setConfirming(false);
    if (res.ok) {
      flashToast(`Charged ${member.firstName} ${euro(totalCents)}`);
      setCart({});
      setMember({ kind: "idle" });
      loadHistory();
    } else {
      const d = await res.json();
      flashToast(d.error ?? "Could not confirm order");
    }
  }

  // ── Category tabs ───────────────────────────────────────────────────────────
  const categories = useMemo(() => {
    const map = new Map<string, { id: string; name: string; sortOrder: number }>();
    for (const p of products) map.set(p.category.id, p.category);
    return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [products]);

  const visible = activeCat === "all" ? products : products.filter((p) => p.category.id === activeCat);

  const memberRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/ppp")}
            className="text-gray-400 hover:text-white"
            aria-label="Back to activities"
          >
            ←
          </button>
          <h1 className="font-bold">{activity?.name ?? "…"}</h1>
          {activity && !isOpen && (
            <span className="rounded-full bg-gray-700/40 px-2 py-0.5 text-xs text-gray-400">
              Closed
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {/* Specials toggle — bartenders flip this off when a special runs out. */}
          {specialMap.size > 0 && (
            <button
              onClick={toggleSpecials}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                discountsActive ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-400"
              }`}
              title="Toggle the borrel's drink specials"
            >
              <span className={`h-2.5 w-2.5 rounded-full ${discountsActive ? "bg-white" : "bg-gray-500"}`} />
              Specials {discountsActive ? "ON" : "OFF"}
            </button>
          )}
          <div className="flex items-center gap-2 text-xs text-gray-500">
          {mode === "hid" ? (
            <>
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Ready to scan
            </>
          ) : (
            <>
              <span
                className={`h-2 w-2 rounded-full ${
                  wsStatus === "connected"
                    ? "bg-green-500"
                    : wsStatus === "connecting"
                    ? "animate-pulse bg-yellow-500"
                    : "bg-red-500"
                }`}
              />
              {wsStatus === "connected" ? "Reader connected" : wsStatus === "connecting" ? "Connecting…" : "Reader offline"}
            </>
          )}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: products */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap gap-2.5 border-b border-gray-800 px-5 py-4">
            <CatPill active={activeCat === "all"} onClick={() => setActiveCat("all")}>
              All
            </CatPill>
            {categories.map((c) => (
              <CatPill key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)}>
                {c.name}
              </CatPill>
            ))}
          </div>
          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-4 overflow-y-auto p-5 sm:grid-cols-3 lg:grid-cols-4">
            {visible.length === 0 ? (
              <p className="col-span-full text-base text-gray-500">
                No published drinks. Add some under Admin → PPP Products.
              </p>
            ) : (
              visible.map((p) => {
                const colored = !!p.color;
                const effective = activityUnitPrice(p, specialFor(p.id));
                const isSpecial = effective !== p.price;
                const onBorrelSpecial = specialFor(p.id) != null;
                return (
                  <button
                    key={p.id}
                    onClick={() => add(p.id)}
                    disabled={!isOpen}
                    style={p.color ? { backgroundColor: p.color } : undefined}
                    className={`relative flex min-h-[7rem] flex-col items-center justify-center rounded-2xl border p-4 text-center shadow-sm transition-transform active:scale-95 disabled:opacity-40 ${
                      colored
                        ? "border-white/15 text-white hover:brightness-110"
                        : "border-gray-800 bg-gray-900 hover:border-amber-600"
                    }`}
                  >
                    {onBorrelSpecial && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-black">
                        SPECIAL
                      </span>
                    )}
                    <span className="text-xl font-bold leading-tight">{p.name}</span>
                    {isSpecial ? (
                      <span className="mt-2 flex items-baseline gap-1.5 text-base">
                        <span className={colored ? "text-white/60 line-through" : "text-gray-500 line-through"}>
                          {euro(p.price)}
                        </span>
                        <span className={colored ? "font-bold text-white" : "font-bold text-amber-400"}>
                          {euro(effective)}
                        </span>
                      </span>
                    ) : (
                      <span className={`mt-2 text-base ${colored ? "text-white/90" : "text-gray-400"}`}>
                        {euro(p.price)}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Regulars — tap to charge without scanning, most orders first */}
          {customers.length > 0 && (
            <div className="border-t border-gray-800 px-4 py-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                Regulars — tap to charge (no scan)
              </p>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {customers.map((c) => {
                  const selected = member.kind === "found" && member.id === c.memberId;
                  const initials = `${c.firstName[0] ?? ""}${c.lastName[0] ?? ""}`.toUpperCase();
                  return (
                    <button
                      key={c.memberId}
                      onClick={() => selectCustomer(c)}
                      className="flex flex-shrink-0 flex-col items-center gap-1.5 active:scale-95"
                    >
                      <span
                        className={`relative flex h-16 w-16 items-center justify-center rounded-full border-2 text-lg font-bold transition-colors ${
                          selected
                            ? "border-amber-400 bg-amber-600/30 text-amber-100"
                            : "border-gray-700 bg-gray-800 text-gray-200 hover:border-amber-500"
                        }`}
                      >
                        {initials}
                        <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-600 px-1 text-xs font-bold text-white">
                          {c.orderCount}
                        </span>
                      </span>
                      <span className="max-w-[4.5rem] truncate text-xs text-gray-300">{c.firstName}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: cart + history */}
        <aside className="flex w-96 flex-col border-l border-gray-800">
          <div className="flex border-b border-gray-800 text-base">
            <TabBtn active={tab === "cart"} onClick={() => setTab("cart")}>
              Cart{itemCount > 0 ? ` (${itemCount})` : ""}
            </TabBtn>
            <TabBtn active={tab === "history"} onClick={() => setTab("history")}>
              History
            </TabBtn>
          </div>

          {tab === "cart" ? (
            <>
              {/* Clear cart — kept at the top for quick reset */}
              {cartLines.length > 0 && (
                <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2.5">
                  <span className="text-sm text-gray-400">{itemCount} item{itemCount === 1 ? "" : "s"}</span>
                  <button
                    onClick={clearCart}
                    className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-300 transition-colors hover:bg-red-600 hover:text-white"
                  >
                    Clear cart
                  </button>
                </div>
              )}
              {/* Member chip */}
              <div ref={memberRef} className="border-b border-gray-800 p-4">
                {member.kind === "found" ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-500">Charging</p>
                        <p className="text-lg font-bold">
                          {member.firstName} {member.lastName}
                        </p>
                      </div>
                      <button
                        onClick={() => setMember({ kind: "idle" })}
                        className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
                      >
                        Change
                      </button>
                    </div>
                    {member.roles.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {member.roles.map((r) => (
                          <span
                            key={r.name}
                            className={`rounded-lg px-2 py-1 text-xs font-medium ${
                              r.discountPercent >= 100
                                ? "bg-green-500/15 text-green-400"
                                : "bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            {r.name} — {r.discountPercent >= 100 ? "drinks free" : formatRoleDiscount(r)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : member.kind === "scanning" ? (
                  <p className="text-sm text-amber-400">Reading card…</p>
                ) : member.kind === "error" ? (
                  <p className="text-sm text-red-400">{member.message} — tap again</p>
                ) : (
                  <p className="text-sm text-gray-500">Tap a member card to charge</p>
                )}
              </div>

              {/* Cart lines */}
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {cartLines.length === 0 ? (
                  <p className="text-sm text-gray-600">Cart is empty</p>
                ) : (
                  <ul className="space-y-3">
                    {cartLines.map((l) => (
                      <li key={l.product.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-base font-medium">{l.product.name}</span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => dec(l.product.id)} className="h-10 w-10 rounded-lg bg-gray-800 text-2xl leading-none hover:bg-gray-700 active:scale-95">
                            −
                          </button>
                          <span className="w-7 text-center text-lg font-bold tabular-nums">{l.qty}</span>
                          <button onClick={() => add(l.product.id)} className="h-10 w-10 rounded-lg bg-gray-800 text-2xl leading-none hover:bg-gray-700 active:scale-95">
                            +
                          </button>
                          <span className="w-16 text-right text-base text-gray-400 tabular-nums">
                            {euro(activityDiscountedUnitPrice(l.product, specialFor(l.product.id), memberRoles) * l.qty)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Totals + confirm */}
              <div className="border-t border-gray-800 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-base text-gray-400">Total</span>
                  <span className="flex items-baseline gap-2">
                    {hasDiscount && (
                      <span className="text-base text-gray-500 line-through">{euro(grossCents)}</span>
                    )}
                    <span className="text-3xl font-extrabold tabular-nums">{euro(totalCents)}</span>
                  </span>
                </div>
                <button
                  onClick={confirmOrder}
                  disabled={member.kind !== "found" || cartLines.length === 0 || confirming || !isOpen}
                  className="w-full rounded-2xl bg-amber-600 py-5 text-xl font-bold transition-colors hover:bg-amber-500 active:scale-[0.99] disabled:opacity-40"
                >
                  {confirming
                    ? "Confirming…"
                    : member.kind === "found"
                    ? `Confirm — ${member.firstName}`
                    : "Scan a card to confirm"}
                </button>
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {history.length === 0 ? (
                <p className="text-sm text-gray-600">No orders yet</p>
              ) : (
                <ul className="space-y-3">
                  {history.map((inv) => (
                    <li key={inv.id} className="rounded-lg border border-gray-800 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">
                          {inv.member.firstName} {inv.member.lastName}
                        </span>
                        <span className="text-sm text-gray-400">{euro(inv.totalCents)}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {inv.lines.map((l) => `${l.quantity}× ${l.product.name}`).join(", ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl bg-amber-600 px-5 py-3 font-medium shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function CatPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-5 py-2.5 text-base font-semibold transition-colors active:scale-95 ${
        active ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-4 font-semibold transition-colors ${
        active ? "border-b-2 border-amber-500 text-white" : "text-gray-500 hover:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}
