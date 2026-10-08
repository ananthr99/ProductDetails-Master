/* Product Content Hub v2 — one record per product family.
   Family content (shared by every variant) + variant table (what differs) → preview → approve.
   Approved: docs/approved/<pid>.json (family) and docs/approved/<pid>/<PART>.json (merged, one per variant).
   Static app for GitHub Pages: data/*.json is built by tools/build_data.py. */
(() => {
"use strict";

const SOURCES = [
  { key: "website", label: "Website", short: "W" },
  { key: "master", label: "Old Master", short: "M" },
  { key: "catalogue", label: "New Catalogue", short: "C" },
  { key: "datasheet", label: "Datasheet", short: "D" },
];
const SRC_LABEL = { website: "Website", master: "Old Master", catalogue: "New Catalogue", datasheet: "Datasheet", edited: "Typed in", suggested: "Suggested" };
const CH = { W: "Website", C: "Catalogue", D: "Datasheet" };
const TEXT_FIELDS = [
  { key: "title", label: "Title", hint: "e.g. Industrial 5G/4G Dual Modem Router", rows: 1 },
  { key: "tagline", label: "Tagline (above the name)", hint: "e.g. ROUTER · DUAL MODEM 5G/4G", rows: 1 },
  { key: "short_description", label: "Short description", hint: "Product card and page intro on the website", rows: 3 },
  { key: "long_description", label: "Long description", hint: "Catalogue intro and datasheet overview", rows: 4 },
];
const DERIVED_FILTERS = new Set(["Website filters::Cellular generation", "Website filters::Wi-Fi", "Website filters::RS485", "Website filters::RS232"]);
const NA_RX = /^(na|n\/a|-|—|no|none|nil|not applicable)$/i;
const SCHEMA = "invendis.product-content/v2";
const MAX_KEY = 5, MAX_FEAT = 4;
const LS = { draft: p => `pch2:draft:${p}`, approved: p => `pch2:approved:${p}`, settings: "pch:settings", ui: "pch2:ui" };

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = s => String(s).replace(/\(.*?\)/g, "").trim().replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "") || "variant";
const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const isNA = v => !String(v ?? "").trim() || NA_RX.test(String(v).trim());
const lsGet = k => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const clone = o => JSON.parse(JSON.stringify(o));

const state = {
  index: null, products: {}, approved: {}, fields: { sections: {}, fields: {}, text: {} }, icons: {},
  settings: Object.assign({ owner: "", repo: "", branch: "main", token: "", name: "", base: "docs/approved" }, lsGet(LS.settings) || {}),
  ui: Object.assign({ hide: {}, diffOnly: false, emptyOnly: false, q: "", collapsed: {}, tab: "family", pv: "W" }, lsGet(LS.ui) || {}),
  pid: null, product: null, draft: null, pvPart: "",
};
if (!state.settings.owner && location.hostname.endsWith(".github.io")) {
  state.settings.owner = location.hostname.split(".")[0];
  state.settings.repo = location.pathname.split("/").filter(Boolean)[0] || `${state.settings.owner}.github.io`;
}
const saveUI = () => lsSet(LS.ui, state.ui);
const ghReady = () => !!(state.settings.owner && state.settings.repo && state.settings.token);

/* ================================================================ data loading */
async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function loadApprovedIndex() {
  let idx = null;
  if (ghReady()) { try { idx = (await ghGet(`${state.settings.base}/index.json`)).json; } catch {} }
  if (!idx) { try { idx = await getJSON("approved/index.json"); } catch { idx = { records: {} }; } }
  state.approved = {};
  for (const [k, v] of Object.entries(idx.records || {})) if (!k.includes("/")) state.approved[k] = v;   // v1 variant entries are ignored
}
async function loadProduct(pid) {
  if (!state.products[pid]) state.products[pid] = await getJSON(`data/products/${encodeURIComponent(pid)}.json`);
  return state.products[pid];
}
async function loadApprovedRecord(pid) {
  const e = state.approved[pid], file = (e && e.file) || `${pid}.json`;
  if (ghReady()) { try { return (await ghGet(`${state.settings.base}/${file}`)).json; } catch {} }
  if (e) { try { return await getJSON(`approved/${file}`); } catch {} }
  return lsGet(LS.approved(pid));
}

/* ================================================================ GitHub */
const b64 = s => { const b = new TextEncoder().encode(s); let x = ""; b.forEach(c => x += String.fromCharCode(c)); return btoa(x); };
const unb64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), c => c.charCodeAt(0)));
async function gh(path, opts = {}) {
  const { owner, repo, token } = state.settings;
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/${path}`, {
    ...opts, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (!r.ok) { const e = new Error(`GitHub ${r.status}: ${(await r.json().catch(() => ({}))).message || r.statusText}`); e.status = r.status; throw e; }
  return r.status === 204 ? null : r.json();
}
const encPath = p => p.split("/").map(encodeURIComponent).join("/");
async function ghGet(path, ref) {
  const j = await gh(`contents/${encPath(path)}?ref=${encodeURIComponent(ref || state.settings.branch)}`);
  return { sha: j.sha, json: JSON.parse(unb64(j.content)) };
}
/* All files of one approval in a single commit; the approved index is re-read and merged on every attempt. */
async function ghCommit(files, indexUpdate, message) {
  const br = state.settings.branch, base = state.settings.base;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = await gh(`git/ref/heads/${encodeURIComponent(br)}`);
    const head = ref.object.sha;
    const commit = await gh(`git/commits/${head}`);
    let idx = { records: {} };
    try { idx = (await ghGet(`${base}/index.json`, head)).json; } catch (e) { if (e.status !== 404) throw e; }
    idx.records = idx.records || {};
    indexUpdate(idx.records); idx.updated = now();
    const all = { ...files, [`${base}/index.json`]: JSON.stringify(idx, null, 2) + "\n" };
    const tree = await gh("git/trees", { method: "POST", body: JSON.stringify({ base_tree: commit.tree.sha,
      tree: Object.entries(all).map(([path, content]) => ({ path, mode: "100644", type: "blob", content })) }) });
    const c = await gh("git/commits", { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [head] }) });
    try {
      await gh(`git/refs/heads/${encodeURIComponent(br)}`, { method: "PATCH", body: JSON.stringify({ sha: c.sha }) });
      state.approved = Object.fromEntries(Object.entries(idx.records).filter(([k]) => !k.includes("/")));
      return;
    } catch (e) { if (e.status !== 422 && e.status !== 409) throw e; }   // someone pushed in between: retry on the new head
  }
  throw new Error("The repository kept changing while saving. Try again.");
}

/* ================================================================ product helpers */
const parts = () => state.product.variants && state.product.variants.length ? state.product.variants : [state.product.name];
const multi = () => parts().length > 1;
function dsKey(part) {
  const ds = Object.keys(state.product.datasheets || {});
  return ds.find(k => k === part) || ds.find(k => norm(k) === norm(part)) || null;
}
function loadedSources() {
  const l = state.index && state.index.sources;
  return SOURCES.filter(x => !l || l.includes(x.key));
}
function showOf(row) {
  const d = state.draft, f = state.fields;
  return (d.show && d.show[row.id]) || f.fields[row.id] || f.sections[row.section] || "WCD";
}
function specRows() {           // all spec rows of the product + custom ones, Overview and derived filters left out
  const p = state.product, d = state.draft;
  const rows = p.rows.filter(r => r.section !== "Overview" && !DERIVED_FILTERS.has(r.id));
  for (const c of d.custom || []) {
    if (rows.some(r => r.id === c.id)) continue;
    const at = rows.map(r => r.section).lastIndexOf(c.section);
    rows.splice(at < 0 ? rows.length : at + 1, 0, { id: c.id, section: c.section, label: c.label, values: {}, ds: "none", custom: true, level: c.level });
  }
  return rows;
}
function isVariantRow(row) {
  const m = state.draft.moved || {};
  if (m[row.id]) return m[row.id] === "variant";
  if (row.custom) return row.level === "variant";
  return multi() && (row.ds === "varies" || row.ds === "partial");
}
function familyRows() { return specRows().filter(r => !isVariantRow(r)); }
function variantRows() { return specRows().filter(r => isVariantRow(r)); }

function srcValue(row, src) {   // family screen: -> null | {value} | {varies:[{value, parts}]}
  const v = row.values || {};
  if (src !== "datasheet") return v[src] ? { value: v[src] } : null;
  const ds = v.datasheet || {};
  const groups = {};
  for (const [part, val] of Object.entries(ds)) (groups[norm(val)] = groups[norm(val)] || { value: val, parts: [] }).parts.push(part);
  const g = Object.values(groups);
  if (!g.length) return null;
  return g.length === 1 ? { value: g[0].value, parts: g[0].parts } : { varies: g.sort((a, b) => b.parts.length - a.parts.length) };
}
function rowDiffers(row) {
  const vals = new Set();
  for (const s of loadedSources()) {
    const sv = srcValue(row, s.key);
    if (!sv) continue;
    if (sv.varies) sv.varies.forEach(x => vals.add(norm(x.value))); else vals.add(norm(sv.value));
  }
  return vals.size > 1;
}

/* ---------- variant cells: explicit edit, else the variant's own datasheet */
function vcell(row, part) {
  const e = ((state.draft.vcells || {})[row.id] || {})[part];
  if (e) return { value: e.value, source: e.source || "edited", edited: true };
  const k = dsKey(part), v = k && ((row.values || {}).datasheet || {})[k];
  return v ? { value: v, source: "datasheet", edited: false } : { value: "", source: "", edited: false };
}
function setVcell(rowId, part, value) {
  const d = state.draft;
  d.vcells[rowId] = d.vcells[rowId] || {};
  d.vcells[rowId][part] = { value, source: "edited" };
}
/* ---------- family value for a variant row: suggestion from the variant values, or an edited text */
function hashVals(row) { return parts().map(p => norm(vcell(row, p).value)).join("|"); }
function suggest(row) {
  const vals = parts().map(p => ({ part: p, v: vcell(row, p).value.trim() }));
  const have = vals.filter(x => !isNA(x.v));
  if (!have.length) return vals.some(x => x.v) ? "NA" : "";
  const groups = {};
  have.forEach(x => (groups[norm(x.v)] = groups[norm(x.v)] || { v: x.v, parts: [] }).parts.push(x.part));
  const g = Object.values(groups);
  const some = vals.some(x => isNA(x.v) && (x.v || dsKey(x.part)));     // explicit NA, or a sheet without the line
  const tag = () => have.length <= 4 ? ` (${have.map(x => x.part).join(", ")})` : " (selected models)";
  if (g.length === 1) return g[0].v + (some ? tag() : "");
  const num = have.map(x => x.v.match(/^\s*([\d.]+)\s*([^\d\s].*)?$/));
  if (num.every(Boolean)) {
    const units = new Set(num.map(m => norm(m[2] || "")));
    if (units.size === 1) {
      const ns = num.map(m => parseFloat(m[1])), u = (num[0][2] || "").trim();
      return `${Math.min(...ns)}–${Math.max(...ns)}${u ? " " + u : ""}` + (some ? tag() : "");
    }
  }
  const gens = have.map(x => (x.v.match(/\b([2-5])G\b/g) || []));
  if (gens.every(a => a.length)) {
    const top = [...new Set(have.map(x => (x.v.match(/\b([2-5])G\b/g) || []).sort().reverse()[0]))].sort().reverse();
    if (top.length > 1 && have.every(x => x.v.length < 70)) return top.join("/") + (some ? tag() : "");
  }
  if (g.length <= 3 && g.every(x => x.v.length <= 40)) return g.map(x => x.v).join(" / ") + (some ? tag() : "");
  return "";
}
function famValue(row) {
  const f = (state.draft.vfam || {})[row.id];
  if (f && f.edited) return { value: f.value, edited: true, stale: f.basis !== hashVals(row) };
  return { value: suggest(row), edited: false, stale: false };
}

/* ---------- checks on a variant cell against the variant's features */
function cellProblem(row, part, value) {
  const f = (state.draft.features || {})[part] || {};
  if (isNA(value)) return "";
  const id = row.id.toLowerCase(), v = value.toLowerCase();
  const wifiRow = row.section === "Wi-Fi" || /::wi-fi$/.test(id) || id === "summary::wi-fi";
  const cellRow = row.section === "Cellular" || /::(cellular|sim)$/.test(id);
  if (wifiRow && !f.wifi) return "Wi-Fi listed, but this variant has no Wi-Fi";
  if (cellRow && !f.cellular) return "Cellular listed, but this variant has no cellular";
  if (/cellular module|::cellular$/.test(id) && f.cellular === "4G" && /\b5g\b/.test(v)) return "Says 5G, variant is 4G";
  if (/cellular module/.test(id) && f.cellular === "5G" && /\b4g\b/.test(v) && !/\b5g\b/.test(v)) return "Module is 4G, variant is 5G";
  if (/::sim$/.test(id) && f.modems === 1 && /active,\s*active|2x active/.test(v)) return "Two active SIMs on a single-modem variant";
  return "";
}
function sectionDropped(row, part) {      // sections a variant's datasheet leaves out
  const f = (state.draft.features || {})[part] || {};
  return (row.section === "Wi-Fi" && !f.wifi) || (row.section === "Cellular" && !f.cellular);
}

/* ================================================================ drafts */
function newDraft(p) {
  const d = { v: 2, product_id: p.id, created_at: now(), updated_at: now(), locked: false,
    text: {}, use_cases: [], highlights: { key: [], feature: [] }, values: {}, custom: [], moved: {}, show: {},
    vfam: {}, vcells: {}, features: clone(p.features || {}), notes: "" };
  // sensible starting points: catalogue text and lists where they exist
  for (const t of TEXT_FIELDS) {
    const src = p.text && p.text[t.key] || {};
    const k = t.key === "short_description" ? (src.website ? "website" : src.catalogue ? "catalogue" : null) : (src.catalogue ? "catalogue" : src.website ? "website" : null);
    if (k) d.text[t.key] = { value: src[k], source: k, edited: false };
  }
  const uc = p.use_cases || {};
  if (uc.catalogue) d.use_cases = clone(uc.catalogue);
  else if (uc.website) d.use_cases = clone(uc.website);
  const hl = (p.highlights || {}).catalogue;
  if (hl) d.highlights = { key: clone(hl.key || []), feature: clone(hl.feature || []) };
  return d;
}
function ensureFeatures(d) {
  d.features = d.features || {};
  for (const pt of parts()) d.features[pt] = Object.assign({ cellular: "", modems: 0, wifi: "", rs485: false, rs232: false }, d.features[pt] || {});
}
let saveTimer = null;
function saveDraft() {
  const d = state.draft;
  if (!d || d.locked) return;
  d.updated_at = now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { lsSet(LS.draft(d.product_id), d); renderList(); const el = $("#savedAt"); if (el) el.textContent = `Draft saved in this browser ${new Date().toLocaleTimeString()}`; }, 250);
}
function statusOf(pid) {
  const d = lsGet(LS.draft(pid));
  if (d && !d.locked) return "draft";
  if (state.approved[pid] || lsGet(LS.approved(pid))) return "approved";
  return "todo";
}

/* ================================================================ list */
function renderList() {
  const idx = state.index; if (!idx) return;
  const q = norm($("#search").value), cat = $("#catFilter").value, sf = $("#statusFilter").value;
  const order = idx.categories && idx.categories.length ? idx.categories : [...new Set(idx.products.map(p => p.category))];
  const groups = {};
  for (const p of idx.products) {
    const st = statusOf(p.id);
    if (q && !norm(p.name + " " + p.id + " " + (p.variants || []).join(" ")).includes(q)) continue;
    if (cat && p.category !== cat) continue;
    if (sf && st !== sf) continue;
    (groups[p.category] = groups[p.category] || []).push([p, st]);
  }
  const cats = [...order.filter(c => groups[c]), ...Object.keys(groups).filter(c => !order.includes(c))];
  $("#plist").innerHTML = cats.map(c => `<li class="cat-h">${esc(c || "Other")}</li>` + groups[c].map(([p, st]) => {
    const srcs = loadedSources().map(s => `<b class="${p.present[s.key] ? "" : "no"}">${s.short}</b>`).join("");
    const lbl = st === "approved" ? "Approved" : st === "draft" ? "In progress" : "Not started";
    const nv = (p.variants || []).length;
    return `<li><button type="button" data-pid="${esc(p.id)}" aria-current="${p.id === state.pid}">
      <span class="pl-top"><span class="pl-name">${esc(p.name)}</span><span class="st ${st}">${lbl}</span></span>
      <span class="pl-sub"><span class="srcs">${srcs}</span><span>${nv > 1 ? nv + " variants" : ""}</span></span></button></li>`;
  }).join("")).join("") || `<li class="muted small" style="padding:12px">No products match.</li>`;
}

/* ================================================================ open a product */
async function openProduct(pid, push = true) {
  const p = await loadProduct(pid);
  state.pid = pid; state.product = p;
  let d = lsGet(LS.draft(pid));
  if (!d) {
    const a = state.approved[pid] || lsGet(LS.approved(pid)) ? await loadApprovedRecord(pid) : null;
    if (a && a.editor_state) d = Object.assign(clone(a.editor_state), { locked: true, approved_by: a.approved_by, approved_at: a.approved_at });
    else d = newDraft(p);
  }
  ensureFeatures(d);
  state.draft = d;
  state.pvPart = parts()[0];
  if (!multi() && state.ui.tab === "variants") state.ui.tab = "family";
  if (push) { state.ui.tab = "family"; saveUI(); }        // a newly picked product starts on its first step
  if (push) history.replaceState(null, "", `#${encodeURIComponent(pid)}`);
  renderList();
  renderView();
  $("#main").scrollTop = 0;
}

/* ================================================================ main view */
function renderView() {
  const p = state.product, d = state.draft;
  $("#empty").hidden = true;
  const v = $("#view"); v.hidden = false;
  const m = p.meta || {}, mm = m.master || {}, c = m.catalogue || {}, w = m.website || {};
  const dsN = Object.keys(p.datasheets || {}).length;
  const origs = [
    `<span class="orig ${p.present.website ? "" : "off"}"><i class="sw website"></i>Website JSON${w.file ? ": " + esc(w.file) : ""}${w.hidden ? " (hidden on site)" : ""}</span>`,
    mm.brief_page ? `<a class="orig" target="_blank" rel="noopener" href="${esc(mm.pdf || "")}#page=${mm.brief_page}"><i class="sw master"></i>Old Master p.${mm.brief_page}${mm.detailed_page ? " + p." + mm.detailed_page : ""}</a>` : `<span class="orig off"><i class="sw master"></i>Not in Old Master</span>`,
    c.pdf ? `<a class="orig" target="_blank" rel="noopener" href="${esc(c.pdf)}"><i class="sw catalogue"></i>New catalogue PDF</a>` : `<span class="orig ${p.present.catalogue ? "" : "off"}"><i class="sw catalogue"></i>${p.present.catalogue ? "New catalogue" : "Not in new catalogue"}</span>`,
    dsN ? `<button class="orig" type="button" data-act="sheets"><i class="sw datasheet"></i>${dsN} datasheet${dsN > 1 ? "s" : ""}: PDFs & full text</button>` : `<span class="orig off"><i class="sw datasheet"></i>No datasheet</span>`,
  ].join("");
  const vr = variantRows().length;
  const tabs = [["family", "1 · Family content"], ...(multi() ? [["variants", `2 · Variant table (${parts().length} variants, ${vr} lines)`]] : []), ["preview", `${multi() ? 3 : 2} · Preview & approve`]];
  const banner = d.locked
    ? `<div class="notice ok">Approved${d.approved_by ? " by <b>" + esc(d.approved_by) + "</b>" : ""}${d.approved_at ? " on " + esc(new Date(d.approved_at).toLocaleString()) : ""}. <button class="btn sm" type="button" data-act="unlock">Edit again</button> <button class="btn sm" type="button" data-act="dl-files">Download files</button></div>` : "";
  v.innerHTML = `
    <div class="phead"><div>
      <h1>${esc(p.name)}</h1>
      <div class="meta">${esc(p.category)} · ${multi() ? `${parts().length} variants: ${esc(parts().join(", "))}` : "single product"}</div>
      <div class="origs">${origs}</div></div></div>
    ${banner}
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" class="tab" data-tab="${k}" aria-selected="${state.ui.tab === k}">${l}</button>`).join("")}</div>
    <div id="tabBody" class="${d.locked ? "ro" : ""}"></div>`;
  renderTab();
}
function renderTab() {
  const t = state.ui.tab;
  const el = $("#tabBody");
  if (t === "variants" && multi()) el.innerHTML = variantsTab();
  else if (t === "preview") el.innerHTML = previewTab();
  else { el.innerHTML = familyTab(); renderFamilyTable(); }
  el.querySelectorAll("textarea").forEach(autosize);
}

/* ---------------------------------------------------------------- tab 1: family content */
function chips(chs, rowId) {
  const locked = state.draft.locked;
  return `<span class="chips" ${rowId ? `data-row="${esc(rowId)}"` : ""}>${"WCD".split("").map(k =>
    rowId ? `<button type="button" class="chip ${chs.includes(k) ? "on" : ""}" data-act="show" data-ch="${k}" ${locked ? "disabled" : ""} title="${CH[k]}: ${chs.includes(k) ? "shown" : "not shown"}">${k}</button>`
          : `<span class="chip ${chs.includes(k) ? "on" : ""}" title="${CH[k]}">${k}</span>`).join("")}</span>`;
}
function familyTab() {
  const p = state.product, d = state.draft, locked = d.locked;
  const tf = state.fields.text || {};
  const textRows = TEXT_FIELDS.map(t => {
    const src = (p.text || {})[t.key] || {}, cur = d.text[t.key] || {};
    const opts = Object.entries(src).map(([k, val]) => `<button type="button" class="srcbtn ${cur.source === k && !cur.edited ? "on" : ""}" data-act="text-use" data-k="${t.key}" data-src="${k}" ${locked ? "disabled" : ""} title="${esc(val)}"><i class="sw ${k}"></i>${SRC_LABEL[k]}</button>`).join("");
    return `<div class="tf"><div class="tf-h"><b>${t.label}</b>${chips(tf[t.key] || "WCD")}<span class="srcs-row">${opts || `<span class="muted small">no source has this</span>`}</span></div>
      <textarea data-text="${t.key}" rows="${t.rows}" ${locked ? "readonly" : ""} placeholder="${esc(t.hint)}">${esc(cur.value || "")}</textarea></div>`;
  }).join("");
  const uc = d.use_cases;
  const ucs = p.use_cases || {};
  const ucRows = uc.map((u, i) => `<tr><td class="n">${i + 1}</td><td><textarea data-uc="${i}" data-f="title" rows="1" ${locked ? "readonly" : ""}>${esc(u.title)}</textarea></td>
    <td><textarea data-uc="${i}" data-f="description" rows="2" ${locked ? "readonly" : ""}>${esc(u.description)}</textarea></td>
    <td class="acts">${locked ? "" : `<button class="x" type="button" data-act="uc-up" data-i="${i}" title="Move up">↑</button><button class="x" type="button" data-act="uc-down" data-i="${i}" title="Move down">↓</button><button class="x" type="button" data-act="uc-del" data-i="${i}" title="Remove">✕</button>`}</td></tr>`).join("");
  const iconSel = (kind, i, cur) => `<select data-hl="${kind}" data-i="${i}" data-f="icon" ${locked ? "disabled" : ""}><option value="">—</option>${Object.keys(state.icons).map(n => `<option ${n === cur ? "selected" : ""}>${n}</option>`).join("")}</select>`;
  const ico = n => n && state.icons[n] ? `<span class="ico">${state.icons[n]}</span>` : `<span class="ico"></span>`;
  const key = d.highlights.key.map((h, i) => `<tr><td>${ico(h.icon)}${iconSel("key", i, h.icon)}</td><td><input data-hl="key" data-i="${i}" data-f="value" value="${esc(h.value)}" ${locked ? "readonly" : ""}></td><td><input data-hl="key" data-i="${i}" data-f="label" value="${esc(h.label)}" ${locked ? "readonly" : ""}></td><td class="acts">${locked ? "" : `<button class="x" type="button" data-act="hl-up" data-k="key" data-i="${i}">↑</button><button class="x" type="button" data-act="hl-del" data-k="key" data-i="${i}">✕</button>`}</td></tr>`).join("");
  const feat = d.highlights.feature.map((h, i) => `<tr><td>${ico(h.icon)}${iconSel("feature", i, h.icon)}</td><td><input data-hl="feature" data-i="${i}" data-f="label" value="${esc(h.label)}" ${locked ? "readonly" : ""}></td><td class="acts">${locked ? "" : `<button class="x" type="button" data-act="hl-up" data-k="feature" data-i="${i}">↑</button><button class="x" type="button" data-act="hl-del" data-k="feature" data-i="${i}">✕</button>`}</td></tr>`).join("");
  const sources = loadedSources().map(s => s.key);
  const vr = variantRows().length;
  return `
  <section class="card"><h2>Text</h2><p class="hint">Pick a source (hover to read it), then edit. W C D show where each text appears.</p>${textRows}</section>

  <section class="card"><h2>Use cases ${chips(tf.use_case_title || "WC")}</h2>
    <p class="hint">The website shows the titles; the catalogue shows titles with descriptions (${chips(tf.use_case_description || "C")}).</p>
    ${locked ? "" : `<div class="tools">${ucs.catalogue ? `<button class="btn sm" type="button" data-act="uc-load" data-src="catalogue">Load from New Catalogue (${ucs.catalogue.length})</button>` : ""}${ucs.website ? `<button class="btn sm" type="button" data-act="uc-load" data-src="website">Load titles from Website (${ucs.website.length})</button>` : ""}<button class="btn sm" type="button" data-act="uc-add">Add use case</button></div>`}
    <div class="tw"><table class="grid uc"><thead><tr><th>#</th><th>Title</th><th>Description</th><th></th></tr></thead><tbody>${ucRows || `<tr><td colspan="4" class="muted small">No use cases yet.</td></tr>`}</tbody></table></div></section>

  <section class="card"><h2>Catalogue only: highlights ${chips("C")}</h2>
    <p class="hint">Shown on the catalogue page only. Key Highlights are the tiles under the photo (up to ${MAX_KEY}); Feature Highlights are the badges beside the title (up to ${MAX_FEAT}).</p>
    ${locked ? "" : `<div class="tools">${(p.highlights || {}).catalogue ? `<button class="btn sm" type="button" data-act="hl-load">Load from New Catalogue</button>` : ""}<button class="btn sm" type="button" data-act="hl-add" data-k="key">Add Key Highlight</button><button class="btn sm" type="button" data-act="hl-add" data-k="feature">Add Feature Highlight</button></div>`}
    <div class="hl2"><div><h3>Key Highlights <span class="${d.highlights.key.length > MAX_KEY ? "bad" : "muted"}">${d.highlights.key.length}/${MAX_KEY}</span></h3>
      <table class="grid hl"><thead><tr><th>Icon</th><th>Value</th><th>Label</th><th></th></tr></thead><tbody>${key || `<tr><td colspan="4" class="muted small">None</td></tr>`}</tbody></table></div>
      <div><h3>Feature Highlights <span class="${d.highlights.feature.length > MAX_FEAT ? "bad" : "muted"}">${d.highlights.feature.length}/${MAX_FEAT}</span></h3>
      <table class="grid hl"><thead><tr><th>Icon</th><th>Label</th><th></th></tr></thead><tbody>${feat || `<tr><td colspan="3" class="muted small">None</td></tr>`}</tbody></table></div></div></section>

  <section class="card wide"><h2>Specifications shared by ${multi() ? "every variant" : "the product"}</h2>
    <p class="hint">${multi() ? `${vr} line${vr === 1 ? "" : "s"} that differ between the variant datasheets are in the <a href="#" data-act="go" data-tab="variants">Variant table</a>. Use <b>↘ varies</b> to move any other line there.` : "Pick a source per line or for the whole product, then edit."}</p>
    <div class="bar">
      ${locked ? "" : `<div class="grp"><label for="fillSrc">Start from</label><select id="fillSrc">${sources.map(s => `<option value="${s}">${SRC_LABEL[s]}</option>`).join("")}</select>
        <button class="btn sm" type="button" data-act="fill" data-mode="gaps">Fill empty</button><button class="btn sm" type="button" data-act="fill" data-mode="all">Replace all</button></div>`}
      <div class="grp"><input id="rowSearch" type="search" placeholder="Find a field" value="${esc(state.ui.q)}">
        <label class="chk"><input type="checkbox" id="diffOnly" ${state.ui.diffOnly ? "checked" : ""}>Only where sources differ</label>
        <label class="chk"><input type="checkbox" id="emptyOnly" ${state.ui.emptyOnly ? "checked" : ""}>Only empty final</label></div>
      <div class="grp"><label>Columns</label>${sources.map(s => `<label class="chk"><input type="checkbox" data-hide="${s}" ${state.ui.hide[s] ? "" : "checked"}>${SRC_LABEL[s]}</label>`).join("")}</div>
      <span class="progress" id="progress"></span>
    </div>
    <div class="tw"><table class="cmp" id="cmp"></table>
      ${locked ? "" : `<div class="addrow"><b class="small">Add a field</b><select id="newSec">${secOptions()}</select><input id="newLabel" placeholder="Field name">${multi() ? `<label class="chk"><input type="checkbox" id="newVar">differs by variant</label>` : ""}<button class="btn sm" type="button" data-act="addrow">Add</button></div>`}</div>
  </section>`;
}
function secOptions() {
  const secs = [...new Set(state.product.rows.map(r => r.section).filter(s => s !== "Overview"))];
  ["Hardware", "Interfaces", "Power", "Physical", "Environmental", "Cellular", "Wi-Fi", "Networking & Firewall", "VPN",
   "Remote Management", "Operating System & Software", "Gateway", "Compliance", "Packaging", "Other"].forEach(s => secs.includes(s) || secs.push(s));
  return secs.map(s => `<option>${esc(s)}</option>`).join("");
}
function renderFamilyTable() {
  const d = state.draft, locked = d.locked;
  const cols = loadedSources().map(s => s.key).filter(s => !state.ui.hide[s]);
  const q = norm(state.ui.q);
  const rows = familyRows();
  let html = `<colgroup><col class="c-field">${cols.map(() => "<col>").join("")}<col class="c-final"></colgroup>
    <thead><tr><th>Field</th>${cols.map(s => `<th><span class="sw ${s}"></span>${SRC_LABEL[s]}${s === "datasheet" && multi() ? " (all sheets)" : ""}</th>`).join("")}<th><span class="sw final"></span>Final</th></tr></thead><tbody>`;
  let filled = 0, total = 0;
  const bySec = {};
  for (const r of rows) {
    const fv = (d.values[r.id] || {}).value || "";
    total++; if (fv.trim()) filled++;
    if (!r.custom && !fv && !loadedSources().some(s => srcValue(r, s.key))) continue;
    if (q && !norm(r.label + " " + r.section + " " + fv + " " + JSON.stringify(r.values)).includes(q)) continue;
    const differs = rowDiffers(r);
    if (state.ui.diffOnly && !differs) continue;
    if (state.ui.emptyOnly && fv.trim()) continue;
    (bySec[r.section] = bySec[r.section] || []).push([r, differs, fv]);
  }
  for (const [s, list] of Object.entries(bySec)) {
    const coll = state.ui.collapsed[s];
    html += `<tr class="sec"><td colspan="${cols.length + 2}" data-sec="${esc(s)}">${coll ? "▸" : "▾"} ${esc(s)}<span class="cnt">${list.filter(x => x[2].trim()).length}/${list.length} filled</span></td></tr>`;
    if (coll) continue;
    for (const [r, differs, fv] of list) {
      const cur = d.values[r.id] || {};
      html += `<tr data-row="${esc(r.id)}" class="${differs ? "diff" : ""}"><td class="f">${esc(r.label)}<div class="f-acts">${chips(showOf(r), r.id)}${!locked && multi() ? `<button class="lnk" type="button" data-act="to-variant" title="This line differs by variant: edit it per variant">↘ varies</button>` : ""}${r.custom && !locked ? `<button class="lnk" type="button" data-act="delrow">remove</button>` : ""}</div></td>`;
      for (const s of cols) {
        const sv = srcValue(r, s);
        if (!sv) { html += `<td class="s none">—</td>`; continue; }
        if (sv.varies) {
          html += `<td class="s"><span class="varies">Differs between sheets</span>` + sv.varies.map((x, i) =>
            `<button class="opt" type="button" ${locked ? "disabled" : ""} data-act="use" data-src="${s}" data-i="${i}"><span class="who">${esc(x.parts.join(", "))}</span>${esc(x.value)}</button>`).join("") + `</td>`;
          continue;
        }
        const picked = cur.source === s && !cur.edited;
        const long = sv.value.length > 260 || sv.value.split("\n").length > 7;
        const partial = s === "datasheet" && multi() && sv.parts && sv.parts.length < Object.keys(state.product.datasheets || {}).length;
        const hid = s === "website" && ((state.product.meta.website || {}).hidden_rows || []).includes(r.id);
        html += `<td class="s ${picked ? "picked" : ""}"><span class="val ${long ? "clamp" : ""}">${esc(sv.value)}</span>${long ? `<button class="more" type="button" data-act="more">Show all</button>` : ""}${partial ? `<span class="who">only on ${esc(sv.parts.join(", "))}</span>` : ""}${hid ? `<span class="who">hidden on the website</span>` : ""}${locked ? "" : `<button class="btn sm use" type="button" data-act="use" data-src="${s}">Use</button>`}</td>`;
      }
      const tag = cur.value ? `<span class="tag ${cur.edited ? "edited" : cur.source}">${cur.edited ? (cur.source && SRC_LABEL[cur.source] && cur.source !== "edited" ? SRC_LABEL[cur.source] + ", edited" : "Typed in") : SRC_LABEL[cur.source] || ""}</span>` : "";
      html += `<td class="fin"><textarea rows="1" ${locked ? "readonly" : ""} aria-label="Final ${esc(r.label)}" placeholder="${locked ? "" : "Pick a source or type"}">${esc(cur.value || "")}</textarea>${tag}${!locked && cur.value ? ` <button class="btn sm" type="button" data-act="clear" style="margin-top:4px">Clear</button>` : ""}</td></tr>`;
    }
  }
  html += `</tbody>`;
  if (!Object.keys(bySec).length) html += `<tbody><tr><td colspan="${cols.length + 2}" class="muted" style="padding:16px">No fields match the filters.</td></tr></tbody>`;
  $("#cmp").innerHTML = html;
  $("#progress").textContent = `${filled} of ${total} shared fields filled`;
  $("#cmp").querySelectorAll("textarea").forEach(autosize);
}
function autosize(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 420) + "px"; }

/* ---------------------------------------------------------------- tab 2: variant table */
function variantsTab() {
  const d = state.draft, locked = d.locked, ps = parts();
  const hasSheet = pt => !!dsKey(pt);
  const head = `<th class="sticky0">Field</th><th class="sticky1">Family value <span class="muted small">(website + catalogue)</span></th>` +
    ps.map(pt => `<th>${esc(pt)}${hasSheet(pt) ? "" : ` <span class="nosheet" title="No datasheet for this variant">no sheet</span>`}</th>`).join("");
  const fRow = (label, key, cell) => `<tr class="feat"><td class="sticky0 f">${label}</td><td class="sticky1 muted small">${esc(featSummary(key))}</td>${ps.map(pt => `<td>${cell(pt, d.features[pt])}</td>`).join("")}</tr>`;
  const sel = (pt, key, opts, val) => `<select data-feat="${key}" data-part="${esc(pt)}" ${locked ? "disabled" : ""}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const box = (pt, key, val) => `<input type="checkbox" data-feat="${key}" data-part="${esc(pt)}" ${val ? "checked" : ""} ${locked ? "disabled" : ""}>`;
  const feats = [
    fRow("Cellular", "cellular", (pt, f) => sel(pt, "cellular", [["", "None"], ["4G", "4G"], ["5G", "5G"]], f.cellular)),
    fRow("Modems", "modems", (pt, f) => sel(pt, "modems", [[0, "—"], [1, "Single"], [2, "Dual"]], f.modems)),
    fRow("Wi-Fi", "wifi", (pt, f) => sel(pt, "wifi", [["", "None"], ["Wi-Fi 4", "Wi-Fi 4"], ["Wi-Fi 5", "Wi-Fi 5"], ["Wi-Fi 6", "Wi-Fi 6"], ["Wi-Fi 7", "Wi-Fi 7"], ["Wi-Fi", "Wi-Fi (other)"]], f.wifi)),
    fRow("RS485", "rs485", (pt, f) => box(pt, "rs485", f.rs485)),
    fRow("RS232", "rs232", (pt, f) => box(pt, "rs232", f.rs232)),
  ].join("");
  let body = "", sec = null, problems = 0;
  for (const r of variantRows()) {
    if (r.section !== sec) { sec = r.section; body += `<tr class="sec"><td class="sticky0" colspan="2">${esc(sec)}</td><td colspan="${ps.length}"></td></tr>`; }
    const fam = famValue(r);
    const others = loadedSources().filter(s => s.key !== "datasheet" && (r.values || {})[s.key]).map(s => `${s.label}: ${r.values[s.key]}`).join("\n");
    const famCell = /[WC]/.test(showOf(r))
      ? `<textarea rows="1" data-fam="${esc(r.id)}" ${locked ? "readonly" : ""} placeholder="Write the family value">${esc(fam.value)}</textarea>
        <span class="tag ${fam.edited ? "edited" : "suggested"}">${fam.edited ? "Edited" : fam.value ? "Suggested" : "No suggestion: write one"}</span>${fam.stale ? `<span class="tag bad">Variant values changed: check</span>` : ""}${fam.edited && !locked ? ` <button class="lnk" type="button" data-act="fam-reset">use suggestion</button>` : ""}`
      : `<span class="muted small">Datasheet only: no family value needed</span>`;
    body += `<tr data-row="${esc(r.id)}"><td class="sticky0 f">${esc(r.label)}${others ? ` <span class="info" title="${esc(others)}">ⓘ</span>` : ""}<div class="f-acts">${chips(showOf(r), r.id)}${locked ? "" : `<button class="lnk" type="button" data-act="to-family" title="Same for every variant: edit it on the Family screen">↖ shared</button>`}</div></td>
      <td class="sticky1 fam ${fam.stale ? "stale" : ""} ${!fam.value && /[WC]/.test(showOf(r)) ? "need" : ""}">${famCell}</td>`;
    for (const pt of ps) {
      const c = vcell(r, pt), drop = sectionDropped(r, pt), prob = drop ? "" : cellProblem(r, pt, c.value);
      if (prob) problems++;
      body += `<td class="vc ${c.edited ? "ed" : c.value ? "ds" : "empty"} ${drop ? "drop" : ""} ${prob ? "bad" : ""}" ${prob ? `title="${esc(prob)}"` : drop ? `title="Not on this variant's datasheet (no ${r.section === "Wi-Fi" ? "Wi-Fi" : "cellular"})"` : ""}>
        <textarea rows="1" data-part="${esc(pt)}" ${locked ? "readonly" : ""}>${esc(c.value)}</textarea>${prob ? `<span class="tag bad">${esc(prob)}</span>` : ""}</td>`;
    }
    body += `</tr>`;
  }
  return `
  <section class="card"><h2>What each variant has</h2>
    <p class="hint">These decide the ordering table, the website filters and which sections each datasheet includes: a variant with no Wi-Fi gets no Wi-Fi section. Pre-filled from the website's variant table (or the datasheet's Product Info box).</p>
    <div class="tw"><table class="vgrid"><thead><tr>${head}</tr></thead><tbody>${feats}</tbody></table></div></section>
  <section class="card wide"><h2>Specifications that differ by variant</h2>
    <p class="hint">Each variant column starts from that variant's own datasheet (pale) and can be edited. The <b>Family value</b> is what the website and catalogue show, e.g. “5G/4G” or “640–700 g”; it is suggested from the variant values until you edit it.
    ${problems ? `<b class="bad">${problems} cell${problems === 1 ? "" : "s"} contradict the variant's features</b> (red).` : ""} Greyed cells are left out of that variant's datasheet.</p>
    <div class="tw"><table class="vgrid specs"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${ps.length + 2}" class="muted" style="padding:14px">No lines differ between variants. Use “↘ varies” on the Family screen to add some.</td></tr>`}</tbody></table></div></section>`;
}
function featSummary(key) {
  const fs = parts().map(pt => state.draft.features[pt] || {});
  if (key === "cellular") { const g = [...new Set(fs.map(f => f.cellular).filter(Boolean))].sort().reverse(); return g.length ? g.join("/") + (fs.some(f => !f.cellular) ? " (some models)" : "") : "None"; }
  if (key === "modems") { const m = [...new Set(fs.map(f => +f.modems).filter(Boolean))].sort(); return m.length ? m.map(x => x === 1 ? "Single" : "Dual").join(" or ") : "—"; }
  if (key === "wifi") { const w = [...new Set(fs.map(f => f.wifi).filter(Boolean))]; return w.length ? w.join("/") + (fs.some(f => !f.wifi) ? " (some models)" : "") : "None"; }
  const n = fs.filter(f => f[key]).length; return n === 0 ? "No" : n === fs.length ? "Yes" : "Some models";
}

/* ---------------------------------------------------------------- outputs (shared by preview, approve, exports) */
function textVal(k) { return ((state.draft.text || {})[k] || {}).value || ""; }
function familySpecs(ch) {     // [{section, items:[{label, value}]}] for W or C
  const out = [];
  const push = (sec, label, value) => { let s = out.find(x => x.section === sec); if (!s) out.push(s = { section: sec, items: [] }); s.items.push({ label, value }); };
  for (const r of specRows()) {
    if (!showOf(r).includes(ch)) continue;
    const v = isVariantRow(r) ? famValue(r).value : ((state.draft.values[r.id] || {}).value || "");
    if (v.trim()) push(r.section, r.label, v.trim());
  }
  return out;
}
function variantSpecs(pt) {    // exact values for one variant's datasheet
  const out = [];
  const push = (sec, label, value) => { let s = out.find(x => x.section === sec); if (!s) out.push(s = { section: sec, items: [] }); s.items.push({ label, value }); };
  for (const r of specRows()) {
    if (!showOf(r).includes("D") || sectionDropped(r, pt)) continue;
    const v = isVariantRow(r) ? vcell(r, pt).value : ((state.draft.values[r.id] || {}).value || "");
    if (v.trim()) push(r.section, r.label, v.trim());
  }
  return out;
}
function orderingTable() {
  const ps = parts(), fs = ps.map(pt => state.draft.features[pt] || {});
  const cols = [["Part Number", pt => pt]];
  if (fs.some(f => f.cellular)) cols.push(["Cellular", (pt, f) => f.cellular || "—"], ["Modems", (pt, f) => f.cellular ? (+f.modems === 2 ? "Dual" : "Single") : "—"]);
  if (fs.some(f => f.wifi)) cols.push(["Wi-Fi", (pt, f) => f.wifi || "—"]);
  if (fs.some(f => f.rs485)) cols.push(["RS485", (pt, f) => f.rs485 ? "✓" : "—"]);
  if (fs.some(f => f.rs232)) cols.push(["RS232", (pt, f) => f.rs232 ? "✓" : "—"]);
  return { headers: cols.map(c => c[0]), rows: ps.map((pt, i) => cols.map(c => c[1](pt, fs[i]))) };
}
function buildFamilyRecord(approver) {
  const p = state.product, d = state.draft;
  const specs = {}, variant_specs = {}, show_on = {}, provenance = {};
  for (const r of specRows()) {
    show_on[r.id] = showOf(r);
    if (isVariantRow(r)) {
      const fam = famValue(r), vals = {};
      parts().forEach(pt => { vals[pt] = vcell(r, pt).value; });
      if (!fam.value && !Object.values(vals).some(Boolean)) continue;
      variant_specs[r.id] = { section: r.section, field: r.label, family: fam.value, values: vals };
      provenance[r.id] = { family: fam.edited ? "edited" : "suggested", values: Object.fromEntries(parts().map(pt => [pt, vcell(r, pt).source || null])) };
    } else {
      const c = d.values[r.id];
      if (!c || !String(c.value || "").trim()) continue;
      (specs[r.section] = specs[r.section] || {})[r.label] = c.value.trim();
      provenance[r.id] = { source: c.source || "edited", edited: !!c.edited };
    }
  }
  return {
    schema: SCHEMA, product_id: p.id, name: p.name, category: p.category,
    text: Object.fromEntries(TEXT_FIELDS.map(t => [t.key, textVal(t.key)])),
    use_cases: d.use_cases.filter(u => u.title.trim()).map(u => ({ title: u.title.trim(), description: (u.description || "").trim() })),
    catalogue: { key_highlights: d.highlights.key, feature_highlights: d.highlights.feature },
    specs, variant_specs,
    variants: parts().map(pt => ({ part: pt, ...pick(d.features[pt], ["cellular", "modems", "wifi", "rs485", "rs232"]), datasheet: dsKey(pt) ? (p.datasheets[dsKey(pt)] || {}).file : null })),
    ordering: orderingTable(),
    show_on: Object.assign({}, show_on, Object.fromEntries(Object.entries(state.fields.text || {}).map(([k, v]) => [`text::${k}`, v]))),
    provenance, notes: d.notes || "",
    approved_by: approver || null, approved_at: approver ? now() : null, source_data_built: state.index.built,
    editor_state: Object.assign(clone(d), { locked: false }),
  };
}
function pick(o, ks) { const r = {}; ks.forEach(k => r[k] = (o || {})[k]); return r; }
function buildVariantRecord(pt, fam) {
  const p = state.product, k = dsKey(pt);
  const sections = {};
  for (const s of variantSpecs(pt)) sections[s.section] = Object.fromEntries(s.items.map(x => [x.label, x.value]));
  return {
    schema: SCHEMA, type: "variant", product_id: p.id, name: p.name, part_number: pt, category: p.category, inherits: `${p.id}.json`,
    text: { title: fam.text.title, long_description: fam.text.long_description },
    features: pick(state.draft.features[pt], ["cellular", "modems", "wifi", "rs485", "rs232"]),
    specs: sections,
    datasheet_source: k ? { file: p.datasheets[k].file, model: p.datasheets[k].model } : null,
    approved_by: fam.approved_by, approved_at: fam.approved_at,
  };
}
function filesFor(fam) {        // path (relative to approved/) -> JSON text
  const files = { [`${fam.product_id}.json`]: JSON.stringify(fam, null, 2) + "\n" };
  if (multi()) for (const pt of parts()) files[`${fam.product_id}/${slug(pt)}.json`] = JSON.stringify(buildVariantRecord(pt, fam), null, 2) + "\n";
  return files;
}

/* ---------------------------------------------------------------- checks */
const TYPOS = [[/\bSingle strength\b/g, "Signal strength"], [/\bsingle strength\b/g, "signal strength"], [/\bMannual\b/g, "Manual"], [/\bmannual\b/g, "manual"],
  [/\bAdabpter\b/g, "Adapter"], [/\bconnecter\b/g, "connector"], [/\bInaterfaces\b/g, "Interfaces"], [/802\.11 b\/g\/n\/ac\/ac\b/g, "802.11 b/g/n/ac"], [/\bUSB 3\.0 3\.0\b/g, "USB 3.0"]];
const fixTypos = v => TYPOS.reduce((x, [rx, to]) => x.replace(rx, to), v);
function fixAllTypos() {
  const d = state.draft; let n = 0;
  const f = v => { const o = fixTypos(v); if (o !== v) n++; return o; };
  for (const c of Object.values(d.values)) c.value = f(c.value || "");
  for (const t of Object.values(d.text)) t.value = f(t.value || "");
  d.use_cases.forEach(u => { u.title = f(u.title); u.description = f(u.description || ""); });
  for (const r of variantRows()) {
    if ((d.vfam[r.id] || {}).edited) d.vfam[r.id].value = f(d.vfam[r.id].value);
    for (const pt of parts()) { const c = vcell(r, pt), o = fixTypos(c.value); if (o !== c.value) { setVcell(r.id, pt, o); n++; } }
  }
  saveDraft(); return n;
}
function runChecks() {
  const d = state.draft, errs = [], warns = [];
  const fam = buildFamilyRecord(null);
  if (!textVal("title").trim()) errs.push("Title is empty.");
  if (!textVal("short_description").trim()) errs.push("Short description (website) is empty.");
  if (!textVal("long_description").trim()) errs.push("Long description (catalogue, datasheet) is empty.");
  if (!fam.use_cases.length) warns.push("No use cases.");
  if (d.use_cases.some(u => !u.title.trim() && u.description.trim())) errs.push("A use case has a description but no title.");
  if (fam.use_cases.some(u => !u.description)) warns.push(`${fam.use_cases.filter(u => !u.description).length} use case(s) without a description (the catalogue shows descriptions).`);
  if (d.highlights.key.length > MAX_KEY) errs.push(`${d.highlights.key.length} Key Highlights: the catalogue fits ${MAX_KEY}.`);
  if (d.highlights.feature.length > MAX_FEAT) errs.push(`${d.highlights.feature.length} Feature Highlights: the catalogue fits ${MAX_FEAT}.`);
  if (d.highlights.key.some(h => !h.value.trim() && !h.label.trim()) || d.highlights.feature.some(h => !h.label.trim())) errs.push("A highlight is empty.");
  const hasCell = parts().some(pt => d.features[pt].cellular), hasWifi = parts().some(pt => d.features[pt].wifi);
  [...d.highlights.key.map(h => h.value + " " + h.label), ...d.highlights.feature.map(h => h.label)].forEach(t => {
    if (/modem|lte|\b[45]g\b/i.test(t) && !hasCell) errs.push(`Highlight “${t.trim()}” mentions cellular, but no variant has cellular.`);
    if (/wi-?fi/i.test(t) && !hasWifi) errs.push(`Highlight “${t.trim()}” mentions Wi-Fi, but no variant has Wi-Fi.`);
    if (/^\s*-|\s-\s/.test(t)) errs.push(`Highlight “${t.trim()}” looks like a placeholder.`);
  });
  if (!Object.keys(fam.specs).length && !Object.keys(fam.variant_specs).length) errs.push("No specifications have final values.");
  const allText = [...TEXT_FIELDS.map(t => [t.label, textVal(t.key)]), ...Object.entries(fam.specs).flatMap(([s, o]) => Object.entries(o).map(([k, v]) => [`${s} › ${k}`, v])),
    ...Object.values(fam.variant_specs).flatMap(v => [[`${v.section} › ${v.field} (family)`, v.family], ...Object.entries(v.values).map(([pt, x]) => [`${v.section} › ${v.field} (${pt})`, x])]),
    ...fam.use_cases.flatMap(u => [["Use case", u.title], ["Use case", u.description]])];
  const typos = {}, reps = {};
  for (const [where, v] of allText) {
    if (!v) continue;
    if (/«|»|device_name|lorem|\bTBD\b|\bTBC\b|xxx\b/i.test(v)) errs.push(`Placeholder text in ${where}: “${v.slice(0, 60)}”.`);
    const rp = v.match(/\b(\S{2,})\s+\1\b/i);
    if (rp) (reps[rp[0]] = reps[rp[0]] || []).push(where);
    if (fixTypos(v) !== v) { const t = TYPOS.find(([rx]) => (rx.lastIndex = 0, rx.test(v))); const k = v.match(t[0])[0]; t[0].lastIndex = 0; (typos[k] = typos[k] || []).push(where); }
  }
  for (const [k, w] of Object.entries(typos)) warns.push(`TYPO:Likely typo “${k}” in ${w.length} place${w.length > 1 ? "s" : ""} (e.g. ${w[0]}).`);
  for (const [k, w] of Object.entries(reps)) warns.push(`Repeated word “${k}” in ${w.length} place${w.length > 1 ? "s" : ""} (e.g. ${w[0]}).`);
  if (multi()) {
    let bad = 0, need = 0, stale = 0;
    for (const r of variantRows()) {
      const f = famValue(r);
      if (!f.value && /[WC]/.test(showOf(r)) && parts().some(pt => vcell(r, pt).value)) need++;
      if (f.stale) stale++;
      for (const pt of parts()) if (!sectionDropped(r, pt) && cellProblem(r, pt, vcell(r, pt).value)) bad++;
    }
    if (bad) errs.push(`${bad} variant cell(s) contradict the variant's features (red in the Variant table).`);
    if (need) errs.push(`${need} line(s) in the Variant table have no family value; the website and catalogue need one.`);
    if (stale) warns.push(`${stale} edited family value(s) may be out of date (variant values changed after editing).`);
    const nos = parts().filter(pt => !dsKey(pt));
    if (nos.length) warns.push(`No datasheet for ${nos.join(", ")}: check their columns in the Variant table.`);
  }
  return { errs: [...new Set(errs)], warns: [...new Set(warns)] };
}

/* ---------------------------------------------------------------- tab 3: preview & approve */
function specHTML(groups) {
  return groups.map(g => `<h4>${esc(g.section)}</h4><table class="kv">${g.items.map(i => `<tr><td>${esc(i.label)}</td><td>${esc(i.value).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table>`).join("") || `<p class="muted small">No specifications for this output yet.</p>`;
}
function ordHTML(t) {
  return `<table class="ord"><thead><tr>${t.headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function previewTab() {
  const d = state.draft, p = state.product, pv = state.ui.pv;
  const ico = n => n && state.icons[n] ? `<span class="ico">${state.icons[n]}</span>` : "";
  let doc = "";
  if (pv === "W") {
    const model = state.pvModel || "";
    const groups = model ? variantSpecs(model).map(g => ({ section: g.section, items: g.items.filter(i => showOf({ id: `${g.section}::${i.label}`, section: g.section }).includes("W")) })) : familySpecs("W");
    doc = `<div class="pv web"><div class="pv-top"><h2>${esc(p.name)}</h2><div class="sub">${esc(textVal("title"))}</div></div>
      <p>${esc(textVal("short_description"))}</p>
      ${d.use_cases.length ? `<h4>Use cases</h4><ul>${d.use_cases.filter(u => u.title).map(u => `<li>${esc(u.title)}</li>`).join("")}</ul>` : ""}
      ${multi() ? `<div class="pv-model"><label>Select model <select id="pvModel"><option value="">All models (family)</option>${parts().map(pt => `<option ${pt === model ? "selected" : ""}>${esc(pt)}</option>`).join("")}</select></label></div>` : ""}
      ${specHTML(groups)}
      ${multi() ? `<h4>Variants</h4>${ordHTML(orderingTable())}` : ""}
      <h4>Downloads</h4><ul class="dl"><li>Catalogue (PDF)</li>${parts().map(pt => `<li>Datasheet ${esc(pt)} (PDF)</li>`).join("")}</ul></div>`;
  } else if (pv === "C") {
    doc = `<div class="pv cat"><div class="eyebrow">${esc(textVal("tagline"))}</div><h2>${esc(p.name)}</h2><div class="sub">${esc(textVal("title"))}</div>
      <p>${esc(textVal("long_description"))}</p>
      <div class="badges">${d.highlights.feature.map(h => `<span class="badge">${ico(h.icon)}${esc(h.label)}</span>`).join("")}</div>
      <div class="tiles">${d.highlights.key.map(h => `<div class="tile">${ico(h.icon)}<div><b>${esc(h.value)}</b><small>${esc(h.label)}</small></div></div>`).join("")}</div>
      ${specHTML(familySpecs("C"))}
      ${multi() ? `<h4>Ordering information</h4>${ordHTML(orderingTable())}` : ""}
      ${d.use_cases.length ? `<h4>Typical applications / use cases</h4>${d.use_cases.filter(u => u.title).map(u => `<div class="uc"><b>${esc(u.title)}</b><small>${esc(u.description)}</small></div>`).join("")}` : ""}</div>`;
  } else {
    const pt = parts().includes(state.pvPart) ? state.pvPart : parts()[0];
    const f = d.features[pt] || {};
    doc = `<div class="pv ds">${multi() ? `<label class="small">Variant <select id="pvPart">${parts().map(x => `<option ${x === pt ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>` : ""}
      <h2>${esc(pt)}</h2><div class="sub">DATASHEET · ${esc(p.name)} · ${esc(textVal("title"))}</div>
      <p>${esc(textVal("long_description"))}</p>
      <p class="small muted">Features: ${f.cellular ? `${f.cellular}, ${+f.modems === 2 ? "dual" : "single"} modem` : "no cellular"} · ${f.wifi || "no Wi-Fi"}${f.rs485 ? " · RS485" : ""}${f.rs232 ? " · RS232" : ""}${!f.wifi || !f.cellular ? ` · ${[!f.cellular && "Cellular", !f.wifi && "Wi-Fi"].filter(Boolean).join(" and ")} section left out` : ""}</p>
      ${specHTML(variantSpecs(pt))}</div>`;
  }
  const { errs, warns } = runChecks();
  const locked = d.locked;
  return `<div class="pvwrap"><div>
    <div class="ptabs">${[["W", "Website"], ["C", "Catalogue"], ["D", "Datasheet"]].map(([k, l]) => `<button type="button" class="tab ${pv === k ? "on" : ""}" data-pv="${k}" aria-selected="${pv === k}">${l}</button>`).join("")}</div>
    ${doc}</div>
    <aside class="card checks"><h2>Checks</h2>
      ${errs.length ? `<p class="bad"><b>${errs.length} to fix before approving</b></p><ul class="errs">${errs.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : `<p class="good"><b>No blocking problems.</b></p>`}
      ${warns.length ? `<p class="muted"><b>${warns.length} to review</b></p><ul class="warns">${warns.map(e => `<li>${esc(e.replace(/^TYPO:/, ""))}</li>`).join("")}</ul>` : ""}
      ${!locked && warns.some(w => w.startsWith("TYPO:")) ? `<button class="btn sm" type="button" data-act="fix-typos">Fix these typos everywhere</button>` : ""}
      <label class="small"><b>Notes</b><textarea id="notes" rows="3" ${locked ? "readonly" : ""} placeholder="Decisions, open questions, who confirmed what">${esc(d.notes || "")}</textarea></label>
      <label class="small"><b>Approved by</b><input id="approver" ${locked ? "readonly" : ""} value="${esc(locked ? d.approved_by || "" : state.settings.name || "")}" placeholder="Your name"></label>
      ${locked ? "" : `<div class="actions"><button class="btn ok" type="button" data-act="approve" ${errs.length ? "disabled" : ""}>Approve and save</button>
        <button class="btn" type="button" data-act="dl-files">Download draft files</button>
        <button class="btn ghost" type="button" data-act="discard">Discard draft</button></div>`}
      <p class="small muted">Saves ${multi() ? `<code>${esc(p.id)}.json</code> and ${parts().length} variant files in <code>${esc(p.id)}/</code>` : `<code>${esc(p.id)}.json</code>`}${ghReady() ? " to GitHub in one commit" : " as a zip download (connect GitHub to save to the repository)"}.</p>
      <span id="savedAt" class="muted small"></span>
    </aside></div>`;
}

/* ================================================================ approve & download */
function download(name, blobOrText, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
async function zipFiles(files, name) {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(files)) zip.file(path, text);
  download(name, await zip.generateAsync({ type: "blob" }));
}
async function approve() {
  const name = $("#approver").value.trim();
  if (!name) { toast("Enter your name in “Approved by” first."); $("#approver").focus(); return; }
  state.settings.name = name; lsSet(LS.settings, state.settings);
  if (runChecks().errs.length) return toast("Fix the problems listed under Checks first.");
  const fam = buildFamilyRecord(name);
  const files = filesFor(fam), pid = fam.product_id;
  const entry = { file: `${pid}.json`, product_id: pid, variants: Object.keys(files).filter(f => f.includes("/")), approved_by: name, approved_at: fam.approved_at };
  if (ghReady()) {
    try {
      toast("Saving to GitHub…", 0);
      const base = state.settings.base;
      await ghCommit(Object.fromEntries(Object.entries(files).map(([k, v]) => [`${base}/${k}`, v])),
        recs => { Object.keys(recs).filter(k => k === pid || k.startsWith(pid + "/")).forEach(k => delete recs[k]); recs[pid] = entry; },
        `Approve ${p_name()} (${name})`);
      toast(`Saved ${Object.keys(files).length} file(s) for ${state.product.name}. The site shows them after GitHub Pages rebuilds (1–2 minutes).`);
    } catch (e) { toast(`Not saved to GitHub: ${e.message}. Downloading the files instead.`); await zipFiles(files, `${pid}_approved.zip`); }
  } else {
    await zipFiles(files, `${pid}_approved.zip`);
    toast(`Approved. ${pid}_approved.zip downloaded: unzip it into docs/approved/ (see README), or connect GitHub.`);
  }
  state.approved[pid] = entry;
  lsSet(LS.approved(pid), fam);
  lsSet(LS.draft(pid), null);
  state.draft = Object.assign(clone(fam.editor_state), { locked: true, approved_by: name, approved_at: fam.approved_at });
  renderList(); renderView();
}
const p_name = () => state.product.name;

/* ================================================================ events */
function setFinal(rowId, value, source, edited = false) { state.draft.values[rowId] = { value, source, edited }; saveDraft(); }
function rerender() { const y = $("#main").scrollTop; renderTab(); $("#main").scrollTop = y; }
document.addEventListener("click", async e => {
  const b = e.target.closest("button, td[data-sec], a[data-act]"); if (!b) return;
  if (b.dataset.pid) return openProduct(b.dataset.pid);
  if (b.dataset.tab) { e.preventDefault(); state.ui.tab = b.dataset.tab; saveUI(); renderView(); $("#main").scrollTop = 0; return; }
  if (b.dataset.pv) { state.ui.pv = b.dataset.pv; saveUI(); return rerender(); }
  if (b.dataset.sec) { state.ui.collapsed[b.dataset.sec] = !state.ui.collapsed[b.dataset.sec]; saveUI(); return renderFamilyTable(); }
  const act = b.dataset.act; if (!act) return;
  if (act === "go") e.preventDefault();
  const d = state.draft;
  const tr = b.closest("tr[data-row]"), rowId = (tr && tr.dataset.row) || (b.closest("[data-row]") || {}).dataset?.row;
  const row = rowId && specRows().find(r => r.id === rowId);
  const ok = !d || !d.locked || ["sheets", "close", "unlock", "dl-files", "more", "go"].includes(act);
  if (!ok) return;
  switch (act) {
    case "use": {
      const sv = srcValue(row, b.dataset.src);
      setFinal(rowId, sv.varies ? sv.varies[+b.dataset.i].value : sv.value, b.dataset.src); return renderFamilyTable();
    }
    case "more": { const v = b.previousElementSibling; v.classList.toggle("clamp"); b.textContent = v.classList.contains("clamp") ? "Show all" : "Show less"; return; }
    case "clear": delete d.values[rowId]; saveDraft(); return renderFamilyTable();
    case "delrow": d.custom = d.custom.filter(c => c.id !== rowId); delete d.values[rowId]; delete d.vcells[rowId]; saveDraft(); return rerender();
    case "addrow": {
      const sec = $("#newSec").value, label = $("#newLabel").value.trim();
      if (!label) return $("#newLabel").focus();
      const id = `${sec}::${label}`;
      if (specRows().some(r => r.id === id)) return toast("That field already exists in this section.");
      d.custom.push({ id, section: sec, label, level: $("#newVar") && $("#newVar").checked ? "variant" : "family" }); saveDraft(); return rerender();
    }
    case "fill": {
      const src = $("#fillSrc").value, mode = b.dataset.mode; let n = 0, skipped = 0;
      for (const r of familyRows()) {
        const sv = srcValue(r, src); if (!sv) continue;
        if (sv.varies) { skipped++; continue; }
        if (mode === "gaps" && (d.values[r.id] || {}).value) continue;
        d.values[r.id] = { value: sv.value, source: src, edited: false }; n++;
      }
      saveDraft(); renderFamilyTable();
      return toast(`${n} field${n === 1 ? "" : "s"} filled from ${SRC_LABEL[src]}.${skipped ? ` ${skipped} skipped because the datasheets disagree: pick those one by one, or mark them “varies”.` : ""}`);
    }
    case "show": {
      const cur = showOf(row), ch = b.dataset.ch;
      d.show[rowId] = "WCD".split("").filter(k => k === ch ? !cur.includes(k) : cur.includes(k)).join("");
      saveDraft(); return rerender();
    }
    case "to-variant": d.moved[rowId] = "variant"; saveDraft(); toast(`“${row.label}” moved to the Variant table.`); return rerender();
    case "to-family": d.moved[rowId] = "family"; saveDraft(); toast(`“${row.label}” moved to the Family screen.`); return rerender();
    case "fam-reset": delete d.vfam[rowId]; saveDraft(); return rerender();
    case "text-use": { const src = state.product.text[b.dataset.k][b.dataset.src]; d.text[b.dataset.k] = { value: src, source: b.dataset.src, edited: false }; saveDraft(); return rerender(); }
    case "uc-load": {
      const ucs = state.product.use_cases || {};
      if (b.dataset.src === "catalogue") d.use_cases = clone(ucs.catalogue);
      else {   // website titles, keeping any description already written for the same title
        const known = Object.fromEntries([...(ucs.catalogue || []), ...d.use_cases].map(u => [norm(u.title), u.description]));
        d.use_cases = ucs.website.map(u => ({ title: u.title, description: known[norm(u.title)] || "" }));
      }
      saveDraft(); return rerender();
    }
    case "uc-add": d.use_cases.push({ title: "", description: "" }); saveDraft(); return rerender();
    case "uc-del": d.use_cases.splice(+b.dataset.i, 1); saveDraft(); return rerender();
    case "uc-up": case "uc-down": {
      const i = +b.dataset.i, j = act === "uc-up" ? i - 1 : i + 1;
      if (j < 0 || j >= d.use_cases.length) return;
      [d.use_cases[i], d.use_cases[j]] = [d.use_cases[j], d.use_cases[i]]; saveDraft(); return rerender();
    }
    case "hl-load": { const h = state.product.highlights.catalogue; d.highlights = { key: clone(h.key || []), feature: clone(h.feature || []) }; saveDraft(); return rerender(); }
    case "hl-add": d.highlights[b.dataset.k].push(b.dataset.k === "key" ? { value: "", label: "", icon: "" } : { label: "", icon: "" }); saveDraft(); return rerender();
    case "hl-del": d.highlights[b.dataset.k].splice(+b.dataset.i, 1); saveDraft(); return rerender();
    case "hl-up": { const a = d.highlights[b.dataset.k], i = +b.dataset.i; if (i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]]; saveDraft(); return rerender(); }
    case "approve": return approve();
    case "fix-typos": { const n = fixAllTypos(); toast(`Corrected ${n} value${n === 1 ? "" : "s"}.`); return rerender(); }
    case "dl-files": {
      const fam = d.locked ? Object.assign(buildFamilyRecord(d.approved_by), { approved_at: d.approved_at }) : buildFamilyRecord(null);
      return zipFiles(filesFor(fam), `${fam.product_id}_${d.locked ? "approved" : "draft"}.zip`);
    }
    case "discard":
      return confirmBox("Discard this draft?", "All your choices and edits for this product in this browser will be deleted. Approved files are not affected.", "Discard", () => {
        lsSet(LS.draft(d.product_id), null); openProduct(state.pid); });
    case "unlock": state.draft.locked = false; lsSet(LS.draft(d.product_id), state.draft); renderList(); return renderView();
    case "sheets": return showSheets();
    case "close": return closeModal();
  }
});
document.addEventListener("input", e => {
  const t = e.target, d = state.draft;
  if (t.id === "search") return renderList();
  if (!d || d.locked) { if (t.id === "rowSearch") { state.ui.q = t.value; saveUI(); renderFamilyTable(); } return; }
  if (t.matches("td.fin textarea")) {
    const rowId = t.closest("tr").dataset.row, cur = d.values[rowId] || {};
    setFinal(rowId, t.value, cur.source && cur.source !== "edited" ? cur.source : "edited", true);
    autosize(t);
    t.closest("td").querySelectorAll(".tag").forEach(x => { x.className = "tag edited"; x.textContent = cur.source && cur.source !== "edited" ? SRC_LABEL[cur.source] + ", edited" : "Typed in"; });
    t.closest("tr").querySelectorAll("td.picked").forEach(x => x.classList.remove("picked"));
  } else if (t.dataset.text) {
    const cur = d.text[t.dataset.text] || {};
    d.text[t.dataset.text] = { value: t.value, source: cur.source || "edited", edited: true }; autosize(t); saveDraft();
    t.closest(".tf").querySelectorAll(".srcbtn.on").forEach(x => x.classList.remove("on"));
  } else if (t.dataset.uc != null) { d.use_cases[+t.dataset.uc][t.dataset.f] = t.value; autosize(t); saveDraft(); }
  else if (t.dataset.hl && t.tagName === "INPUT") { d.highlights[t.dataset.hl][+t.dataset.i][t.dataset.f] = t.value; saveDraft(); }
  else if (t.dataset.fam) {
    const r = specRows().find(x => x.id === t.dataset.fam);
    d.vfam[t.dataset.fam] = { value: t.value, edited: true, basis: hashVals(r) }; autosize(t); saveDraft();
    const tag = t.parentElement.querySelector(".tag"); if (tag) { tag.className = "tag edited"; tag.textContent = "Edited"; }
  } else if (t.matches("td.vc textarea")) {
    const rowId = t.closest("tr").dataset.row; setVcell(rowId, t.dataset.part, t.value); autosize(t); saveDraft();
    const td = t.closest("td"); td.classList.remove("ds", "empty"); td.classList.add("ed");
    const famTa = t.closest("tr").querySelector("textarea[data-fam]"), r = specRows().find(x => x.id === rowId);
    if (famTa && !(d.vfam[rowId] || {}).edited) famTa.value = suggest(r);
  } else if (t.id === "notes") { d.notes = t.value; saveDraft(); }
  else if (t.id === "rowSearch") { state.ui.q = t.value; saveUI(); renderFamilyTable(); }
});
document.addEventListener("change", e => {
  const t = e.target, d = state.draft;
  if (t.id === "catFilter" || t.id === "statusFilter") return renderList();
  if (t.id === "pvModel") { state.pvModel = t.value; return rerender(); }
  if (t.id === "pvPart") { state.pvPart = t.value; return rerender(); }
  if (t.id === "diffOnly") { state.ui.diffOnly = t.checked; saveUI(); return renderFamilyTable(); }
  if (t.id === "emptyOnly") { state.ui.emptyOnly = t.checked; saveUI(); return renderFamilyTable(); }
  if (t.dataset.hide) { state.ui.hide[t.dataset.hide] = !t.checked; saveUI(); return renderFamilyTable(); }
  if (!d || d.locked) return;
  if (t.dataset.feat) {
    const f = d.features[t.dataset.part];
    f[t.dataset.feat] = t.type === "checkbox" ? t.checked : t.dataset.feat === "modems" ? +t.value : t.value;
    if (t.dataset.feat === "cellular") f.modems = t.value ? (f.modems || 1) : 0;
    saveDraft(); return rerender();
  }
  if (t.dataset.hl && t.tagName === "SELECT") { d.highlights[t.dataset.hl][+t.dataset.i].icon = t.value; saveDraft(); return rerender(); }
});
window.addEventListener("hashchange", routeFromHash);
function routeFromHash() {
  const pid = decodeURIComponent(location.hash.slice(1)).split("/")[0]; if (!pid) return;
  if (state.index.products.some(p => p.id === pid) && pid !== state.pid) openProduct(pid, false);
}

/* ================================================================ modals, toast */
function openModal(html) { $("#modalBody").innerHTML = html; $("#modal").hidden = false; const f = $("#modalBody input, #modalBody button"); f && f.focus(); }
function closeModal() { $("#modal").hidden = true; }
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
function confirmBox(title, text, okLabel, onOk) {
  openModal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" type="button" data-act="close">Cancel</button><button class="btn primary" type="button" id="okBtn">${esc(okLabel)}</button></div>`);
  $("#okBtn").onclick = () => { closeModal(); onOk(); };
}
function showSheets() {
  const p = state.product;
  const items = Object.entries(p.datasheets).map(([k, v]) => `<details><summary><b>${esc(k)}</b> · model on sheet: ${esc(v.model || "—")} · footer: ${esc(v.footer || "—")} · ${v.pages} page${v.pages > 1 ? "s" : ""}${v.template ? "" : " · <span style='color:var(--warn)'>non-standard layout: check the full text</span>"}</summary>
    <p class="small">${v.pdf ? `<a href="${esc(v.pdf)}" target="_blank" rel="noopener">Open PDF</a> · ` : ""}${esc(v.file)}</p><pre>${esc(v.raw)}</pre></details>`).join("");
  openModal(`<h2>Datasheets for ${esc(p.name)}</h2><p class="small muted">Values in the tables were read from these PDFs. Sheets with a non-standard layout may be missing fields: copy them from the full text.</p>${items}<div style="text-align:right;margin-top:10px"><button class="btn" type="button" data-act="close">Close</button></div>`);
}
function showSettings() {
  const s = state.settings;
  openModal(`<h2>GitHub connection</h2>
    <p class="small">Connect to save approved files straight into the repository (<code>${esc(s.base)}/</code>) so everyone sees them. Without it, approving downloads a zip.</p>
    <p class="small muted">Use a <b>fine-grained personal access token</b> limited to this one repository with <b>Contents: Read and write</b>. It is stored only in this browser.</p>
    <form class="form" id="setForm">
      <div class="row"><label>Owner<input name="owner" value="${esc(s.owner)}" required></label><label>Repository<input name="repo" value="${esc(s.repo)}" required></label><label>Branch<input name="branch" value="${esc(s.branch)}" required></label></div>
      <label>Folder for approved files<input name="base" value="${esc(s.base)}"></label>
      <label>Token<input name="token" type="password" value="${esc(s.token)}" autocomplete="off" placeholder="github_pat_…"></label>
      <label>Your name (used for “Approved by”)<input name="name" value="${esc(s.name)}"></label>
      <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap"><span id="setMsg" class="small muted"></span>
        <span style="display:flex;gap:8px"><button class="btn" type="button" id="disc">Disconnect</button><button class="btn" type="button" data-act="close">Cancel</button><button class="btn primary" type="submit">Save and test</button></span></div>
    </form>`);
  $("#disc").onclick = () => { state.settings.token = ""; lsSet(LS.settings, state.settings); updateGhDot(); closeModal(); toast("GitHub disconnected."); };
  $("#setForm").onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    Object.assign(state.settings, f, { base: (f.base || "docs/approved").replace(/^\/|\/$/g, "") });
    lsSet(LS.settings, state.settings);
    $("#setMsg").textContent = "Testing…";
    try {
      const r = await gh("");
      if (!r.permissions || !r.permissions.push) throw new Error("token cannot write to this repository");
      await loadApprovedIndex(); updateGhDot(); renderList();
      closeModal(); toast(`Connected to ${r.full_name}.`);
    } catch (err) { $("#setMsg").textContent = `Failed: ${err.message}`; updateGhDot(); }
  };
}
function updateGhDot() { $("#ghDot").className = "dot " + (ghReady() ? "on" : "off"); }
let toastT;
function toast(msg, ms = 5200) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); if (ms) toastT = setTimeout(() => t.hidden = true, ms);
}

/* ================================================================ exports (all approved products) */
async function approvedFamilies() {
  const ids = new Set(Object.keys(state.approved));
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("pch2:approved:")) ids.add(k.slice(14)); }
  const out = [];
  for (const pid of ids) { const r = await loadApprovedRecord(pid); if (r && r.schema === SCHEMA) out.push(r); }
  return out;
}
async function withProduct(rec, fn) {     // build outputs for an approved record using the normal helpers
  const keep = [state.pid, state.product, state.draft];
  state.pid = rec.product_id; state.product = await loadProduct(rec.product_id);
  state.draft = Object.assign(clone(rec.editor_state), { locked: true }); ensureFeatures(state.draft);
  try { return fn(); } finally { [state.pid, state.product, state.draft] = keep; }
}
async function exportApproved() {
  toast("Collecting approved records…", 0);
  const recs = await approvedFamilies();
  if (!recs.length) return toast("No approved products yet.");
  const files = {}, index = {};
  for (const rec of recs) {
    const fs = await withProduct(rec, () => filesFor(rec));
    Object.assign(files, fs);
    index[rec.product_id] = { file: `${rec.product_id}.json`, product_id: rec.product_id, variants: Object.keys(fs).filter(f => f.includes("/")), approved_by: rec.approved_by, approved_at: rec.approved_at };
  }
  files["index.json"] = JSON.stringify({ updated: now(), records: index }, null, 2) + "\n";
  await zipFiles(files, `approved_${new Date().toISOString().slice(0, 10)}.zip`);
  toast(`Downloaded ${recs.length} approved product(s).`);
}
const WIFI_ENUM = { "Wi-Fi 4": "WiFi4", "Wi-Fi 5": "WiFi5", "Wi-Fi 6": "WiFi6", "Wi-Fi 7": "WiFi7", "Wi-Fi": "WiFi" };
async function exportWebsite() {
  toast("Building website JSON…", 0);
  const recs = await approvedFamilies();
  if (!recs.length) return toast("No approved products yet.");
  const files = {};
  for (const rec of recs) {
    const json = await withProduct(rec, () => {
      const p = state.product, w = p.meta.website || {}, idx = state.index.products.find(x => x.id === p.id) || {};
      const fam = Object.fromEntries(familySpecs("W").flatMap(g => g.items.map(i => [`${g.section}::${i.label}`, i.value])));
      const v = k => fam[k] || "";
      const fs = parts().map(pt => state.draft.features[pt] || {});
      const gens = [...new Set(fs.map(f => f.cellular).filter(Boolean))].sort().reverse();
      const wifis = fs.map(f => f.wifi).filter(Boolean).sort().reverse();
      const ord = orderingTable();
      return {
        id: p.id, name: p.name, cat: p.category, order: idx.order || 0,
        desc: textVal("short_description"),
        cpu: v("Hardware::CPU"), ram: v("Hardware::RAM"), storage: v("Hardware::Flash") || v("Hardware::Storage"),
        cell: v("Hardware::Cellular"), cellular_gen: gens[0] || "", wifi: WIFI_ENUM[wifis[0]] || "",
        rs485: fs.some(f => f.rs485) ? "Yes" : "No", rs232: fs.some(f => f.rs232) ? "Yes" : "No",
        ip: v("Physical::IP Rating"), power: v("Power::Input Voltage"), ports: v("Website filters::Ethernet ports"),
        os: v("Operating System & Software::Operating System"), housing: v("Physical::Enclosure"), dims: v("Physical::Dimensions"),
        weight: v("Physical::Weight"), op_temp: v("Environmental::Operating Temperature"),
        images: w.images || [], use_cases: rec.use_cases.map(u => u.title), datasheet: w.datasheet ?? null,
        part_datasheets: w.part_datasheets || {}, hidden: !!w.hidden, hidden_fields: w.hidden_fields || [], additional_specs: [],
        variants: { headers: ord.headers.slice(1).concat("Part Number"), rows: ord.rows.map(r => r.slice(1).concat(r[0])) },
        full: {
          title: textVal("title"), tagline: textVal("tagline"), long_description: textVal("long_description"),
          use_cases: rec.use_cases.map(u => ({ title: u.title })),
          sections: familySpecs("W"),
          models: multi() ? Object.fromEntries(parts().map(pt => [pt, variantSpecs(pt).map(g => ({ section: g.section, items: g.items.filter(i => showOf({ id: `${g.section}::${i.label}`, section: g.section }).includes("W")) }))])) : {},
          approved_at: rec.approved_at,
        },
      };
    });
    files[`products/${rec.product_id}.json`] = JSON.stringify(json, null, 2) + "\n";
  }
  await zipFiles(files, `website_json_${new Date().toISOString().slice(0, 10)}.zip`);
  toast(`Website JSON for ${recs.length} product(s) downloaded. Each file keeps today's fields and adds a "full" block.`);
}

/* ================================================================ start */
async function init() {
  $("#btnSettings").onclick = showSettings;
  $("#btnExport").onclick = exportApproved;
  $("#btnWeb").onclick = exportWebsite;
  updateGhDot();
  try { state.index = await getJSON("data/index.json"); }
  catch { $("#empty").innerHTML = `<h1>No data yet</h1><p>Run <code>python tools/build_data.py</code> to create <code>docs/data/</code> (see README).</p>`; return; }
  try { state.fields = await getJSON("data/fields.json"); } catch {}
  try { state.icons = await getJSON("data/icons.json"); } catch {}
  $("#buildInfo").textContent = `Sources read ${new Date(state.index.built).toLocaleDateString()}`;
  const cats = state.index.categories && state.index.categories.length ? state.index.categories : [...new Set(state.index.products.map(p => p.category))];
  $("#catFilter").insertAdjacentHTML("beforeend", cats.map(c => `<option>${esc(c)}</option>`).join(""));
  await loadApprovedIndex();
  renderList();
  routeFromHash();
}
init();
})();
