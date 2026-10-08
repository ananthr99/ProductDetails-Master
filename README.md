# Product Content Hub

A web page (hosted on GitHub Pages) for agreeing one version of every product's content.
For each product it shows, side by side, what these four sources say:

| Column | Source | Where it lives in this repo |
|---|---|---|
| Website | product-selector JSON used on invendis.co.in | `inputs/website/` (`_index.json` + `products/*.json`) |
| Old Master | the old Master Catalogue (brief + detailed page) | `inputs/Master_Catalogue.pdf` |
| New Catalogue | the one-page catalogue from the catalogue tool | `inputs/catalogue/<NAME>/<NAME>_Catalogue.html` (+ `.pdf`) |
| Datasheet | product and per-variant datasheets | `inputs/datasheets/<folder>/*.pdf` |

A source that has no entry for a product is simply blank. The reviewer chooses a source for each line (or for the whole product), edits the final text, and approves. **Each approved record is saved as one JSON file**: `docs/approved/<product>.json` for the product (family) and `docs/approved/<product>/<PART>.json` for each variant.

---

## Using the page

1. **Pick a product** on the left. W M C D show which sources have it; the badge shows Not started / In progress / Approved.
2. **Pick the record** at the top: *Family (product page)* or one of the variants. Variant records show that variant's own datasheet, plus a *Family record* column once the family has been drafted or approved.
3. **Fill the Final column**
   - *Start from* a source → **Fill empty** (only empty cells) or **Replace all**.
   - Or click **Use** on any cell. When several datasheets disagree, each version is listed with the part numbers it came from; click the one you want.
   - Type in any Final cell to edit it. The tag below shows where it came from ("Datasheet, edited").
   - **Only where sources differ** shows just the lines that need a decision.
   - **Add a field** at the bottom of the table for anything none of the sources has.
4. **Ordering table** (family record): pick one source's table and edit it.
5. **Approve**: enter your name and click **Approve and save**.
   - Connected to GitHub → the file is committed to the repository and everyone sees it after the site rebuilds (about 1–2 minutes).
   - Not connected → the JSON file downloads (e.g. `rtxx__RT65-2.json`). Send it to whoever maintains the repository, or add it yourself (see below).

Drafts are saved automatically **in your browser only**. Use the same browser to continue, or approve to share.
**Download approved (zip)** collects every approved record into one zip.

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

**When names don't match** between sources (e.g. the Master Catalogue calls a product "IDF" and the website calls it "IDFxx"), add the pair to `tools/aliases.json` and push.

### Adding approved files by hand

Put the downloaded file in `docs/approved/` (variants in `docs/approved/<product>/<PART>.json`). Rename `rtxx__RT65-2.json` to `rtxx/RT65-2.json`, then add a line for it to `docs/approved/index.json`:

```json
{ "records": { "rtxx": { "file": "rtxx.json", "product_id": "rtxx", "part_number": null, "approved_by": "Ananth", "approved_at": "2026-10-08T10:00:00Z" } } }
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

```jsonc
{
  "schema": "invendis.product-content/v1",
  "record_id": "rtxx/RT65-2",
  "type": "variant",                       // or "family"
  "product_id": "rtxx",
  "product_name": "RTXX",
  "part_number": "RT65-2",                 // null for the family record
  "category": "Router",
  "content": {                             // section -> field -> final text (lists for use cases, tiles, badges)
    "Overview": { "Product name": "...", "Description": "...", "Use cases": ["..."] },
    "Hardware": { "CPU": "MediaTek MT7981", "RAM": "1GB" },
    "Physical": { "Enclosure": "Industrial Aluminium Enclosure" }
  },
  "provenance": { "Hardware::CPU": { "source": "datasheet", "edited": false } },
  "ordering": { "source": "website", "headers": ["..."], "rows": [["..."]] },   // family only
  "variants": ["RT00", "RT04-1"],                                               // family only
  "datasheet": { "file": "rtxx/rt65-2_Datasheet.pdf", "model": "RT65-2", "footer": "..." },  // variant only
  "notes": "...",
  "approved_by": "Ananth",
  "approved_at": "2026-10-08T10:00:00Z",
  "source_data_built": "2026-10-08T11:16:00+00:00"
}
```

Sections are always named the same way (Overview, Summary, Hardware, Interfaces, Power, Physical, Environmental, Cellular, Wi-Fi, Networking & Firewall, VPN, Remote Management, Operating System & Software, Gateway, Compliance, Packaging, Website filters). That makes the approved files a single source for the website JSON, the catalogue and the datasheets.

## How the sources are lined up

`tools/build_data.py` reads each source and maps every field name to a common name in a common section (`tools/canon.py`). For example "Input Power", "Input Voltage Range" and the website's `power` all become **Power › Input Voltage**, and "Dimensions (W × H × D)" and `dims` become **Physical › Dimensions**. Fields with no common name keep their own name. To line up more fields, add synonyms to `canon.py`.

- **Website:** the main fields, `additional_specs`, the selector filters (`cellular_gen`, `wifi`, `ports`, `rs485`, `rs232`), the variants table, and the datasheet links. Those links decide which PDF belongs to which part number.
- **Old Master:** the brief page (Summary section + ordering table) and the linked detailed page. Products are matched by name, then by part numbers, then by CPU model.
- **New Catalogue:** the HTML the catalogue tool writes next to each PDF, including title, description, tiles, badges, use cases and ordering.
- **Datasheets:** the standard Invendis datasheet layout. Sheets in a different layout (Intel boxes, meters, SILBO brochure) are flagged; their full text is under *datasheets: details & full text*, so you can copy from it.
