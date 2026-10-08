# Product Content Hub

A web page (hosted on GitHub Pages) for agreeing one version of every product's content.
For each product it shows, side by side, what these four sources say:

| Column | Source | Where it lives in this repo |
|---|---|---|
| Website | product-selector JSON used on invendis.co.in | `inputs/website/` (`_index.json` + `products/*.json`) |
| Old Master | the old Master Catalogue (brief + detailed page) | `inputs/Master_Catalogue.pdf` |
| New Catalogue | the one-page catalogue from the catalogue tool | `inputs/catalogue/<NAME>/<NAME>_Catalogue.html` (+ `.pdf`) |
| Datasheet | product and per-variant datasheets | `inputs/datasheets/<folder>/*.pdf` |

A source that has no entry for a product is simply blank.

The goal: **one final set of information per product (and per variant)**, then a decision on **where each piece appears** (website, catalogue, datasheet).

---

## Using the page

Pick a product on the left (W M C D show which sources have it). Each product has two steps.

### Step 1 · Final data

Everything the four sources say about the product, merged into one list.

- **Agreed**: the sources say the same thing, or only one source has it. Filled in for you; nothing to do.
- **Needs decision**: the sources disagree. Click the version that is right (each shows which sources say it), or type the correct value.
- **Per variant**: lines that differ between the variant datasheets (cellular, Wi-Fi, SIM, ports, size, weight…) get one value per variant, taken from each variant's own datasheet and editable. If a value contradicts what the variant has (e.g. Wi-Fi listed on a variant without Wi-Fi) the line needs a decision: **Set the flagged values to NA** or **The values are correct**. Use **↘ differs by variant** / **↖ same for all variants** to move a line between product level and variant level.
- **All information** shows every line, the **Variants** table (cellular, modems, Wi-Fi, RS485, RS232 per variant), the use cases and the highlights; **Add information** adds a line none of the sources has.

When nothing needs a decision, **Next: where it appears**.

### Step 2 · Where it appears

The final data with three tick boxes per line: **Website**, **Catalogue**, **Datasheet**. Defaults are pre-ticked (`tools/fields.json`); **all** ticks or clears a whole section.
For lines that differ by variant and are ticked for Website or Catalogue, write the **one line they show** (a suggestion such as “5G/4G” or “640–700 g” is filled in). Datasheets always show each variant's own value, and a variant without Wi-Fi or cellular gets no Wi-Fi or Cellular section.

**Preview** shows the website page, the catalogue page and each variant's datasheet content. **Checks** list what must be fixed first; **Fix these typos everywhere** corrects the known ones (“Single strength”, “Mannual”, …).
**Approve and save** writes the product file and one file per variant:
- connected to GitHub → one commit to `docs/approved/`, visible to everyone after the site rebuilds (1–2 minutes);
- not connected → `<product>_approved.zip`; unzip it into `docs/approved/` (see below).

Drafts are saved automatically **in your browser only**; **Discard draft** starts the product again. An approved product opens read-only; **Edit again** reopens it.

Top bar: **Approved files (zip)** collects every approved product. **Website JSON (zip)** builds one website product file per approved product in today's format (`desc`, `cpu`, `cellular_gen`, `variants`, …) plus a `full` block with every website section and each model's exact values.

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

Unzip `<product>_approved.zip` into `docs/approved/` (it holds `<product>.json` and, for products with variants, a `<product>/` folder with one file per variant), then add the product to `docs/approved/index.json`:

```json
{ "records": { "rtsxx": { "file": "rtsxx.json", "schema": "invendis.product-content/v3", "product_id": "rtsxx", "approved_by": "Ananth", "approved_at": "2026-10-09T10:00:00Z" } } }
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

**Product file**: `docs/approved/<product>.json`

```jsonc
{
  "schema": "invendis.product-content/v3",
  "product_id": "rtsxx", "name": "RTSXX", "category": "Router",
  "info": { "title": "...", "tagline": "...", "short_description": "...", "long_description": "..." },
  "use_cases": [ { "title": "...", "description": "..." } ],
  "highlights": { "key": [ { "value": "Dual", "label": "5G MODEMS", "icon": "signal" } ], "feature": [ { "label": "Made in India", "icon": "india" } ] },
  "specs": [
    { "section": "Hardware", "field": "RAM", "level": "product", "value": "1GB" },
    { "section": "Hardware", "field": "Wi-Fi", "level": "variant",
      "values": { "RTS04-1": "NA", "RTS65-2": "802.11 b/g/n/ac/ax" }, "summary": "802.11 b/g/n/ac/ax (RTS6x models)" }
  ],
  "variants": [ { "part": "RTS04-1", "cellular": "4G", "modems": 1, "wifi": "", "rs485": false, "rs232": false, "datasheet_source": "rtsxx/rts04-1_Datasheet.pdf" } ],
  "ordering": { "headers": ["Part Number", "Cellular", "Modems", "Wi-Fi"], "rows": [["RTS04-1", "4G", "Single", "—"]] },
  "placement": { "Hardware::RAM": "WCD", "Packaging::Standard Packaging": "D", "info::short_description": "W", "list::key_highlights": "C" },
  "notes": "...", "approved_by": "Ananth", "approved_at": "2026-10-09T10:00:00Z",
  "editor_state": { }                     // lets the tool reopen the product exactly as approved
}
```

`summary` is the one line the website and catalogue show for a line that differs by variant. `placement`: W website, C catalogue, D datasheet.

**Variant files**: `docs/approved/<product>/<PART>.json`, ready for the datasheet generator. Each holds that variant's complete final data (product-level lines plus its own values, without the Cellular or Wi-Fi section when the variant has none), with the placement of every line.

```jsonc
{ "schema": "invendis.product-content/v3", "type": "variant", "product_id": "rtsxx", "part_number": "RTS04-1", "product_file": "rtsxx.json",
  "info": { "title": "...", "long_description": "..." },
  "features": { "cellular": "4G", "modems": 1, "wifi": "", "rs485": false, "rs232": false },
  "specs": [ { "section": "Hardware", "field": "Wi-Fi", "value": "NA", "placement": "WCD" } ] }
```

Sections are always named the same way (Summary, Hardware, Interfaces, Power, Physical, Environmental, Cellular, Wi-Fi, Networking & Firewall, VPN, Remote Management, Operating System & Software, Gateway, Compliance, Packaging, Website filters).

## How the sources are lined up

`tools/build_data.py` reads each source and maps every field name to a common name in a common section (`tools/canon.py`). For example "Input Power", "Input Voltage Range" and the website's `power` all become **Power › Input Voltage**, and "Dimensions (W × H × D)" and `dims` become **Physical › Dimensions**. Fields with no common name keep their own name. To line up more fields, add synonyms to `canon.py`.

- **Website:** the main fields, `additional_specs`, the selector filters (`cellular_gen`, `wifi`, `ports`, `rs485`, `rs232`), the variants table, and the datasheet links. Those links decide which PDF belongs to which part number.
- **Old Master:** the brief page (Summary section + ordering table) and the linked detailed page. Products are matched by name, then by part numbers, then by CPU model.
- **New Catalogue:** the HTML the catalogue tool writes next to each PDF: title, tagline, description, Key and Feature Highlights (with their icons), use cases with descriptions, and specifications.
- **Variant features** (cellular, modems, Wi-Fi, RS485, RS232) come from the website's variants table, or the datasheet's Product Info box when the website has none.
- **Datasheets:** the standard Invendis datasheet layout. Sheets in a different layout (Intel boxes, meters, SILBO brochure) are flagged; their full text is under *datasheets: details & full text*, so you can copy from it.
