# Product Content Hub

A web page (hosted on GitHub Pages) for agreeing one version of every product's content.
For each product it shows, side by side, what these four sources say:

| Column | Source | Where it lives in this repo |
|---|---|---|
| Website | product-selector JSON used on invendis.co.in | `inputs/website/` (`_index.json` + `products/*.json`) |
| Old Master | the old Master Catalogue (brief + detailed page) | `inputs/Master_Catalogue.pdf` |
| New Catalogue | the one-page catalogue from the catalogue tool | `inputs/catalogue/<NAME>/<NAME>_Catalogue.html` (+ `.pdf`) |
| Datasheet | product and per-variant datasheets | `inputs/datasheets/<folder>/*.pdf` |

A source that has no entry for a product is simply blank. Each product family is agreed **once**, in three steps, and saved as JSON files that become the single source for the website, the catalogue and the datasheets.

---

## Using the page

Pick a product on the left (W M C D show which sources have it). The product opens on three tabs:

**1 · Family content**: everything that is the same for every variant.
- **Text**: title, tagline, short description (website) and long description (catalogue + datasheet). Click a source to use it, then edit.
- **Use cases**: title + description. The website shows the titles, the catalogue shows both. *Load from New Catalogue* or *Load titles from Website* (descriptions already written for the same title are kept).
- **Catalogue only: highlights**: Key Highlights (tiles, up to 5) and Feature Highlights (badges, up to 4), with icons from the catalogue tool.
- **Shared specifications**: one line per field with the Website, Old Master, New Catalogue and Datasheet values side by side. *Start from* a source (**Fill empty** / **Replace all**), or **Use** a single cell, then edit the Final column. **W C D** on each line set where it appears; click to change. **↘ varies** moves a line to the Variant table.

**2 · Variant table** (families with more than one variant)
- **What each variant has**: cellular (4G/5G), modems, Wi-Fi, RS485, RS232. These build the ordering table and the website filters, and decide which sections each datasheet includes: a variant without Wi-Fi gets no Wi-Fi section.
- **Specifications that differ by variant**: one column per variant, pre-filled from that variant's own datasheet (pale until edited). The **Family value** column is what the website and catalogue show ("5G/4G", "640–700 g"). It is suggested from the variant values until you edit it, and flagged if the variants change afterwards. Cells that contradict the variant's features are red (e.g. Wi-Fi listed on a variant without Wi-Fi). **↖ shared** moves a line back to the family.

**3 · Preview & approve**
- **Website**, **Catalogue** and **Datasheet** (per variant) previews show exactly what each output will contain. The website preview has a *Select model* switch.
- **Checks** list what must be fixed (empty text, missing family values, contradicting cells, placeholder text, too many highlights) and what to review (typos, repeated words, variants without a datasheet). *Fix these typos everywhere* corrects the known ones ("Single strength", "Mannual", …). Approve is disabled while anything must be fixed.
- **Approve and save** writes all files for the family at once:
  - connected to GitHub → one commit to `docs/approved/`, visible to everyone after the site rebuilds (1–2 minutes);
  - not connected → `<product>_approved.zip`; unzip it into `docs/approved/` (see below).

Drafts are saved automatically **in your browser only**; **Discard draft** starts the product again. An approved product opens read-only; **Edit again** reopens it.

Top bar: **Approved files (zip)** collects every approved product. **Website JSON (zip)** builds one website product file per approved product in today's format (`desc`, `cpu`, `cellular_gen`, `variants`, …) plus a `full` block with every section, the use cases and each model's exact values.

### Connecting to GitHub (to save approvals directly)

Each person who approves needs their own token:

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token.
2. Repository access: **Only select repositories** → this repository.
3. Permissions → Repository permissions → **Contents: Read and write**.
4. On the page, click **GitHub**, check owner / repository / branch, paste the token, enter your name, **Save and test**.

The token is stored only in that browser. Click **Disconnect** to remove it.

---

## Setting up the repository (once)

1. Create a repository (e.g. `product-content-hub`) and push this folder to the `main` branch.
2. Repository → Settings → **Pages** → Build and deployment → Source: **GitHub Actions**.
3. The workflow `.github/workflows/pages.yml` runs on every push. It reads `inputs/`, builds `docs/data/` and publishes `docs/`. The site appears at `https://<owner>.github.io/<repo>/`.

> **Visibility:** GitHub Pages sites are public, even from a private repository, unless your organisation is on GitHub Enterprise Cloud with private Pages. Everything in `docs/` is readable by anyone with the link: the source PDFs, the comparison data and the approved JSON (including notes). Keep internal-only material out of `inputs/`, or use private Pages.

### Updating a source

Replace the files in `inputs/` and push. For example, put new datasheets in `inputs/datasheets/`, or drop in a fresh `productSelector` export. The workflow rebuilds the comparison data. Approved records and browser drafts are not touched.

**Leaving a source out:** either delete its folder or file from `inputs/`, or keep the files and change the build line in `.github/workflows/pages.yml` to `run: python tools/build_data.py --skip catalogue`. You can skip more than one, comma-separated, from `website`, `master`, `catalogue` and `datasheets`. The skipped source's column disappears from the page, and approved records are not affected. Remove `--skip` to bring the source back.

**When names don't match** between sources (e.g. the Master Catalogue calls a product "IDF" and the website calls it "IDFxx"), add the pair to `tools/aliases.json` and push.

### Adding approved files by hand

Unzip `<product>_approved.zip` into `docs/approved/` (it holds `<product>.json` and, for families, a `<product>/` folder with one file per variant), then add the product to `docs/approved/index.json`:

```json
{ "records": { "rtsxx": { "file": "rtsxx.json", "product_id": "rtsxx", "approved_by": "Ananth", "approved_at": "2026-10-09T10:00:00Z" } } }
```

### Running it on your own computer

```bash
pip install -r tools/requirements.txt
python tools/build_data.py          # reads inputs/, writes docs/data and docs/sources
cd docs && python -m http.server 8000
# open http://localhost:8000
```

---

## The approved JSON

**Family file**: `docs/approved/<product>.json`

```jsonc
{
  "schema": "invendis.product-content/v2",
  "product_id": "rtsxx", "name": "RTSXX", "category": "Router",
  "text": { "title": "...", "tagline": "...", "short_description": "...", "long_description": "..." },
  "use_cases": [ { "title": "...", "description": "..." } ],
  "catalogue": {
    "key_highlights":     [ { "value": "Dual", "label": "5G MODEMS", "icon": "signal" } ],
    "feature_highlights": [ { "label": "Made in India", "icon": "india" } ]
  },
  "specs": { "Hardware": { "RAM": "1GB" } },                     // shared by every variant
  "variant_specs": {                                              // lines that differ
    "Hardware::Wi-Fi": { "section": "Hardware", "field": "Wi-Fi", "family": "802.11 b/g/n/ac/ax (RTS6x models)",
                         "values": { "RTS04-1": "NA", "RTS65-2": "802.11 b/g/n/ac/ax" } }
  },
  "variants": [ { "part": "RTS04-1", "cellular": "4G", "modems": 1, "wifi": "", "rs485": false, "rs232": false, "datasheet": "rtsxx/rts04-1_Datasheet.pdf" } ],
  "ordering": { "headers": ["Part Number", "Cellular", "Modems", "Wi-Fi"], "rows": [["RTS04-1", "4G", "Single", "—"]] },
  "show_on": { "Hardware::RAM": "WCD", "Packaging::Standard Packaging": "D", "text::short_description": "W" },
  "provenance": { "Hardware::RAM": { "source": "datasheet", "edited": false } },
  "notes": "...", "approved_by": "Ananth", "approved_at": "2026-10-09T10:00:00Z",
  "editor_state": { }                                             // lets the tool reopen the product exactly as approved
}
```

**Variant files**: `docs/approved/<product>/<PART>.json`, ready for the datasheet generator. Each holds that variant's complete specifications: shared lines plus its own values, only lines marked **D**, and without the Cellular or Wi-Fi section when the variant has none.

```jsonc
{ "schema": "invendis.product-content/v2", "type": "variant", "product_id": "rtsxx", "part_number": "RTS04-1", "inherits": "rtsxx.json",
  "text": { "title": "...", "long_description": "..." },
  "features": { "cellular": "4G", "modems": 1, "wifi": "", "rs485": false, "rs232": false },
  "specs": { "Hardware": { "CPU": "...", "Wi-Fi": "NA" }, "Cellular": { "Cellular Module": "..." } } }
```

**W / C / D** (`show_on`): W website, C catalogue, D datasheet. Defaults per section and field are in `tools/fields.json`; reviewers can change them per product.

Sections are always named the same way (Summary, Hardware, Interfaces, Power, Physical, Environmental, Cellular, Wi-Fi, Networking & Firewall, VPN, Remote Management, Operating System & Software, Gateway, Compliance, Packaging, Website filters).

## How the sources are lined up

`tools/build_data.py` reads each source and maps every field name to a common name in a common section (`tools/canon.py`). For example "Input Power", "Input Voltage Range" and the website's `power` all become **Power › Input Voltage**, and "Dimensions (W × H × D)" and `dims` become **Physical › Dimensions**. Fields with no common name keep their own name. To line up more fields, add synonyms to `canon.py`.

- **Website:** the main fields, `additional_specs`, the selector filters (`cellular_gen`, `wifi`, `ports`, `rs485`, `rs232`), the variants table, and the datasheet links. Those links decide which PDF belongs to which part number.
- **Old Master:** the brief page (Summary section + ordering table) and the linked detailed page. Products are matched by name, then by part numbers, then by CPU model.
- **New Catalogue:** the HTML the catalogue tool writes next to each PDF: title, tagline, description, Key and Feature Highlights (with their icons), use cases with descriptions, and specifications.
- **Variant features** (cellular, modems, Wi-Fi, RS485, RS232) come from the website's variants table, or the datasheet's Product Info box when the website has none.
- **Datasheets:** the standard Invendis datasheet layout. Sheets in a different layout (Intel boxes, meters, SILBO brochure) are flagged; their full text is under *datasheets: details & full text*, so you can copy from it.
