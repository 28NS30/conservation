# Plan: crisp map, then launch

Written 2026-08-05. Split by who has to do it.

---

## Part 0 — Why the map is blurry, honestly

I tuned this twice and both times I changed the wrong thing.

MapLibre's `heatmap` layer type is a **kernel density estimate**: every point is
splatted as a Gaussian blob, the blobs are summed, and the sum is colour-mapped.
The blur is not a setting I got wrong — it is the definition of the layer. The
knobs I reached for (`heatmap-radius`, `heatmap-weight`, `heatmap-intensity`)
only trade *how* blurry against *how saturated*. There is no combination that
makes it sharp, because a sharp KDE is a contradiction.

Making the aggregation grid 4× finer (the first fix) genuinely helped — it raised
the information content of the underlying data — but it was still being rendered
through a blur, so it could only ever go from "featureless blob" to "slightly
better blob".

**The fix is to stop using the heatmap layer.** Aggregation into cells already
happens server-side; the cells just need to be drawn as themselves — discrete
shapes with hard edges and a stepped colour scale — instead of being converted
into a smear.

A side benefit: this also deletes the whole `tune:heatmap` maintenance problem
(see §4 of `remaining-work.md`). Continuous kernel density has to be re-fitted
whenever the dataset grows because density is a *sum of overlapping kernels*.
Discrete class breaks on an absolute per-cell count do not — "this cell holds
16–31 reports" means the same thing at 46k records as at 460k.

Rendered comparison at z6.35 (real data, 46,334 records) is in the session; the
short version is that square and hex bins both resolve the west-coast road
corridors, the Highway 9/11 line and the empty mountain spine as crisp structure,
where the heatmap shows one red mass.

---

## Part 1 — What I can do

### 1.1 Replace the heatmap with binned cells — **DONE (2026-08-05)**

Shipped as square bins. Tile endpoint emits cell polygons; `HeatmapView` and
`SpeciesMap` both draw `fill` layers with stepped colour; the legend lists real
counts; cells are clickable and report their count; `AGGREGATION_CELLS_PER_TILE`
dropped to 128 so cells render at 4px rather than 2px; `tune:heatmap` and the
whole re-fitting problem are deleted. `apps/web/test/map-bins.test.mjs` fails if
a heatmap layer is reintroduced.

Extended the same day with a **bins/dots toggle**: aggregated tiles now carry
both cell polygons and cell centroids as two layers in one MVT, so switching is a
visibility flip with zero refetches. Dot area scales with the count (radius on
sqrt), the legend redraws itself at the real circle sizes, and the choice
persists. Then extended again so the aggregation **keeps subdividing until it
converges on individual reports**: `TILE_AGGREGATION_MAX_ZOOM` is 13 (73% of
cells hold exactly one report by then), both regimes size symbols from one shared
ramp, and the aggregate source is capped so its last tile overzooms and covers
the moment the point tiles load. Measured on a continuous wheel zoom from z9 to
z16: no blank frames, and the worst frame-to-frame change in painted area is
1.3x. 111 tests pass.

The original plan, for reference:

**Tile endpoint** (`apps/web/app/api/tiles/[z]/[x]/[y]/route.ts`)
- At z ≤ 9, emit each aggregation cell as a **polygon** rather than a centroid.
  Squares come free from the existing `ST_SnapToGrid` path (`ST_MakeEnvelope`
  around the snapped corner, measured at **43 ms**). Hexagons need
  `ST_HexagonGrid` + a spatial join (measured at **554 ms** for equal-area
  cells) — still fine behind CDN caching, but 13× the cost and it scales worse.
- Keep the `weight` property exactly as-is, so the existing
  weight-conservation test still applies unchanged.
- Watch payload: the current points tile is 67 KB; polygons will be larger.
  Mitigate with `ST_AsMVTGeom` quantisation and, if needed, a slightly coarser
  grid — which is fine now, because crisp cells no longer need to be tiny to
  avoid looking dotty.

**Map layer** (`components/map/HeatmapView.tsx`)
- Replace the `heatmap` layer with a `fill` layer using a `step` colour
  expression over discrete class breaks.
- Delete `heatmap-radius`, `heatmap-weight`, `heatmap-intensity`,
  `heatmap-opacity` and the percentile comment block entirely.
- Re-pick cell size so cells land ~6–10 px on screen instead of the current
  2–4 px. Small cells were a workaround for blending; crisp cells want to be
  legible individually.
- Handle fill seams: adjacent polygons can show hairline gaps or double-blended
  edges depending on antialiasing. Needs checking in a real browser at several
  zooms — likely `fill-antialias: false`, or a sub-pixel outline in the same
  colour.

**Everything downstream of that**
- `components/species/SpeciesMap.tsx` — has its own independent paint and must be
  converted too. This is the file that silently broke last time the grid changed.
- **Legend** — currently a continuous gradient bar, which will be a lie once the
  scale is stepped. Becomes discrete swatches with real numbers ("1–3", "4–15",
  …). More honest than the gradient was, since a viewer can now read a value off
  the map instead of guessing.
- **Interaction** — cells become hoverable/clickable to show their count and
  drill into that area. A blurred KDE fundamentally cannot support this; a cell
  can. This is the part I think you'll actually feel day to day.
- **Tests** — weight conservation carries over untouched. The
  `heatmap-tuning.test.mjs` tripwire gets rewritten around class breaks and cell
  size. Add: cells tile without gaps or overlaps; class breaks are monotonic and
  cover the full range.
- **Delete** `scripts/tune-heatmap.ts`, its npm scripts, and §4 of
  `remaining-work.md` — the drift problem stops existing.
- **Re-verify** at z5/6/8/9 and across the z10 handoff to individual points, with
  screenshots, plus the privacy tests (obscured points sit at privacy-cell
  centres and will fall into bins — same exposure as today, but it must be
  re-checked rather than assumed).

**Decision needed from you:** squares vs hexagons vs graduated circles. See the
question at the end — this changes the query strategy, not just the CSS.

### 1.1b Done alongside it (2026-08-05)

- **Shareable map URLs.** The map syncs centre, zoom and filters to the address
  bar via `history.replaceState` — measured at zero server refetches and no
  history-stack growth. Deep links restore the exact view and filter.
- **`e2e/pages.spec.mjs`**, now in CI: every page in both locales, checking for
  unresolved translations (which render as their own key path and return 200),
  uncaught client exceptions, 5xx responses, silently-dropped map layers, and
  map-page tab order.
- **Accessibility fix.** The "view as list" skip link now precedes the map canvas
  in tab order, and `/reports` honours the full filter set so it is a real
  equivalent rather than a partial one.

### 1.1c Also done (2026-08-05)

- **Admin authorisation pinned.** Every exported server action re-checks the
  caller's role — a server action is a public HTTP endpoint, so gating the page
  that links to it is not authorisation. `test/admin-auth.test.mjs` fails if a new
  action is added without the guard, which is the realistic way this breaks.
- **Species search announces its results** through a polite live region. It stays
  a plain list of buttons rather than an ARIA combobox: Tab reaches each
  suggestion and Enter selects it, and a half-built combobox would announce a
  listbox that does not behave like one.

### 1.2 Everything else in the backlog I can finish alone

| | Work | Notes |
|---|---|---|
| a | **Administrative boundaries** | `/stats` hotspots currently read `23.045°N, 120.127°E` because there is no county/township geometry to name them with. Importing 縣市/鄉鎮 boundaries makes hotspots readable *and* enables county filtering on the map. Needs downloading an open government dataset — I'd want to confirm the licence before adding it. |
| b | **OG images** | Species and report pages have no share previews. Caveat: `next/og` has no CJK font built in, so Chinese renders as blank boxes unless a font subset is embedded. Latin-only is easy; doing it properly for a Taiwanese audience needs a subsetted font (~few hundred KB). |
| c | **NLSC basemap toggle** | 國土測繪中心 layer as an alternative to CARTO. |
| d | **Backup script** | `pg_dump` to a file, documented. Real value only once there is user data, and production is better served by Supabase PITR — low priority. |
| e | **Re-run the eval** | If you get real roadkill photos (§2.4), I re-fit both confidence bands and re-test MegaDetector cropping, which the current eval set structurally cannot assess. |

### 1.3 What I will *not* do without you saying so

- `git init` and a first commit (§2.1).
- Anything that publishes outward: uploading to GBIF, contacting 路殺社,
  registering domains.

---

## Part 2 — What only you can do

### 2.1 Version control — the biggest risk on this list
There is no `.git` directory. Weeks of work, no history, no way to revert, and
the CI workflow can never run. I hit this myself today: re-applying migration
`0004` out of order silently recreated a view that `0006` redefines and reverted
a filter. Tests caught it, but with git it would have been a one-line diff.

Say the word and I'll `git init`, write a sensible first commit, and confirm
`.gitignore` covers `data/` (575 MB) before anything is staged. Pushing anywhere
is a separate decision.

### 2.2 Secrets and accounts — all four are currently empty
| Variable | Consequence of leaving it empty |
|---|---|
| `CRON_SECRET` | `/api/jobs/classify` is closed in production by default, so this fails *safe* — the worker 401s and jobs queue up unclassified. Nothing leaks, but nothing gets identified either. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` | Bot protection on submission is skipped entirely. Fine locally; **do not launch publicly without it.** |
| `NEXT_PUBLIC_MAPTILER_KEY` | Basemap falls back to CARTO raster, whose labels are **English**. For a Taiwanese audience that is a real quality gap — 台中 currently reads "TAICHUNG". |

### 2.3 Publishing to GBIF
The exporter is built and tested. What is left is not code: fill in the real
`DATASET` homepage and contact email in `scripts/export-dwca.ts`, register a
publisher account or IPT, and upload. It currently emits zero rows, which is
correct — every record present was imported *from* GBIF and is deliberately
excluded.

### 2.4 Real roadkill photos
The single most valuable thing for accuracy, and I cannot get it. Every accuracy
number in the README is measured on 308 iNaturalist images — live, well-framed
animals filling the frame. Real roadkill is dead, damaged, distant, against
asphalt. The figures are an optimistic upper bound for the exact category this
project exists to serve, and it is why MegaDetector cropping measured *worse*
(it strips context these photos have and removes background they don't).
TaiRON publishes no images to GBIF, so this needs either a direct request to
路殺社 or the site's own submissions accumulating.

### 2.5 Launch prerequisites
- **Talk to 路殺社 / TBIA** before launching. They have a decade of expert
  verification. Complement them, don't compete.
- **Legal**: privacy policy contact details and a look at 個人資料保護法 (PDPA)
  compliance — you collect location and optionally email.
- **Domain**, and a decision on whether reports are CC BY (what the exporter
  currently declares).
- **Moderation capacity.** If submissions take off, expert verification is the
  bottleneck, not compute. Worth deciding who does it before you need it.

---

## Sequencing

1. You pick a cell style → I do §1.1 end to end, with screenshots at each zoom.
2. In parallel, you decide on git (§2.1) — it blocks nothing but protects
   everything.
3. Then §1.2 in whatever order you care about, while you work through §2.2.
4. §2.3–2.5 are launch-gated and can wait.
