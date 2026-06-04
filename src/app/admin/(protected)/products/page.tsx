"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { discountStage, effectivePriceCents } from "@/lib/pricing";

interface Category { id: string; name: string }
interface Product {
  id: string;
  name: string;
  price: number;
  stock: number | null;
  published: boolean;
  archived: boolean;
  imageUrl: string | null;
  expiresAt: string | null;
  category: Category;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({ name: "", price: "", categoryId: "", stock: "" });
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function load() {
    fetch("/api/admin/products").then((r) => r.json()).then((d) => {
      setProducts(d.products ?? []);
      setCategories(d.categories ?? []);
    });
  }

  useEffect(load, []);

  async function addProduct(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        price: Math.round(parseFloat(form.price) * 100),
        categoryId: form.categoryId,
        stock: form.stock ? parseInt(form.stock) : null,
      }),
    });
    setForm({ name: "", price: "", categoryId: "", stock: "" });
    setSaving(false);
    load();
  }

  async function patch(id: string, data: Record<string, unknown>) {
    await fetch(`/api/admin/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    load();
  }

  function startEditPrice(p: Product) {
    setEditingId(p.id);
    setEditPrice((p.price / 100).toFixed(2));
  }

  async function savePrice(p: Product) {
    const cents = Math.round(parseFloat(editPrice) * 100);
    setEditingId(null);
    if (!isNaN(cents) && cents !== p.price && cents >= 0) {
      await patch(p.id, { price: cents });
    }
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = newCategory.trim();
    if (!name) return;
    setCatBusy(true);
    setCatError(null);
    const res = await fetch("/api/admin/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setCatBusy(false);
    if (res.ok) {
      setNewCategory("");
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      setCatError(d.error ?? "Could not add category");
    }
  }

  async function moveCategory(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= categories.length) return;
    const reordered = [...categories];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setCategories(reordered); // optimistic
    setCatError(null);
    const res = await fetch("/api/admin/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: reordered.map((c) => c.id) }),
    });
    if (res.ok) {
      load();
    } else {
      setCatError("Could not reorder categories");
      load(); // revert to server state
    }
  }

  async function deleteCategory(c: Category) {
    const count = products.filter((p) => p.category.id === c.id).length;
    if (count > 0) {
      setCatError(`"${c.name}" still has ${count} product${count === 1 ? "" : "s"}. Move or archive them first.`);
      return;
    }
    if (!confirm(`Delete category "${c.name}"?`)) return;
    setCatError(null);
    const res = await fetch(`/api/admin/categories/${c.id}`, { method: "DELETE" });
    if (res.ok) {
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      setCatError(d.error ?? "Could not delete category");
    }
  }

  async function uploadImage(product: Product, file: File) {
    setUploadingId(product.id);
    const fd = new FormData();
    fd.append("image", file);
    await fetch(`/api/admin/products/${product.id}/image`, { method: "POST", body: fd });
    setUploadingId(null);
    load();
  }

  const visible = products.filter((p) => !p.archived);
  const byCategory = categories
    .map((c) => ({ category: c, items: visible.filter((p) => p.category.id === c.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="p-8">
      <h1 className="mb-1 text-3xl font-bold">Products</h1>
      <p className="mb-6 text-gray-500">{visible.length} active</p>

      {/* Categories */}
      <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">Categories</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          {categories.length === 0 && (
            <span className="text-sm text-gray-500">No categories yet — add one below.</span>
          )}
          {categories.map((c, i) => {
            const count = products.filter((p) => p.category.id === c.id).length;
            return (
              <span key={c.id} className="flex items-center gap-1 rounded-full bg-gray-800 py-1.5 pl-2 pr-2 text-sm">
                <button
                  onClick={() => moveCategory(i, -1)}
                  disabled={i === 0}
                  title="Move left"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-base leading-none text-gray-400 transition-colors hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  ‹
                </button>
                <button
                  onClick={() => moveCategory(i, 1)}
                  disabled={i === categories.length - 1}
                  title="Move right"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-base leading-none text-gray-400 transition-colors hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  ›
                </button>
                <span className="ml-1 font-medium">{c.name}</span>
                <span className="text-gray-500">{count}</span>
                <button
                  onClick={() => deleteCategory(c)}
                  title={count > 0 ? "Empty this category before deleting" : `Delete "${c.name}"`}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-base leading-none transition-colors ${
                    count > 0
                      ? "cursor-not-allowed text-gray-600"
                      : "text-gray-400 hover:bg-red-600 hover:text-white"
                  }`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
        <form onSubmit={addCategory} className="flex flex-wrap items-center gap-3">
          <input
            value={newCategory}
            onChange={(e) => { setNewCategory(e.target.value); setCatError(null); }}
            placeholder="New category name"
            className="w-56 rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" disabled={catBusy || !newCategory.trim()}
            className="rounded-lg bg-gray-700 px-4 py-2 font-semibold transition-colors hover:bg-gray-600 disabled:opacity-40">
            Add category
          </button>
          {catError && <span className="text-sm text-red-400">{catError}</span>}
        </form>
      </div>

      {/* Add product form */}
      <form onSubmit={addProduct} className="mb-8 flex flex-wrap items-end gap-3 rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <Field label="Name">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            required placeholder="Stroopwafel"
            className="w-48 rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" />
        </Field>
        <Field label="Price (€)">
          <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
            required placeholder="1.50" type="number" step="0.01" min="0"
            className="w-28 rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" />
        </Field>
        <Field label="Category">
          <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            required className="w-40 rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Select…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Stock (blank = ∞)">
          <input value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })}
            placeholder="—" type="number" min="0"
            className="w-28 rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500" />
        </Field>
        <button type="submit" disabled={saving}
          className="rounded-lg bg-blue-600 px-5 py-2 font-semibold transition-colors hover:bg-blue-500 disabled:opacity-40">
          Add product
        </button>
      </form>

      {/* Product list grouped by category */}
      <div className="space-y-8">
        {byCategory.map(({ category, items }) => (
          <div key={category.id}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">{category.name}</h2>
            <div className="space-y-2">
              {items.map((p) => (
                <div key={p.id} className="flex items-center gap-4 rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3">
                  {/* Image thumbnail / upload */}
                  <button
                    onClick={() => fileInputRefs.current[p.id]?.click()}
                    className="group relative flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-800 transition-all hover:ring-2 hover:ring-blue-500"
                    title="Click to upload image"
                  >
                    {p.imageUrl ? (
                      <Image src={p.imageUrl} alt={p.name} fill className="object-cover" />
                    ) : (
                      <span className="text-xs text-gray-500 group-hover:text-gray-300">📷</span>
                    )}
                    {uploadingId === p.id && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <span className="animate-pulse text-xs">…</span>
                      </div>
                    )}
                  </button>
                  <input
                    ref={(el) => { fileInputRefs.current[p.id] = el; }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadImage(p, file);
                      e.target.value = "";
                    }}
                  />

                  {/* Name + stock */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{p.name}</p>
                      {(() => {
                        const stage = discountStage(p.expiresAt ? new Date(p.expiresAt) : null);
                        return stage ? (
                          <span className="flex-shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
                            {stage === "FREE" ? "FREE" : "-50%"}
                          </span>
                        ) : null;
                      })()}
                    </div>
                    <p className="text-sm text-gray-500">
                      {p.stock !== null ? `${p.stock} in stock` : "Unlimited stock"}
                    </p>
                  </div>

                  {/* Best-before date */}
                  <div className="flex-shrink-0">
                    <label className="mb-0.5 block text-[11px] text-gray-500">Best before</label>
                    <input
                      type="date"
                      value={p.expiresAt ? p.expiresAt.slice(0, 10) : ""}
                      onChange={(e) => patch(p.id, { expiresAt: e.target.value || null })}
                      title="Set a best-before date (50% off in its final week and after)"
                      className="rounded-lg bg-gray-800 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 [color-scheme:dark]"
                    />
                  </div>

                  {/* Category selector */}
                  <div className="flex-shrink-0">
                    <select
                      value={p.category.id}
                      onChange={(e) => {
                        if (e.target.value !== p.category.id) patch(p.id, { categoryId: e.target.value });
                      }}
                      title="Change category"
                      className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Editable price */}
                  <div className="flex-shrink-0">
                    {editingId === p.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400">€</span>
                        <input
                          autoFocus
                          type="number"
                          step="0.01"
                          min="0"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") savePrice(p);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="w-24 rounded-lg bg-gray-800 px-2 py-1.5 text-right outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button onClick={() => savePrice(p)}
                          className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold hover:bg-green-500">
                          Save
                        </button>
                        <button onClick={() => setEditingId(null)}
                          className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-300">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditPrice(p)}
                        title="Click to edit price"
                        className="group flex items-center gap-2 rounded-lg px-3 py-1.5 text-lg font-semibold tabular-nums hover:bg-gray-800"
                      >
                        {discountStage(p.expiresAt ? new Date(p.expiresAt) : null) ? (
                          <span className="flex items-baseline gap-1.5">
                            <span className="text-green-400">
                              {effectivePriceCents(p.price, new Date(p.expiresAt as string)) === 0
                                ? "Free"
                                : `€${(effectivePriceCents(p.price, new Date(p.expiresAt as string)) / 100).toFixed(2)}`}
                            </span>
                            <span className="text-sm text-gray-500 line-through">€{(p.price / 100).toFixed(2)}</span>
                          </span>
                        ) : (
                          <>€{(p.price / 100).toFixed(2)}</>
                        )}
                        <span className="text-xs text-gray-500 group-hover:text-gray-300">✎</span>
                      </button>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-shrink-0 items-center gap-3">
                    <button onClick={() => patch(p.id, { published: !p.published })}
                      className={`rounded-full px-3 py-1 text-sm ${p.published ? "bg-green-800 text-green-200" : "bg-gray-800 text-gray-300"}`}>
                      {p.published ? "Published" : "Draft"}
                    </button>
                    <button
                      onClick={() => { if (confirm(`Archive "${p.name}"?`)) patch(p.id, { archived: true }); }}
                      className="text-sm text-gray-500 hover:text-red-400"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-400">{label}</label>
      {children}
    </div>
  );
}
