"use client";

import { useEffect, useState, useCallback } from "react";
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

export default function ShopPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  const fetchCart = useCallback(async () => {
    const res = await fetch(`/api/cart?token=${token}`);
    if (res.status === 401) { router.push("/"); return; }
    const data = await res.json();
    setInvoice(data.invoice);
  }, [token, router]);

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
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
        <h1 className="text-2xl font-bold">SSS</h1>
        <div className="flex items-center gap-4">
          <span className="text-gray-600 text-xs hidden sm:block">Stress Snack System</span>
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
                      <div
                        key={p.id}
                        className="bg-gray-800 rounded-xl overflow-hidden flex flex-col"
                      >
                        {/* Product image */}
                        <div className="relative w-full h-28 bg-gray-700 flex-shrink-0">
                          {p.imageUrl ? (
                            <Image src={p.imageUrl} alt={p.name} fill className="object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-3xl">🍫</div>
                          )}
                        </div>
                        <div className="p-3 flex flex-col gap-3 flex-1">
                        <div>
                          <p className="font-medium">{p.name}</p>
                          <p className="text-gray-400 text-sm">€{(p.price / 100).toFixed(2)}</p>
                        </div>
                        <div className="flex items-center gap-2 mt-auto">
                          <button
                            onClick={() => updateCart(p.id, -1)}
                            disabled={qty === 0}
                            className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-30 font-bold"
                          >
                            −
                          </button>
                          <span className="w-6 text-center font-bold">{qty}</span>
                          <button
                            onClick={() => updateCart(p.id, 1)}
                            className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 font-bold"
                          >
                            +
                          </button>
                        </div>
                        </div>
                      </div>
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
