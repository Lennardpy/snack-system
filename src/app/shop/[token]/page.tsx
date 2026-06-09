"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";

interface Product {
  id: string;
  name: string;
  price: number;
  imageUrl: string | null;
  stock?: number | null;
  onSale?: boolean;
  discount?: "HALF" | "FREE" | null;
  salePrice?: number | null;
  category: { name: string };
}

interface InvoiceLine {
  productId: string;
  quantity: number;
  unitCents: number;
  product: Product;
}

interface Invoice {
  id: string;
  totalCents: number;
  lines: InvoiceLine[];
}

// Idle auto-reset: if nobody interacts, warn near the end then return to the
// tap screen and end the session — so a member who walks away can't leave their
// account open for the next person.
const IDLE_LIMIT_MS = 60_000;   // total inactivity allowed
const WARN_BEFORE_MS = 15_000;  // show the countdown warning this long before reset

export default function ShopPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [memberFirstName, setMemberFirstName] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("All");

  // Welcome animation: name pops out, then the overlay clears to reveal the shop.
  const [showWelcome, setShowWelcome] = useState(true);
  const [welcomeExiting, setWelcomeExiting] = useState(false);
  const welcomeStarted = useRef(false);

  useEffect(() => {
    if (!memberFirstName || welcomeStarted.current) return;
    welcomeStarted.current = true;
    const exitTimer = setTimeout(() => setWelcomeExiting(true), 1900); // start fade-out
    const doneTimer = setTimeout(() => setShowWelcome(false), 2400);   // remove overlay
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(doneTimer);
    };
  }, [memberFirstName]);

  const fetchCart = useCallback(async () => {
    const res = await fetch(`/api/cart?token=${token}`);
    if (res.status === 401) { router.push("/"); return; }
    const data = await res.json();
    setInvoice(data.invoice);
    if (data.memberFirstName) setMemberFirstName(data.memberFirstName);
  }, [token, router]);

  // ── Idle auto-reset ─────────────────────────────────────────────────────────
  const [idleWarning, setIdleWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(WARN_BEFORE_MS / 1000));
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const endedRef = useRef(false);

  const clearIdleTimers = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (warnTimer.current) clearTimeout(warnTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
  }, []);

  const endSession = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    clearIdleTimers();
    // keepalive lets the request complete even as we navigate away
    fetch(`/api/cart?token=${token}`, { method: "DELETE", keepalive: true }).catch(() => {});
    router.push("/");
  }, [token, router, clearIdleTimers]);

  const resetIdle = useCallback(() => {
    if (endedRef.current) return;
    setIdleWarning(false);
    clearIdleTimers();
    warnTimer.current = setTimeout(() => {
      setSecondsLeft(Math.ceil(WARN_BEFORE_MS / 1000));
      setIdleWarning(true);
      countdownTimer.current = setInterval(() => {
        setSecondsLeft((s) => (s > 1 ? s - 1 : 1));
      }, 1000);
    }, IDLE_LIMIT_MS - WARN_BEFORE_MS);
    idleTimer.current = setTimeout(endSession, IDLE_LIMIT_MS);
  }, [clearIdleTimers, endSession]);

  useEffect(() => {
    // Don't start the idle clock until the welcome overlay clears, and stop it
    // once an order is confirmed.
    if (showWelcome || done) return;
    resetIdle();
    const onActivity = () => resetIdle();
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity));
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      clearIdleTimers();
    };
  }, [showWelcome, done, resetIdle, clearIdleTimers]);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((d) => setProducts(d.products ?? []));
    fetchCart();
  }, [fetchCart]);

  async function updateCart(productId: string, delta: number) {
    await fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, productId, delta }),
    });
    fetchCart();
  }

  async function confirm() {
    setConfirming(true);
    const res = await fetch("/api/orders/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      endedRef.current = true; // session already deleted server-side; stop idle reset
      clearIdleTimers();
      setDone(true);
      setTimeout(() => router.push("/"), 3000);
    } else {
      setConfirming(false);
    }
  }

  function qtyFor(productId: string) {
    return invoice?.lines.find((l) => l.productId === productId)?.quantity ?? 0;
  }

  const categories = [...new Set(products.map((p) => p.category.name))];
  const visibleCategories =
    activeCategory === "All" || !categories.includes(activeCategory)
      ? categories
      : [activeCategory];

  if (done) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center">
        <div className="text-8xl mb-6">✅</div>
        <h1 className="text-4xl font-bold mb-2">Order confirmed!</h1>
        <p className="text-gray-400">You will be charged via SEPA. Returning…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {/* Welcome overlay — name pops out, then clears to reveal the shop */}
      {showWelcome && (
        <div
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-950 px-6 text-center ${
            welcomeExiting ? "animate-welcome-exit" : ""
          }`}
        >
          <Image
            src="/stress-logo.svg"
            alt="Stress"
            width={120}
            height={120}
            priority
            className="mb-10 select-none animate-welcome-logo"
          />
          {memberFirstName && (
            <>
              <h1 className="text-6xl font-extrabold animate-welcome-pop">
                Welcome, {memberFirstName}!
              </h1>
              <p className="mt-5 text-xl text-gray-400 animate-welcome-sub">
                Let&apos;s grab some snacks 🍫
              </p>
            </>
          )}
        </div>
      )}

      {/* Idle warning — any tap dismisses it and resets the timer */}
      {idleWarning && (
        <div
          onClick={resetIdle}
          className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-gray-950/90 backdrop-blur-sm px-6 text-center cursor-pointer"
        >
          <div className="text-7xl mb-6">⏳</div>
          <h2 className="text-3xl font-bold mb-2">Still there?</h2>
          <p className="text-gray-400 text-lg mb-8">
            Returning to the start in <strong className="text-white">{secondsLeft}</strong>s…
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); resetIdle(); }}
            className="bg-green-600 hover:bg-green-500 text-white font-bold px-8 py-4 rounded-xl text-lg"
          >
            I&apos;m still shopping
          </button>
        </div>
      )}

      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <Image src="/stress-logo.svg" alt="Stress" width={44} height={44} priority className="select-none" />
          <h1 className="text-2xl font-bold">Stress Snack System</h1>
        </div>
        <div className="flex items-center gap-5">
          {memberFirstName && (
            <span className="text-xl">
              Hi, <strong className="font-semibold">{memberFirstName}</strong> 👋
            </span>
          )}
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-800 px-5 py-2.5 text-base font-semibold text-gray-200 transition-colors hover:bg-gray-700 active:scale-95"
          >
            ← Back
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-72px)]">
        {/* Products column: category selector + scrollable grid */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Category selector */}
          <div className="flex flex-shrink-0 gap-2 overflow-x-auto border-b border-gray-800 px-6 py-3">
            <button
              onClick={() => setActiveCategory("All")}
              className={`flex-shrink-0 rounded-full px-5 py-2.5 text-base font-semibold transition-colors active:scale-95 ${
                activeCategory === "All"
                  ? "bg-green-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`flex-shrink-0 rounded-full px-5 py-2.5 text-base font-semibold transition-colors active:scale-95 ${
                  activeCategory === cat
                    ? "bg-green-600 text-white"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Product grid */}
          <div className="flex-1 overflow-y-auto p-6">
          {visibleCategories.map((cat) => (
            <div key={cat} className="mb-8">
              <h2 className="text-base font-semibold text-gray-400 mb-3 uppercase tracking-wider">{cat}</h2>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {products
                  .filter((p) => p.category.name === cat)
                  .map((p) => {
                    const qty = qtyFor(p.id);
                    const outOfStock = p.stock != null && p.stock <= 0;
                    return (
                      <div
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => updateCart(p.id, 1)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            updateCart(p.id, 1);
                          }
                        }}
                        aria-label={`Add one ${p.name}`}
                        className={`relative flex cursor-pointer flex-col overflow-hidden rounded-xl bg-gray-800 ring-2 transition-all hover:brightness-110 active:scale-[0.98] ${
                          qty > 0 ? "ring-green-500" : "ring-transparent hover:ring-gray-600"
                        } ${outOfStock ? "opacity-70" : ""}`}
                      >
                        {/* Image — contained on white so the whole product shows */}
                        <div className={`relative aspect-square w-full flex-shrink-0 bg-white p-2 ${outOfStock ? "grayscale" : ""}`}>
                          {p.imageUrl ? (
                            <Image src={p.imageUrl} alt={p.name} fill className="object-contain p-1" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-3xl">🍫</div>
                          )}
                          {outOfStock && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                              <span className="rounded bg-gray-900/90 px-2 py-1 text-xs font-bold uppercase tracking-wide text-white">
                                Out of stock
                              </span>
                            </div>
                          )}
                          {p.discount && (
                            <div className="absolute left-1.5 top-1.5 rounded-md bg-red-600 px-1.5 py-0.5 text-[11px] font-bold uppercase leading-none text-white shadow">
                              {p.discount === "FREE" ? "Free" : "-50%"}
                            </div>
                          )}
                          {qty > 0 && (
                            <div className="absolute right-1.5 top-1.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-green-500 px-1.5 text-sm font-bold text-white shadow-lg">
                              {qty}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-1 flex-col gap-2 p-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold leading-tight">{p.name}</p>
                            {p.discount && p.salePrice != null ? (
                              <p className="flex items-baseline gap-1.5 text-xs">
                                <span className="font-bold text-green-400">
                                  {p.discount === "FREE" ? "Free" : `€${(p.salePrice / 100).toFixed(2)}`}
                                </span>
                                <span className="text-gray-500 line-through">€{(p.price / 100).toFixed(2)}</span>
                              </p>
                            ) : (
                              <p className="text-xs text-gray-400">€{(p.price / 100).toFixed(2)}</p>
                            )}
                          </div>

                          {/* +/- stepper. Buttons stop propagation so they don't
                              also trigger the card's add-on-click. */}
                          <div className="mt-auto">
                            {qty > 0 ? (
                              <div className="flex items-center justify-between gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); updateCart(p.id, -1); }}
                                  aria-label={`Remove one ${p.name}`}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-700 text-2xl font-bold leading-none text-white transition-colors hover:bg-red-600 active:scale-90"
                                >
                                  −
                                </button>
                                <span className="min-w-6 text-center text-lg font-bold tabular-nums">{qty}</span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); updateCart(p.id, 1); }}
                                  aria-label={`Add one ${p.name}`}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-600 text-2xl font-bold leading-none text-white transition-colors hover:bg-green-500 active:scale-90"
                                >
                                  +
                                </button>
                              </div>
                            ) : (
                              <div className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-gray-700 text-sm font-semibold text-white">
                                <span className="text-lg leading-none">+</span> Add
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
          </div>
        </div>

        {/* Cart sidebar */}
        <aside className="flex w-96 flex-col border-l border-gray-800 p-6">
          <h2 className="mb-5 text-2xl font-bold">Your cart</h2>

          {!invoice || invoice.lines.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center text-gray-500">
              <div className="mb-3 text-5xl">🛒</div>
              <p className="text-lg">Nothing added yet.</p>
              <p className="text-sm">Tap a product to add it.</p>
            </div>
          ) : (
            <ul className="flex-1 space-y-3 overflow-y-auto pr-1">
              {invoice.lines.map((l) => (
                <li
                  key={l.productId}
                  className="flex items-center gap-3 rounded-xl bg-gray-800/70 p-3"
                >
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-green-600 text-xl font-bold text-white tabular-nums">
                    {l.quantity}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-lg font-medium">{l.product.name}</span>
                  <span className="text-lg font-semibold text-gray-200 tabular-nums">
                    €{((l.quantity * l.unitCents) / 100).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 border-t border-gray-800 pt-5">
            <div className="mb-5 flex items-baseline justify-between">
              <span className="text-xl font-semibold text-gray-300">Total</span>
              <span className="text-4xl font-bold tabular-nums">€{((invoice?.totalCents ?? 0) / 100).toFixed(2)}</span>
            </div>
            <button
              onClick={confirm}
              disabled={confirming || !invoice || invoice.lines.length === 0}
              className="w-full rounded-2xl bg-green-600 py-5 text-2xl font-bold text-white transition-colors hover:bg-green-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {confirming ? "Confirming…" : "Confirm order"}
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
