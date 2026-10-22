"use client";

import { useEffect, useState } from "react";
import { PPP_COLORS } from "@/lib/ppp-colors";

type Vat = "ZERO" | "LOW" | "STANDARD";
const VAT_LABEL: Record<Vat, string> = { ZERO: "0%", LOW: "9%", STANDARD: "21%" };

// Swatch row: click to pick a colour, click the active one (or ✕) to clear.
function ColorSwatches({ value, onChange }: { value: string | null; onChange: (c: string | null) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(null)}
        title="No colour"
        className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs ${
          value == null ? "border-white text-white" : "border-gray-600 text-gray-500"
        }`}
      >
        ✕
      </button>
      {PPP_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onChange(c.value)}
          title={c.name}
          style={{ backgroundColor: c.value }}
          className={`h-7 w-7 rounded-full border-2 ${value === c.value ? "border-white" : "border-transparent"}`}
        />
      ))}
    </div>
  );
}

interface Category {
  id: string;
  name: string;
  bartenderFree?: boolean;
  _count?: { products: number };
}
interface Product {
  id: string;
  name: string;
  price: number;
  specialPrice: number | null;
  vatCategory: Vat;
  color: string | null;
  published: boolean;
  archived: boolean;
  categoryId: string;
  category: Category;
}

const euro = (c: number) => (c / 100).toFixed(2);
const toCents = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.round(Number(s) * 100)));

export default function PppProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  // new product form
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [special, setSpecial] = useState("");
  const [vat, setVat] = useState<Vat>("LOW");
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // new category
  const [catName, setCatName] = useState("");

  async function load() {
    const res = await fetch("/api/admin/ppp/products");
    if (res.ok) {
      const d = await res.json();
      setProducts(d.products);
      setCategories(d.categories);
      if (!categoryId && d.categories[0]) setCategoryId(d.categories[0].id);
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    const n = catName.trim();
    if (!n) return;
    const res = await fetch("/api/admin/ppp/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n }),
    });
    if (res.ok) {
      setCatName("");
      load();
    } else {
      alert((await res.json()).error ?? "Could not add category");
    }
  }

  async function deleteCategory(c: Category) {
    if (!confirm(`Delete category "${c.name}"?`)) return;
    const res = await fetch(`/api/admin/ppp/categories/${c.id}`, { method: "DELETE" });
    if (res.ok) load();
    else alert((await res.json()).error ?? "Could not delete category");
  }

  // Toggle whether drinks in this category are free for the on-shift bartender.
  async function toggleBartenderFree(c: Category) {
    const res = await fetch(`/api/admin/ppp/categories/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bartenderFree: !c.bartenderFree }),
    });
    if (res.ok) load();
    else alert((await res.json()).error ?? "Could not update category");
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !categoryId || price.trim() === "") return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/ppp/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        price: toCents(price),
        specialPrice: toCents(special),
        categoryId,
        vatCategory: vat,
        color,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      setPrice("");
      setSpecial("");
      setColor(null);
      load();
    } else {
      setError((await res.json()).error ?? "Could not create drink");
    }
  }

  const visible = products.filter((p) => showArchived || !p.archived);

  return (
    <div className="p-8">
      <div className="mb-2">
        <h1 className="text-3xl font-bold">Drinks</h1>
        <p className="text-gray-500">
          Manage the PPP bar catalog. Drinks are created here — bartenders only sell them.
          A <span className="text-amber-400">special price</span> overrides the price; on a
          special price only percentage role discounts apply (fixed-cent discounts are skipped).
        </p>
      </div>

      {/* Categories */}
      <section className="my-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Categories</h2>
        <p className="mb-2 text-xs text-gray-500">
          Tap 🍺 to mark a category <b>free for the on-shift bartender</b> (they drink these free when
          charging their own card — e.g. soft drinks &amp; 0.0%). The association covers the cost.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {categories.map((c) => (
            <span
              key={c.id}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${
                c.bartenderFree ? "bg-green-600/25 text-green-300 ring-1 ring-green-600/40" : "bg-gray-800"
              }`}
            >
              {c.name}
              <button
                onClick={() => toggleBartenderFree(c)}
                className={c.bartenderFree ? "text-green-300" : "text-gray-500 hover:text-green-300"}
                title={c.bartenderFree ? "Bartender-free — click to turn off" : "Make free for the on-shift bartender"}
              >
                🍺
              </button>
              <button onClick={() => deleteCategory(c)} className="text-gray-500 hover:text-red-400" title="Delete category">
                ✕
              </button>
            </span>
          ))}
          <form onSubmit={addCategory} className="flex items-center gap-2">
            <input
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="New category"
              className="w-40 rounded-lg bg-gray-800 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
            <button type="submit" className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm hover:bg-gray-600">
              Add
            </button>
          </form>
        </div>
      </section>

      {/* New drink */}
      <section className="my-6 rounded-2xl border border-gray-800 bg-gray-900 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Add a drink</h2>
        {categories.length === 0 ? (
          <p className="text-sm text-gray-500">Add a category first.</p>
        ) : (
          <form onSubmit={createProduct} className="flex flex-wrap items-end gap-3">
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Pils"
                className="w-48 rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
              />
            </Field>
            <Field label="Category">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Price €">
              <input
                type="number" min={0} step={0.05} value={price}
                onChange={(e) => setPrice(e.target.value)} placeholder="0.00"
                className="w-24 rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
              />
            </Field>
            <Field label="Special € (optional)">
              <input
                type="number" min={0} step={0.05} value={special}
                onChange={(e) => setSpecial(e.target.value)} placeholder="—"
                className="w-28 rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
              />
            </Field>
            <Field label="VAT">
              <select
                value={vat} onChange={(e) => setVat(e.target.value as Vat)}
                className="rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-amber-500"
              >
                {(["ZERO", "LOW", "STANDARD"] as Vat[]).map((v) => (
                  <option key={v} value={v}>{VAT_LABEL[v]}</option>
                ))}
              </select>
            </Field>
            <Field label="Tile colour">
              <div className="py-2">
                <ColorSwatches value={color} onChange={setColor} />
              </div>
            </Field>
            <button
              type="submit" disabled={busy || !name.trim() || price.trim() === ""}
              className="rounded-xl bg-amber-600 px-5 py-2 font-semibold transition-colors hover:bg-amber-500 disabled:opacity-40"
            >
              {busy ? "Adding…" : "Add drink"}
            </button>
          </form>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </section>

      {/* Drink list */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Catalog ({visible.length})
        </h2>
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-gray-500">No drinks yet.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((p) => (
            <ProductRow key={p.id} product={p} categories={categories} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-gray-400">{label}</span>
      {children}
    </label>
  );
}

function ProductRow({
  product,
  categories,
  onChanged,
}: {
  product: Product;
  categories: Category[];
  onChanged: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [price, setPrice] = useState(euro(product.price));
  const [special, setSpecial] = useState(product.specialPrice == null ? "" : euro(product.specialPrice));
  const [vat, setVat] = useState<Vat>(product.vatCategory);
  const [color, setColor] = useState<string | null>(product.color);
  const [saving, setSaving] = useState(false);

  const dirty =
    name !== product.name ||
    categoryId !== product.categoryId ||
    toCents(price) !== product.price ||
    toCents(special) !== product.specialPrice ||
    vat !== product.vatCategory ||
    color !== product.color;

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    const res = await fetch(`/api/admin/ppp/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) onChanged();
    else alert((await res.json()).error ?? "Save failed");
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-800 bg-gray-900 p-3">
      <input
        value={name} onChange={(e) => setName(e.target.value)}
        className="w-40 rounded-lg bg-gray-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500"
      />
      <select
        value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
        className="rounded-lg bg-gray-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500"
      >
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <label className="flex items-center gap-1 text-sm text-gray-400">
        €<input
          type="number" min={0} step={0.05} value={price} onChange={(e) => setPrice(e.target.value)}
          className="w-20 rounded-lg bg-gray-800 px-2 py-2 text-right outline-none focus:ring-2 focus:ring-amber-500"
        />
      </label>
      <label className="flex items-center gap-1 text-sm text-amber-400/80">
        special €<input
          type="number" min={0} step={0.05} value={special} onChange={(e) => setSpecial(e.target.value)}
          placeholder="—"
          className="w-20 rounded-lg bg-gray-800 px-2 py-2 text-right outline-none focus:ring-2 focus:ring-amber-500"
        />
      </label>
      <select
        value={vat} onChange={(e) => setVat(e.target.value as Vat)}
        className="rounded-lg bg-gray-800 px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500"
        title="VAT"
      >
        {(["ZERO", "LOW", "STANDARD"] as Vat[]).map((v) => <option key={v} value={v}>{VAT_LABEL[v]}</option>)}
      </select>
      <ColorSwatches value={color} onChange={setColor} />

      <div className="ml-auto flex items-center gap-2">
        {dirty && (
          <button
            onClick={() => patch({ name, categoryId, price: toCents(price), specialPrice: toCents(special) === null ? null : toCents(special), vatCategory: vat, color })}
            disabled={saving}
            className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium hover:bg-amber-500 disabled:opacity-40"
          >
            Save
          </button>
        )}
        <button
          onClick={() => patch({ published: !product.published })}
          disabled={saving}
          className={`rounded-lg px-3 py-2 text-sm font-medium ${
            product.published ? "bg-green-600/80 hover:bg-green-600" : "bg-gray-700 hover:bg-gray-600"
          }`}
        >
          {product.published ? "Published" : "Hidden"}
        </button>
        <button
          onClick={() => patch({ archived: !product.archived })}
          disabled={saving}
          className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-400 hover:bg-red-600 hover:text-white"
        >
          {product.archived ? "Unarchive" : "Archive"}
        </button>
      </div>
    </div>
  );
}
