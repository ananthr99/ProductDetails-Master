/* Product Content Hub — compare four product sources, pick, edit, approve, save as JSON.
   Static app for GitHub Pages: data comes from data/*.json (built by tools/build_data.py),
   drafts live in this browser, approved records are downloaded and/or committed to the repo. */
(() => {
"use strict";

const SOURCES = [
  { key: "website",   label: "Website",        short: "W" },
  { key: "master",    label: "Old Master",     short: "M" },
  { key: "catalogue", label: "New Catalogue",  short: "C" },
  { key: "datasheet", label: "Datasheet",      short: "D" },
];
const SRC_LABEL = { website: "Website", master: "Old Master", catalogue: "New Catalogue", datasheet: "Datasheet", family: "Family record", edited: "Edited", custom: "Added" };
const LIST_FIELDS = new Set(["Overview::Use cases", "Overview::Highlight tiles", "Overview::Highlight badges", "Compliance::Compliance marks"]);
const SCHEMA = "invendis.product-content/v1";
const LS = {
  draft: rid => `pch:draft:${rid}`,
  approved: rid => `pch:approved:${rid}`,
  settings: "pch:settings",
  ui: "pch:ui",
};

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = s => String(s).replace(/\(.*?\)/g, "").trim().replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "") || "variant";
const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const lsGet = k => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const state = {
  index: null, products: {}, approved: {},    // approved: rid -> index entry
  settings: Object.assign({ owner: "", repo: "", branch: "main", token: "", name: "", base: "docs/approved" }, lsGet(LS.settings) || {}),
  ui: Object.assign({ hide: {}, diffOnly: false, emptyOnly: false, q: "", collapsed: {} }, lsGet(LS.ui) || {}),
  pid: null, part: null, product: null, draft: null, familyFinal: null,
};
if (!state.settings.owner && location.hostname.endsWith(".github.io")) {
  state.settings.owner = location.hostname.split(".")[0];
  state.settings.repo = location.pathname.split("/").filter(Boolean)[0] || `${state.settings.owner}.github.io`;
}
const saveUI = () => lsSet(LS.ui, state.ui);
const ghReady = () => !!(state.settings.owner && state.settings.repo && state.settings.token);

/* ------------------------------------------------------------ record ids & files */
const rid = (pid, part) => part ? `${pid}/${part}` : pid;
const fileFor = (pid, part) => part ? `${pid}/${slug(part)}.json` : `${pid}.json`;
function recordsOf(p) {           // the records a product produces: family + one per variant (if more than one)
  const vs = p.variants || [];
  return vs.length > 1 ? [null, ...vs] : [null];
}
function statusOf(r) {
  const d = lsGet(LS.draft(r));
  if (d && !d.locked) return "draft";
  if (state.approved[r] || lsGet(LS.approved(r))) return "approved";
  return "todo";
}
function productStatus(p) {
  const recs = recordsOf(p).map(v => statusOf(rid(p.id, v)));
  const appr = recs.filter(s => s === "approved").length;
  const s = appr === recs.length ? "approved" : recs.some(s => s !== "todo") ? "draft" : "todo";
  return { s, appr, total: recs.length };
}

/* ------------------------------------------------------------ data loading */
async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function loadApprovedIndex() {
  let idx = null;
  if (ghReady()) { try { idx = (await ghGet(`${state.settings.base}/index.json`)).json; } catch {} }
  if (!idx) { try { idx = await getJSON("approved/index.json"); } catch { idx = { records: {} }; } }
  state.approved = idx.records || {};
}
async function loadProduct(pid) {
  if (!state.products[pid]) state.products[pid] = await getJSON(`data/products/${encodeURIComponent(pid)}.json`);
  return state.products[pid];
}
async function loadApprovedRecord(r, file) {
  const local = lsGet(LS.approved(r));
  if (ghReady()) { try { return (await ghGet(`${state.settings.base}/${file}`)).json; } catch {} }
  try { return await getJSON(`approved/${file}`); } catch {}
  return local;
}

/* ------------------------------------------------------------ GitHub */
const b64 = s => { const b = new TextEncoder().encode(s); let x = ""; b.forEach(c => x += String.fromCharCode(c)); return btoa(x); };
const unb64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), c => c.charCodeAt(0)));
async function gh(path, opts = {}) {
  const { owner, repo, token } = state.settings;
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/${path}`, {
    ...opts, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (!r.ok) { const e = new Error(`GitHub ${r.status}: ${(await r.json().catch(() => ({}))).message || r.statusText}`); e.status = r.status; throw e; }
  return r.status === 204 ? null : r.json();
}
async function ghGet(path) {
  const j = await gh(`contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(state.settings.branch)}`);
  return { sha: j.sha, json: JSON.parse(unb64(j.content)) };
}
async function ghPut(path, obj, message) {
  let sha;
  try { sha = (await ghGet(path)).sha; } catch (e) { if (e.status !== 404) throw e; }
  return gh(`contents/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT",
    body: JSON.stringify({ message, content: b64(JSON.stringify(obj, null, 2) + "\n"), branch: state.settings.branch, ...(sha ? { sha } : {}) }) });
}
async function ghUpdateIndex(r, entry) {
  const path = `${state.settings.base}/index.json`;
  for (let i = 0; i < 4; i++) {
    let cur = { records: {} }, sha;
    try { const g = await ghGet(path); cur = g.json; sha = g.sha; } catch (e) { if (e.status !== 404) throw e; }
    cur.records = cur.records || {};
    if (entry) cur.records[r] = entry; else delete cur.records[r];
    cur.updated = now();
    try {
      await gh(`contents/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT",
        body: JSON.stringify({ message: `Update approved index (${r})`, content: b64(JSON.stringify(cur, null, 2) + "\n"), branch: state.settings.branch, ...(sha ? { sha } : {}) }) });
      state.approved = cur.records;
      return;
    } catch (e) { if (e.status !== 409 && e.status !== 422) throw e; }
  }
  throw new Error("Could not update approved/index.json (someone else is saving). Try again.");
}

/* ------------------------------------------------------------ source values */
function dsPart(p, part) {      // datasheet key for a variant
  if (!part) return null;
  const ds = Object.keys(p.datasheets || {});
  return ds.find(k => k === part) || ds.find(k => norm(k) === norm(part)) || null;
}
function srcValue(row, src) {   // -> null | {value} | {varies:[{value, parts}]}
  const p = state.product, v = row.values || {};
  if (src === "family") {
    const f = state.familyFinal && state.familyFinal[row.id];
    return f && f.value ? { value: f.value } : null;
  }
  if (src !== "datasheet") return v[src] ? { value: v[src] } : null;
  const ds = v.datasheet || {};
  if (state.part) {
    const k = dsPart(p, state.part);
    return k && ds[k] ? { value: ds[k], parts: [k] } : null;
  }
  const groups = {};
  for (const [part, val] of Object.entries(ds)) {
    const n = norm(val);
    (groups[n] = groups[n] || { value: val, parts: [] }).parts.push(part);
  }
  const g = Object.values(groups);
  if (!g.length) return null;
  const sheets = Object.keys(p.datasheets || {}).length;
  if (g.length === 1) return { value: g[0].value, parts: g[0].parts, partial: g[0].parts.length < sheets };
  return { varies: g.sort((a, b) => b.parts.length - a.parts.length) };
}
function loadedSources() {      // sources the build read (index.sources); older data has no list, so show all
  const l = state.index && state.index.sources;
  return SOURCES.filter(x => !l || l.includes(x.key));
}
function activeSources() {
  const s = loadedSources().map(x => x.key);
  return state.part ? [...s, "family"] : s;
}
function allRows() {
  const p = state.product, d = state.draft;
  const custom = (d.custom || []).map(c => ({ id: c.id, section: c.section, label: c.label, values: {}, custom: true }));
  const rows = [...p.rows];
  for (const c of custom) {      // put custom rows at the end of their section
    let at = rows.map(r => r.section).lastIndexOf(c.section);
    rows.splice(at < 0 ? rows.length : at + 1, 0, c);
  }
  return rows;
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

/* ------------------------------------------------------------ drafts */
function newDraft(pid, part) {
  return { schema: SCHEMA, record_id: rid(pid, part), product_id: pid, part_number: part || null, values: {}, custom: [], ordering: null,
           notes: "", created_at: now(), updated_at: now(), locked: false };
}
function fromApproved(a) {
  const d = newDraft(a.product_id, a.part_number);
  for (const [sec, fields] of Object.entries(a.content || {}))
    for (const [label, value] of Object.entries(fields)) {
      const id = `${sec}::${label}`, prov = (a.provenance || {})[id] || {};
      d.values[id] = { value: Array.isArray(value) ? value.join("\n") : String(value), source: prov.source || "edited", edited: !!prov.edited };
    }
  d.custom = (a.custom_fields || []).map(id => ({ id, section: id.split("::")[0], label: id.split("::").slice(1).join("::") }));
  d.ordering = a.ordering || null;
  d.notes = a.notes || "";
  d.approved_by = a.approved_by; d.approved_at = a.approved_at;
  return d;
}
let saveTimer = null;
function saveDraft() {
  const d = state.draft;
  if (!d || d.locked) return;
  d.updated_at = now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { lsSet(LS.draft(d.record_id), d); renderList(); const el = $("#savedAt"); if (el) el.textContent = `Draft saved in this browser ${new Date().toLocaleTimeString()}`; }, 250);
}

/* ------------------------------------------------------------ list */
function renderList() {
  const idx = state.index; if (!idx) return;
  const q = norm($("#search").value), cat = $("#catFilter").value, sf = $("#statusFilter").value;
  const order = idx.categories && idx.categories.length ? idx.categories : [...new Set(idx.products.map(p => p.category))];
  const groups = {};
  for (const p of idx.products) {
    const st = productStatus(p);
    if (q && !norm(p.name + " " + p.id + " " + (p.variants || []).join(" ")).includes(q)) continue;
    if (cat && p.category !== cat) continue;
    if (sf && st.s !== sf) continue;
    (groups[p.category] = groups[p.category] || []).push([p, st]);
  }
  const cats = [...order.filter(c => groups[c]), ...Object.keys(groups).filter(c => !order.includes(c))];
  $("#plist").innerHTML = cats.map(c => `<li class="cat-h">${esc(c || "Other")}</li>` + groups[c].map(([p, st]) => {
    const srcs = loadedSources().map(s => `<b class="${p.present[s.key] ? "" : "no"}">${s.short}</b>`).join("");
    const lbl = st.s === "approved" ? "Approved" : st.s === "draft" ? "In progress" : "Not started";
    return `<li><button type="button" data-pid="${esc(p.id)}" aria-current="${p.id === state.pid}">
      <span class="pl-top"><span class="pl-name">${esc(p.name)}</span><span class="st ${st.s}">${lbl}</span></span>
      <span class="pl-sub"><span class="srcs">${srcs}</span><span>${st.total > 1 ? `${st.appr}/${st.total} records` : ""}</span></span></button></li>`;
  }).join("")).join("") || `<li class="muted small" style="padding:12px">No products match.</li>`;
}

/* ------------------------------------------------------------ open a record */
async function openRecord(pid, part, push = true) {
  const p = await loadProduct(pid);
  state.pid = pid; state.part = part || null; state.product = p;
  if (state.part && !(p.variants || []).includes(state.part)) state.part = null;
  const r = rid(pid, state.part);
  let d = lsGet(LS.draft(r));
  if (!d) {
    const entry = state.approved[r];
    const a = entry ? await loadApprovedRecord(r, entry.file) : lsGet(LS.approved(r));
    d = a ? Object.assign(fromApproved(a), { locked: true }) : newDraft(pid, state.part);
  }
  state.draft = d;
  // family final values for the "Family record" column in variant mode
  state.familyFinal = null;
  if (state.part) {
    let fd = lsGet(LS.draft(pid));
    if (!fd) {
      const e = state.approved[pid];
      const a = e ? await loadApprovedRecord(pid, e.file) : lsGet(LS.approved(pid));
      if (a) fd = fromApproved(a);
    }
    state.familyFinal = fd ? fd.values : null;
  }
  if (push) history.replaceState(null, "", `#${encodeURIComponent(pid)}${state.part ? "/" + encodeURIComponent(state.part) : ""}`);
  renderList();
  renderView();
  $("#main").scrollTop = 0;
}

/* ------------------------------------------------------------ main view */
function renderView() {
  const p = state.product, d = state.draft;
  $("#empty").hidden = true;
  const v = $("#view"); v.hidden = false;
  const recs = recordsOf(p);
  const meta = p.meta || {};
  const m = meta.master || {}, c = meta.catalogue || {}, w = meta.website || {};
  const dsKeys = Object.keys(p.datasheets || {});
  const curDs = state.part ? dsPart(p, state.part) : (dsKeys.length === 1 ? dsKeys[0] : null);
  const origs = [
    `<span class="orig ${p.present.website ? "" : "off"}"><i class="sw website"></i>Website JSON${w.file ? ": " + esc(w.file) : ""}${w.hidden ? " (hidden on site)" : ""}</span>`,
    m.brief_page ? `<a class="orig" target="_blank" rel="noopener" href="${esc(m.pdf || "")}#page=${m.brief_page}"><i class="sw master"></i>Old Master p.${m.brief_page}${m.detailed_page ? " + p." + m.detailed_page : ""}: ${esc(m.title)}</a>` : `<span class="orig off"><i class="sw master"></i>Not in Old Master</span>`,
    c.pdf ? `<a class="orig" target="_blank" rel="noopener" href="${esc(c.pdf)}"><i class="sw catalogue"></i>New catalogue PDF</a>` : `<span class="orig ${p.present.catalogue ? "" : "off"}"><i class="sw catalogue"></i>${p.present.catalogue ? "New catalogue" : "Not in new catalogue"}</span>`,
    curDs && p.datasheets[curDs].pdf ? `<a class="orig" target="_blank" rel="noopener" href="${esc(p.datasheets[curDs].pdf)}"><i class="sw datasheet"></i>Datasheet PDF: ${esc(curDs)}</a>` : "",
    dsKeys.length ? `<button class="orig" type="button" data-act="sheets"><i class="sw datasheet"></i>${dsKeys.length} datasheet${dsKeys.length > 1 ? "s" : ""}: details & full text</button>` : `<span class="orig off"><i class="sw datasheet"></i>No datasheet</span>`,
  ].join("");
  const recBtns = recs.length > 1 ? `<div class="recs"><span class="lbl">Record:</span>` + recs.map(vp => {
    const st = statusOf(rid(p.id, vp));
    const has = vp && dsPart(p, vp) ? "" : vp ? " (no sheet)" : "";
    return `<button class="rec" type="button" data-part="${esc(vp || "")}" aria-pressed="${(vp || null) === state.part}">${vp ? esc(vp) + has : "Family (product page)"} ${st === "todo" ? "" : `<span class="st ${st}">${st === "approved" ? "✓" : "•"}</span>`}</button>`;
  }).join("") + `</div>` : "";

  const locked = d.locked;
  const banner = locked
    ? `<div class="notice ok">Approved${d.approved_by ? " by <b>" + esc(d.approved_by) + "</b>" : ""}${d.approved_at ? " on " + esc(new Date(d.approved_at).toLocaleString()) : ""}. <button class="btn sm" type="button" data-act="unlock">Edit again</button> <button class="btn sm" type="button" data-act="download">Download JSON</button></div>`
    : (state.part && !state.familyFinal ? `<div class="notice">Tip: approve or draft the <b>Family</b> record first. Its final values then appear here as an extra column you can start from.</div>` : "");
  const sources = activeSources();
  const fillOpts = (state.part ? ["family", ...sources.filter(s => s !== "family")] : sources).map(s => `<option value="${s}">${SRC_LABEL[s]}</option>`).join("");
  const hideChecks = sources.map(s => `<label class="chk"><input type="checkbox" data-hide="${s}" ${state.ui.hide[s] ? "" : "checked"}>${SRC_LABEL[s]}</label>`).join("");

  v.innerHTML = `
    <div class="phead"><div>
      <h1>${esc(p.name)}${state.part ? ` <span style="font-weight:500;color:var(--mut)">› ${esc(state.part)}</span>` : ""}</h1>
      <div class="meta">${esc(p.category)} · ${state.part ? "Variant record" : recs.length > 1 ? `Family record · ${recs.length - 1} variants` : "Product record"} · file <code>${esc(fileFor(p.id, state.part))}</code></div>
      <div class="origs">${origs}</div></div></div>
    ${recBtns}${banner}
    <div class="bar">
      ${locked ? "" : `<div class="grp"><label for="fillSrc">Start from</label><select id="fillSrc">${fillOpts}</select>
        <button class="btn sm" type="button" data-act="fill" data-mode="gaps" title="Copy this source into every final cell that is still empty">Fill empty</button>
        <button class="btn sm" type="button" data-act="fill" data-mode="all" title="Replace every final cell with this source where it has a value">Replace all</button></div>`}
      <div class="grp"><input id="rowSearch" type="search" placeholder="Find a field" value="${esc(state.ui.q)}">
        <label class="chk"><input type="checkbox" id="diffOnly" ${state.ui.diffOnly ? "checked" : ""}>Only where sources differ</label>
        <label class="chk"><input type="checkbox" id="emptyOnly" ${state.ui.emptyOnly ? "checked" : ""}>Only empty final</label></div>
      <div class="grp"><label>Columns</label>${hideChecks}</div>
      <span class="progress" id="progress"></span>
    </div>
    <div class="tw ${locked ? "ro" : ""}"><table class="cmp" id="cmp"></table>
      ${locked ? "" : `<div class="addrow"><b class="small">Add a field</b><select id="newSec">${secOptions()}</select><input id="newLabel" placeholder="Field name"><button class="btn sm" type="button" data-act="addrow">Add</button></div>`}</div>
    ${state.part ? "" : orderingPanel()}
    ${approvePanel()}`;
  renderTable();
}
function secOptions() {
  const secs = [...new Set(state.product.rows.map(r => r.section))];
  ["Overview", "Hardware", "Interfaces", "Power", "Physical", "Environmental", "Cellular", "Wi-Fi", "Networking & Firewall", "VPN",
   "Remote Management", "Operating System & Software", "Gateway", "Compliance", "Packaging", "Other"].forEach(s => secs.includes(s) || secs.push(s));
  return secs.map(s => `<option>${esc(s)}</option>`).join("");
}

function renderTable() {
  const d = state.draft, locked = d.locked;
  const cols = activeSources().filter(s => !state.ui.hide[s]);
  const q = norm(state.ui.q);
  const rows = allRows();
  let html = `<colgroup><col class="c-field">${cols.map(() => "<col>").join("")}<col class="c-final"></colgroup>
    <thead><tr><th>Field</th>${cols.map(s => `<th><span class="sw ${s}"></span>${SRC_LABEL[s]}${s === "datasheet" && state.part ? ": " + esc(state.part) : s === "datasheet" && Object.keys(state.product.datasheets || {}).length > 1 ? " (all sheets)" : ""}</th>`).join("")}<th><span class="sw final"></span>Final (approved content)</th></tr></thead><tbody>`;
  let sec = null, filled = 0, total = 0, shown = 0;
  const bySec = {};
  for (const r of rows) {
    const fv = (d.values[r.id] || {}).value || "";
    total++; if (fv.trim()) filled++;
    const anySrc = r.custom || activeSources().some(s => srcValue(r, s));
    if (!anySrc && !fv) continue;
    if (q && !norm(r.label + " " + r.section + " " + fv + " " + JSON.stringify(r.values)).includes(q)) continue;
    const differs = rowDiffers(r);
    if (state.ui.diffOnly && !differs) continue;
    if (state.ui.emptyOnly && fv.trim()) continue;
    (bySec[r.section] = bySec[r.section] || []).push([r, differs, fv]);
  }
  for (const [s, list] of Object.entries(bySec)) {
    const coll = state.ui.collapsed[s];
    const done = list.filter(x => x[2].trim()).length;
    html += `<tr class="sec"><td colspan="${cols.length + 2}" data-sec="${esc(s)}">${coll ? "▸" : "▾"} ${esc(s)}<span class="cnt">${done}/${list.length} filled</span></td></tr>`;
    if (coll) continue;
    for (const [r, differs, fv] of list) {
      shown++;
      const cur = d.values[r.id] || {};
      html += `<tr data-row="${esc(r.id)}" class="${differs ? "diff" : ""}"><td class="f">${esc(r.label)}${r.custom && !locked ? `<button class="rm" type="button" data-act="delrow">remove field</button>` : ""}</td>`;
      for (const s of cols) {
        const sv = srcValue(r, s);
        if (!sv) { html += `<td class="s none">—</td>`; continue; }
        const picked = cur.source === s && !cur.edited;
        if (sv.varies) {
          html += `<td class="s"><span class="varies">Differs between sheets</span>` + sv.varies.map((x, i) =>
            `<button class="opt" type="button" ${locked ? "disabled" : ""} data-act="use" data-src="${s}" data-i="${i}"><span class="who">${esc(x.parts.join(", "))}</span>${esc(x.value)}</button>`).join("") + `</td>`;
        } else {
          const note = s === "datasheet" && sv.partial && !state.part ? `<span class="who small muted">only on ${esc(sv.parts.join(", "))}</span>` : "";
          const hid = s === "website" && ((state.product.meta.website || {}).hidden_rows || []).includes(r.id) ? `<span class="who small muted">hidden on the website</span>` : "";
          const long = sv.value.length > 260 || sv.value.split("\n").length > 7;
          html += `<td class="s ${picked ? "picked" : ""}"><span class="val ${long ? "clamp" : ""}">${esc(sv.value)}</span>${long ? `<button class="more" type="button" data-act="more">Show all</button>` : ""}${note}${hid}${locked ? "" : `<button class="btn sm use" type="button" data-act="use" data-src="${s}">Use</button>`}</td>`;
        }
      }
      const tag = cur.value ? `<span class="tag ${cur.edited ? "edited" : cur.source}">${cur.edited ? (cur.source && cur.source !== "edited" && cur.source !== "custom" ? SRC_LABEL[cur.source] + ", edited" : "Typed in") : SRC_LABEL[cur.source] || ""}</span>` : "";
      html += `<td class="fin"><textarea rows="1" ${locked ? "readonly" : ""} aria-label="Final ${esc(r.label)}" placeholder="${locked ? "" : "Pick a source or type"}">${esc(cur.value || "")}</textarea>${tag}${!locked && cur.value ? ` <button class="btn sm" type="button" data-act="clear" style="margin-top:4px">Clear</button>` : ""}</td></tr>`;
    }
  }
  html += `</tbody>`;
  if (!shown && !Object.keys(bySec).length) html += `<tbody><tr><td colspan="${cols.length + 2}" class="muted" style="padding:16px">No fields match the filters.</td></tr></tbody>`;
  $("#cmp").innerHTML = html;
  $("#progress").textContent = `${filled} of ${total} fields have final content`;
  $("#cmp").querySelectorAll("textarea").forEach(autosize);
}
function autosize(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 420) + "px"; }

/* ------------------------------------------------------------ ordering */
function orderingSources() {
  const p = state.product, o = Object.assign({}, p.ordering || {});
  const ds = Object.entries(p.datasheets || {});
  if (ds.length) o.datasheet = { headers: ["Part Number", "Model on datasheet", "Footer"], rows: ds.map(([k, v]) => [k, v.model || "", v.footer || ""]) };
  return o;
}
function ordTable(t) {
  return `<div class="ord-scroll"><table class="ord"><thead><tr>${t.headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
    t.rows.map(r => `<tr>${t.headers.map((_, i) => `<td>${esc(r[i] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function orderingPanel() {
  const o = orderingSources(), d = state.draft, locked = d.locked;
  const keys = ["website", "master", "catalogue", "datasheet"].filter(k => o[k]);
  const tabs = keys.map(k => `<div class="otab"><h3><span><span class="sw ${k}" style="display:inline-block;width:8px;height:8px;border-radius:2px"></span> ${SRC_LABEL[k]}</span>${locked ? "" : `<button class="btn sm" type="button" data-act="ord-use" data-src="${k}">Use this table</button>`}</h3>${ordTable(o[k])}</div>`).join("");
  const fin = d.ordering;
  let edit = `<p class="muted small">No ordering table chosen yet.${locked ? "" : ` <button class="btn sm" type="button" data-act="ord-new">Start an empty table</button>`}</p>`;
  if (fin) {
    edit = locked ? ordTable(fin) : `<div class="ord-scroll"><table class="ord edit" id="ordEdit"><thead><tr>${fin.headers.map((h, i) => `<th><input data-h="${i}" value="${esc(h)}"></th>`).join("")}<th></th></tr>
      <tr>${fin.headers.map((_, i) => `<th><button class="x" type="button" data-act="ord-delcol" data-i="${i}" title="Delete column">✕ col</button></th>`).join("")}<th></th></tr></thead><tbody>${
      fin.rows.map((r, ri) => `<tr>${fin.headers.map((_, i) => `<td><input data-r="${ri}" data-c="${i}" value="${esc(r[i] ?? "")}"></td>`).join("")}<td><button class="x" type="button" data-act="ord-delrow" data-i="${ri}" title="Delete row">✕</button></td></tr>`).join("")}</tbody></table></div>
      <div style="display:flex;gap:6px;margin-top:8px"><button class="btn sm" type="button" data-act="ord-addrow">Add row</button><button class="btn sm" type="button" data-act="ord-addcol">Add column</button><button class="btn sm" type="button" data-act="ord-clear">Remove table</button></div>`;
  }
  return `<section class="panel"><h2>Ordering information / variants</h2>
    <p class="hint">What each source lists as the product's variants. Pick one to start from, then edit the final table.${fin && fin.source ? ` Final table started from <b>${esc(SRC_LABEL[fin.source] || fin.source)}</b>.` : ""}</p>
    <div class="otabs">${tabs || `<p class="muted small">No source has an ordering table for this product.</p>`}</div>
    <h3 style="font-size:13px;margin:12px 0 6px">Final ordering table</h3>${edit}</section>`;
}

/* ------------------------------------------------------------ approve */
function approvePanel() {
  const d = state.draft, locked = d.locked;
  return `<section class="panel"><h2>${locked ? "Approved record" : "Review and approve"}</h2>
    <p class="hint">${locked ? "This record is approved. Choose “Edit again” above to change it." :
      `Drafts are kept in this browser only. Approving writes <code>${esc(fileFor(state.pid, state.part))}</code>${ghReady() ? " to the GitHub repository" : " as a download (connect GitHub to save it to the repository for everyone)"}.`}</p>
    <div class="approve">
      <label class="small"><b>Notes</b><textarea id="notes" rows="3" ${locked ? "readonly" : ""} placeholder="Decisions, open questions, who confirmed what">${esc(d.notes || "")}</textarea></label>
      <label class="small"><b>Approved by</b><input id="approver" ${locked ? "readonly" : ""} value="${esc(locked ? d.approved_by || "" : state.settings.name || "")}" placeholder="Your name"></label>
      <div class="actions">${locked ? "" : `
        <button class="btn ok" type="button" data-act="approve">Approve and save</button>
        <button class="btn" type="button" data-act="download">Download JSON (draft)</button>
        <button class="btn ghost" type="button" data-act="discard">Discard draft</button>`}
        <span id="savedAt" class="muted small"></span></div>
    </div></section>`;
}
function buildRecord(approver) {
  const p = state.product, d = state.draft;
  const content = {}, provenance = {};
  for (const r of allRows()) {
    const c = d.values[r.id];
    if (!c || !String(c.value || "").trim()) continue;
    const val = LIST_FIELDS.has(r.id) ? c.value.split("\n").map(x => x.trim()).filter(Boolean) : c.value.trim();
    (content[r.section] = content[r.section] || {})[r.label] = val;
    provenance[r.id] = { source: c.source || "edited", edited: !!c.edited };
  }
  const rec = {
    schema: SCHEMA, record_id: rid(p.id, state.part), type: state.part ? "variant" : "family",
    product_id: p.id, product_name: p.name, part_number: state.part, category: p.category,
    content, provenance, custom_fields: (d.custom || []).map(c => c.id),
    notes: d.notes || "", approved_by: approver || null, approved_at: approver ? now() : null,
    source_data_built: state.index.built,
  };
  if (!state.part) {
    rec.variants = recordsOf(p).filter(Boolean);
    if (d.ordering) rec.ordering = { source: d.ordering.source || null, headers: d.ordering.headers, rows: d.ordering.rows };
  } else {
    const k = dsPart(p, state.part);
    rec.datasheet = k ? { file: p.datasheets[k].file, model: p.datasheets[k].model, footer: p.datasheets[k].footer } : null;
  }
  return rec;
}
function download(name, text, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
async function approve() {
  const name = $("#approver").value.trim();
  if (!name) { toast("Enter your name in “Approved by” first."); $("#approver").focus(); return; }
  state.settings.name = name; lsSet(LS.settings, state.settings);
  const rec = buildRecord(name);
  if (!Object.keys(rec.content).length) { toast("Nothing to approve yet: no field has final content."); return; }
  const r = rec.record_id, file = fileFor(state.pid, state.part);
  const entry = { file, product_id: rec.product_id, part_number: rec.part_number, approved_by: name, approved_at: rec.approved_at };
  if (ghReady()) {
    try {
      toast("Saving to GitHub…", 0);
      await ghPut(`${state.settings.base}/${file}`, rec, `Approve ${r} (${name})`);
      await ghUpdateIndex(r, entry);
      toast(`Saved ${file} to ${state.settings.owner}/${state.settings.repo}. The site shows it after GitHub Pages rebuilds (about a minute).`);
    } catch (e) { toast(`Not saved to GitHub: ${e.message}. Downloading the file instead.`); download(file.replace("/", "__"), JSON.stringify(rec, null, 2)); }
  } else {
    download(file.replace("/", "__"), JSON.stringify(rec, null, 2));
    toast(`Approved. ${file.replace("/", "__")} downloaded; put it in docs/approved/${file} (see README) or connect GitHub.`);
  }
  state.approved[r] = entry;
  lsSet(LS.approved(r), rec);
  lsSet(LS.draft(r), null);
  state.draft = Object.assign(fromApproved(rec), { locked: true });
  renderList(); renderView();
}

/* ------------------------------------------------------------ events */
function setFinal(rowId, value, source, edited = false) {
  state.draft.values[rowId] = { value, source, edited };
  saveDraft();
}
document.addEventListener("click", async e => {
  const b = e.target.closest("button, td[data-sec]"); if (!b) return;
  if (b.dataset.pid) return openRecord(b.dataset.pid, null);
  if (b.matches(".rec")) return openRecord(state.pid, b.dataset.part || null);
  if (b.dataset.sec) { state.ui.collapsed[b.dataset.sec] = !state.ui.collapsed[b.dataset.sec]; saveUI(); return renderTable(); }
  const act = b.dataset.act; if (!act) return;
  const d = state.draft;
  const tr = b.closest("tr[data-row]"), rowId = tr && tr.dataset.row;
  const row = rowId && allRows().find(r => r.id === rowId);
  switch (act) {
    case "use": {
      const sv = srcValue(row, b.dataset.src);
      const val = sv.varies ? sv.varies[+b.dataset.i].value : sv.value;
      setFinal(rowId, val, b.dataset.src); return renderTable();
    }
    case "more": { const v = b.previousElementSibling; v.classList.toggle("clamp"); b.textContent = v.classList.contains("clamp") ? "Show all" : "Show less"; return; }
    case "clear": delete d.values[rowId]; saveDraft(); return renderTable();
    case "delrow": d.custom = d.custom.filter(c => c.id !== rowId); delete d.values[rowId]; saveDraft(); return renderTable();
    case "addrow": {
      const sec = $("#newSec").value, label = $("#newLabel").value.trim();
      if (!label) return $("#newLabel").focus();
      const id = `${sec}::${label}`;
      if (allRows().some(r => r.id === id)) return toast("That field already exists in this section.");
      d.custom.push({ id, section: sec, label }); saveDraft(); return renderTable();
    }
    case "fill": {
      const src = $("#fillSrc").value, mode = b.dataset.mode; let n = 0, skipped = 0;
      for (const r of allRows()) {
        const sv = srcValue(r, src); if (!sv) continue;
        if (sv.varies) { skipped++; continue; }
        if (mode === "gaps" && (d.values[r.id] || {}).value) continue;
        d.values[r.id] = { value: sv.value, source: src, edited: false }; n++;
      }
      saveDraft(); renderTable();
      return toast(`${n} field${n === 1 ? "" : "s"} filled from ${SRC_LABEL[src]}.${skipped ? ` ${skipped} skipped because the datasheets disagree: pick those one by one.` : ""}`);
    }
    case "ord-use": { const t = orderingSources()[b.dataset.src]; d.ordering = { source: b.dataset.src, headers: [...t.headers], rows: t.rows.map(r => [...r]) }; saveDraft(); return renderView(); }
    case "ord-new": d.ordering = { source: "edited", headers: ["Part Number"], rows: [[""]] }; saveDraft(); return renderView();
    case "ord-addrow": d.ordering.rows.push(d.ordering.headers.map(() => "")); saveDraft(); return renderView();
    case "ord-addcol": d.ordering.headers.push("New column"); d.ordering.rows.forEach(r => r.push("")); saveDraft(); return renderView();
    case "ord-delrow": d.ordering.rows.splice(+b.dataset.i, 1); saveDraft(); return renderView();
    case "ord-delcol": d.ordering.headers.splice(+b.dataset.i, 1); d.ordering.rows.forEach(r => r.splice(+b.dataset.i, 1)); saveDraft(); return renderView();
    case "ord-clear": d.ordering = null; saveDraft(); return renderView();
    case "approve": return approve();
    case "download": { const rec = buildRecord(d.locked ? d.approved_by : null); if (d.locked) { rec.approved_at = d.approved_at; } return download(fileFor(state.pid, state.part).replace("/", "__"), JSON.stringify(rec, null, 2)); }
    case "discard":
      return confirmBox("Discard this draft?", "Your unsaved choices for this record in this browser will be deleted. Approved files are not affected.", "Discard", () => {
        lsSet(LS.draft(d.record_id), null); openRecord(state.pid, state.part); });
    case "unlock": state.draft.locked = false; lsSet(LS.draft(d.record_id), state.draft); renderList(); return renderView();
    case "sheets": return showSheets();
    case "close": return closeModal();
  }
});
document.addEventListener("input", e => {
  const t = e.target;
  if (t.matches("td.fin textarea") && !state.draft.locked) {
    const rowId = t.closest("tr").dataset.row, cur = state.draft.values[rowId] || {};
    setFinal(rowId, t.value, cur.source && cur.source !== "edited" ? cur.source : "edited", true);
    autosize(t);
    t.closest("td").querySelectorAll(".tag").forEach(x => { x.className = "tag edited"; x.textContent = cur.source && cur.source !== "edited" ? SRC_LABEL[cur.source] + ", edited" : "Typed in"; });
    t.closest("td").previousElementSibling && t.closest("tr").querySelectorAll("td.picked").forEach(x => x.classList.remove("picked"));
  } else if (t.id === "notes") { state.draft.notes = t.value; saveDraft(); }
  else if (t.id === "rowSearch") { state.ui.q = t.value; saveUI(); renderTable(); }
  else if (t.closest && t.closest("#ordEdit")) {
    const o = state.draft.ordering;
    if (t.dataset.h != null) o.headers[+t.dataset.h] = t.value; else o.rows[+t.dataset.r][+t.dataset.c] = t.value;
    saveDraft();
  } else if (["search"].includes(t.id)) renderList();
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "diffOnly") { state.ui.diffOnly = t.checked; saveUI(); renderTable(); }
  else if (t.id === "emptyOnly") { state.ui.emptyOnly = t.checked; saveUI(); renderTable(); }
  else if (t.dataset.hide) { state.ui.hide[t.dataset.hide] = !t.checked; saveUI(); renderTable(); }
  else if (t.id === "catFilter" || t.id === "statusFilter") renderList();
});
window.addEventListener("hashchange", routeFromHash);
function routeFromHash() {
  const h = decodeURIComponent(location.hash.slice(1)); if (!h) return;
  const [pid, ...rest] = h.split("/");
  if (state.index.products.some(p => p.id === pid) && (pid !== state.pid || (rest.join("/") || null) !== state.part)) openRecord(pid, rest.join("/") || null, false);
}

/* ------------------------------------------------------------ modals */
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
  const items = Object.entries(p.datasheets).map(([k, v]) => `<details ${state.part && dsPart(p, state.part) === k ? "open" : ""}><summary><b>${esc(k)}</b> · model on sheet: ${esc(v.model || "—")} · footer: ${esc(v.footer || "—")} · ${v.pages} page${v.pages > 1 ? "s" : ""}${v.template ? "" : " · <span style='color:var(--warn)'>non-standard layout: check the full text</span>"}</summary>
    <p class="small">${v.pdf ? `<a href="${esc(v.pdf)}" target="_blank" rel="noopener">Open PDF</a> · ` : ""}${esc(v.file)}</p><pre>${esc(v.raw)}</pre></details>`).join("");
  openModal(`<h2>Datasheets for ${esc(p.name)}</h2><p class="small muted">Values in the table were read from these PDFs. Sheets with a non-standard layout may be missing fields: copy them from the full text.</p>${items}<div style="text-align:right;margin-top:10px"><button class="btn" type="button" data-act="close">Close</button></div>`);
}
function showSettings() {
  const s = state.settings;
  openModal(`<h2>GitHub connection</h2>
    <p class="small">Connect to save approved records straight into the repository (<code>${esc(s.base)}/</code>) so everyone sees them. Without it, approving downloads the JSON file.</p>
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

/* ------------------------------------------------------------ export */
async function exportZip() {
  const recs = new Set([...Object.keys(state.approved)]);
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("pch:approved:")) recs.add(k.slice(13)); }
  if (!recs.size) return toast("No approved records yet.");
  toast(`Collecting ${recs.size} records…`, 0);
  const zip = new JSZip(); const index = {};
  for (const r of recs) {
    const entry = state.approved[r];
    const pid = r.split("/")[0], part = r.includes("/") ? r.slice(pid.length + 1) : null;
    const file = entry ? entry.file : fileFor(pid, part);
    const rec = await loadApprovedRecord(r, file);
    if (!rec) continue;
    zip.file(file, JSON.stringify(rec, null, 2) + "\n");
    index[r] = { file, product_id: rec.product_id, part_number: rec.part_number, approved_by: rec.approved_by, approved_at: rec.approved_at };
  }
  zip.file("index.json", JSON.stringify({ updated: now(), records: index }, null, 2) + "\n");
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `approved_${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast(`Downloaded ${Object.keys(index).length} approved records.`);
}

/* ------------------------------------------------------------ start */
async function init() {
  $("#btnSettings").onclick = showSettings;
  $("#btnExport").onclick = exportZip;
  updateGhDot();
  try { state.index = await getJSON("data/index.json"); }
  catch { $("#empty").innerHTML = `<h1>No data yet</h1><p>Run <code>python tools/build_data.py …</code> to create <code>docs/data/</code> (see README).</p>`; return; }
  $("#buildInfo").textContent = `Sources read ${new Date(state.index.built).toLocaleDateString()}`;
  const cats = state.index.categories && state.index.categories.length ? state.index.categories : [...new Set(state.index.products.map(p => p.category))];
  $("#catFilter").insertAdjacentHTML("beforeend", cats.map(c => `<option>${esc(c)}</option>`).join(""));
  await loadApprovedIndex();
  renderList();
  routeFromHash();
}
init();
})();