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

    def to_json(self):
        rows = []
        for (sec, label), vals in sorted(self.rows.items(), key=lambda kv: (order(*kv[0]), kv[0][1])):
            rows.append({"id": f"{sec}::{label}", "section": sec, "label": label, "values": vals})
        return {
            "id": self.id, "name": self.name, "category": self.cat, "order": self.order,
            "present": self.present, "meta": self.meta,
            "variants": list(self.parts.values()),
            "datasheets": self.ds_files,
            "ordering": self.ordering,
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
        for sid, d in c["sections"].items():
            if "uc" in d:
                p.add("catalogue", "Overview", "Use cases", [f"{a} — {b}" if b else a for a, b in d["uc"]])
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
    ap.add_argument("--no-originals", action="store_true", help="do not copy PDFs into docs/sources")
    a = ap.parse_args()
    if not any([a.website, a.master, a.catalogue, a.datasheets]):     # default: the inputs/ folder of the repo
        inp = os.path.join(ROOT, "inputs")
        a.website = os.path.join(inp, "website")
        a.master = os.path.join(inp, "Master_Catalogue.pdf")
        a.catalogue = os.path.join(inp, "catalogue")
        a.datasheets = os.path.join(inp, "datasheets")
        a.website, a.master, a.catalogue, a.datasheets = [x if os.path.exists(x) else None for x in (a.website, a.master, a.catalogue, a.datasheets)]
        print("using inputs/:", ", ".join(k for k, v in vars(a).items() if v and k != "no_originals"))
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

    index = []
    for p in sorted(prods.values(), key=lambda p: (p.order or 999, p.name)):
        json.dump(p.to_json(), open(os.path.join(out, "products", f"{p.id}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        index.append({"id": p.id, "name": p.name, "category": p.cat, "order": p.order, "present": p.present,
                      "variants": list(p.parts.values()), "rows": len(p.rows)})
    json.dump({"built": datetime.now(timezone.utc).isoformat(timespec="seconds"), "categories": cats, "products": index},
              open(os.path.join(out, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"wrote {len(index)} products to {out}")


if __name__ == "__main__":
    main()
