"""Read the four product sources and write one comparison file per product for the web app.

    python tools/build_data.py            # reads the inputs/ folder

    python tools/build_data.py --website path/to/productSelector \
        --master path/to/Master_Catalogue.pdf \
        --catalogue path/to/catalogue_output \
        --datasheets path/to/datasheets

Every source is optional. Output goes to docs/data (index.json + products/<id>.json).
With --copy-originals (default) the PDFs are copied to docs/sources so the app can open them.
"""
import argparse, glob, html, json, os, re, shutil, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from canon import place, order, nk  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
SRC_KEYS = ["website", "master", "catalogue", "datasheet"]


def clean(s):
    s = (s or "").replace(" ", " ").replace("˚", "°").replace("ﬁ", "fi")
    return re.sub(r"\s+", " ", s).strip()


def pnorm(p):
    """Normalise a part number for matching: drop bracketed notes, spaces, dashes, case."""
    p = re.sub(r"\(.*?\)", "", p or "")
    p = re.sub(r"(un)?managed.*|poe switch.*|lite.*", "", p, flags=re.I)
    return re.sub(r"[^A-Z0-9]", "", p.upper())


def fnorm(name):
    """Normalise a product name for matching across sources (RTXX, RTSxx, IAXX-X, iSense XXX ...)."""
    n = re.sub(r"[^A-Z0-9]", "", (name or "").upper())
    return re.sub(r"X+$", "", n) or n


class Product:
    def __init__(self, pid, name, cat="", order_=0):
        self.id, self.name, self.cat, self.order = pid, name, cat, order_
        self.rows = {}              # (section, label) -> {"website": str, "master": str, "catalogue": str, "datasheet": {part: str}}
        self.ordering = {}
        self.present = {k: False for k in SRC_KEYS}
        self.meta = {k: {} for k in SRC_KEYS}
        self.parts = {}             # pnorm -> display name
        self.ds_files = {}          # part -> {file, model, footer, raw, pages}
        self.text = {}              # field -> {source: str}
        self.use_cases = {}         # source -> [{title, description}]
        self.highlights = {}        # source -> {"key": [{value, label, icon}], "feature": [{label, icon}]}
        self.features = {}          # part -> {cellular, modems, wifi, rs485, rs232, source}

    def add(self, src, section, key, value, part=None):
        value = value if isinstance(value, str) else "\n".join(value)
        value = value.strip() if "\n" in value else clean(value)
        if not value:
            return
        sec, label = (section, key) if section in ("Overview", "Website filters") else place(section, key)
        cell = self.rows.setdefault((sec, label), {})
        if src == "datasheet":
            d = cell.setdefault("datasheet", {})
            d[part] = value if part not in d else d[part] + "\n" + value
        else:
            cell[src] = value if src not in cell else (cell[src] if value in cell[src] else cell[src] + "\n" + value)
        self.present[src] = True

    def add_part(self, name):
        k = pnorm(name)
        if k and k not in self.parts:
            self.parts[k] = clean(name)
        return self.parts.get(k, clean(name))

    def set_text(self, field, src, value):
        value = clean(value)
        if value:
            self.text.setdefault(field, {})[src] = value

    def to_json(self):
        rows = []
        sheets = len(self.ds_files)
        for (sec, label), vals in sorted(self.rows.items(), key=lambda kv: (order(*kv[0]), kv[0][1])):
            if sec == "Overview":
                continue
            ds = vals.get("datasheet") or {}
            if not ds:
                kind = "none"
            elif sheets > 1 and len(ds) < sheets:
                kind = "partial"            # only some sheets have this line
            elif len({nk(v) for v in ds.values()}) > 1:
                kind = "varies"
            else:
                kind = "common"
            rows.append({"id": f"{sec}::{label}", "section": sec, "label": label, "values": vals, "ds": kind})
        return {
            "id": self.id, "name": self.name, "category": self.cat, "order": self.order,
            "present": self.present, "meta": self.meta,
            "variants": list(self.parts.values()),
            "datasheets": self.ds_files,
            "ordering": self.ordering,
            "text": self.text, "use_cases": self.use_cases, "highlights": self.highlights,
            "features": self.features,
            "rows": rows,
        }


# ---------------------------------------------------------------- website JSON
WEB_FIELDS = [  # field, section, label
    ("cpu", "Hardware", "CPU"), ("ram", "Hardware", "RAM"), ("storage", "Hardware", "Flash"),
    ("cell", "Hardware", "Cellular"), ("power", "Power", "Input Voltage"),
    ("os", "Operating System & Software", "Operating System"), ("housing", "Physical", "Enclosure"),
    ("dims", "Physical", "Dimensions"), ("weight", "Physical", "Weight"), ("ip", "Physical", "IP Rating"),
    ("op_temp", "Environmental", "Operating Temperature"),
]
FILTERS = [("cellular_gen", "Cellular generation"), ("wifi", "Wi-Fi"), ("ports", "Ethernet ports"),
           ("rs485", "RS485"), ("rs232", "RS232")]


def load_website(prods, wdir):
    idx_path = os.path.join(wdir, "_index.json")
    idx = json.load(open(idx_path, encoding="utf-8"))
    for e in idx["products"]:
        prods[e["id"]] = Product(e["id"], e["name"], e.get("cat", ""), e.get("order", 0))
    for f in glob.glob(os.path.join(wdir, "products", "*.json")):
        j = json.load(open(f, encoding="utf-8"))
        p = prods.get(j["id"]) or prods.setdefault(j["id"], Product(j["id"], j["name"], j.get("cat", ""), j.get("order", 0)))
        hidden = set(j.get("hidden_fields") or [])
        p.meta["website"] = {"file": os.path.basename(f), "hidden": j.get("hidden", False), "hidden_fields": sorted(hidden),
                             "images": j.get("images") or [], "part_datasheets": j.get("part_datasheets") or {},
                             "datasheet": j.get("datasheet")}
        p.add("website", "Overview", "Product name", j.get("name", ""))
        p.add("website", "Overview", "Category", j.get("cat", ""))
        p.add("website", "Overview", "Description", j.get("desc", ""))
        p.add("website", "Overview", "Use cases", [clean(u) for u in j.get("use_cases") or []])
        p.set_text("short_description", "website", j.get("desc", ""))
        p.set_text("long_description", "website", j.get("desc", ""))
        if j.get("use_cases"):
            p.use_cases["website"] = [{"title": clean(u), "description": ""} for u in j["use_cases"] if clean(u)]
        hid = []
        for fld, sec, label in WEB_FIELDS:
            v = j.get(fld)
            if v not in (None, "", "-"):
                p.add("website", sec, label, str(v))
                if fld in hidden:
                    hid.append("%s::%s" % place(sec, label))
        for fld, label in FILTERS:
            v = j.get(fld)
            if v not in (None, ""):
                p.add("website", "Website filters", label, str(v))
                if fld in hidden:
                    hid.append(f"Website filters::{label}")
        p.meta["website"]["hidden_rows"] = hid
        for a in j.get("additional_specs") or []:
            if a.get("k"):
                p.add("website", "Hardware", a["k"], a.get("v", ""))
        var = j.get("variants") or {}
        if var.get("rows"):
            p.ordering["website"] = {"headers": var.get("headers", []), "rows": var["rows"]}
            for r in var["rows"]:
                p.add_part(r[-1])
        for part in (j.get("part_datasheets") or {}):
            p.add_part(part)


# ---------------------------------------------------------------- master catalogue
def load_master(prods, pdf, aliases):
    from master_pdf import MasterCatalogue, norm
    mc = MasterCatalogue(pdf)
    briefs = mc.briefs()
    used, pick = {}, {}

    def take(p, n, how):
        used[n] = p.id
        pick[p.id] = (n, how)

    todo = sorted(prods.values(), key=lambda p: p.order)
    for p in todo:                                   # 1. alias or same name
        want = aliases.get(p.id)
        for b in briefs:
            if b.number in used:
                continue
            if (want and norm(b.title) == norm(want)) or (not want and (fnorm(b.title) in (fnorm(p.name), fnorm(p.id)))):
                take(p, b.number, "alias" if want else "name")
                break
    for p in todo:                                   # 2. most of the part numbers appear on the page
        if p.id in pick:
            continue
        parts = [pnorm(x) for x in p.parts.values() if pnorm(x)]
        if not parts:
            continue
        for b in briefs:
            t = norm(b.text)
            if b.number not in used and sum(1 for x in parts if x in t) >= max(1, (len(parts) + 1) // 2):
                take(p, b.number, "part numbers")
                break
    for p in todo:                                   # 3. CPU model in the page title (e.g. INTEL X6425)
        if p.id in pick:
            continue
        c = norm(p.rows.get(("Hardware", "CPU"), {}).get("website", ""))
        for b in briefs:
            toks = [norm(t) for t in re.findall(r"[A-Za-z]*\d{3,}[A-Za-z]*", b.title)]
            if b.number not in used and c and toks and all(t in c for t in toks) and p.cat.lower().startswith("intel"):
                take(p, b.number, "CPU model")
                break
    for pid, (n, how) in pick.items():
        p = prods[pid]
        b = mc.parse_brief(n)
        dn = mc.detailed_for(n)
        p.meta["master"] = {"title": b.title, "brief_page": n, "detailed_page": dn, "matched_by": how}
        p.add("master", "Overview", "Product name", b.title)
        for k, v in b.specs.items():
            p.add("master", "brief", k, v)
        if b.ordering:
            p.ordering["master"] = b.ordering
            hdr = [nk(h) for h in b.ordering["headers"]]
            pi = next((i for i, h in enumerate(hdr) if "part" in h or "model" in h), len(hdr) - 1)
        if dn:
            d = mc.parse_detailed(dn)
            for sec, rows in d.sections.items():
                for k, v in rows:
                    if nk(k) in ("standardpackaging", "standardpacking"):
                        p.add("master", "Packaging", "Standard Packaging", v)
                    else:
                        p.add("master", sec, k, v)
    return {pid: n for n, pid in used.items()}


# ---------------------------------------------------------------- new catalogue (HTML written by the catalogue tool)
def _txt(s):
    s = re.sub(r"<svg.*?</svg>", "", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    return clean(html.unescape(s))


ICONS = json.load(open(os.path.join(os.path.dirname(__file__), "icons.json"), encoding="utf-8"))
_ICON_KEY = {re.sub(r"\s+", "", v): k for k, v in ICONS.items()}


def icon_name(svg):
    """Name of a catalogue-tool icon from its inline SVG (empty when unknown, e.g. an uploaded logo)."""
    return _ICON_KEY.get(re.sub(r"\s+", "", svg or ""), "")


def parse_catalogue_html(path):
    t = open(path, encoding="utf-8").read()
    t = re.sub(r"<style.*?</style>|<script.*?</script>", "", t, flags=re.S)
    t = re.sub(r'src="data:[^"]+"', 'src=""', t)
    r = {}
    for tag in ("h1", "h2"):
        m = re.search(rf"<{tag}>(.*?)</{tag}>", t, re.S)
        r[tag] = _txt(m.group(1)) if m else ""
    m = re.search(r'<div class="intro">.*?<p>(.*?)</p>', t, re.S)
    r["intro"] = _txt(m.group(1)) if m else ""
    m = re.search(r'<div class="p">(.*?)</div>', t, re.S)
    r["page"] = _txt(m.group(1)) if m else ""
    r["badges"] = [_txt(x) for x in re.findall(r'<div class="badge">(.*?)</div>', t, re.S)]
    r["tiles"] = [_txt(x) for x in re.findall(r'<div class="tile">(.*?)</div></div>', t, re.S)]
    m = re.search(r'<div class="eyebrow">(.*?)</div>', t, re.S)
    r["eyebrow"] = " · ".join(_txt(x) for x in re.findall(r"<span>(.*?)</span>", m.group(1), re.S)) if m else ""
    r["tiles_s"] = [{"value": _txt(b), "label": _txt(sm), "icon": icon_name(svg)} for svg, b, sm in
                    re.findall(r'<div class="tile">(<svg.*?</svg>)?\s*<div><b>(.*?)</b><small>(.*?)</small>', t, re.S)]
    r["badges_s"] = [{"label": _txt(lb), "icon": icon_name(svg)} for svg, lb in
                     re.findall(r'<div class="badge">(<svg.*?</svg>|<img[^>]*>)?\s*<span>(.*?)</span>', t, re.S)]
    secs = {}
    pat = r'<div class="sec" data-id="([^"]+)"[^>]*>(.*?)(?=<div class="sec" data-id|<div class="col" id|</div>\s*</div>\s*<div class="foot")'
    for sid, body in re.findall(pat, t, re.S):
        h = re.search(r"<h3>(.*?)</h3>", body, re.S)
        d = {"title": _txt(h.group(1)) if h else sid}
        kv = re.search(r'<table class="kv">(.*?)</table>', body, re.S)
        if kv:
            d["kv"] = [[_txt(a), _txt(b)] for a, b in re.findall(r"<tr><td>(.*?)</td><td>(.*?)</td></tr>", kv.group(1), re.S)]
        od = re.search(r'<table class="ord">(.*?)</table>', body, re.S)
        if od:
            rows = [[_txt(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", x, re.S)] for x in re.findall(r"<tr>(.*?)</tr>", od.group(1), re.S)]
            d["ord"] = rows
        uc = re.findall(r'<div class="uc"><b>(.*?)</b><small>(.*?)</small>', body, re.S)
        if uc:
            d["uc"] = [[_txt(a), _txt(b)] for a, b in uc]
        if sid == "compliance":
            d["marks"] = [_txt(x) for x in re.findall(r'<div class="cm[^"]*">(.*?)</div>', body, re.S)] or [_txt(body)]
        secs[sid] = d
    r["sections"] = secs
    return r


def load_catalogue(prods, cdir, docs_src, copy):
    by = {}
    for p in prods.values():
        for k in {fnorm(p.name), fnorm(p.id)}:
            by.setdefault(k, p)
    matched = {}
    for f in sorted(glob.glob(os.path.join(cdir, "**", "*_Catalogue.html"), recursive=True)):
        name = os.path.basename(f)[: -len("_Catalogue.html")]
        alias = {v: k for k, v in ALIASES.get("catalogue", {}).items()}
        p = prods.get(alias.get(name, "")) or by.get(fnorm(name)) or by.get(fnorm(name.replace("_", " ")))
        if not p:
            print(f"  catalogue: no product for {name}")
            continue
        c = parse_catalogue_html(f)
        pdf = f[:-5] + ".pdf"
        rel = None
        if copy and os.path.exists(pdf):
            rel = f"sources/catalogue/{os.path.basename(pdf)}"
            os.makedirs(os.path.join(docs_src, "catalogue"), exist_ok=True)
            shutil.copy2(pdf, os.path.join(DOCS, rel))
        p.meta["catalogue"] = {"name": name, "pdf": rel, "page": c["page"]}
        matched[p.id] = name
        p.add("catalogue", "Overview", "Product name", c["h1"])
        p.add("catalogue", "Overview", "Title", c["h2"])
        p.add("catalogue", "Overview", "Category", c["page"].split("|")[0].strip())
        p.add("catalogue", "Overview", "Description", c["intro"])
        p.add("catalogue", "Overview", "Highlight badges", c["badges"])
        p.add("catalogue", "Overview", "Highlight tiles", c["tiles"])
        p.set_text("title", "catalogue", c["h2"])
        p.set_text("tagline", "catalogue", c["eyebrow"])
        p.set_text("long_description", "catalogue", c["intro"])
        p.highlights["catalogue"] = {"key": c["tiles_s"], "feature": c["badges_s"]}
        for sid, d in c["sections"].items():
            if "uc" in d:
                p.add("catalogue", "Overview", "Use cases", [f"{a} — {b}" if b else a for a, b in d["uc"]])
                p.use_cases["catalogue"] = [{"title": a, "description": b} for a, b in d["uc"]]
            if "ord" in d and d["ord"]:
                p.ordering["catalogue"] = {"headers": d["ord"][0], "rows": d["ord"][1:]}
                pi = next((i for i, h in enumerate(d["ord"][0]) if "part" in h.lower()), len(d["ord"][0]) - 1)
                for r in d["ord"][1:]:
                    if pi < len(r) and re.search(r"\d", r[pi]) and len(r[pi]) < 40:
                        p.add_part(r[pi])
            if sid == "compliance":
                p.add("catalogue", "Compliance", "Compliance marks", d.get("marks", []))
            for k, v in d.get("kv", []):
                if sid == "hardware" and nk(k) == "interface":
                    p.add("catalogue", "Interfaces", "Serial Interface", v)
                else:
                    p.add("catalogue", {"hardware": "hardware", "physical": "physical", "software": "software"}.get(sid, sid), k, v)
    return matched


# ---------------------------------------------------------------- datasheets
def load_datasheets(prods, ddir, docs_src, copy):
    import pymupdf
    from datasheet_pdf import parse
    files = {}
    for f in glob.glob(os.path.join(ddir, "**", "*.pdf"), recursive=True):
        files.setdefault(os.path.basename(f).lower(), []).append(f)
    used = set()

    def attach(p, part, f):
        r = parse(f)
        raw = "\n".join(pg.get_text() for pg in pymupdf.open(f))
        rel = None
        if copy:
            sub = os.path.basename(os.path.dirname(f))
            rel = f"sources/datasheets/{sub}/{os.path.basename(f)}"
            os.makedirs(os.path.join(DOCS, os.path.dirname(rel)), exist_ok=True)
            shutil.copy2(f, os.path.join(DOCS, rel))
        footer = next((m for m in re.findall(r"([^\s]+_V\.\d+\.\d+)", raw)), "")
        template = "Hardware Specification" in r["sections"]
        p.ds_files[part] = {"file": os.path.relpath(f, ddir), "pdf": rel, "model": r["model"] or "", "footer": footer,
                            "pages": r["pages"], "template": template, "raw": clean_raw(raw)}
        p.add("datasheet", "Overview", "Product name", r["model"] or "", part)
        for sec, kv in r["sections"].items():
            if sec == "Header":
                continue
            for k, v in kv.items():
                p.add("datasheet", sec, k, v, part)
        for sec, v in r["text"].items():
            if nk(sec) == "standardpackaging":
                p.add("datasheet", "Packaging", "Standard Packaging", v, part)
        used.add(f)

    for p in prods.values():
        links = dict((p.meta["website"].get("part_datasheets") or {}))
        if p.meta["website"].get("datasheet"):
            links.setdefault(p.name, p.meta["website"]["datasheet"])
        for part, path in links.items():
            if not path or path == "contact_us":
                continue
            cands = files.get(os.path.basename(path).lower(), [])
            if not cands:   # fall back to the part number inside the folder
                folder = os.path.basename(os.path.dirname(path)).lower()
                cands = [f for fs in files.values() for f in fs
                         if os.path.basename(os.path.dirname(f)).lower() == folder
                         and pnorm(os.path.basename(f).split("_")[0]) == pnorm(part)]
            if not cands:   # a file whose part number is the start of this one (rd44 for RD44-A)
                folder = os.path.basename(os.path.dirname(path)).lower()
                inf = [f for fs in files.values() for f in fs if os.path.basename(os.path.dirname(f)).lower() == folder and f not in used]
                cands = [f for f in inf if pnorm(os.path.basename(f).split("_")[0]) and pnorm(part).startswith(pnorm(os.path.basename(f).split("_")[0]))
                         and not any(pnorm(os.path.basename(f).split("_")[0]) == pnorm(q) for q in links)]
            if cands:
                attach(p, p.add_part(part), cands[0])
            else:
                print(f"  datasheet: {p.id} {part} -> {path} not found")
    # files not referenced by the website: attach by folder name
    for fs in files.values():
        for f in fs:
            if f in used:
                continue
            folder = fnorm(os.path.basename(os.path.dirname(f)))
            p = next((q for q in prods.values() if fnorm(q.id) == folder or fnorm(q.name) == folder), None)
            if p:
                stem = re.sub(r"_?datasheet$", "", os.path.splitext(os.path.basename(f))[0], flags=re.I)
                attach(p, p.add_part(stem.upper()), f)
            else:
                print(f"  datasheet: no product for {os.path.relpath(f, ddir)}")


# ---------------------------------------------------------------- variant features (drive ordering, filters, datasheet sections)
def _yes(v):
    return bool(v) and v.strip() not in ("—", "-", "NA", "N/A", "No", "no", "✗", "")


def _wifi_std(t):
    t = (t or "").lower()
    if not _yes(t) or t.strip() in ("na", "n/a"):
        return ""
    for pat, std in (("wi-?fi ?7|be\\b|/be", "Wi-Fi 7"), ("wi-?fi ?6|ax", "Wi-Fi 6"), ("wi-?fi ?5|ac", "Wi-Fi 5"), ("wi-?fi ?4|/n|b/g/n", "Wi-Fi 4")):
        if re.search(pat, t):
            return std
    return "Wi-Fi"


def derive_features(p):
    parts = list(p.parts.values()) or [p.name]
    if not p.parts:
        p.add_part(p.name)
    web = p.ordering.get("website") or {}
    hdr = [nk(h) for h in web.get("headers", [])]
    rows = {pnorm(r[-1]): r for r in web.get("rows", []) if r}

    def col(r, *names):
        for n in names:
            if n in hdr and hdr.index(n) < len(r):
                return r[hdr.index(n)]
        return None

    for part in parts:
        f = {"cellular": "", "modems": 0, "wifi": "", "rs485": False, "rs232": False, "source": ""}
        r = rows.get(pnorm(part))
        if r:
            cell, gen, mod = col(r, "cellular"), col(r, "4g5g", "gen"), col(r, "noofmodems", "modem", "modems")
            if _yes(cell) or _yes(gen):
                f["cellular"] = gen if _yes(gen) else "4G"
                f["modems"] = 2 if mod and "dual" in mod.lower() else 1
            w = col(r, "wifi")
            f["wifi"] = (w if w and w.lower().startswith("wi") else "Wi-Fi") if _yes(w) else ""
            f["rs485"] = _yes(col(r, "rs485")) or bool(re.search(r"[1-9]", col(r, "noofrs485ports") or ""))
            f["rs232"] = _yes(col(r, "rs232"))
            f["source"] = "website"
        k = next((x for x in p.ds_files if pnorm(x) == pnorm(part)), None)
        if k and not r:           # fall back to the datasheet's Product Info box
            info = {lb: (v.get("datasheet") or {}).get(k, "") for (sec, lb), v in p.rows.items() if sec == "Summary"}
            cell = info.get("Cellular", "")
            if _yes(cell):
                f["cellular"] = "5G" if "5g" in cell.lower() else "4G"
                f["modems"] = 2 if "dual modem" in cell.lower() else 1
            f["wifi"] = _wifi_std(info.get("Wi-Fi", ""))
            itf = info.get("Interface", "").lower()
            f["rs485"], f["rs232"] = "rs485" in itf.replace(" ", ""), "rs232" in itf.replace(" ", "")
            f["source"] = "datasheet"
        p.features[part] = f


def clean_raw(t):
    lines = [clean(x) for x in t.splitlines()]
    return "\n".join(x for x in lines if x)


# ---------------------------------------------------------------- main
ALIASES = json.load(open(os.path.join(os.path.dirname(__file__), "aliases.json"), encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--website", help="productSelector folder (contains _index.json and products/)")
    ap.add_argument("--master", help="Master Catalogue PDF")
    ap.add_argument("--catalogue", help="folder with the catalogue tool output (<NAME>/<NAME>_Catalogue.html/.pdf)")
    ap.add_argument("--datasheets", help="folder with datasheet PDFs (any depth)")
    ap.add_argument("--skip", default="", help="comma-separated sources to leave out: website,master,catalogue,datasheets")
    ap.add_argument("--no-originals", action="store_true", help="do not copy PDFs into docs/sources")
    a = ap.parse_args()
    if not any([a.website, a.master, a.catalogue, a.datasheets]):     # default: the inputs/ folder of the repo
        inp = os.path.join(ROOT, "inputs")
        a.website = os.path.join(inp, "website")
        a.master = os.path.join(inp, "Master_Catalogue.pdf")
        a.catalogue = os.path.join(inp, "catalogue")
        a.datasheets = os.path.join(inp, "datasheets")
        a.website, a.master, a.catalogue, a.datasheets = [x if os.path.exists(x) else None for x in (a.website, a.master, a.catalogue, a.datasheets)]
        print("using inputs/:", ", ".join(k for k in ("website", "master", "catalogue", "datasheets") if getattr(a, k)))
    for k in filter(None, (x.strip().lower() for x in a.skip.split(","))):
        k = {"datasheet": "datasheets", "website": "website", "master": "master", "catalogue": "catalogue", "datasheets": "datasheets"}.get(k)
        if k:
            setattr(a, k, None)
            print(f"skipping {k}")
    copy = not a.no_originals
    out = os.path.join(DOCS, "data")
    docs_src = os.path.join(DOCS, "sources")
    if copy and os.path.isdir(docs_src):
        shutil.rmtree(docs_src)
    os.makedirs(os.path.join(out, "products"), exist_ok=True)
    for f in glob.glob(os.path.join(out, "products", "*.json")):
        os.remove(f)

    prods = {}
    cats = []
    if a.website:
        load_website(prods, a.website)
        cats = json.load(open(os.path.join(a.website, "_index.json"), encoding="utf-8")).get("cats", [])
        print(f"website: {len(prods)} products")
    if a.master:
        m = load_master(prods, a.master, ALIASES.get("master", {}))
        if copy:
            os.makedirs(docs_src, exist_ok=True)
            shutil.copy2(a.master, os.path.join(docs_src, "Master_Catalogue.pdf"))
            for p in prods.values():
                if p.meta["master"]:
                    p.meta["master"]["pdf"] = "sources/Master_Catalogue.pdf"
        print(f"master catalogue: {len(m)} products matched")
    if a.catalogue:
        m = load_catalogue(prods, a.catalogue, docs_src, copy)
        print(f"new catalogue: {len(m)} products matched")
    if a.datasheets:
        load_datasheets(prods, a.datasheets, docs_src, copy)
        print(f"datasheets: {sum(len(p.ds_files) for p in prods.values())} files on {sum(1 for p in prods.values() if p.ds_files)} products")

    for p in prods.values():
        derive_features(p)
    for f in ("fields.json", "icons.json"):
        shutil.copy2(os.path.join(os.path.dirname(__file__), f), os.path.join(out, f))

    index = []
    for p in sorted(prods.values(), key=lambda p: (p.order or 999, p.name)):
        json.dump(p.to_json(), open(os.path.join(out, "products", f"{p.id}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        index.append({"id": p.id, "name": p.name, "category": p.cat, "order": p.order, "present": p.present,
                      "variants": list(p.parts.values()), "rows": len(p.rows)})
    loaded = [k for k, v in (("website", a.website), ("master", a.master), ("catalogue", a.catalogue), ("datasheet", a.datasheets)) if v]
    json.dump({"built": datetime.now(timezone.utc).isoformat(timespec="seconds"), "sources": loaded, "categories": cats, "products": index},
              open(os.path.join(out, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"wrote {len(index)} products to {out}")


if __name__ == "__main__":
    main()
