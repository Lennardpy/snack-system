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
  category: { id: string; name: string; sortOrder: number; bartenderFree: boolean };
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
  lines: { quantity: number; unitCents: number; product: { id: string; name: string } }[];
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
interface MemberSearchResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  cardCount: number;
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
  // A scanned card with no linked member — the bartender links it by searching.
  | { kind: "unlinked"; uid: string }
  | { kind: "error"; message: string };

const WS_URL =
  process.env.NEXT_PUBLIC_PPP_CARD_READER_WS_URL ?? "ws://localhost:3000";
const PPP_MODE = process.env.NEXT_PUBLIC_PPP_CARD_READER_MODE;
const ENV_MODE = PPP_MODE === "ws" || PPP_MODE === "nfc" ? PPP_MODE : "hid";

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
  // On phones the products grid and the cart don't fit side-by-side, so we show
  // one at a time and switch with a bottom tab bar. Ignored at lg+ (both shown).
  const [mobileView, setMobileView] = useState<"products" | "cart">("products");
  const [history, setHistory] = useState<HistoryInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState("");
  // The logged-in bartender's own member — they drink free from bartender-free
  // categories when charging their own card.
  const [selfMemberId, setSelfMemberId] = useState<string | null>(null);
  // Manual card-linking (when an unrecognised card is scanned at the bar).
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<MemberSearchResult[]>([]);
  const [linking, setLinking] = useState(false);

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
    fetch("/api/ppp/me")
      .then((r) => (r.ok ? r.json() : { memberId: null }))
      .then((d) => setSelfMemberId(d.memberId ?? null))
      .catch(() => setSelfMemberId(null));
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

  // Leave this borrel and go back to the activity list. (Logging out lives on the
  // selector.) Confirmed, so it's not triggered by an accidental tap mid-service.
  function endBorrel() {
    if (!confirm("End this borrel and return to the activity list?")) return;
    router.push("/ppp");
  }

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
  const selectCustomer = (c: Customer) => {
    setMember({ kind: "found", id: c.memberId, firstName: c.firstName, lastName: c.lastName, roles: c.roles });
    setMobileView("cart"); // jump to the cart to confirm (no-op on desktop)
  };

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
      if (res.ok && d.unlinked) {
        // Unrecognised card — let the bartender link it to a member by name.
        setLinkQuery("");
        setLinkResults([]);
        setMember({ kind: "unlinked", uid: d.uid });
        setMobileView("cart");
      } else if (res.ok) {
        setMember({
          kind: "found",
          id: d.memberId,
          firstName: d.firstName,
          lastName: d.lastName,
          roles: d.roles ?? [],
        });
        setMobileView("cart"); // a scanned card means we're about to confirm
      } else {
        setMember({ kind: "error", message: d.error ?? "Scan failed" });
      }
    } catch {
      setMember({ kind: "error", message: "Connection error" });
    }
  }, []);

  // Debounced member search while linking an unrecognised card.
  const unlinkedUid = member.kind === "unlinked" ? member.uid : null;
  useEffect(() => {
    if (unlinkedUid === null) return;
    const q = linkQuery.trim();
    if (q.length < 2) {
      setLinkResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/ppp/members/search?q=${encodeURIComponent(q)}`);
      if (res.ok) setLinkResults((await res.json()).members);
    }, 250);
    return () => clearTimeout(t);
  }, [linkQuery, unlinkedUid]);

  // Link the just-scanned card to the chosen member, then charge them.
  async function linkCard(m: MemberSearchResult) {
    if (member.kind !== "unlinked") return;
    setLinking(true);
    const res = await fetch("/api/ppp/card/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: member.uid, memberId: m.id }),
    });
    setLinking(false);
    const d = await res.json();
    if (res.ok) {
      setMember({ kind: "found", id: d.memberId, firstName: d.firstName, lastName: d.lastName, roles: d.roles ?? [] });
      setLinkQuery("");
      setLinkResults([]);
      flashToast(`Linked card to ${d.firstName} ${d.lastName}`);
    } else {
      setMember({ kind: "error", message: d.error ?? "Could not link card" });
    }
  }

  const { mode, wsStatus, nfcStatus, startNfc } = useCardReader({
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
  // The on-shift bartender (this logged-in user) drinks free from bartender-free
  // categories when charging their OWN card.
  const chargingSelf = member.kind === "found" && selfMemberId != null && member.id === selfMemberId;
  const isFreeForBartender = useCallback(
    (p: Product) => chargingSelf && p.category.bartenderFree,
    [chargingSelf]
  );
  // Final unit price a member pays for a product, honouring the bartender free rule.
  const unitPriceFor = useCallback(
    (p: Product) =>
      isFreeForBartender(p) ? 0 : activityDiscountedUnitPrice(p, specialFor(p.id), memberRoles),
    [isFreeForBartender, specialFor, memberRoles]
  );
  // "Gross" = effective price (special if set) before role discounts; total = after.
  const grossCents = cartLines.reduce(
    (s, l) => s + activityUnitPrice(l.product, specialFor(l.product.id)) * l.qty,
    0
  );
  const totalCents = cartLines.reduce((s, l) => s + unitPriceFor(l.product) * l.qty, 0);
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
      setMobileView("products"); // back to the drinks grid for the next round
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

  // Quantity sold per product at this borrel (from the recent history feed), used
  // to bubble the most-purchased drinks to the front of the "All" tab.
  const soldByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const inv of history)
      for (const l of inv.lines) m.set(l.product.id, (m.get(l.product.id) ?? 0) + l.quantity);
    return m;
  }, [history]);

  const visible = useMemo(() => {
    if (activeCat !== "all") return products.filter((p) => p.category.id === activeCat);
    // Most-purchased first; unsold drinks keep their normal order after them.
    return [...products].sort(
      (a, b) => (soldByProduct.get(b.id) ?? 0) - (soldByProduct.get(a.id) ?? 0)
    );
  }, [activeCat, products, soldByProduct]);

  const memberRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-dvh flex-col">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-800 px-3 py-2.5 lg:px-5 lg:py-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* On the phone, the cart's back-arrow returns to the Drinks grid (an
              accidental tap is harmless); leaving the borrel is the End Borrel
              button. Hidden on desktop, where both panes are always visible. */}
          {mobileView === "cart" && (
            <button
              onClick={() => setMobileView("products")}
              className="flex items-center gap-1 text-gray-300 hover:text-white lg:hidden"
              aria-label="Back to drinks"
            >
              <span className="text-xl leading-none">←</span>
              <span className="text-sm font-medium">Drinks</span>
            </button>
          )}
          <h1 className="truncate font-bold">{activity?.name ?? "…"}</h1>
          {activity && !isOpen && (
            <span className="rounded-full bg-gray-700/40 px-2 py-0.5 text-xs text-gray-400">
              Closed
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 lg:gap-4">
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
          {mode === "nfc" ? (
            nfcStatus === "scanning" ? (
              <>
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Ready — tap a card
              </>
            ) : (
              <button
                onClick={startNfc}
                disabled={nfcStatus === "unsupported"}
                className="rounded-full bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
              >
                {nfcStatus === "unsupported"
                  ? "NFC unavailable"
                  : nfcStatus === "error"
                  ? "Retry NFC"
                  : "Enable NFC"}
              </button>
            )
          ) : mode === "hid" ? (
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
          <button
            onClick={endBorrel}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:border-red-600 hover:bg-red-600 hover:text-white"
          >
            End Borrel
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: products (full-width on phones; hidden there when viewing cart) */}
        <div
          className={`min-w-0 flex-1 flex-col ${
            mobileView === "cart" ? "hidden lg:flex" : "flex"
          }`}
        >
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
                const qty = cart[p.id] ?? 0;
                const free = isFreeForBartender(p);
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
                    {/* Live in-cart quantity — appears the moment you tap the tile */}
                    {qty > 0 && (
                      <span className="absolute -left-1.5 -top-1.5 flex h-8 min-w-[2rem] items-center justify-center rounded-full bg-amber-500 px-2 text-base font-extrabold tabular-nums text-black shadow-lg ring-2 ring-gray-950">
                        {qty}
                      </span>
                    )}
                    {onBorrelSpecial && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-black">
                        SPECIAL
                      </span>
                    )}
                    <span className="text-xl font-bold leading-tight">{p.name}</span>
                    {free ? (
                      <span className="mt-2 flex items-baseline gap-1.5 text-base">
                        <span className={colored ? "text-white/60 line-through" : "text-gray-500 line-through"}>
                          {euro(effective)}
                        </span>
                        <span className={colored ? "font-extrabold text-white" : "font-extrabold text-green-400"}>
                          FREE
                        </span>
                      </span>
                    ) : isSpecial ? (
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

        {/* Right: cart + history (full-width on phones; hidden there when viewing drinks) */}
        <aside
          className={`w-full flex-col border-gray-800 lg:w-96 lg:border-l ${
            mobileView === "products" ? "hidden lg:flex" : "flex"
          }`}
        >
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
                ) : member.kind === "unlinked" ? (
                  <div className="space-y-2">
                    <div>
                      <p className="text-sm font-semibold text-amber-400">Card not linked yet</p>
                      <p className="text-xs text-gray-500">Search the member to link this card to them.</p>
                    </div>
                    <input
                      autoFocus
                      value={linkQuery}
                      onChange={(e) => setLinkQuery(e.target.value)}
                      placeholder="Search name…"
                      className="w-full rounded-lg bg-gray-800 px-3 py-2 text-base outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    {linkResults.length > 0 && (
                      <ul className="max-h-56 space-y-1 overflow-y-auto">
                        {linkResults.map((m) => (
                          <li key={m.id}>
                            <button
                              onClick={() => linkCard(m)}
                              disabled={linking}
                              className="flex w-full items-center justify-between gap-2 rounded-lg bg-gray-800 px-3 py-2.5 text-left hover:bg-gray-700 disabled:opacity-40"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">
                                  {m.firstName} {m.lastName}
                                </span>
                                <span className="block truncate text-xs text-gray-500">{m.email}</span>
                              </span>
                              <span className="flex-shrink-0 text-xs font-semibold text-amber-400">Link →</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {linkQuery.trim().length >= 2 && linkResults.length === 0 && !linking && (
                      <p className="text-xs text-gray-600">No members found.</p>
                    )}
                    <button
                      onClick={() => { setMember({ kind: "idle" }); setLinkQuery(""); setLinkResults([]); }}
                      className="text-xs text-gray-500 hover:text-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
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
                            {isFreeForBartender(l.product) ? "FREE" : euro(unitPriceFor(l.product) * l.qty)}
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

      {/* Mobile view switcher — phones only; desktop shows both panes at once.
          Big finger targets; extra bottom padding clears the phone gesture bar. */}
      <nav className="flex items-stretch border-t border-gray-800 pb-[env(safe-area-inset-bottom)] lg:hidden">
        <button
          onClick={() => setMobileView("products")}
          className={`flex flex-1 items-center justify-center gap-2 border-t-2 py-5 text-lg font-bold transition-colors ${
            mobileView === "products"
              ? "border-amber-500 bg-gray-900 text-white"
              : "border-transparent text-gray-400"
          }`}
        >
          🍺 Drinks
        </button>
        <button
          onClick={() => setMobileView("cart")}
          className={`flex flex-1 items-center justify-center gap-2 border-t-2 py-5 text-lg font-bold transition-colors ${
            mobileView === "cart"
              ? "border-amber-500 bg-gray-900 text-white"
              : "border-transparent text-gray-400"
          }`}
        >
          <span>Cart{itemCount > 0 ? ` (${itemCount})` : ""}</span>
          {itemCount > 0 && <span className="tabular-nums text-amber-400">{euro(totalCents)}</span>}
        </button>
      </nav>

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
