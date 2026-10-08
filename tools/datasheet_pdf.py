"""Parse the Invendis datasheet template into {model, sections: {section: {key: value}}, text: {section: str}}."""
import json, re, sys, glob, os
import pymupdf

IGNORE = re.compile(r"^(Page \d+|«Device_Name».*|\*All rights reserved.*|Get in touch:?|sales@invendis\.com|"
                    r"www\.silbonetworks\.com|www\.invendis\.com|Invendis Technologies India Private Limited|"
                    r"No\. 230.*|2nd Stage, Bangalore.*|DATA SHEET|PRODUCT INFO|SOFTWARE SPECIFICATIONS|HARDWARE SPECIFICATIONS)$", re.I)

def norm(t):
    t = t.replace(" ", " ").replace("ﬁ", "fi").replace("˚", "°")
    return re.sub(r"\s+", " ", t).strip()

def lines_of(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = norm("".join(s["text"] for s in l["spans"]))
            if not t:
                continue
            sp = [s for s in l["spans"] if s["text"].strip()] or l["spans"]
            f = sp[0]["font"]; size = round(sp[0]["size"], 1)
            x0, y0, x1, y1 = l["bbox"]
            out.append(dict(t=t, x0=x0, y0=y0, x1=x1, y1=y1, font=f, size=size))
    out.sort(key=lambda d: (round(d["y0"] / 2), d["x0"]))
    return out

def parse(path):
    doc = pymupdf.open(path)
    res = {"file": path, "model": None, "sections": {}, "text": {}, "pages": len(doc)}
    sec = "Header"
    for pno, page in enumerate(doc):
        info_key = None
        last_key = None
        last_y = None
        parent = None            # for bulleted sub-items
        for d in lines_of(page):
            t, f, size = d["t"], d["font"], d["size"]
            if d["y0"] > 800 or IGNORE.match(t):
                continue
            if size >= 30:
                res["model"] = res["model"] or t
                continue
            if size >= 13:
                continue
            if 11 <= size < 13:
                sec = t.rstrip(":")
                last_key = parent = None
                continue
            # product-info box: 9.5 SemiBold label + 7pt Light value lines
            if 9.2 <= size < 10.5 and d["x0"] < 230:
                info_key = t
                res["sections"].setdefault("Product info", {})[info_key] = ""
                continue
            if size < 7.6 and info_key and d["x0"] < 300:
                v = res["sections"]["Product info"][info_key]
                res["sections"]["Product info"][info_key] = norm(v + " " + t)
                continue
            if t in ("•", "", "§") or ("Symbol" in f and len(t) <= 2):
                continue
            if sec.lower().startswith("standard packaging"):        # one free-text paragraph
                res["text"][sec] = norm(res["text"].get(sec, "") + " " + t)
                continue
            tbl = res["sections"].setdefault(sec, {})
            if d["x0"] < 230:                                   # key column (or free text)
                if d["x1"] > 330 and not any(True for _ in []):
                    # long line starting at the left: free text (e.g. standard packaging)
                    if last_key is None or (last_y is not None and abs(d["y0"] - last_y) > 3):
                        res["text"][sec] = norm(res["text"].get(sec, "") + " " + t)
                        continue
                key = t
                if d["x0"] > 50 and parent:                     # bulleted sub-item under a parent key
                    key = f"{parent} › {t}"
                elif d["x0"] <= 50:
                    parent = t
                if key in tbl and tbl[key]:
                    key = key + " (2)"
                tbl[key] = ""
                last_key, last_y = key, d["y0"]
            else:                                               # value column
                if last_key is not None:
                    tbl[last_key] = norm(tbl[last_key] + " " + t)
                else:
                    res["text"][sec] = norm(res["text"].get(sec, "") + " " + t)
    # drop empty sections; tidy
    res["sections"] = {s: {k: v for k, v in kv.items()} for s, kv in res["sections"].items() if kv}
    return res

if __name__ == "__main__":
    root = sys.argv[1]
    out = {}
    for f in sorted(glob.glob(os.path.join(root, "*", "*.pdf"))):
        r = parse(f)
        out[os.path.relpath(f, root)] = r
    json.dump(out, open(sys.argv[2], "w"), indent=1, ensure_ascii=False)
    for k, r in out.items():
        n = sum(len(v) for v in r["sections"].values())
        empties = sum(1 for s in r["sections"].values() for v in s.values() if not v)
        print(f"{k:45s} model={r['model']!s:22s} pages={r['pages']} specs={n:3d} empty={empties} sections={len(r['sections'])}")
