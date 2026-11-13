# Container Load Planner

Plan how cartons fit into a **20' GP, 40' HQ, 45' HQ container, a 53' truckload trailer or a 48 × 40 pallet**, and see the result in 3D.

A container rated at 65 CBM can be "full" at 60 CBM or still have room at 66 CBM. It depends on the carton sizes. This tool places every carton, so you know before booking.

**Live site:** `https://<github-user>.github.io/container-load-planner/` (update this link after the first publish)

---

## How to use it

1. **Pick the equipment.** The CBM on each card is the rated capacity used for the % figures (20' = 28, 40' HQ = 65, 45' HQ = 72, 53' TL = 98, pallet = 2.08).
   - **Pallet 48×40:** a standard US pallet. The loaded pallet may stand **72 in tall including the 6 in pallet**, which leaves 66 in for cartons (shown as a dashed outline), payload 2,500 lb. All the same rules apply (up side, stackable, nesting). Turn on *Add more units when cargo overflows* to see how many pallets a shipment needs.
2. **Add cargo**, one line per carton type:
   - **Add SKU:** enter Units and Case Pack, and Cartons is calculated (Units ÷ Case Pack, rounded up). Or leave Units blank and type Cartons.
   - **Add nested carton:** several SKUs packed in one carton. Add each SKU with its units per carton (e.g. A ×2, B ×1, C ×1), then the number of cartons and the final carton size.
   - Enter the master carton **L × W × H** (inches by default; switch to cm at the top right) and, optionally, the weight per carton (lb by default).
   - **Up** picks which side of the carton must stand vertical: **L**, **W** or **H** (the chosen dimension is marked ↑ up). **Any**, the default, lets the carton go on any side, which is how most of our containers are stuffed. A carton with a fixed up side can still turn 90° on the floor. **Stackable:** other cartons may go on top.
3. Press **Fill container** (or Ctrl + Enter).
4. Read the result:
   - % of rated CBM, cartons loaded, weight against payload, and floor length used.
   - What didn't fit, with an option to plan the rest into more containers.
   - Volume by carton type, weight balance between the front half and the door half, and a warning when the cargo is heavier than the usual US road limit.
   - **Stacking plan:** numbered steps from the front wall to the doors. Select a step or a SKU to highlight it in 3D.
   - **Loading sequence** slider and play button, and **Look inside** to peel cartons away from the side, top or door end.
   - A ruler along the floor shows distance from the front wall and how much length the load uses. Keys 1 to 4 switch between the 3D, top, side and door views.
   - Exports: **PDF** load plan, **stacking plan CSV**, and **Copy summary** for emails.
5. **PDF:** select **PDF** in the 3D toolbar or **Download PDF** under the results. It includes:
   - a summary page with the figures and a large 3D view
   - top, side and door views with a colour key
   - the cargo table and the step-by-step stacking plan
   - one set of pages per container when cargo spills into more than one unit

   Type a **Reference** (PO #, container # or note) under Load options to print it on every page.

Your cargo list and settings are saved in your own browser. Nothing is uploaded anywhere.

Works on phones, tablets (portrait and landscape), laptops and large monitors. On touch screens, drag to rotate, pinch to zoom and tap a carton to see its details.

## Importing cargo from a CSV

Use **Blank template** to download an empty CSV with the right columns. Fill it in Excel, save as CSV, then use **Import CSV** (you can also paste rows straight from Excel). **Export cargo** downloads the current list in the same format, so you can edit it and import it again.

| Column | Notes |
| --- | --- |
| SKU | Item number |
| Units | Total units. Optional if Cartons is filled in |
| Case Pack | Units per carton |
| Cartons | Leave blank to calculate from Units ÷ Case Pack |
| Length, Width, Height | Carton size. The header says the unit, e.g. `Length (in)` or `Length (cm)` |
| Weight per Carton | Optional. `(kg)` or `(lb)` in the header |
| This Side Up (L/W/H/N) | Which side stands vertical: `L`, `W` or `H` (`Y` also means H). Blank or `N` = any side |
| Stackable (Y/N) | Default Y |
| Nest Group | Rows with the same value are packed together in one carton |

### Nested cartons in the CSV

A nested carton is several SKUs packed in one master carton. In the CSV you write **one row per SKU** and tie the rows together with a **Nest Group** code.

**How to make a Nest Group code:** any text works, as long as every SKU in the same carton has the same code and different cartons have different codes. The easiest is the shared SKU root: `NAF2580` for NAF2580L + NAF2580S, or `NTB4827` for NTB4827A + NTB4827B. For mixed sets, use something like `SET-01`, `SET-02`.

For each row of a nested carton:

- **SKU:** the SKU inside the carton.
- **Case Pack:** units of that SKU in **one** nested carton.
- **Units:** total units of that SKU being shipped (Cartons = Units ÷ Case Pack). Or leave Units blank and put the number of nested cartons in **Cartons**.
- **Length, Width, Height, Weight:** the master carton's size, needed on the first row of the group only.
- **Nest Group:** the code.

Example: 80 cartons that each hold SKU-A ×2, SKU-B ×1 and SKU-C ×1 in a 24 × 24 × 19 in carton:

```
SKU,Units,Case Pack,Cartons,Length (in),Width (in),Height (in),Weight per Carton (lb),This Side Up (L/W/H/N),Stackable (Y/N),Nest Group
SKU-A,160,2,,24,24,19,24,N,Y,SET-01
SKU-B,80,1,,,,,,,,SET-01
SKU-C,80,1,,,,,,,,SET-01
```

The import window shows a **preview** before anything is added, and warns when a group's SKU quantities don't come to the same number of cartons, or when a code appears on only one row.

There is a full example in [`examples/sample-cargo.csv`](examples/sample-cargo.csv).

**From the product master:** copy rows from the *Home Decor* sheet, including the header row, and paste them into Import. `Case Pack`, `Package Length / Width / Depth` and `Package Weight (Lbs)` are picked up automatically (package sizes win over product sizes). Then fill in Units or Cartons on each line. For nested SKUs, add a `Nest Group` column, or use **Add nested carton**.

## Get a copy (clone)

You need [Git](https://git-scm.com/downloads) and [Python 3](https://www.python.org/downloads/) (used only to serve the files locally).

```bash
git clone https://github.com/<github-user>/container-load-planner.git
cd container-load-planner
python -m http.server 8000
```

Open http://localhost:8000. Opening `index.html` by double-clicking won't work, because browsers block the 3D modules from `file://`.

## Publish on GitHub Pages (first time)

1. On GitHub, create a new empty repository called `container-load-planner`.
2. From this folder:
   ```bash
   git init
   git add .
   git commit -m "Container Load Planner"
   git branch -M main
   git remote add origin https://github.com/<github-user>/container-load-planner.git
   git push -u origin main
   ```
3. On GitHub, go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute or two the site is live at `https://<github-user>.github.io/container-load-planner/`. Anyone with the link can use it.

**Updating:** commit and push to `main`, and Pages republishes automatically.

**Custom domain later:** add the domain under **Settings → Pages → Custom domain**, create a `CNAME` DNS record pointing to `<github-user>.github.io`, then tick **Enforce HTTPS**.

## Changing the defaults

Standard container sizes, payloads and rated CBM are in [`js/containers.js`](js/containers.js). Edit them there to change the defaults for everyone.

## How the planning works

The planner fills the unit from the front wall towards the doors in blocks of identical cartons. It tries several strategies, then keeps searching with small variations while cartons are left over, and uses the plan that loads the most. The same cargo always gives the same plan. Every carton sits fully on the floor or on other cartons, must be able to pass through the door opening, and orientation, stacking and payload limits are respected.

It was checked against 119 real 40' HC containers from the shipment tracker, using product master carton sizes. It placed every carton in 118 of them. Real loads often run 66 to 72 CBM in a 40' HC. When the planner says it fits above 65 CBM, it is usually right, but there is little slack for loose stacking.

### Equipment sizes

Inside sizes are the standard published figures (carrier and lessor tables for ISO containers, manufacturer listings for 53' vans). Individual units differ by a few millimetres, so every value can be changed under **Edit CBM & sizes**.

| Unit | Inside L × W × H | Door opening W × H | Payload | US road guide |
| --- | --- | --- | --- | --- |
| 20' GP | 5,898 × 2,352 × 2,393 mm | 2,340 × 2,280 mm | 28,200 kg | 38,000 lb |
| 40' HQ | 12,032 × 2,352 × 2,698 mm | 2,340 × 2,585 mm | 26,580 kg | 44,000 lb |
| 45' HQ | 13,556 × 2,352 × 2,698 mm | 2,340 × 2,585 mm | 27,700 kg | 44,000 lb |
| 53' TL | 630 × 100 × 110 in | 98 × 105 in | 45,000 lb | (same) |
| Pallet | 48 × 40 in, 72 in tall with pallet | n/a | 2,500 lb | n/a |

## Security and privacy

- **Nothing is uploaded.** All planning runs in the visitor's browser. Cargo lists and settings are saved only in that browser.
- **No third-party code or requests.** The 3D engine, PDF library and fonts are served from this repository (`vendor/`, `fonts/`), so the site makes no calls to other servers.
- **Content Security Policy.** `index.html` only allows scripts, styles, fonts and images from the site itself. Injected or inline scripts won't run.
- **Input checks.** Saved data, CSV files and pasted rows are cleaned before use, text is always escaped when shown, and size limits stop an oversized file or a mistyped quantity from freezing the page.
- **Safe CSV exports.** Cells that Excel would treat as formulas are neutralised.
- **`_headers`** adds the full set of security headers on hosts that support it (Cloudflare Pages, Netlify). GitHub Pages ignores it and relies on the policy in `index.html`.

On GitHub, also turn on **Settings → Pages → Enforce HTTPS**, and two-factor sign-in on your account.

| File | What it does |
| --- | --- |
| `index.html`, `css/styles.css` | Page and styling (dark and light) |
| `js/app.js` | Screens, units, import/export, results |
| `js/packer.js` | Load-planning algorithm |
| `js/viewer.js` | 3D view (Three.js) |
| `js/containers.js` | Equipment sizes, payloads and rated CBM |
| `js/csv.js` | CSV reading and writing |
| `js/report.js` | PDF load plan |
| `js/theme.js` | Applies the saved dark or light theme before the page shows |
| `vendor/` | Three.js 0.160, OrbitControls, jsPDF 2.5.1, jsPDF-AutoTable 3.8.2 (MIT licences) |
| `fonts/` | Zalando Sans and Roboto Mono (SIL Open Font and Apache licences) |

Made by Shubham Mandotia.
