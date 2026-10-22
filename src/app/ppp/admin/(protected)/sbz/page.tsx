"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SBZ_SECTIONS, sbzKeyFor, type SbzPriceListInfo, type SbzProduct, type SbzUnit } from "@/lib/sbz";

// SBZ cost prices (what the association pays SBZ). Versioned: saving creates a
// list valid from a chosen date; borrels before that date keep the older prices.

interface PdfRow {
  name: string;
  section: string;
  unit: SbzUnit;
  vatRate: number;
  oldExclCents: number | null;
  oldInclCents: number | null;
  costExclCents: number;
  costInclCents: number;
  matchKey: string | null;
}

type RowStatus = "updated" | "unchanged" | "new" | "kept";
interface DraftRow {
  key: string;
  name: string;
  section: string;
  unit: SbzUnit;
  vatRate: number;
  excl: string; // euro input
  incl: string;
  onRequest: boolean;
  status?: RowStatus; // PDF import only
  prevExclCents?: number;
  prevInclCents?: number;
}
interface Draft {
  mode: "edit" | "pdf";
  label: string;
  validFrom: string; // YYYY-MM-DD
  source: string;
  rows: DraftRow[];
}

const euro = (c: number) => `€${(c / 100).toFixed(2)}`;
const toCents = (s: string) => Math.round(Number(String(s).replace(",", ".")) * 100);
const ymd = (iso: string) => iso.slice(0, 10);
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const today = () => new Date().toISOString().slice(0, 10);
const isBase = (iso: string) => iso.startsWith("2000-01-01");

function toDraftRow(p: SbzProduct): DraftRow {
  return {
    key: p.key,
    name: p.name,
    section: p.section,
    unit: p.unit,
    vatRate: p.vatRate,
    excl: (p.costExclCents / 100).toFixed(2),
    incl: (p.costInclCents / 100).toFixed(2),
    onRequest: p.onRequest ?? false,
  };
}

export default function SbzPricesPage() {
  const [lists, setLists] = useState<SbzPriceListInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (selectId?: string) => {
    const res = await fetch("/api/admin/ppp/sbz");
    if (res.ok) {
      const d = await res.json();
      setLists(d.lists);
      setCurrentId(d.currentId);
      setViewId(selectId ?? d.currentId);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const viewed = lists.find((l) => l.id === viewId) ?? null;
  const newest = lists[0] ?? null; // newest validFrom — the base for edits/imports

  // ── Draft (edit / PDF import) ──────────────────────────────────────────────
  function startEdit() {
    if (!newest) return;
    setError("");
    setNotice("");
    setDraft({
      mode: "edit",
      label: "",
      validFrom: today(),
      source: "manual edit",
      rows: newest.items.map(toDraftRow),
    });
  }

  async function importPdf(file: File) {
    if (!newest) return;
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/admin/ppp/sbz/parse", { method: "POST", body: form });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error ?? "Could not read the PDF");
      return;
    }
    const pdfRows: PdfRow[] = d.rows;
    const byKey = new Map(pdfRows.filter((r) => r.matchKey).map((r) => [r.matchKey!, r]));
    // Start from the newest list: matched items get the PDF's new price; items not
    // in the PDF are kept as they are; PDF rows without a match become new items.
    const rows: DraftRow[] = newest.items.map((p) => {
      const r = byKey.get(p.key);
      if (!r) return { ...toDraftRow(p), status: "kept" };
      const changed = r.costExclCents !== p.costExclCents || r.costInclCents !== p.costInclCents || r.vatRate !== p.vatRate;
      return {
        ...toDraftRow(p),
        vatRate: r.vatRate,
        excl: (r.costExclCents / 100).toFixed(2),
        incl: (r.costInclCents / 100).toFixed(2),
        status: changed ? "updated" : "unchanged",
        prevExclCents: p.costExclCents,
        prevInclCents: p.costInclCents,
      };
    });
    const taken = new Set(rows.map((r) => r.key));
    for (const r of pdfRows.filter((x) => !x.matchKey)) {
      const key = sbzKeyFor(r.name, taken);
      taken.add(key);
      rows.push({
        key,
        name: r.name,
        section: r.section,
        unit: r.unit,
        vatRate: r.vatRate,
        excl: (r.costExclCents / 100).toFixed(2),
        incl: (r.costInclCents / 100).toFixed(2),
        onRequest: r.section === "On request",
        status: "new",
      });
    }
    setDraft({
      mode: "pdf",
      label: d.label ?? `SBZ price list ${d.validFrom ?? today()}`,
      validFrom: d.validFrom ?? today(),
      source: `PDF: ${d.fileName ?? "upload"}`,
      rows,
    });
  }

  const updateRow = (i: number, patch: Partial<DraftRow>) =>
    setDraft((d) => (d ? { ...d, rows: d.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : d));
  const removeRow = (i: number) => setDraft((d) => (d ? { ...d, rows: d.rows.filter((_, j) => j !== i) } : d));
  function addRow() {
    setDraft((d) => {
      if (!d) return d;
      const key = sbzKeyFor("new item", new Set(d.rows.map((r) => r.key)));
      return {
        ...d,
        rows: [...d.rows, { key, name: "", section: "Other", unit: "UNIT", vatRate: 21, excl: "", incl: "", onRequest: false }],
      };
    });
  }

  const replacing = useMemo(
    () => (draft ? lists.find((l) => ymd(l.validFrom) === draft.validFrom) ?? null : null),
    [draft, lists]
  );

  async function saveDraft() {
    if (!draft) return;
    setError("");
    const isNew = (r: DraftRow) => r.status === "new" || r.key.startsWith("new-item");
    // Reserve existing keys first so a new item can never take one.
    const taken = new Set(draft.rows.filter((r) => !isNew(r)).map((r) => r.key));
    const items: SbzProduct[] = [];
    for (const r of draft.rows) {
      const name = r.name.trim();
      if (!name) return setError("Every item needs a name.");
      const excl = toCents(r.excl);
      const incl = toCents(r.incl);
      if (!Number.isFinite(excl) || !Number.isFinite(incl) || excl < 0 || incl < 0)
        return setError(`"${name}": enter valid prices.`);
      // Brand-new rows get a key from their (final) name.
      const key = isNew(r) ? sbzKeyFor(name, taken) : r.key;
      taken.add(key);
      items.push({ key, name, section: r.section, unit: r.unit, vatRate: r.vatRate, costExclCents: excl, costInclCents: incl, onRequest: r.onRequest });
    }
    const msg = replacing
      ? `A price list already starts on ${fmtDay(replacing.validFrom)} ("${replacing.label}"). Replace it?`
      : `Save as a new price list valid from ${fmtDay(draft.validFrom)}?\n\nBorrels before that date keep their current cost prices.`;
    if (!confirm(msg)) return;
    setBusy(true);
    const res = await fetch("/api/admin/ppp/sbz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: draft.label, validFrom: draft.validFrom, source: draft.source, items }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(d.error ?? "Could not save");
    setDraft(null);
    setNotice(
      `${d.replaced ? "Replaced" : "Saved"} price list valid from ${fmtDay(draft.validFrom)}. Borrels before that date are unchanged.`
    );
    load(d.id);
  }

  async function deleteList(l: SbzPriceListInfo) {
    if (!confirm(`Delete "${l.label}" (valid from ${fmtDay(l.validFrom)})?\n\nBorrels it covered fall back to the previous price list.`)) return;
    const res = await fetch(`/api/admin/ppp/sbz/${l.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return alert(d.error ?? "Could not delete");
    setNotice(`Deleted "${l.label}".`);
    load();
  }

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold">SBZ prices</h1>
          <p className="text-gray-500">
            What we pay SBZ per drink — the cost of goods in each borrel&apos;s profit/loss. Each price list is valid
            from its date; a borrel is always costed with the list valid on its date, so new prices never change older
            borrels.
          </p>
        </div>
        {!draft && (
          <div className="flex gap-2">
            <button
              onClick={startEdit}
              className="rounded-xl bg-gray-800 px-4 py-2.5 text-sm font-medium text-gray-200 hover:bg-gray-700"
            >
              ✏️ Edit prices
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold hover:bg-amber-500 disabled:opacity-40"
            >
              {busy ? "Reading PDF…" : "⬆ Upload price list PDF"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importPdf(f);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-900/30 px-4 py-2 text-sm text-red-300">{error}</p>}
      {notice && (
        <p className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-green-900/20 px-4 py-2 text-sm text-green-300">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="opacity-60 hover:opacity-100">✕</button>
        </p>
      )}

      {draft ? (
        <DraftEditor
          draft={draft}
          setDraft={setDraft}
          replacing={replacing}
          busy={busy}
          onUpdate={updateRow}
          onRemove={removeRow}
          onAdd={addRow}
          onSave={saveDraft}
          onCancel={() => {
            setDraft(null);
            setError("");
          }}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[18rem_1fr]">
          {/* Versions */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">Price lists</h2>
            <ul className="space-y-2">
              {lists.map((l) => (
                <li key={l.id}>
                  <button
                    onClick={() => setViewId(l.id)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                      viewId === l.id ? "border-amber-600 bg-amber-900/20" : "border-gray-800 bg-gray-900 hover:border-gray-600"
                    }`}
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <span className="truncate">{l.label}</span>
                      {l.id === currentId && (
                        <span className="flex-shrink-0 rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-400">current</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {isBase(l.validFrom) ? "Base — all earlier borrels" : `Valid from ${fmtDay(l.validFrom)}`} ·{" "}
                      {l.items.length} items
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Selected list */}
          {viewed && (
            <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{viewed.label}</h2>
                  <p className="text-sm text-gray-500">
                    {isBase(viewed.validFrom) ? "Base list — applies to all borrels before the next list" : `Valid from ${fmtDay(viewed.validFrom)}`}
                    {viewed.source ? ` · ${viewed.source}` : ""}
                  </p>
                </div>
                {viewed.id !== lists[lists.length - 1]?.id && (
                  <button
                    onClick={() => deleteList(viewed)}
                    className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-red-600 hover:text-white"
                  >
                    Delete this list
                  </button>
                )}
              </div>
              <PriceTable items={viewed.items} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function PriceTable({ items }: { items: SbzProduct[] }) {
  return (
    <div className="space-y-5">
      {SBZ_SECTIONS.map((section) => {
        const rows = items.filter((p) => p.section === section);
        if (rows.length === 0) return null;
        return (
          <div key={section}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{section}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-1 font-medium">Product</th>
                  <th className="py-1 font-medium">Per</th>
                  <th className="py-1 text-right font-medium">BTW</th>
                  <th className="py-1 text-right font-medium">Excl. BTW</th>
                  <th className="py-1 text-right font-medium">Incl. BTW</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {rows.map((p) => (
                  <tr key={p.key}>
                    <td className="py-1.5">{p.name}</td>
                    <td className="py-1.5 text-gray-400">{p.unit === "LITER" ? "liter (keg)" : "unit"}</td>
                    <td className="py-1.5 text-right text-gray-400">{p.vatRate}%</td>
                    <td className="py-1.5 text-right tabular-nums text-gray-300">{euro(p.costExclCents)}</td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">{euro(p.costInclCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

const STATUS_CHIP: Record<RowStatus, string> = {
  updated: "bg-amber-500/15 text-amber-300",
  unchanged: "bg-gray-700/40 text-gray-400",
  new: "bg-green-500/15 text-green-400",
  kept: "bg-blue-500/15 text-blue-300",
};
const STATUS_LABEL: Record<RowStatus, string> = {
  updated: "price changed",
  unchanged: "same price",
  new: "new item",
  kept: "not in PDF — kept",
};

function DraftEditor({
  draft,
  setDraft,
  replacing,
  busy,
  onUpdate,
  onRemove,
  onAdd,
  onSave,
  onCancel,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
  replacing: SbzPriceListInfo | null;
  busy: boolean;
  onUpdate: (i: number, patch: Partial<DraftRow>) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const counts = draft.rows.reduce<Record<string, number>>((c, r) => {
    if (r.status) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, {});
  const input = "rounded-lg bg-gray-800 px-2 py-1 outline-none focus:ring-2 focus:ring-amber-500";

  return (
    <section className="rounded-2xl border border-amber-700/40 bg-gray-900 p-6">
      <h2 className="mb-1 text-lg font-semibold">
        {draft.mode === "pdf" ? "Review the uploaded price list" : "Edit prices"}
      </h2>
      <p className="mb-4 text-sm text-gray-500">
        Saved as a <b className="text-gray-300">new price list valid from the date below</b>. Borrels before that date
        keep their current cost prices.
        {draft.mode === "pdf" && (
          <>
            {" "}
            {counts.updated ?? 0} price changes, {counts.unchanged ?? 0} unchanged, {counts.new ?? 0} new,{" "}
            {counts.kept ?? 0} kept (not in the PDF). Check the result, then save.
          </>
        )}
      </p>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-400">Name</span>
          <input
            value={draft.label}
            onChange={(e) => setDraft((d) => (d ? { ...d, label: e.target.value } : d))}
            placeholder="e.g. SBZ price list 1 Nov 2026"
            className={`${input} w-80 py-2`}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-400">Valid from</span>
          <input
            type="date"
            value={draft.validFrom}
            onChange={(e) => setDraft((d) => (d ? { ...d, validFrom: e.target.value } : d))}
            className={`${input} py-2`}
          />
        </label>
        {replacing && (
          <p className="pb-2 text-sm text-amber-300">
            Replaces &ldquo;{replacing.label}&rdquo;, which starts the same day.
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-1 font-medium">Product</th>
              <th className="py-1 font-medium">Section</th>
              <th className="py-1 font-medium">Per</th>
              <th className="py-1 font-medium">BTW</th>
              <th className="py-1 text-right font-medium">Excl. €</th>
              <th className="py-1 text-right font-medium">Incl. €</th>
              {draft.mode === "pdf" && <th className="py-1 pl-3 font-medium">Change</th>}
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {draft.rows.map((r, i) => (
              <tr key={r.key}>
                <td className="py-1.5 pr-2">
                  <input value={r.name} onChange={(e) => onUpdate(i, { name: e.target.value })} className={`${input} w-full`} />
                </td>
                <td className="py-1.5 pr-2">
                  <select value={r.section} onChange={(e) => onUpdate(i, { section: e.target.value, onRequest: e.target.value === "On request" })} className={input}>
                    {SBZ_SECTIONS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 pr-2">
                  <select value={r.unit} onChange={(e) => onUpdate(i, { unit: e.target.value as SbzUnit })} className={input}>
                    <option value="LITER">liter (keg)</option>
                    <option value="UNIT">unit</option>
                  </select>
                </td>
                <td className="py-1.5 pr-2">
                  <select value={r.vatRate} onChange={(e) => onUpdate(i, { vatRate: Number(e.target.value) })} className={input}>
                    <option value={21}>21%</option>
                    <option value={9}>9%</option>
                  </select>
                </td>
                <td className="py-1.5 pr-2 text-right">
                  <input value={r.excl} inputMode="decimal" onChange={(e) => onUpdate(i, { excl: e.target.value })} className={`${input} w-20 text-right`} />
                </td>
                <td className="py-1.5 pr-2 text-right">
                  <input value={r.incl} inputMode="decimal" onChange={(e) => onUpdate(i, { incl: e.target.value })} className={`${input} w-20 text-right font-semibold`} />
                </td>
                {draft.mode === "pdf" && (
                  <td className="py-1.5 pl-3">
                    {r.status && (
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${STATUS_CHIP[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                        {r.status === "updated" && r.prevInclCents != null && (
                          <> · {euro(r.prevInclCents)} → {euro(toCents(r.incl))}</>
                        )}
                      </span>
                    )}
                  </td>
                )}
                <td className="py-1.5 pl-2 text-right">
                  <button onClick={() => onRemove(i)} title="Remove from this list" className="text-gray-500 hover:text-red-400">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button onClick={onAdd} className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-200 hover:bg-gray-700">
          + Add item
        </button>
        <span className="flex-1" />
        <button onClick={onCancel} className="rounded-xl px-4 py-2.5 text-sm text-gray-400 hover:text-white">
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={busy || !draft.validFrom}
          className="rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-semibold hover:bg-amber-500 disabled:opacity-40"
        >
          {busy ? "Saving…" : replacing ? "Replace price list" : "Save as new price list"}
        </button>
      </div>
    </section>
  );
}
