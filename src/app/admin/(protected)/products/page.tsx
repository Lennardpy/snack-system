"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

interface Category { id: string; name: string }
interface Product {
  id: string;
  name: string;
  price: number;
  stock: number | null;
  published: boolean;
  archived: boolean;
  imageUrl: string | null;
  category: Category;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({ name: "", price: "", categoryId: "", stock: "" });
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
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

  async function togglePublish(product: Product) {
    await fetch(`/api/admin/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: !product.published }),
    });
    load();
  }

  async function archive(product: Product) {
    if (!confirm(`Archive "${product.name}"?`)) return;
    await fetch(`/api/admin/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    load();
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

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <h1 className="text-3xl font-bold mb-8">Products</h1>

      {/* Add product form */}
      <form onSubmit={addProduct} className="bg-gray-800 rounded-xl p-5 mb-8 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            required placeholder="Stroopwafel"
            className="bg-gray-700 rounded-lg px-3 py-2 w-48 outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Price (€)</label>
          <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
            required placeholder="1.50" type="number" step="0.01" min="0"
            className="bg-gray-700 rounded-lg px-3 py-2 w-28 outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Category</label>
          <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            required className="bg-gray-700 rounded-lg px-3 py-2 w-40 outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Select…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Stock (blank = unlimited)</label>
          <input value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })}
            placeholder="—" type="number" min="0"
            className="bg-gray-700 rounded-lg px-3 py-2 w-28 outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button type="submit" disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-5 py-2 rounded-lg font-semibold">
          Add
        </button>
      </form>

      {/* Product list */}
      <div className="space-y-2">
        {visible.map((p) => (
          <div key={p.id} className="bg-gray-800 rounded-xl px-5 py-3 flex items-center gap-4">
            {/* Image thumbnail / upload */}
            <button
              onClick={() => fileInputRefs.current[p.id]?.click()}
              className="relative w-14 h-14 rounded-lg overflow-hidden bg-gray-700 flex-shrink-0 flex items-center justify-center hover:ring-2 hover:ring-blue-500 transition-all group"
              title="Click to upload image"
            >
              {p.imageUrl ? (
                <Image src={p.imageUrl} alt={p.name} fill className="object-cover" />
              ) : (
                <span className="text-gray-500 text-xs group-hover:text-gray-300">📷</span>
              )}
              {uploadingId === p.id && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <span className="text-xs animate-pulse">…</span>
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

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{p.name}</p>
              <p className="text-gray-400 text-sm">
                €{(p.price / 100).toFixed(2)} · {p.category.name}
                {p.stock !== null && ` · ${p.stock} in stock`}
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <button onClick={() => togglePublish(p)}
                className={`text-sm px-3 py-1 rounded-full ${p.published ? "bg-green-800 text-green-200" : "bg-gray-700 text-gray-300"}`}>
                {p.published ? "Published" : "Draft"}
              </button>
              <button onClick={() => archive(p)} className="text-gray-500 hover:text-red-400 text-sm">
                Archive
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
