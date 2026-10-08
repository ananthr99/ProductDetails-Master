/* Product Content Hub v3 — two steps per product.
   Step 1 · Final data: every piece of information from every source merged into one set (product level, and per variant
            where it differs). Agreed / single-source lines fill themselves; the reviewer only answers "Needs decision".
   Step 2 · Where it appears: tick Website / Catalogue / Datasheet per line, then approve.
   Approved: docs/approved/<pid>.json (product) and docs/approved/<pid>/<PART>.json (one per variant).
   Static app for GitHub Pages; data/*.json is built by tools/build_data.py. */
(() => {
"use strict";

const SOURCES = [
  { key: "website", label: "Website", short: "W" },
  { key: "master", label: "Old Master", short: "M" },
  { key: "catalogue", label: "New Catalogue", short: "C" },
  { key: "datasheet", label: "Datasheet", short: "D" },
];
const SRC_LABEL = { website: "Website", master: "Old Master", catalogue: "New Catalogue", datasheet: "Datasheet", typed: "Typed in" };
const CH = { W: "Website", C: "Catalogue", D: "Datasheet" };
const INFO = [
  { key: "title", label: "Title", hint: "e.g. Industrial 5G/4G Dual Modem Router", def: "WCD" },
  { key: "tagline", label: "Tagline", hint: "e.g. ROUTER · DUAL MODEM 5G/4G", def: "C" },
  { key: "short_description", label: "Short description", hint: "One or two sentences", def: "W" },
  { key: "long_description", label: "Long description", hint: "A paragraph", def: "CD" },
];
const DERIVED_FILTERS = new Set(["Website filters::Cellular generation", "Website filters::Wi-Fi", "Website filters::RS485", "Website filters::RS232"]);
const NA_RX = /^(na|n\/a|-|—|no|none|nil|not applicable)$/i;
const SCHEMA = "invendis.product-content/v3";
const MAX_KEY = 5, MAX_FEAT = 4;
const LS = { draft: p => `pch3:draft:${p}`, approved: p => `pch3:approved:${p}`, settings: "pch:settings", ui: "pch3:ui" };

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = s => String(s).replace(/\(.*?\)/g, "").trim().replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "") || "variant";
const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const isNA = v => !String(v ?? "").trim() || NA_RX.test(String(v).trim());
const lsGet = k => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const clone = o => JSON.parse(JSON.stringify(o));
const pick = (o, ks) => { const r = {}; ks.forEach(k => r[k] = (o || {})[k]); return r; };

const state = {
  index: null, products: {}, approved: {}, fields: { sections: {}, fields: {}, text: {} }, icons: {},
  settings: Object.assign({ owner: "", repo: "", branch: "main", token: "", name: "", base: "docs/approved" }, lsGet(LS.settings) || {}),
  ui: Object.assign({ filter: "decide" }, lsGet(LS.ui) || {}),
  pid: null, product: null, draft: null, open: {},
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
  for (const [k, v] of Object.entries(idx.records || {})) if (!k.includes("/") && v.schema === SCHEMA) state.approved[k] = v;
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
      state.approved = Object.fromEntries(Object.entries(idx.records).filter(([k, v]) => !k.includes("/") && v.schema === SCHEMA));
      return;
    } catch (e) { if (e.status !== 422 && e.status !== 409) throw e; }
  }
  throw new Error("The repository kept changing while saving. Try again.");
}

/* ================================================================ product helpers */
const P = () => state.product, D = () => state.draft;
const parts = () => P().variants && P().variants.length ? P().variants : [P().name];
const multi = () => parts().length > 1;
function dsKey(part) {
  const ds = Object.keys(P().datasheets || {});
  return ds.find(k => k === part) || ds.find(k => norm(k) === norm(part)) || null;
}
function loadedSources() {
  const l = state.index && state.index.sources;
  return SOURCES.filter(x => !l || l.includes(x.key));
}
function specRows() {
  const rows = P().rows.filter(r => r.section !== "Overview" && !DERIVED_FILTERS.has(r.id));
  for (const c of D().custom || []) {
    if (rows.some(r => r.id === c.id)) continue;
    const at = rows.map(r => r.section).lastIndexOf(c.section);
    rows.splice(at < 0 ? rows.length : at + 1, 0, { id: c.id, section: c.section, label: c.label, values: {}, ds: "none", custom: true, lvl: c.level });
  }
  return rows;
}
function isVariant(row) {
  if (!multi()) return false;
  const l = (D().level || {})[row.id];
  if (l) return l === "variant";
  if (row.custom) return row.lvl === "variant";
  return row.ds === "varies" || row.ds === "partial";
}

/* ---------- candidate values for a product-level line, grouped across sources */
function candidates(row) {
  const groups = {};
  const add = (val, who) => {
    if (!String(val || "").trim()) return;
    const k = norm(val);
    (groups[k] = groups[k] || { value: val, who: [] }).who.push(who);
  };
  const v = row.values || {};
  for (const s of loadedSources()) {
    if (s.key === "datasheet") {
      const ds = v.datasheet || {}, n = Object.keys(P().datasheets || {}).length;
      const byVal = {};
      for (const [pt, val] of Object.entries(ds)) (byVal[norm(val)] = byVal[norm(val)] || { val, pts: [] }).pts.push(pt);
      for (const g of Object.values(byVal)) add(g.val, n > 1 && g.pts.length < n ? `Datasheet: ${g.pts.join(", ")}` : n > 1 ? "Datasheet (all)" : "Datasheet");
    } else if (v[s.key]) add(v[s.key], s.label);
  }
  return Object.values(groups).sort((a, b) => b.who.length - a.who.length);
}
function infoCandidates(key) {
  const src = ((P().text || {})[key]) || {}, groups = {};
  for (const [s, val] of Object.entries(src)) (groups[norm(val)] = groups[norm(val)] || { value: val, who: [] }).who.push(SRC_LABEL[s] || s);
  return Object.values(groups);
}
/* ---------- variant values: explicit edit, else the variant's own datasheet */
function vcell(row, part) {
  const e = ((D().vcells || {})[row.id] || {})[part];
  if (e) return { value: e.value, source: "typed", edited: true };
  const k = dsKey(part), v = k && ((row.values || {}).datasheet || {})[k];
  return v ? { value: v, source: "datasheet", edited: false } : { value: "", source: "", edited: false };
}
function cellProblem(row, part, value) {
  const f = (D().features || {})[part] || {};
  if (isNA(value)) return "";
  const id = row.id.toLowerCase(), v = value.toLowerCase();
  const wifiRow = row.section === "Wi-Fi" || /::wi-fi$/.test(id);
  const cellRow = row.section === "Cellular" || /::(cellular|sim)$/.test(id);
  if (wifiRow && !f.wifi) return "this variant has no Wi-Fi";
  if (cellRow && !f.cellular) return "this variant has no cellular";
  if (/cellular module|::cellular$/.test(id) && f.cellular === "4G" && /\b5g\b/.test(v)) return "says 5G, the variant is 4G";
  if (/cellular module/.test(id) && f.cellular === "5G" && /\b4g\b/.test(v) && !/\b5g\b/.test(v)) return "module is 4G, the variant is 5G";
  if (/::sim$/.test(id) && +f.modems === 1 && /active,\s*active|2x active/.test(v)) return "two active SIMs on a single-modem variant";
  return "";
}
function sectionDropped(row, part) {
  const f = (D().features || {})[part] || {};
  return (row.section === "Wi-Fi" && !f.wifi) || (row.section === "Cellular" && !f.cellular);
}
function problems(row) { return parts().filter(pt => !sectionDropped(row, pt) && cellProblem(row, pt, vcell(row, pt).value)); }

/* ---------- status of a line in step 1: auto | decide | done | empty */
function lineState(row) {
  const d = D();
  if (isVariant(row)) {
    const pr = problems(row);
    if (pr.length && !(d.confirmed || {})[row.id]) return { st: "decide", why: `${pr.length} variant value${pr.length > 1 ? "s" : ""} contradict what the variant has` };
    const any = parts().some(pt => vcell(row, pt).value);
    const touched = (d.confirmed || {})[row.id] || Object.keys((d.vcells || {})[row.id] || {}).length;
    return { st: touched ? "done" : any ? "auto" : row.custom ? "decide" : "empty", why: any ? "From each variant's datasheet" : "Add a value per variant" };
  }
  const cur = (d.lines || {})[row.id];
  const c = candidates(row);
  if (cur && (cur.decided || cur.edited)) return { st: "done", value: cur.value, why: cur.edited ? "Typed in" : `Chosen: ${cur.who || ""}` };
  if (!c.length) return row.custom ? { st: "decide", value: "", why: "New line: type the value" } : { st: "empty" };
  if (c.length === 1) return { st: "auto", value: c[0].value, why: c[0].who.length > 1 ? `Same in ${c[0].who.join(", ")}` : `Only in ${c[0].who[0]}` };
  return { st: "decide", value: "", why: `${c.length} different values` };
}
function infoState(key) {
  const cur = (D().info || {})[key], c = infoCandidates(key);
  if (cur && (cur.decided || cur.edited)) return { st: "done", value: cur.value, why: cur.edited ? "Typed in" : `Chosen: ${cur.who || ""}` };
  if (!c.length) return { st: "decide", value: "", why: "No source has this: type it" };
  if (c.length === 1) return { st: "auto", value: c[0].value, why: c[0].who.length > 1 ? `Same in ${c[0].who.join(", ")}` : `Only in ${c[0].who[0]}` };
  return { st: "decide", value: "", why: `${c.length} different versions` };
}
const finalLine = row => { const s = lineState(row); return s.st === "empty" ? "" : (s.value || ""); };
const finalInfo = key => infoState(key).value || "";

/* ---------- step 2: where each line appears */
function placeOf(id, section) {
  const d = D(), f = state.fields;
  if ((d.place || {})[id] != null) return d.place[id];
  if (id.startsWith("info::")) return (INFO.find(i => "info::" + i.key === id) || {}).def || "WCD";
  if (id === "list::use_case_title") return (f.text || {}).use_case_title || "WC";
  if (id === "list::use_case_description") return (f.text || {}).use_case_description || "C";
  if (id === "list::key_highlights" || id === "list::feature_highlights") return "C";
  return f.fields[id] || f.sections[section] || "WCD";
}
function suggest(row) {        // one line for website/catalogue from the variant values: "5G/4G", "640–700 g"
  const vals = parts().map(p => ({ part: p, v: vcell(row, p).value.trim() }));
  const have = vals.filter(x => !isNA(x.v));
  if (!have.length) return "";
  const groups = {};
  have.forEach(x => (groups[norm(x.v)] = groups[norm(x.v)] || { v: x.v, parts: [] }).parts.push(x.part));
  const g = Object.values(groups);
  const some = vals.some(x => isNA(x.v) && (x.v || dsKey(x.part)));
  const tag = () => have.length <= 4 ? ` (${have.map(x => x.part).join(", ")})` : " (selected models)";
  if (g.length === 1) return g[0].v + (some ? tag() : "");
  const num = have.map(x => x.v.match(/^\s*([\d.]+)\s*([^\d\s].*)?$/));
  if (num.every(Boolean) && new Set(num.map(m => norm(m[2] || ""))).size === 1) {
    const ns = num.map(m => parseFloat(m[1])), u = (num[0][2] || "").trim();
    return `${Math.min(...ns)}–${Math.max(...ns)}${u ? " " + u : ""}` + (some ? tag() : "");
  }
  const tops = have.map(x => (x.v.match(/\b[2-5]G\b/g) || []).sort().reverse()[0]);
  if (tops.every(Boolean) && new Set(tops).size > 1) return [...new Set(tops)].sort().reverse().join("/") + (some ? tag() : "");
  if (g.length <= 3 && g.every(x => x.v.length <= 40)) return g.map(x => x.v).join(" / ") + (some ? tag() : "");
  return "";
}
function summaryOf(row) {
  const s = (D().summary || {})[row.id];
  return s && s.edited ? { value: s.value, edited: true } : { value: suggest(row), edited: false };
}

/* ================================================================ drafts */
function newDraft(p) {
  const d = { v: 3, product_id: p.id, created_at: now(), updated_at: now(), locked: false, step: 1,
    info: {}, use_cases: [], highlights: { key: [], feature: [] }, lines: {}, level: {}, vcells: {}, confirmed: {},
    summary: {}, place: {}, custom: [], features: clone(p.features || {}), notes: "" };
  const uc = p.use_cases || {};
  const titles = new Set();
  for (const u of [...(uc.catalogue || []), ...(uc.website || [])]) {      // catalogue (with descriptions) + website titles it lacks
    if (titles.has(norm(u.title))) continue;
    titles.add(norm(u.title)); d.use_cases.push({ title: u.title, description: u.description || "" });
  }
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
  const d = D();
  if (!d || d.locked) return;
  d.updated_at = now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { lsSet(LS.draft(d.product_id), d); renderList(); }, 250);
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
  state.pid = pid; state.product = p; state.open = {};
  let d = lsGet(LS.draft(pid));
  if (!d || d.v !== 3) {
    const a = state.approved[pid] || lsGet(LS.approved(pid)) ? await loadApprovedRecord(pid) : null;
    d = a && a.schema === SCHEMA && a.editor_state ? Object.assign(clone(a.editor_state), { locked: true, approved_by: a.approved_by, approved_at: a.approved_at }) : newDraft(p);
  }
  state.draft = d;
  ensureFeatures(d);
  if (push) history.replaceState(null, "", `#${encodeURIComponent(pid)}`);
  renderList(); renderView();
  $("#main").scrollTop = 0;
}

/* ================================================================ view */
function counts() {
  let decide = 0, total = 0;
  for (const i of INFO) { total++; if (infoState(i.key).st === "decide") decide++; }
  for (const r of specRows()) { const s = lineState(r).st; if (s === "empty") continue; total++; if (s === "decide") decide++; }
  return { decide, total };
}
function renderView() {
  const p = P(), d = D();
  $("#empty").hidden = true;
  const v = $("#view"); v.hidden = false;
  const m = p.meta || {}, mm = m.master || {}, c = m.catalogue || {};
  const dsN = Object.keys(p.datasheets || {}).length;
  const { decide } = counts();
  const step = d.step === 2 ? 2 : 1;
  v.innerHTML = `
    <div class="phead"><div>
      <h1>${esc(p.name)}</h1>
      <div class="meta">${esc(p.category)} · ${multi() ? `${parts().length} variants: ${esc(parts().join(", "))}` : "single product"}</div>
      <div class="origs">
        ${mm.brief_page ? `<a class="orig" target="_blank" rel="noopener" href="${esc(mm.pdf || "")}#page=${mm.brief_page}"><i class="sw master"></i>Old Master p.${mm.brief_page}</a>` : ""}
        ${c.pdf ? `<a class="orig" target="_blank" rel="noopener" href="${esc(c.pdf)}"><i class="sw catalogue"></i>New catalogue PDF</a>` : ""}
        ${dsN ? `<button class="orig" type="button" data-act="sheets"><i class="sw datasheet"></i>${dsN} datasheet${dsN > 1 ? "s" : ""}</button>` : ""}
      </div></div></div>
    ${d.locked ? `<div class="notice ok">Approved${d.approved_by ? " by <b>" + esc(d.approved_by) + "</b>" : ""}${d.approved_at ? " on " + esc(new Date(d.approved_at).toLocaleString()) : ""}. <button class="btn sm" type="button" data-act="unlock">Edit again</button> <button class="btn sm" type="button" data-act="dl-files">Download files</button></div>` : ""}
    <ol class="steps">
      <li><button type="button" data-step="1" aria-current="${step === 1}"><b>1</b> Final data <span class="muted">${decide ? `${decide} to decide` : "✓ complete"}</span></button></li>
      <li><button type="button" data-step="2" aria-current="${step === 2}"><b>2</b> Where it appears</button></li>
    </ol>
    <div id="stepBody" class="${d.locked ? "ro" : ""}"></div>`;
  renderStep();
}
function renderStep() {
  const el = $("#stepBody");
  el.innerHTML = D().step === 2 ? step2() : step1();
  el.querySelectorAll("textarea").forEach(autosize);
}
function autosize(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 360) + "px"; }
function rerender() { const y = $("#main").scrollTop; renderView(); $("#main").scrollTop = y; }

/* ---------------------------------------------------------------- step 1: final data */
const badge = s => s === "decide" ? `<span class="badge decide">Needs decision</span>` : s === "done" ? `<span class="badge done">Decided</span>` : `<span class="badge auto">Agreed</span>`;
function optionsHTML(id, cands, kind) {
  return `<div class="opts">${cands.map((c, i) => `<button type="button" class="opt" data-act="choose" data-kind="${kind}" data-i="${i}">
    <span class="who">${esc(c.who.join(" · "))}</span><span class="val">${esc(c.value)}</span></button>`).join("")}</div>`;
}
function infoLine(i) {
  const s = infoState(i.key), d = D(), locked = d.locked, id = "info::" + i.key;
  const show = state.ui.filter === "all" || s.st === "decide" || state.open[id];
  if (!show) return "";
  const c = infoCandidates(i.key);
  const openEdit = s.st === "decide" || state.open[id];
  return `<div class="line ${s.st}" data-id="${esc(id)}">
    <div class="lh"><b>${esc(i.label)}</b>${badge(s.st)}<span class="why">${esc(s.why || "")}</span>${!locked && !openEdit && c.length > 1 ? `<button class="lnk" type="button" data-act="open">see all versions</button>` : ""}</div>
    ${openEdit && c.length && !locked ? optionsHTML(id, c, "info") : ""}
    <textarea data-info="${i.key}" rows="${i.key.includes("description") ? 3 : 1}" ${locked ? "readonly" : ""} placeholder="${s.st === "decide" ? "Choose a version above, or type here" : esc(i.hint)}">${esc(s.value || "")}</textarea></div>`;
}
function specLine(r) {
  const s = lineState(r), d = D(), locked = d.locked, f = state.ui.filter;
  if (s.st === "empty") return "";
  if (f === "variant" && !isVariant(r)) return "";
  if (f === "decide" && s.st !== "decide" && !state.open[r.id]) return "";
  const levelBtn = multi() && !locked ? `<button class="lnk" type="button" data-act="level" title="Switch between one value for the product and one value per variant">${isVariant(r) ? "↖ same for all variants" : "↘ differs by variant"}</button>` : "";
  const del = r.custom && !locked ? `<button class="lnk" type="button" data-act="delrow">remove</button>` : "";
  if (isVariant(r)) {
    const pr = problems(r);
    const refs = loadedSources().filter(x => x.key !== "datasheet" && (r.values || {})[x.key]).map(x => `<span><i class="sw ${x.key}"></i>${x.label}: ${esc(r.values[x.key])}</span>`).join("");
    if (s.st !== "decide" && !state.open[r.id]) {        // settled: one compact line, values on request
      const distinct = [...new Set(parts().map(pt => vcell(r, pt).value.trim()).filter(Boolean))];
      return `<div class="line ${s.st}" data-id="${esc(r.id)}">
        <div class="lh"><b>${esc(r.label)}</b><span class="lvl">per variant</span>${badge(s.st)}<span class="why">${esc(s.why || "")}</span><button class="lnk" type="button" data-act="open">show the ${parts().length} values</button>${levelBtn}${del}</div>
        <div class="fv muted small">${esc(distinct.length === 1 ? distinct[0] : `${distinct.length} different values: ${distinct.slice(0, 3).map(x => x.length > 50 ? x.slice(0, 50) + "…" : x).join(" | ")}${distinct.length > 3 ? " …" : ""}`)}</div></div>`;
    }
    return `<div class="line ${s.st}" data-id="${esc(r.id)}">
      <div class="lh"><b>${esc(r.label)}</b><span class="lvl">per variant</span>${badge(s.st)}<span class="why">${esc(s.why || "")}</span>${state.open[r.id] ? `<button class="lnk" type="button" data-act="close-line">hide values</button>` : ""}${levelBtn}${del}</div>
      <table class="vt"><tbody>${parts().map(pt => {
        const c = vcell(r, pt), drop = sectionDropped(r, pt), bad = pr.includes(pt);
        return `<tr class="${bad ? "bad" : ""} ${drop ? "drop" : ""}"><th>${esc(pt)}${dsKey(pt) ? "" : ` <span class="nosheet">no datasheet</span>`}</th>
          <td><textarea rows="1" data-part="${esc(pt)}" ${locked ? "readonly" : ""} placeholder="${dsKey(pt) ? "not on its datasheet" : "no datasheet: type the value"}">${esc(c.value)}</textarea>
          ${bad ? `<span class="warn">⚠ ${esc(cellProblem(r, pt, c.value))}</span>` : drop ? `<span class="muted small">left out of this variant's datasheet</span>` : ""}</td></tr>`; }).join("")}</tbody></table>
      ${refs ? `<div class="refs">For the whole product: ${refs}</div>` : ""}
      ${pr.length && !locked && !(d.confirmed || {})[r.id] ? `<div class="acts"><button class="btn sm" type="button" data-act="na-all">Set the flagged values to NA</button><button class="btn sm" type="button" data-act="confirm">The values are correct</button></div>` : ""}
    </div>`;
  }
  const c = candidates(r);
  const openEdit = s.st === "decide" || state.open[r.id];
  return `<div class="line ${s.st}" data-id="${esc(r.id)}">
    <div class="lh"><b>${esc(r.label)}</b>${badge(s.st)}<span class="why">${esc(s.why || "")}</span>${!locked && !openEdit ? `<button class="lnk" type="button" data-act="open">change</button>` : ""}${levelBtn}${del}</div>
    ${openEdit && c.length > 1 && !locked ? optionsHTML(r.id, c, "line") : ""}
    ${openEdit || s.st === "done" ? `<textarea data-line="${esc(r.id)}" rows="1" ${locked ? "readonly" : ""} placeholder="Choose a value above, or type here">${esc(s.value || "")}</textarea>` : `<div class="fv">${esc(s.value)}</div>`}
  </div>`;
}
function step1() {
  const d = D(), p = P(), locked = d.locked, f = state.ui.filter;
  const { decide, total } = counts();
  const ico = n => n && state.icons[n] ? `<span class="ico">${state.icons[n]}</span>` : `<span class="ico"></span>`;
  const varCard = multi() ? `<section class="card"><h2>Variants</h2>
    <p class="hint">What each variant has. This builds the ordering table and decides which sections each variant's datasheet gets.</p>
    <div class="tw"><table class="feat"><thead><tr><th>Variant</th><th>Cellular</th><th>Modems</th><th>Wi-Fi</th><th>RS485</th><th>RS232</th><th>Datasheet</th></tr></thead><tbody>${parts().map(pt => {
      const x = d.features[pt], dis = locked ? "disabled" : "";
      const sel = (k, opts) => `<select data-feat="${k}" data-part="${esc(pt)}" ${dis}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(x[k]) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
      return `<tr><th>${esc(pt)}</th><td>${sel("cellular", [["", "None"], ["4G", "4G"], ["5G", "5G"]])}</td><td>${sel("modems", [[0, "—"], [1, "Single"], [2, "Dual"]])}</td>
        <td>${sel("wifi", [["", "None"], ["Wi-Fi 4", "Wi-Fi 4"], ["Wi-Fi 5", "Wi-Fi 5"], ["Wi-Fi 6", "Wi-Fi 6"], ["Wi-Fi 7", "Wi-Fi 7"], ["Wi-Fi", "Wi-Fi (other)"]])}</td>
        <td><input type="checkbox" data-feat="rs485" data-part="${esc(pt)}" ${x.rs485 ? "checked" : ""} ${dis}></td><td><input type="checkbox" data-feat="rs232" data-part="${esc(pt)}" ${x.rs232 ? "checked" : ""} ${dis}></td>
        <td class="small">${dsKey(pt) ? "✓" : `<span class="nosheet">none</span>`}</td></tr>`; }).join("")}</tbody></table></div></section>` : "";
  let body = "";
  const bySec = {};
  for (const r of specRows()) { const h = specLine(r); if (h) (bySec[r.section] = bySec[r.section] || []).push(h); }
  for (const [s, list] of Object.entries(bySec)) body += `<h3 class="sech">${esc(s)}</h3>${list.join("")}`;
  const info = f === "variant" ? "" : INFO.map(infoLine).join("");
  const ucs = d.use_cases.map((u, i) => `<tr><td class="n">${i + 1}</td><td><textarea data-uc="${i}" data-f="title" rows="1" ${locked ? "readonly" : ""} placeholder="Title">${esc(u.title)}</textarea></td>
    <td><textarea data-uc="${i}" data-f="description" rows="2" ${locked ? "readonly" : ""} placeholder="Description">${esc(u.description)}</textarea></td>
    <td class="acts">${locked ? "" : `<button class="x" type="button" data-act="uc-up" data-i="${i}" title="Move up">↑</button><button class="x" type="button" data-act="uc-del" data-i="${i}" title="Remove">✕</button>`}</td></tr>`).join("");
  const iconSel = (k, i, cur) => `<select data-hl="${k}" data-i="${i}" data-f="icon" ${locked ? "disabled" : ""}><option value="">—</option>${Object.keys(state.icons).map(n => `<option ${n === cur ? "selected" : ""}>${n}</option>`).join("")}</select>`;
  const hk = d.highlights.key.map((h, i) => `<tr><td>${ico(h.icon)}${iconSel("key", i, h.icon)}</td><td><input data-hl="key" data-i="${i}" data-f="value" value="${esc(h.value)}" ${locked ? "readonly" : ""} placeholder="Value"></td><td><input data-hl="key" data-i="${i}" data-f="label" value="${esc(h.label)}" ${locked ? "readonly" : ""} placeholder="Label"></td><td class="acts">${locked ? "" : `<button class="x" type="button" data-act="hl-del" data-k="key" data-i="${i}">✕</button>`}</td></tr>`).join("");
  const hf = d.highlights.feature.map((h, i) => `<tr><td>${ico(h.icon)}${iconSel("feature", i, h.icon)}</td><td><input data-hl="feature" data-i="${i}" data-f="label" value="${esc(h.label)}" ${locked ? "readonly" : ""} placeholder="Label"></td><td class="acts">${locked ? "" : `<button class="x" type="button" data-act="hl-del" data-k="feature" data-i="${i}">✕</button>`}</td></tr>`).join("");
  const nVar = specRows().filter(r => isVariant(r) && lineState(r).st !== "empty").length;
  return `
  <div class="intro">
    <p><b>Every piece of information about ${esc(p.name)} from the website, the old Master Catalogue, the new catalogue and the datasheets, merged into one list.</b>
    Where the sources agree, or only one source has the information, the line is filled in already. You only need to answer the lines marked <span class="badge decide">Needs decision</span>.</p>
    <div class="progress-row"><div class="pbar"><i style="width:${total ? Math.round(100 * (total - decide) / total) : 100}%"></i></div>
      <b>${decide ? `${decide} of ${total} lines need a decision` : `All ${total} lines are settled`}</b></div>
    <div class="filters2" role="tablist">
      <button type="button" data-filter="decide" aria-selected="${f === "decide"}">Needs decision (${decide})</button>
      <button type="button" data-filter="all" aria-selected="${f === "all"}">All information (${total})</button>
      ${multi() ? `<button type="button" data-filter="variant" aria-selected="${f === "variant"}">Differs by variant (${nVar})</button>` : ""}
    </div>
  </div>
  ${f === "all" ? varCard : ""}
  ${info ? `<section class="card"><h2>Product text</h2>${info}</section>` : ""}
  ${f === "all" ? `<section class="card"><h2>Use cases</h2><p class="hint">From the new catalogue (with descriptions), plus any website titles it doesn't have.</p>
     <div class="tw"><table class="grid"><tbody>${ucs || `<tr><td class="muted small">None</td></tr>`}</tbody></table></div>${locked ? "" : `<button class="btn sm" type="button" data-act="uc-add">Add use case</button>`}</section>
   <section class="card"><h2>Highlights</h2><p class="hint">Key Highlights (tiles, up to ${MAX_KEY}) and Feature Highlights (badges, up to ${MAX_FEAT}), from the new catalogue.</p>
     <div class="hl2"><div><h3>Key Highlights</h3><table class="grid"><tbody>${hk || `<tr><td class="muted small">None</td></tr>`}</tbody></table>${locked ? "" : `<button class="btn sm" type="button" data-act="hl-add" data-k="key">Add</button>`}</div>
     <div><h3>Feature Highlights</h3><table class="grid"><tbody>${hf || `<tr><td class="muted small">None</td></tr>`}</tbody></table>${locked ? "" : `<button class="btn sm" type="button" data-act="hl-add" data-k="feature">Add</button>`}</div></div></section>` : ""}
  <section class="card"><h2>Specifications</h2>${body || `<p class="good"><b>Nothing left to decide here.</b> Choose “All information” to review or change any line, the variants, use cases and highlights.</p>`}
    ${locked || f !== "all" ? "" : `<div class="addrow"><b class="small">Add information none of the sources has</b><select id="newSec">${secOptions()}</select><input id="newLabel" placeholder="Name, e.g. Certifications">${multi() ? `<label class="chk"><input type="checkbox" id="newVar">differs by variant</label>` : ""}<button class="btn sm" type="button" data-act="addrow">Add</button></div>`}</section>
  <div class="next">${locked ? "" : decide ? `<span class="muted">Answer the ${decide} line${decide > 1 ? "s" : ""} marked “Needs decision” to continue.</span>` : ""}
    <button class="btn primary" type="button" data-step="2" ${decide && !locked ? "disabled" : ""}>Next: where it appears →</button></div>`;
}
function secOptions() {
  const secs = [...new Set(P().rows.map(r => r.section).filter(s => s !== "Overview"))];
  ["Hardware", "Interfaces", "Power", "Physical", "Environmental", "Cellular", "Wi-Fi", "Networking & Firewall", "VPN",
   "Remote Management", "Operating System & Software", "Gateway", "Compliance", "Packaging", "Other"].forEach(s => secs.includes(s) || secs.push(s));
  return secs.map(s => `<option>${esc(s)}</option>`).join("");
}

/* ---------------------------------------------------------------- step 2: where it appears */
function placeRow(id, section, label, valueHTML, extra = "") {
  const pl = placeOf(id, section), locked = D().locked;
  return `<tr data-place-id="${esc(id)}" data-sec="${esc(section)}"><td class="f">${esc(label)}</td><td class="v">${valueHTML}${extra}</td>${"WCD".split("").map(k =>
    `<td class="ck"><input type="checkbox" data-place="${k}" ${pl.includes(k) ? "checked" : ""} ${locked ? "disabled" : ""} aria-label="${CH[k]}: ${esc(label)}"></td>`).join("")}</tr>`;
}
const short = v => esc(v.length > 160 ? v.slice(0, 160) + "…" : v).replace(/\n/g, "<br>");
function step2() {
  const d = D(), locked = d.locked;
  const head = sec => `<tr class="sech"><th colspan="2">${esc(sec)}</th>${"WCD".split("").map(k => `<th class="ck">${locked ? "" : `<button class="lnk" type="button" data-act="col" data-sec="${esc(sec)}" data-ch="${k}">all</button>`}</th>`).join("")}</tr>`;
  let rows = head("Product text");
  for (const i of INFO) rows += placeRow("info::" + i.key, "Product text", i.label, short(finalInfo(i.key)) || `<span class="muted">empty</span>`);
  rows += head("Lists");
  rows += placeRow("list::use_case_title", "Lists", "Use case titles", short(d.use_cases.map(u => u.title).filter(Boolean).join(" · ")) || `<span class="muted">none</span>`);
  rows += placeRow("list::use_case_description", "Lists", "Use case descriptions", `<span class="muted">${d.use_cases.filter(u => u.description).length} descriptions</span>`);
  rows += placeRow("list::key_highlights", "Lists", "Key Highlights", short(d.highlights.key.map(h => `${h.value} ${h.label}`).join(" · ")) || `<span class="muted">none</span>`);
  rows += placeRow("list::feature_highlights", "Lists", "Feature Highlights", short(d.highlights.feature.map(h => h.label).join(" · ")) || `<span class="muted">none</span>`);
  let sec = null;
  for (const r of specRows()) {
    if (lineState(r).st === "empty") continue;
    if (r.section !== sec) { sec = r.section; rows += head(sec); }
    if (isVariant(r)) {
      const pl = placeOf(r.id, r.section), sm = summaryOf(r);
      const vals = parts().map(pt => `${pt}: ${vcell(r, pt).value || "—"}`).join("\n");
      const extra = /[WC]/.test(pl) ? `<div class="sum ${sm.value ? "" : "need"}"><label class="small">Website and catalogue show <span class="muted">(one line for all variants)</span></label>
        <input data-summary="${esc(r.id)}" value="${esc(sm.value)}" ${locked ? "readonly" : ""} placeholder="e.g. 5G/4G or 640–700 g"><span class="muted small">${sm.edited ? "edited" : sm.value ? "suggested" : "write one"}</span></div>` : "";
      rows += placeRow(r.id, r.section, r.label, `<span class="lvl">per variant</span> <span class="small muted vals" title="${esc(vals)}">${parts().length} values (hover to see)</span>`, extra);
    } else rows += placeRow(r.id, r.section, r.label, short(finalLine(r)));
  }
  const { errs, warns } = runChecks();
  return `
  <div class="intro"><p><b>Choose where each piece of the final data appears.</b> The ticks start from sensible defaults; change any of them, or use “all” to tick or clear a whole section.
    Lines that differ by variant show each variant's own value on its datasheet; for the website and catalogue, write the one line they show.</p></div>
  <div class="s2"><div class="tw"><table class="place"><thead><tr><th>Information</th><th>Final value</th><th class="ck">Website</th><th class="ck">Catalogue</th><th class="ck">Datasheet</th></tr></thead><tbody>${rows}</tbody></table></div>
  <aside class="card checks"><h2>Preview</h2>
    <div class="pvbtns"><button class="btn sm" type="button" data-act="pv" data-ch="W">Website</button><button class="btn sm" type="button" data-act="pv" data-ch="C">Catalogue</button><button class="btn sm" type="button" data-act="pv" data-ch="D">Datasheet${multi() ? "s" : ""}</button></div>
    <h2>Checks</h2>
    ${errs.length ? `<ul class="errs">${errs.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : `<p class="good"><b>Ready to approve.</b></p>`}
    ${warns.length ? `<ul class="warns">${warns.map(e => `<li>${esc(e.replace(/^TYPO:/, ""))}</li>`).join("")}</ul>` : ""}
    ${!locked && warns.some(w => w.startsWith("TYPO:")) ? `<button class="btn sm" type="button" data-act="fix-typos">Fix these typos everywhere</button>` : ""}
    <label class="small"><b>Notes</b><textarea id="notes" rows="2" ${locked ? "readonly" : ""} placeholder="Decisions, open questions">${esc(d.notes || "")}</textarea></label>
    <label class="small"><b>Approved by</b><input id="approver" ${locked ? "readonly" : ""} value="${esc(locked ? d.approved_by || "" : state.settings.name || "")}" placeholder="Your name"></label>
    ${locked ? "" : `<div class="actions"><button class="btn ok" type="button" data-act="approve" ${errs.length ? "disabled" : ""}>Approve and save</button>
      <button class="btn" type="button" data-act="dl-files">Download draft files</button>
      <button class="btn ghost" type="button" data-act="discard">Discard draft</button></div>`}
    <p class="small muted">Saves <code>${esc(P().id)}.json</code>${multi() ? ` and ${parts().length} variant files` : ""} ${ghReady() ? "to GitHub in one commit" : "as a zip download (connect GitHub to save to the repository)"}.</p>
  </aside></div>
  <div class="next"><button class="btn" type="button" data-step="1">← Back to final data</button></div>`;
}

/* ================================================================ outputs */
function channelSpecs(ch, part) {     // [{section, items:[{label, value}]}]; part = exact values for that variant
  const out = [];
  const push = (sec, label, value) => { let s = out.find(x => x.section === sec); if (!s) out.push(s = { section: sec, items: [] }); s.items.push({ label, value }); };
  for (const r of specRows()) {
    if (lineState(r).st === "empty" || !placeOf(r.id, r.section).includes(ch)) continue;
    if (part && sectionDropped(r, part)) continue;
    const v = isVariant(r) ? (part ? vcell(r, part).value : summaryOf(r).value) : finalLine(r);
    if (String(v || "").trim()) push(r.section, r.label, v.trim());
  }
  return out;
}
function orderingTable() {
  const ps = parts(), fs = ps.map(pt => D().features[pt] || {});
  const cols = [["Part Number", pt => pt]];
  if (fs.some(f => f.cellular)) cols.push(["Cellular", (pt, f) => f.cellular || "—"], ["Modems", (pt, f) => f.cellular ? (+f.modems === 2 ? "Dual" : "Single") : "—"]);
  if (fs.some(f => f.wifi)) cols.push(["Wi-Fi", (pt, f) => f.wifi || "—"]);
  if (fs.some(f => f.rs485)) cols.push(["RS485", (pt, f) => f.rs485 ? "✓" : "—"]);
  if (fs.some(f => f.rs232)) cols.push(["RS232", (pt, f) => f.rs232 ? "✓" : "—"]);
  return { headers: cols.map(c => c[0]), rows: ps.map((pt, i) => cols.map(c => c[1](pt, fs[i]))) };
}
function placement() {
  const out = {};
  for (const i of INFO) out["info::" + i.key] = placeOf("info::" + i.key);
  for (const k of ["use_case_title", "use_case_description", "key_highlights", "feature_highlights"]) out["list::" + k] = placeOf("list::" + k);
  for (const r of specRows()) if (lineState(r).st !== "empty") out[r.id] = placeOf(r.id, r.section);
  return out;
}
function buildProductRecord(approver) {
  const p = P(), d = D();
  const specs = [];
  for (const r of specRows()) {
    if (lineState(r).st === "empty") continue;
    if (isVariant(r)) specs.push({ section: r.section, field: r.label, level: "variant", values: Object.fromEntries(parts().map(pt => [pt, vcell(r, pt).value])), summary: summaryOf(r).value });
    else specs.push({ section: r.section, field: r.label, level: "product", value: finalLine(r) });
  }
  return {
    schema: SCHEMA, product_id: p.id, name: p.name, category: p.category,
    info: Object.fromEntries(INFO.map(i => [i.key, finalInfo(i.key)])),
    use_cases: d.use_cases.filter(u => u.title.trim()).map(u => ({ title: u.title.trim(), description: (u.description || "").trim() })),
    highlights: { key: d.highlights.key, feature: d.highlights.feature },
    specs,
    variants: parts().map(pt => ({ part: pt, ...pick(d.features[pt], ["cellular", "modems", "wifi", "rs485", "rs232"]), datasheet_source: dsKey(pt) ? p.datasheets[dsKey(pt)].file : null })),
    ordering: orderingTable(),
    placement: placement(),
    notes: d.notes || "", approved_by: approver || null, approved_at: approver ? now() : null, source_data_built: state.index.built,
    editor_state: Object.assign(clone(d), { locked: false }),
  };
}
function buildVariantRecord(pt, rec) {
  const specs = [];
  for (const r of specRows()) {
    if (lineState(r).st === "empty" || sectionDropped(r, pt)) continue;
    const v = isVariant(r) ? vcell(r, pt).value : finalLine(r);
    if (String(v || "").trim()) specs.push({ section: r.section, field: r.label, value: v.trim(), placement: placeOf(r.id, r.section) });
  }
  return { schema: SCHEMA, type: "variant", product_id: rec.product_id, name: rec.name, part_number: pt, category: rec.category, product_file: `${rec.product_id}.json`,
    info: { title: rec.info.title, long_description: rec.info.long_description },
    features: pick(D().features[pt], ["cellular", "modems", "wifi", "rs485", "rs232"]), specs,
    approved_by: rec.approved_by, approved_at: rec.approved_at };
}
function filesFor(rec) {
  const files = { [`${rec.product_id}.json`]: JSON.stringify(rec, null, 2) + "\n" };
  if (multi()) for (const pt of parts()) files[`${rec.product_id}/${slug(pt)}.json`] = JSON.stringify(buildVariantRecord(pt, rec), null, 2) + "\n";
  return files;
}

/* ---------------------------------------------------------------- checks */
const TYPOS = [[/\bSingle strength\b/g, "Signal strength"], [/\bsingle strength\b/g, "signal strength"], [/\bMannual\b/g, "Manual"], [/\bmannual\b/g, "manual"],
  [/\bAdabpter\b/g, "Adapter"], [/\bconnecter\b/g, "connector"], [/\bInaterfaces\b/g, "Interfaces"], [/802\.11 b\/g\/n\/ac\/ac\b/g, "802.11 b/g/n/ac"], [/\bUSB 3\.0 3\.0\b/g, "USB 3.0"]];
const fixTypos = v => TYPOS.reduce((x, [rx, to]) => x.replace(rx, to), v);
function typoIn(v) { for (const [rx] of TYPOS) { rx.lastIndex = 0; const m = v.match(rx); rx.lastIndex = 0; if (m) return m[0]; } return ""; }
function fixAllTypos() {
  const d = D(); let n = 0;
  for (const r of specRows()) {
    if (lineState(r).st === "empty") continue;
    if (isVariant(r)) { for (const pt of parts()) { const c = vcell(r, pt), o = fixTypos(c.value); if (o !== c.value) { setVcell(r.id, pt, o); n++; } } }
    else { const v = finalLine(r), o = fixTypos(v); if (o !== v) { d.lines[r.id] = { value: o, edited: true }; n++; } }
  }
  for (const i of INFO) { const v = finalInfo(i.key), o = fixTypos(v); if (o !== v) { d.info[i.key] = { value: o, edited: true }; n++; } }
  saveDraft(); return n;
}
function runChecks() {
  const d = D(), errs = [], warns = [];
  const { decide } = counts();
  if (decide) errs.push(`${decide} line(s) in Final data still need a decision.`);
  for (const i of INFO) if (placeOf("info::" + i.key) && !finalInfo(i.key).trim()) errs.push(`${i.label} is empty but is ticked for ${placeOf("info::" + i.key).split("").map(k => CH[k]).join(", ")}.`);
  if (placeOf("list::key_highlights").includes("C") && d.highlights.key.length > MAX_KEY) errs.push(`${d.highlights.key.length} Key Highlights: the catalogue fits ${MAX_KEY}.`);
  if (placeOf("list::feature_highlights").includes("C") && d.highlights.feature.length > MAX_FEAT) errs.push(`${d.highlights.feature.length} Feature Highlights: the catalogue fits ${MAX_FEAT}.`);
  const hasCell = parts().some(pt => d.features[pt].cellular), hasWifi = parts().some(pt => d.features[pt].wifi);
  [...d.highlights.key.map(h => (h.value + " " + h.label).trim()), ...d.highlights.feature.map(h => h.label)].forEach(t => {
    if (!t) errs.push("A highlight is empty.");
    else if (/modem|lte|\b[45]g\b/i.test(t) && !hasCell) errs.push(`Highlight “${t}” mentions cellular, but no variant has cellular.`);
    else if (/wi-?fi/i.test(t) && !hasWifi) errs.push(`Highlight “${t}” mentions Wi-Fi, but no variant has Wi-Fi.`);
    else if (/^-|\s-\s/.test(t)) errs.push(`Highlight “${t}” looks like a placeholder.`);
  });
  let need = 0;
  for (const r of specRows()) if (isVariant(r) && lineState(r).st !== "empty" && /[WC]/.test(placeOf(r.id, r.section)) && !summaryOf(r).value.trim()) need++;
  if (need) errs.push(`${need} line(s) that differ by variant need the one line the website and catalogue show.`);
  const texts = [];
  for (const i of INFO) texts.push([i.label, finalInfo(i.key)]);
  for (const r of specRows()) {
    if (lineState(r).st === "empty") continue;
    if (isVariant(r)) parts().forEach(pt => texts.push([`${r.label} (${pt})`, vcell(r, pt).value])); else texts.push([r.label, finalLine(r)]);
  }
  d.use_cases.forEach(u => texts.push(["Use case", u.title], ["Use case", u.description]));
  const typos = {}, reps = {};
  for (const [where, v] of texts) {
    if (!v) continue;
    if (/«|»|device_name|lorem|\bTBD\b|\bTBC\b/i.test(v)) errs.push(`Placeholder text in ${where}: “${v.slice(0, 50)}”.`);
    const rp = v.match(/\b(\S{2,})\s+\1\b/i);
    if (rp) (reps[rp[0]] = reps[rp[0]] || []).push(where);
    const ty = typoIn(v); if (ty) (typos[ty] = typos[ty] || []).push(where);
  }
  for (const [k, w] of Object.entries(typos)) warns.push(`TYPO:Likely typo “${k}” in ${w.length} place${w.length > 1 ? "s" : ""}.`);
  for (const [k, w] of Object.entries(reps)) warns.push(`Repeated word “${k}” in ${w[0]}${w.length > 1 ? ` and ${w.length - 1} more` : ""}.`);
  if (d.use_cases.some(u => u.title && !u.description) && placeOf("list::use_case_description").includes("C")) warns.push("Some use cases have no description (the catalogue shows descriptions).");
  const nos = multi() ? parts().filter(pt => !dsKey(pt)) : [];
  if (nos.length) warns.push(`No datasheet for ${nos.join(", ")}: check their values in the lines that differ by variant.`);
  return { errs: [...new Set(errs)], warns: [...new Set(warns)] };
}

/* ---------------------------------------------------------------- previews */
function specHTML(groups) {
  return groups.map(g => `<h4>${esc(g.section)}</h4><table class="kv">${g.items.map(i => `<tr><td>${esc(i.label)}</td><td>${esc(i.value).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table>`).join("") || `<p class="muted small">Nothing ticked for this output.</p>`;
}
function ordHTML(t) { return `<table class="ord"><thead><tr>${t.headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`; }
function showPreview(ch, part) {
  const d = D(), p = P(), on = id => placeOf(id).includes(ch);
  const ico = n => n && state.icons[n] ? `<span class="ico">${state.icons[n]}</span>` : "";
  const txt = k => on("info::" + k) ? finalInfo(k) : "";
  let doc = "";
  if (ch === "D") {
    const pt = part && parts().includes(part) ? part : parts()[0], f = d.features[pt] || {};
    doc = `${multi() ? `<label class="small">Variant <select id="pvPart">${parts().map(x => `<option ${x === pt ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>` : ""}
      <h2>${esc(pt)}</h2><div class="sub">DATASHEET · ${esc(txt("title"))}</div><p>${esc(txt("long_description"))}</p>
      ${multi() ? `<p class="small muted">${f.cellular ? `${f.cellular}, ${+f.modems === 2 ? "dual" : "single"} modem` : "no cellular"} · ${f.wifi || "no Wi-Fi"}</p>` : ""}
      ${specHTML(channelSpecs("D", multi() ? pt : null))}`;
  } else {
    doc = `${ch === "C" && txt("tagline") ? `<div class="eyebrow">${esc(txt("tagline"))}</div>` : ""}<h2>${esc(p.name)}</h2><div class="sub">${esc(txt("title"))}</div>
      <p>${esc(ch === "W" ? txt("short_description") : txt("long_description"))}</p>
      ${on("list::feature_highlights") ? `<div class="badges">${d.highlights.feature.map(h => `<span class="badge2">${ico(h.icon)}${esc(h.label)}</span>`).join("")}</div>` : ""}
      ${on("list::key_highlights") ? `<div class="tiles">${d.highlights.key.map(h => `<div class="tile">${ico(h.icon)}<div><b>${esc(h.value)}</b><small>${esc(h.label)}</small></div></div>`).join("")}</div>` : ""}
      ${specHTML(channelSpecs(ch))}
      ${multi() ? `<h4>${ch === "W" ? "Variants" : "Ordering information"}</h4>${ordHTML(orderingTable())}` : ""}
      ${on("list::use_case_title") && d.use_cases.length ? `<h4>Use cases</h4>${d.use_cases.filter(u => u.title).map(u => `<div class="uc"><b>${esc(u.title)}</b>${on("list::use_case_description") && u.description ? `<small>${esc(u.description)}</small>` : ""}</div>`).join("")}` : ""}`;
  }
  openModal(`<div class="pvhead"><h2>${CH[ch]} preview</h2><button class="btn sm" type="button" data-act="close">Close</button></div><div class="pv">${doc}</div>`, true);
}

/* ================================================================ approve & download */
function download(name, blob) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
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
  const rec = buildProductRecord(name), files = filesFor(rec), pid = rec.product_id;
  const entry = { file: `${pid}.json`, schema: SCHEMA, product_id: pid, variants: Object.keys(files).filter(f => f.includes("/")), approved_by: name, approved_at: rec.approved_at };
  if (ghReady()) {
    try {
      toast("Saving to GitHub…", 0);
      const base = state.settings.base;
      await ghCommit(Object.fromEntries(Object.entries(files).map(([k, v]) => [`${base}/${k}`, v])),
        recs => { Object.keys(recs).filter(k => k === pid || k.startsWith(pid + "/")).forEach(k => delete recs[k]); recs[pid] = entry; },
        `Approve ${P().name} (${name})`);
      toast(`Saved ${Object.keys(files).length} file(s) for ${P().name}. The site shows them after it rebuilds (1–2 minutes).`);
    } catch (e) { toast(`Not saved to GitHub: ${e.message}. Downloading the files instead.`); await zipFiles(files, `${pid}_approved.zip`); }
  } else {
    await zipFiles(files, `${pid}_approved.zip`);
    toast(`Approved. ${pid}_approved.zip downloaded: unzip it into docs/approved/ (see README), or connect GitHub.`);
  }
  state.approved[pid] = entry;
  lsSet(LS.approved(pid), rec);
  lsSet(LS.draft(pid), null);
  state.draft = Object.assign(clone(rec.editor_state), { locked: true, approved_by: name, approved_at: rec.approved_at });
  renderList(); renderView();
}

/* ================================================================ events */
function setVcell(rowId, part, value) { const d = D(); d.vcells[rowId] = d.vcells[rowId] || {}; d.vcells[rowId][part] = { value }; }
document.addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.pid && b.closest("#plist")) return openProduct(b.dataset.pid);
  if (b.dataset.step) { D().step = +b.dataset.step; if (!D().locked) saveDraft(); renderView(); $("#main").scrollTop = 0; return; }
  if (b.dataset.filter) { state.ui.filter = b.dataset.filter; saveUI(); return rerender(); }
  const act = b.dataset.act; if (!act) return;
  const d = D();
  const line = b.closest("[data-id]"), id = line && line.dataset.id;
  const row = id && specRows().find(r => r.id === id);
  if (d && d.locked && !["sheets", "close", "unlock", "dl-files", "pv", "open", "close-line"].includes(act)) return;
  switch (act) {
    case "choose": {
      if (b.dataset.kind === "info") { const k = id.slice(6), c = infoCandidates(k)[+b.dataset.i]; d.info[k] = { value: c.value, decided: true, who: c.who.join(", ") }; }
      else { const c = candidates(row)[+b.dataset.i]; d.lines[id] = { value: c.value, decided: true, who: c.who.join(", ") }; }
      delete state.open[id]; saveDraft(); return rerender();
    }
    case "open": state.open[id] = true; return rerender();
    case "close-line": delete state.open[id]; return rerender();
    case "level": {
      const toVariant = !isVariant(row);
      d.level[id] = toVariant ? "variant" : "product"; saveDraft();
      toast(toVariant ? `“${row.label}” now has one value per variant.` : `“${row.label}” now has one value for the whole product.`);
      return rerender();
    }
    case "na-all": problems(row).forEach(pt => setVcell(id, pt, "NA")); d.confirmed[id] = true; saveDraft(); return rerender();
    case "confirm": d.confirmed[id] = true; saveDraft(); return rerender();
    case "delrow": d.custom = d.custom.filter(c => c.id !== id); delete d.lines[id]; delete d.vcells[id]; saveDraft(); return rerender();
    case "addrow": {
      const sec = $("#newSec").value, label = $("#newLabel").value.trim();
      if (!label) return $("#newLabel").focus();
      const nid = `${sec}::${label}`;
      if (specRows().some(r => r.id === nid)) return toast("That line already exists in this section.");
      d.custom.push({ id: nid, section: sec, label, level: $("#newVar") && $("#newVar").checked ? "variant" : "product" });
      state.open[nid] = true; saveDraft(); return rerender();
    }
    case "uc-add": d.use_cases.push({ title: "", description: "" }); saveDraft(); return rerender();
    case "uc-del": d.use_cases.splice(+b.dataset.i, 1); saveDraft(); return rerender();
    case "uc-up": { const i = +b.dataset.i; if (i > 0) [d.use_cases[i - 1], d.use_cases[i]] = [d.use_cases[i], d.use_cases[i - 1]]; saveDraft(); return rerender(); }
    case "hl-add": d.highlights[b.dataset.k].push(b.dataset.k === "key" ? { value: "", label: "", icon: "" } : { label: "", icon: "" }); saveDraft(); return rerender();
    case "hl-del": d.highlights[b.dataset.k].splice(+b.dataset.i, 1); saveDraft(); return rerender();
    case "col": {
      const ch = b.dataset.ch, trs = [...document.querySelectorAll(`tr[data-place-id][data-sec="${CSS.escape(b.dataset.sec)}"]`)];
      const allOn = trs.every(tr => placeOf(tr.dataset.placeId, tr.dataset.sec).includes(ch));
      trs.forEach(tr => { const cur = placeOf(tr.dataset.placeId, tr.dataset.sec); d.place[tr.dataset.placeId] = "WCD".split("").filter(k => k === ch ? !allOn : cur.includes(k)).join(""); });
      saveDraft(); return rerender();
    }
    case "pv": return showPreview(b.dataset.ch);
    case "fix-typos": { const n = fixAllTypos(); toast(`Corrected ${n} value${n === 1 ? "" : "s"}.`); return rerender(); }
    case "approve": return approve();
    case "dl-files": { const rec = d.locked ? Object.assign(buildProductRecord(d.approved_by), { approved_at: d.approved_at }) : buildProductRecord(null); return zipFiles(filesFor(rec), `${rec.product_id}_${d.locked ? "approved" : "draft"}.zip`); }
    case "discard":
      return confirmBox("Discard this draft?", "All your decisions for this product in this browser will be deleted. Approved files are not affected.", "Discard", () => { lsSet(LS.draft(d.product_id), null); openProduct(state.pid); });
    case "unlock": d.locked = false; lsSet(LS.draft(d.product_id), d); renderList(); return renderView();
    case "sheets": return showSheets();
    case "close": return closeModal();
  }
});
document.addEventListener("input", e => {
  const t = e.target, d = D();
  if (t.id === "search") return renderList();
  if (!d || d.locked) return;
  const line = t.closest("[data-id]"), id = line && line.dataset.id;
  if (t.dataset.line) { d.lines[t.dataset.line] = { value: t.value, edited: true }; autosize(t); saveDraft(); }
  else if (t.dataset.info) { d.info[t.dataset.info] = { value: t.value, edited: true }; autosize(t); saveDraft(); }
  else if (t.dataset.part && id) { setVcell(id, t.dataset.part, t.value); autosize(t); saveDraft(); }
  else if (t.dataset.uc != null) { d.use_cases[+t.dataset.uc][t.dataset.f] = t.value; autosize(t); saveDraft(); }
  else if (t.dataset.hl && t.tagName === "INPUT") { d.highlights[t.dataset.hl][+t.dataset.i][t.dataset.f] = t.value; saveDraft(); }
  else if (t.dataset.summary) { d.summary[t.dataset.summary] = { value: t.value, edited: true }; saveDraft(); }
  else if (t.id === "notes") { d.notes = t.value; saveDraft(); }
});
document.addEventListener("change", e => {
  const t = e.target, d = D();
  if (t.id === "catFilter" || t.id === "statusFilter") return renderList();
  if (t.id === "pvPart") return showPreview("D", t.value);
  if (!d || d.locked) return;
  if (t.dataset.line || t.dataset.info || (t.dataset.part && t.tagName === "TEXTAREA") || t.dataset.summary) return rerender();   // refresh counts after typing
  if (t.dataset.feat) {
    const f = d.features[t.dataset.part];
    f[t.dataset.feat] = t.type === "checkbox" ? t.checked : t.dataset.feat === "modems" ? +t.value : t.value;
    if (t.dataset.feat === "cellular") f.modems = t.value ? (f.modems || 1) : 0;
    saveDraft(); return rerender();
  }
  if (t.dataset.hl && t.tagName === "SELECT") { d.highlights[t.dataset.hl][+t.dataset.i].icon = t.value; saveDraft(); return rerender(); }
  if (t.dataset.place) {
    const tr = t.closest("tr"), cur = placeOf(tr.dataset.placeId, tr.dataset.sec), ch = t.dataset.place;
    d.place[tr.dataset.placeId] = "WCD".split("").filter(k => k === ch ? t.checked : cur.includes(k)).join("");
    saveDraft(); return rerender();
  }
});
window.addEventListener("hashchange", routeFromHash);
function routeFromHash() {
  const pid = decodeURIComponent(location.hash.slice(1)).split("/")[0]; if (!pid) return;
  if (state.index.products.some(p => p.id === pid) && pid !== state.pid) openProduct(pid, false);
}

/* ================================================================ modals, toast */
function openModal(html, wide) { $("#modalBody").innerHTML = html; $("#modal").hidden = false; $(".modal-box").classList.toggle("wide", !!wide); const f = $("#modalBody input, #modalBody button"); f && f.focus(); }
function closeModal() { $("#modal").hidden = true; }
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
function confirmBox(title, text, okLabel, onOk) {
  openModal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" type="button" data-act="close">Cancel</button><button class="btn primary" type="button" id="okBtn">${esc(okLabel)}</button></div>`);
  $("#okBtn").onclick = () => { closeModal(); onOk(); };
}
function showSheets() {
  const p = P();
  const items = Object.entries(p.datasheets).map(([k, v]) => `<details><summary><b>${esc(k)}</b> · model on sheet: ${esc(v.model || "—")} · ${v.pages} page${v.pages > 1 ? "s" : ""}${v.template ? "" : " · <span style='color:var(--warn)'>non-standard layout: check the full text</span>"}</summary>
    <p class="small">${v.pdf ? `<a href="${esc(v.pdf)}" target="_blank" rel="noopener">Open PDF</a> · ` : ""}${esc(v.file)}</p><pre>${esc(v.raw)}</pre></details>`).join("");
  openModal(`<h2>Datasheets for ${esc(p.name)}</h2>${items}<div style="text-align:right;margin-top:10px"><button class="btn" type="button" data-act="close">Close</button></div>`);
}
function showSettings() {
  const s = state.settings;
  openModal(`<h2>Save to GitHub</h2>
    <p class="small">Connect to save approved products straight into the repository (<code>${esc(s.base)}/</code>) so everyone sees them. Without it, approving downloads a zip.</p>
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
async function approvedRecords() {
  const ids = new Set(Object.keys(state.approved));
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("pch3:approved:")) ids.add(k.slice(14)); }
  const out = [];
  for (const pid of ids) { const r = await loadApprovedRecord(pid); if (r && r.schema === SCHEMA) out.push(r); }
  return out;
}
async function withProduct(rec, fn) {
  const keep = [state.pid, state.product, state.draft];
  state.pid = rec.product_id; state.product = await loadProduct(rec.product_id);
  state.draft = Object.assign(clone(rec.editor_state), { locked: true }); ensureFeatures(state.draft);
  try { return fn(); } finally { [state.pid, state.product, state.draft] = keep; }
}
async function exportApproved() {
  toast("Collecting approved products…", 0);
  const recs = await approvedRecords();
  if (!recs.length) return toast("No approved products yet.");
  const files = {}, index = {};
  for (const rec of recs) {
    const fs = await withProduct(rec, () => filesFor(rec));
    Object.assign(files, fs);
    index[rec.product_id] = { file: `${rec.product_id}.json`, schema: SCHEMA, product_id: rec.product_id, variants: Object.keys(fs).filter(f => f.includes("/")), approved_by: rec.approved_by, approved_at: rec.approved_at };
  }
  files["index.json"] = JSON.stringify({ updated: now(), records: index }, null, 2) + "\n";
  await zipFiles(files, `approved_${new Date().toISOString().slice(0, 10)}.zip`);
  toast(`Downloaded ${recs.length} approved product(s).`);
}
const WIFI_ENUM = { "Wi-Fi 4": "WiFi4", "Wi-Fi 5": "WiFi5", "Wi-Fi 6": "WiFi6", "Wi-Fi 7": "WiFi7", "Wi-Fi": "WiFi" };
async function exportWebsite() {
  toast("Building website JSON…", 0);
  const recs = await approvedRecords();
  if (!recs.length) return toast("No approved products yet.");
  const files = {};
  for (const rec of recs) {
    const json = await withProduct(rec, () => {
      const p = P(), w = p.meta.website || {}, idx = state.index.products.find(x => x.id === p.id) || {};
      const fam = Object.fromEntries(channelSpecs("W").flatMap(g => g.items.map(i => [`${g.section}::${i.label}`, i.value])));
      const v = k => fam[k] || "";
      const fs = parts().map(pt => D().features[pt] || {});
      const gens = [...new Set(fs.map(f => f.cellular).filter(Boolean))].sort().reverse();
      const wifis = fs.map(f => f.wifi).filter(Boolean).sort().reverse();
      const ord = orderingTable(), on = id => placeOf(id).includes("W");
      return {
        id: p.id, name: p.name, cat: p.category, order: idx.order || 0,
        desc: on("info::short_description") ? finalInfo("short_description") : "",
        cpu: v("Hardware::CPU"), ram: v("Hardware::RAM"), storage: v("Hardware::Flash") || v("Hardware::Storage"),
        cell: v("Hardware::Cellular"), cellular_gen: gens[0] || "", wifi: WIFI_ENUM[wifis[0]] || "",
        rs485: fs.some(f => f.rs485) ? "Yes" : "No", rs232: fs.some(f => f.rs232) ? "Yes" : "No",
        ip: v("Physical::IP Rating"), power: v("Power::Input Voltage"), ports: v("Website filters::Ethernet ports"),
        os: v("Operating System & Software::Operating System"), housing: v("Physical::Enclosure"), dims: v("Physical::Dimensions"),
        weight: v("Physical::Weight"), op_temp: v("Environmental::Operating Temperature"),
        images: w.images || [], use_cases: on("list::use_case_title") ? rec.use_cases.map(u => u.title) : [], datasheet: w.datasheet ?? null,
        part_datasheets: w.part_datasheets || {}, hidden: !!w.hidden, hidden_fields: w.hidden_fields || [], additional_specs: [],
        variants: { headers: ord.headers.slice(1).concat("Part Number"), rows: ord.rows.map(r => r.slice(1).concat(r[0])) },
        full: {
          title: on("info::title") ? finalInfo("title") : "", sections: channelSpecs("W"),
          models: multi() ? Object.fromEntries(parts().map(pt => [pt, channelSpecs("W", pt)])) : {},
          approved_at: rec.approved_at,
        },
      };
    });
    files[`products/${rec.product_id}.json`] = JSON.stringify(json, null, 2) + "\n";
  }
  await zipFiles(files, `website_json_${new Date().toISOString().slice(0, 10)}.zip`);
  toast(`Website JSON for ${recs.length} product(s) downloaded.`);
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
