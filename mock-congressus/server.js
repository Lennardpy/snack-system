// Mock Congressus v30 API for the STAGING environment — never deployed to
// production. Staging points CONGRESSUS_API_URL here so an export or product sync
// can never create anything in a real Congressus.
//
// Two tenants, chosen by the Bearer token (MOCK_TOKENS="stress:<tok>,dimensie:<tok>"):
//   • stress   — members + product offers loaded from the (anonymised) staging DB,
//                so congressusIds and offer ids match what the app has.
//   • dimensie — generated members (no real data). A few share an email or a
//                Congressus id with a Stress member, to test dual members and id
//                collisions.
// Member status, workflow and folder ids are the real ones (read once from both
// Congressus instances); no real names or emails are stored here.
//
// Mimics the quirks we found in the real API (docs/CONGRESSUS.md): any VAT field
// on a product write → 500; an invoice without items → 500; POST /products returns
// the product ENTITY id, the offer id only shows in the folder listing;
// POST /sale-invoices/{id}/items → 500.
//
// Inspect / control (MOCK_ADMIN_KEY): GET /__mock?key=… shows everything created;
// POST /__mock/fail?key=…  {tenant, mode: "400"|"500"|"timeout", count} makes the
// next invoice POSTs fail ("timeout" waits 35 s, longer than the app's 30 s, and
// then DOES create the invoice — the "outcome unknown" case); POST /__mock/reset.

const http = require("http");
const { Client } = require("pg");

const PORT = Number(process.env.PORT ?? 4555);
const ADMIN_KEY = process.env.MOCK_ADMIN_KEY ?? "";
// Staging's DB is a copy of production, so it holds REAL Congressus ids (e.g. the
// Dimensie products linked by a migration) that this mock never created. With
// MOCK_LENIENT=1 an unknown product offer or folder is accepted (as a product
// without VAT / a new folder) instead of rejected.
const LENIENT = process.env.MOCK_LENIENT === "1";
const TOKENS = new Map(
  (process.env.MOCK_TOKENS ?? "")
    .split(",")
    .map((p) => p.trim().split(":"))
    .filter((p) => p.length === 2 && p[1])
    .map(([tenant, tok]) => [tok, tenant])
);

const VAT = {
  194: { id: 194, name: "VH", percentage: 21 },
  195: { id: 195, name: "VL", percentage: 9 },
};

function emptyTenant(cfg) {
  return { ...cfg, members: [], products: [], invoices: [], fail: null };
}

const tenants = {
  stress: emptyTenant({
    statuses: [
      { id: 1845, name: "The Primary Membership", archived: false, deceased: false },
      { id: 1844, name: "The Secondary membership", archived: false, deceased: false },
      { id: 4119, name: "Honorary", archived: false, deceased: false },
      { id: 4120, name: "Teacher", archived: false, deceased: false },
      { id: 4768, name: "Unsubscribed", archived: true, deceased: false },
    ],
    workflows: [605, 196],
    folders: [
      { id: 5578, name: "1. Mendix" },
      { id: 5952, name: "SSS" },
      { id: 8804, name: "PPP" },
    ],
  }),
  dimensie: emptyTenant({
    statuses: [
      { id: 1588, name: "Lid", archived: false, deceased: false },
      { id: 1671, name: "Extraordinary member", archived: false, deceased: false },
      { id: 1672, name: "Erelid", archived: false, deceased: false },
      { id: 1673, name: "Donateur", archived: false, deceased: false },
      { id: 1587, name: "Lid-af", archived: true, deceased: false },
    ],
    workflows: [309],
    folders: [
      { id: 1442, name: "Evenementen" },
      { id: 1445, name: "Overig" },
      { id: 1921, name: "Streepcomputer" },
    ],
  }),
};

let nextOfferId = 990000;
let nextInvoiceId = 900000;
let nextFolderId = 99000;

function member(id, first, last, email, status) {
  return {
    id,
    username: email.split("@")[0],
    first_name: first,
    last_name: last,
    email,
    status,
    deleted: false,
    locked: false,
  };
}

function product(offerId, name, price, folderId, vatId) {
  return {
    id: offerId,
    product_id: offerId - 8000, // entity id ≠ offer id, like the real API
    product_offer_id: offerId,
    name,
    price,
    published: true,
    is_archived: false,
    folder_id: folderId,
    folder: { id: folderId },
    vat_category: vatId ? VAT[vatId] : null,
  };
}

async function load() {
  const s = tenants.stress;
  const d = tenants.dimensie;
  s.members = [];
  s.products = [];
  d.members = [];
  d.products = [];
  s.invoices = [];
  d.invoices = [];

  // ── Stress: from the staging DB ────────────────────────────────────────────
  if (process.env.DATABASE_URL) {
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await db.connect();
      const m = await db.query(
        `select "congressusId", "firstName", "lastName", email from "Member"
         where "congressusId" is not null and "deletedAt" is null and active order by "congressusId"`
      );
      const primary = s.statuses[0];
      for (const r of m.rows) s.members.push(member(r.congressusId, r.firstName, r.lastName, r.email, primary));
      const vatId = (v) => (v === "STANDARD" ? 194 : v === "LOW" ? 195 : null);
      const sss = await db.query(
        `select "congressusProductOfferId" o, name, price, "vatCategory" v from "Product" where "congressusProductOfferId" is not null`
      );
      for (const r of sss.rows) s.products.push(product(r.o, r.name, r.price / 100, 5952, vatId(r.v)));
      const ppp = await db.query(
        `select "congressusProductOfferId" o, name, price, "vatCategory" v from "PppProduct" where "congressusProductOfferId" is not null`
      );
      for (const r of ppp.rows) s.products.push(product(r.o, r.name, r.price / 100, 8804, vatId(r.v)));
    } catch (err) {
      console.error("Could not load Stress data from the staging DB:", err.message);
    } finally {
      await db.end().catch(() => {});
    }
  }
  const fallback = Number(process.env.MENDIX_OFFER_ID ?? 118389);
  if (!s.products.some((p) => p.id === fallback)) {
    s.products.push(product(fallback, "SSS purchases Mendix", 0.01, 5578, null));
  }

  // ── Dimensie: generated ────────────────────────────────────────────────────
  const [lid, extra, erelid] = d.statuses;
  for (let i = 1; i <= 120; i++) {
    const status = i <= 100 ? lid : i <= 116 ? extra : erelid;
    d.members.push(member(700000 + i, "Dimensie", String(i).padStart(4, "0"), `dimensie${i}@staging.local`, status));
  }
  // 10 dual members: same email as a Stress member (one person, two associations).
  s.members.slice(0, 10).forEach((sm, i) => {
    d.members.push(member(710000 + i, sm.first_name, sm.last_name, sm.email, lid));
  });
  // 3 different people whose Dimensie id equals a Stress id (ids are per instance).
  s.members.slice(10, 13).forEach((sm, i) => {
    d.members.push(member(sm.id, "Clash", String(i + 1), `clash${i + 1}@staging.local`, lid));
  });
  // No VAT categories at Dimensie.
  ["Snickers", "Mars", "Coca Cola"].forEach((n, i) => d.products.push(product(980000 + i, n, 0.6, 1921, null)));

  console.log(
    `Loaded: stress ${s.members.length} members / ${s.products.length} products; ` +
      `dimensie ${d.members.length} members / ${d.products.length} products`
  );
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

function page(rows, q) {
  const size = Math.min(Number(q.get("page_size") ?? 25), 100);
  const num = Math.max(Number(q.get("page") ?? 1), 1);
  const data = rows.slice((num - 1) * size, num * size);
  const hasNext = num * size < rows.length;
  return {
    data,
    total: rows.length,
    has_next: hasNext,
    has_prev: num > 1,
    next_num: hasNext ? num + 1 : null,
    prev_num: num > 1 ? num - 1 : null,
  };
}

const hasVatField = (b) => Object.keys(b).some((k) => k.startsWith("vat"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function invoiceTotals(inv) {
  let incl = 0;
  let vat = 0;
  for (const it of inv.items) {
    const line = it.quantity * it.price;
    incl += line;
    if (it.vat_percentage) vat += line - line / (1 + it.vat_percentage / 100);
  }
  inv.price_inclusive_vat = Math.round(incl * 100) / 100;
  inv.price_exclusive_vat = Math.round((incl - vat) * 100) / 100;
  inv.price_unpaid = inv.price_inclusive_vat;
  inv.price_paid = 0;
}

async function createInvoice(t, b, res) {
  if (!Array.isArray(b.items) || b.items.length === 0) return send(res, 500, "Internal Server Error", "text/plain");
  const m = t.members.find((x) => x.id === b.member_id);
  if (!m) return send(res, 400, { message: `member_id ${b.member_id}: Member not found` });
  if (!t.workflows.includes(b.invoice_workflow_id)) {
    return send(res, 400, { message: `invoice_workflow_id: Unknown workflow ${b.invoice_workflow_id}` });
  }
  const items = [];
  for (const [i, it] of b.items.entries()) {
    let p = t.products.find((x) => x.product_offer_id === it.product_offer_id);
    if (!p && LENIENT) {
      p = product(it.product_offer_id, it.description ?? `Offer ${it.product_offer_id}`, it.price, 0, null);
      t.products.push(p);
    }
    if (!p) return send(res, 400, { message: `product_offer_id ${it.product_offer_id}: Not found` });
    if (p.is_archived) return send(res, 400, { message: `Product "${p.name}" is archived and cannot be used for new invoices` });
    items.push({
      id: nextInvoiceId * 10 + i,
      product_offer_id: p.product_offer_id,
      name: p.name,
      description: it.description ?? p.name,
      quantity: it.quantity,
      price: it.price,
      sort_order: i,
      vat_category_id: p.vat_category?.id ?? null,
      vat_percentage: p.vat_category?.percentage ?? null,
    });
  }
  const inv = {
    id: ++nextInvoiceId,
    member_id: m.id,
    addressee: `${m.first_name} ${m.last_name}`,
    invoice_date: b.invoice_date,
    invoice_reference: b.invoice_reference ?? null,
    invoice_status: "concept",
    invoice_workflow_id: b.invoice_workflow_id,
    use_direct_debit: !!b.use_direct_debit,
    created: new Date().toISOString(),
    items,
  };
  invoiceTotals(inv);
  t.invoices.push(inv);
  return inv;
}

async function api(t, method, path, q, b, res) {
  let m;
  if (method === "GET" && path === "/member-statuses") return send(res, 200, page(t.statuses, q));
  if (method === "GET" && path === "/members") {
    const sid = q.get("status_id");
    return send(res, 200, page(sid ? t.members.filter((x) => String(x.status.id) === sid) : t.members, q));
  }
  if (method === "GET" && path === "/sale-invoices/workflows") {
    return send(res, 200, page(t.workflows.map((id) => ({ id, name: `Workflow ${id}`, deleted: false })), q));
  }
  if (method === "GET" && path === "/product-folders") return send(res, 200, page(t.folders, q));
  if (method === "POST" && path === "/product-folders") {
    const f = { id: ++nextFolderId, name: b.name, parent_id: b.parent_id ?? null };
    t.folders.push(f);
    return send(res, 201, f);
  }
  if (method === "GET" && path === "/products") {
    const fid = q.get("folder_id");
    return send(res, 200, page(fid ? t.products.filter((p) => String(p.folder_id) === fid) : t.products, q));
  }
  if (method === "POST" && path === "/products") {
    if (hasVatField(b)) return send(res, 500, "Internal Server Error", "text/plain");
    if (!t.folders.some((f) => f.id === b.folder_id)) {
      if (!LENIENT) return send(res, 400, { message: "folder_id: Not found" });
      t.folders.push({ id: b.folder_id, name: `Folder ${b.folder_id}`, parent_id: null });
    }
    const p = product(++nextOfferId, b.name, b.price, b.folder_id, null);
    t.products.push(p);
    // Quirk: the POST response carries the ENTITY id, not the offer id.
    return send(res, 201, { id: p.product_id, product_offer_id: p.product_id, name: p.name });
  }
  if ((m = path.match(/^\/products\/(\d+)$/))) {
    const p = t.products.find((x) => x.id === Number(m[1]));
    if (!p) return send(res, 404, { message: "Not found" });
    if (method === "GET") return send(res, 200, p);
    if (method === "PUT") {
      if (hasVatField(b)) return send(res, 500, "Internal Server Error", "text/plain");
      Object.assign(p, {
        name: b.name ?? p.name,
        price: b.price ?? p.price,
        published: b.published ?? p.published,
        is_archived: b.is_archived ?? p.is_archived,
      });
      return send(res, 200, p);
    }
    if (method === "DELETE") {
      t.products = t.products.filter((x) => x !== p);
      return send(res, 204, "", "text/plain");
    }
  }
  if (method === "GET" && path === "/sale-invoices") {
    const st = q.get("invoice_status");
    return send(res, 200, page(st ? t.invoices.filter((i) => i.invoice_status === st) : t.invoices, q));
  }
  if (method === "POST" && path === "/sale-invoices") {
    if (t.fail && t.fail.count > 0) {
      t.fail.count--;
      if (t.fail.mode === "timeout") {
        await sleep(35_000);
        const inv = await createInvoice(t, b, { writeHead() {}, end() {} });
        if (!res.writableEnded) send(res, 201, inv ?? {});
        return;
      }
      return send(res, Number(t.fail.mode), { message: `Mock failure ${t.fail.mode}` });
    }
    const inv = await createInvoice(t, b, res);
    if (inv) send(res, 201, inv);
    return;
  }
  if ((m = path.match(/^\/sale-invoices\/(\d+)\/items$/))) return send(res, 500, "Internal Server Error", "text/plain");
  if ((m = path.match(/^\/sale-invoices\/(\d+)$/))) {
    const inv = t.invoices.find((x) => x.id === Number(m[1]));
    if (!inv) return send(res, 404, { message: "Not found" });
    if (method === "GET") return send(res, 200, inv);
    if (method === "DELETE") {
      t.invoices = t.invoices.filter((x) => x !== inv);
      return send(res, 204, "", "text/plain");
    }
  }
  return send(res, 404, { message: `Mock: ${method} ${path} not implemented` });
}

// ── Inspect page ─────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function dashboard() {
  const section = (name, t) => {
    const rows = t.invoices
      .map(
        (i) =>
          `<tr><td>${i.id}</td><td>${i.member_id}</td><td>${esc(i.addressee)}</td><td>${esc(i.invoice_reference)}</td>` +
          `<td>${i.invoice_workflow_id}</td><td>${i.use_direct_debit ? "yes" : "no"}</td><td>${i.items.length}</td>` +
          `<td>€${i.price_exclusive_vat.toFixed(2)}</td><td>€${i.price_inclusive_vat.toFixed(2)}</td>` +
          `<td>${esc(i.items.map((it) => `${it.quantity}× ${it.description} @ ${it.price}${it.vat_percentage ? ` (${it.vat_percentage}%)` : " (no VAT)"}`).join("; "))}</td></tr>`
      )
      .join("");
    const created = t.products.filter((p) => p.id > 990000);
    return (
      `<h2>${name}</h2><p>${t.members.length} members · ${t.products.length} products ` +
      `(${created.length} created via API: ${esc(created.map((p) => `${p.name} [${p.folder_id}]`).join(", ") || "none")}) · ` +
      `failure injection: ${t.fail ? `${t.fail.mode} ×${t.fail.count}` : "off"}</p>` +
      `<table><tr><th>id</th><th>member</th><th>addressee</th><th>reference</th><th>workflow</th><th>DD</th><th>items</th>` +
      `<th>excl</th><th>incl</th><th>lines</th></tr>${rows || '<tr><td colspan="10">No invoices yet</td></tr>'}</table>`
    );
  };
  return (
    `<!doctype html><meta charset="utf-8"><title>Mock Congressus</title>` +
    `<style>body{font:14px system-ui;margin:24px;background:#111;color:#eee}table{border-collapse:collapse;width:100%}` +
    `td,th{border:1px solid #333;padding:4px 6px;text-align:left;vertical-align:top}th{background:#222}</style>` +
    `<h1>Mock Congressus (staging)</h1>${section("Stress", tenants.stress)}${section("Dimensie", tenants.dimensie)}`
  );
}

// ── Server ───────────────────────────────────────────────────────────────────

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const url = new URL(req.url, "http://mock");
      const path = url.pathname.replace(/^\/v30/, "");
      try {
        if (path === "/health") return send(res, 200, { ok: true });
        if (path.startsWith("/__mock")) {
          if (!ADMIN_KEY || url.searchParams.get("key") !== ADMIN_KEY) return send(res, 401, { message: "Unauthorized" });
          if (req.method === "GET" && path === "/__mock") return send(res, 200, dashboard(), "text/html; charset=utf-8");
          if (req.method === "GET" && path === "/__mock/state") {
            const out = {};
            for (const [n, t] of Object.entries(tenants)) out[n] = { invoices: t.invoices, createdProducts: t.products.filter((p) => p.id > 990000), fail: t.fail };
            return send(res, 200, out);
          }
          if (req.method === "POST" && path === "/__mock/fail") {
            const b = JSON.parse(raw || "{}");
            const t = tenants[b.tenant];
            if (!t || !["400", "500", "timeout"].includes(String(b.mode))) return send(res, 400, { message: "tenant + mode required" });
            t.fail = { mode: String(b.mode), count: Number(b.count ?? 1) };
            return send(res, 200, { ok: true, fail: t.fail });
          }
          if (req.method === "POST" && path === "/__mock/reset") {
            await load();
            return send(res, 200, { ok: true });
          }
          return send(res, 404, { message: "Not found" });
        }
        const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        const tenant = tenants[TOKENS.get(token)];
        if (!tenant) return send(res, 401, { message: "Invalid API token" });
        let body = {};
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            return send(res, 400, { message: "Invalid JSON" });
          }
        }
        await api(tenant, req.method, path, url.searchParams, body, res);
      } catch (err) {
        console.error(err);
        if (!res.writableEnded) send(res, 500, "Internal Server Error", "text/plain");
      }
    });
  })
  .listen(PORT, async () => {
    await load();
    console.log(`Mock Congressus listening on :${PORT}`);
  });
