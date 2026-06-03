"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";

interface Product {
  id: string;
  name: string;
  price: number;
  imageUrl: string | null;
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
          <Image src="/stress-logo.svg" alt="Stress" width={40} height={40} priority className="select-none" />
          <div className="leading-tight">
            <h1 className="text-xl font-bold">SSS</h1>
            <span className="text-gray-500 text-xs">Stress Snack System</span>
          </div>
        </div>
        <div className="flex items-center gap-5">
          {memberFirstName && (
            <span className="text-lg">
              Hi, <strong className="font-semibold">{memberFirstName}</strong> 👋
            </span>
          )}
          <button onClick={() => router.push("/")} className="text-gray-400 hover:text-white text-sm">
            ← Back
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-64px)]">
        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {categories.map((cat) => (
            <div key={cat} className="mb-8">
              <h2 className="text-lg font-semibold text-gray-400 mb-3 uppercase tracking-wider">{cat}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {products
                  .filter((p) => p.category.name === cat)
                  .map((p) => {
                    const qty = qtyFor(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => updateCart(p.id, 1)}
                        className={`relative text-left bg-gray-800 rounded-xl overflow-hidden flex flex-col transition-all active:scale-[0.97] hover:bg-gray-700 cursor-pointer ring-2 ${
                          qty > 0 ? "ring-green-500" : "ring-transparent hover:ring-gray-600"
                        }`}
                      >
                        {/* Product image */}
                        <div className="relative w-full h-28 bg-gray-700 flex-shrink-0">
                          {p.imageUrl ? (
                            <Image src={p.imageUrl} alt={p.name} fill className="object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-3xl">🍫</div>
                          )}
                          {/* Quantity badge */}
                          {qty > 0 && (
                            <div className="absolute top-2 right-2 min-w-7 h-7 px-1.5 rounded-full bg-green-500 text-white text-sm font-bold flex items-center justify-center shadow-lg">
                              {qty}
                            </div>
                          )}
                        </div>
                        <div className="p-3 flex items-center justify-between gap-2 flex-1">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{p.name}</p>
                            <p className="text-gray-400 text-sm">€{(p.price / 100).toFixed(2)}</p>
                          </div>
                          {/* Remove control — only when in cart */}
                          {qty > 0 && (
                            <span
                              role="button"
                              tabIndex={-1}
                              onClick={(e) => {
                                e.stopPropagation();
                                updateCart(p.id, -1);
                              }}
                              className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-700 hover:bg-red-600 active:scale-90 transition-all flex items-center justify-center text-lg font-bold"
                              aria-label={`Remove one ${p.name}`}
                            >
                              −
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>

        {/* Cart sidebar */}
        <aside className="w-72 border-l border-gray-800 flex flex-col p-5">
          <h2 className="text-lg font-semibold mb-4">Your cart</h2>

          {!invoice || invoice.lines.length === 0 ? (
            <p className="text-gray-500 text-sm">Nothing added yet.</p>
          ) : (
            <ul className="flex-1 space-y-2 overflow-y-auto">
              {invoice.lines.map((l) => (
                <li key={l.productId} className="flex justify-between text-sm">
                  <span>{l.quantity}× {l.product.name}</span>
                  <span className="text-gray-400">€{((l.quantity * l.unitCents) / 100).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-auto pt-4 border-t border-gray-800">
            <div className="flex justify-between font-bold text-lg mb-4">
              <span>Total</span>
              <span>€{((invoice?.totalCents ?? 0) / 100).toFixed(2)}</span>
            </div>
            <button
              onClick={confirm}
              disabled={confirming || !invoice || invoice.lines.length === 0}
              className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-colors"
            >
              {confirming ? "Confirming…" : "Confirm order"}
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
