"""Index and parse the Master Catalogue PDF.

Brief pages: title + labelled spec blocks (CPU, Wi-Fi, ETHERNET, ...) + ORDERING INFORMATION table.
Detailed pages: a HARDWARE/SOFTWARE ASPECT | DETAILS grid. Brief pages hyperlink to their detailed page.
"""
import re
from dataclasses import dataclass, field

import pdfplumber
import pymupdf

SYMBOLS = {"✓": "✓", "⮾": "—", "✗": "—", "NA": "—", "N/A": "—"}
NOISE = ("Back to Index", "Detailed Specifications", "Brief Specifications")


def norm(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def _bold(span):
    f = span["font"]
    return ",Bold" in f or f.endswith((" Bold", "-Bold"))


def clean(s):
    s = (s or "").replace("˚", "°").replace(" ", " ")
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"\s+,", ",", s)
    return s


@dataclass
class PageInfo:
    number: int                 # 1-based
    kind: str                   # brief | detailed | other
    title: str = ""
    link_to: int | None = None  # 1-based page this page links to (brief -> detailed)
    text: str = ""


@dataclass
class BriefData:
    title: str = ""
    specs: dict = field(default_factory=dict)       # LABEL -> text
    ordering: dict | None = None                    # {"headers": [...], "rows": [[...]]}


@dataclass
class DetailedData:
    title: str = ""
    sections: dict = field(default_factory=dict)    # "HARDWARE" / "SOFTWARE" / "SPECIFICATIONS" -> [[k, v], ...]


class MasterCatalogue:
    def __init__(self, path):
        self.path = str(path)
        self.doc = pymupdf.open(self.path)
        self.pages = [self._index_page(i) for i in range(len(self.doc))]

    # ---------- index ----------
    def _index_page(self, i):
        p = self.doc[i]
        text = p.get_text()
        kind = "detailed" if "DETAILED PRODUCT SPECIFICATIONS" in text else (
            "brief" if "BRIEF PRODUCT SPECIFICATIONS" in text else "other")
        title = ""
        best = 0
        for s in self._spans(p):
            t = s["text"].strip()
            if not t or t.isdigit() or "SPECIFICATIONS" in t or "HARDWARE AND" in t:
                continue
            if s["size"] >= 22 and s["bbox"][1] < 120 and s["size"] > best:
                best, title = s["size"], t
        link_to = None
        for l in p.get_links():
            tgt = l.get("page")
            if l.get("kind") == pymupdf.LINK_GOTO and tgt is not None and tgt > 1 and tgt != i:
                link_to = tgt + 1
        return PageInfo(i + 1, kind, clean(title), link_to, text)

    @staticmethod
    def _spans(page):
        for b in page.get_text("dict")["blocks"]:
            for l in b.get("lines", []):
                for s in l["spans"]:
                    yield s

    def briefs(self):
        return [p for p in self.pages if p.kind == "brief"]

    def page(self, n):
        return self.pages[n - 1] if n and 1 <= n <= len(self.pages) else None

    # ---------- matching ----------
    def match_brief(self, name, part_numbers=(), cpu=""):
        """Return (page_no, how) for the brief page of a product, or (None, reason)."""
        n = norm(name)
        for p in self.briefs():
            if norm(p.title) == n:
                return p.number, "name"
        for p in self.briefs():  # name without -X / -XX suffix
            if norm(re.sub(r"(-X+)+$", "", p.title)) == norm(re.sub(r"(-X+)+$", "", name)):
                return p.number, "name"
        parts = [norm(x) for x in part_numbers if x]
        if parts:
            for p in self.briefs():
                t = norm(p.text)
                if sum(1 for x in parts if x and x in t) >= max(1, len(parts) // 2):
                    return p.number, "part numbers"
        c = norm(cpu)
        if c:
            for p in self.briefs():
                toks = [norm(t) for t in re.findall(r"[A-Za-z]*\d{3,}[A-Za-z]*", p.title)]
                if toks and all(t in c for t in toks):
                    return p.number, "CPU model"
        return None, "no match"

    def detailed_for(self, brief_no):
        b = self.page(brief_no)
        if b and b.link_to and self.page(b.link_to) and self.page(b.link_to).kind == "detailed":
            return b.link_to
        return None

    # ---------- brief page ----------
    def parse_brief(self, n):
        p = self.doc[n - 1]
        spans = [s for s in self._spans(p) if s["text"].strip()]
        out = BriefData(title=self.pages[n - 1].title)

        labels = [s for s in spans if 17 <= s["size"] <= 21 and not s["text"].strip().isdigit()
                  and "SPECIFICATIONS" not in s["text"] and "ORDERING" not in s["text"]]
        values = [s for s in spans if s["size"] < 14 and "Medium" in s["font"]
                  and not any(k in s["text"] for k in NOISE)]
        col_x = sorted({round(l["bbox"][0]) for l in labels})
        for l in labels:
            lx, ly = l["bbox"][0], l["bbox"][1]
            right = min([x for x in col_x if x > lx + 20], default=10_000)
            below = [o["bbox"][1] for o in labels if abs(o["bbox"][0] - lx) < 20 and o["bbox"][1] > ly + 2]
            bottom = min(below, default=10_000)
            vs = [v for v in values if lx - 5 <= v["bbox"][0] < right - 5 and ly + 2 < v["bbox"][1] < bottom - 2]
            vs.sort(key=lambda v: (round(v["bbox"][1] / 3), v["bbox"][0]))
            key = clean(l["text"]).upper()
            if vs:
                out.specs[key] = clean(" ".join(v["text"] for v in vs))
        out.ordering = self._parse_ordering(spans, p.get_text("words"))
        return out

    @staticmethod
    def _cluster_rows(spans, tol=5):
        rows = []
        for s in sorted(spans, key=lambda s: s["bbox"][1]):
            if rows and s["bbox"][1] - rows[-1][0] <= tol:
                rows[-1][1].append(s)
            else:
                rows.append([s["bbox"][1], [s]])
        return rows

    def _parse_ordering(self, spans, words):
        if not any("ORDERING INFORMATION" in s["text"] for s in spans):
            return None
        cells = [s for s in spans if 9 <= s["size"] <= 12.5 and not any(k in s["text"] for k in NOISE)]
        hdr_rows = [r for r in self._cluster_rows([s for s in cells if _bold(s)]) if len(r[1]) >= 3]
        if not hdr_rows:
            return None
        hy, hdr = hdr_rows[0]
        x_min = min(h["bbox"][0] for h in hdr) - 40
        x_max = max(h["bbox"][2] for h in hdr) + 60
        y_lo, y_hi = min(h["bbox"][1] for h in hdr), max(h["bbox"][3] for h in hdr)
        # split header into columns using word gaps (one span can hold two headers, e.g. "RS485 RS232")
        ws = sorted([w for w in words if y_lo - 2 <= (w[1] + w[3]) / 2 <= y_hi + 2 and x_min < w[0] < x_max],
                    key=lambda w: w[0])
        groups = []
        for w in ws:
            if groups and w[0] - groups[-1][-1][2] < 6:
                groups[-1].append(w)
            else:
                groups.append([w])
        headers = [clean(" ".join(w[4] for w in g)) for g in groups]
        centers = [(g[0][0] + g[-1][2]) / 2 for g in groups]
        if not headers:
            return None
        body = [s for s in cells if s["bbox"][1] > hy + 4 and not _bold(s) and "Medium" not in s["font"]
                and x_min <= s["bbox"][0] <= x_max and s["bbox"][1] < hy + 400]
        out_rows = []
        for _, ss in self._cluster_rows(body):
            r = [""] * len(headers)
            for s in ss:
                c = (s["bbox"][0] + s["bbox"][2]) / 2
                i = min(range(len(centers)), key=lambda k: abs(centers[k] - c))
                t = clean(s["text"])
                r[i] = clean((r[i] + " " + SYMBOLS.get(t, t)).strip())
            if any(r):
                out_rows.append(r)
        return {"headers": headers, "rows": out_rows} if out_rows else None

    # ---------- detailed page ----------
    def parse_detailed(self, n):
        out = DetailedData(title=self.pages[n - 1].title)
        with pdfplumber.open(self.path) as pdf:
            tables = pdf.pages[n - 1].extract_tables()
        for t in tables:
            hi = next((i for i, r in enumerate(t) if any(c and "ASPECT" in c for c in r)), None)
            if hi is None:
                continue
            hdr = t[hi]
            aspects = [i for i, c in enumerate(hdr) if c and "ASPECT" in c]
            details = [i for i, c in enumerate(hdr) if c and "DETAILS" in c]
            secs = []
            for k, a in enumerate(aspects):
                d = next((x for x in details if x > a), None)
                if d is None:
                    continue
                start = max(0, a - 1) if k == 0 else a - 1
                end = (aspects[k + 1] - 1) if k + 1 < len(aspects) else len(hdr)
                name = clean(hdr[a].replace("ASPECT", "")) or "SPECIFICATIONS"
                secs.append((name, range(start, d - 1), range(d - 1, end)))
            for name, kcols, vcols in secs:
                rows = out.sections.setdefault(name, [])
                for r in t[hi + 1:]:
                    k = next((clean(r[i]) for i in kcols if i < len(r) and r[i] and r[i].strip()), "")
                    v = next((clean(r[i]) for i in vcols if i < len(r) and r[i] and r[i].strip()), "")
                    if k:
                        rows.append([k, v])
                    elif v and rows:
                        rows[-1][1] = clean(rows[-1][1] + " " + v)
        return out
