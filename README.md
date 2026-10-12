# Container Load Planner

Plan how cartons fit into a **20' GP, 40' HQ, 45' HQ container or a 53' truckload trailer**, and see the result in 3D.

A container rated at 65 CBM can be "full" at 60 CBM or still have room at 66 CBM. It depends on the carton sizes. This tool places every carton, so you know before booking.

**Live site:** `https://shubhammandotia.github.io/container-load-planner/

---

## How to use it

1. **Pick the equipment.** The CBM on each card is the rated capacity used for the % figures (20' = 28, 40' HQ = 65, 45' HQ = 72, 53' TL = 98). Select **Edit CBM & sizes** to change the rated CBM, payload or inside size of any container in one table. Changes are saved in your browser; *Reset all to standard* undoes them.
2. **Add cargo**, one line per carton type:
   - **Add SKU:** enter Units and Case Pack, and Cartons is calculated (Units ÷ Case Pack, rounded up). Or leave Units blank and type Cartons.
   - **Add nested carton:** several SKUs packed in one carton. Add each SKU with its units per carton (e.g. A ×2, B ×1, C ×1), then the number of cartons and the final carton size.
   - Enter the master carton **L × W × H** (inches by default; switch to cm at the top right) and, optionally, the weight per carton (lb by default).
   - **This side up** is off by default, so cartons may be laid on their side, which is how most of our containers are stuffed. Turn it on for cartons that must stay upright. **Stackable:** other cartons may go on top.
3. Press **Fill container** (or Ctrl + Enter).
4. Read the result:
   - % of rated CBM, cartons loaded, weight against payload, and floor length used.
   - What didn't fit, with an option to plan the rest into more containers.
   - **Stacking plan:** numbered steps from the front wall to the doors. Select a step or a SKU to highlight it in 3D.
   - **Loading sequence** slider and play button.
   - Exports: **PNG** of the 3D view, **stacking plan CSV**, and **Copy summary** for emails.

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
| This Side Up (Y/N) | Default N (carton may be laid on its side) |
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
SKU,Units,Case Pack,Cartons,Length (in),Width (in),Height (in),Weight per Carton (lb),This Side Up (Y/N),Stackable (Y/N),Nest Group
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

The planner fills the container from the front wall towards the doors in blocks of identical cartons. It tries several strategies and keeps the one that loads the most. Every carton sits fully on the floor or on other cartons, and orientation, stacking and payload limits are respected. A plan takes milliseconds.

It was checked against 119 real 40' HC containers from the shipment tracker, using product master carton sizes. It placed every carton in 117 of them, and was within about 1% on the other two. Real loads often run 66–72 CBM in a 40' HC. When the planner says it fits above 65 CBM, it is usually right, but there is little slack for loose stacking.

| File | What it does |
| --- | --- |
| `index.html`, `css/styles.css` | Page and styling (light and dark) |
| `js/app.js` | Screens, units, import/export, results |
| `js/packer.js` | Load-planning algorithm |
| `js/viewer.js` | 3D view (Three.js) |
| `js/containers.js` | Equipment sizes, payloads and rated CBM |
| `js/csv.js` | CSV reading and writing |
