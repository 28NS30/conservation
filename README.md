# 福爾摩沙守望計畫 · FormosaWatch

A citizen-science platform for Taiwan: anyone can report roadkill, an invasive species,
an injured animal or a wildlife sighting; an open-source model identifies the species;
everyone sees a public map. Locations of protected species are coarsened before they are
published.

Named HabitatWatch until September 2026. FlamaWatch, in Atlántico, Colombia, is a separate
project that promotes alongside this one; its site is its own.

**Status: M1–M3 complete, bilingual, with species pages and offline submission.** Schema, species checklist, open-data
seed, vector-tile heatmap, the full reporting flow (submission, photo upload, auth,
moderation), and species identification end-to-end — classifier, embeddings, job queue,
worker, and confirm/correct UI. Species pages and an offline submission queue are in. Measured accuracy is below.
Remaining before launch: deploy the model to Modal.

---

## Quickstart

Local development runs the real Supabase stack, so auth and Storage behave exactly as they
do in production.

```bash
npm install
cp .env.example .env
ln -s ../../.env apps/web/.env   # next dev reads env from its own directory, not the repo root
supabase start         # Postgres+PostGIS, Auth, Storage, Studio; applies all migrations
npm run import:taicol  # ~125k taxa from TaiCOL (~4 min)
npm run import:gbif    # TaiRON roadkill records from GBIF
npm run dev            # http://localhost:3000
```

> The symlink is not optional and its absence is confusing rather than obvious.
> Everything except the web app reads the root `.env` directly — the scripts,
> the migration runner, the test helpers — but `next dev` only loads `.env` from
> the directory holding `next.config.ts`. Without it the site starts, serves
> most pages, and throws `NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are not set` on
> the handful that ask who is signed in. Both files are gitignored.

| URL | What |
|---|---|
| http://localhost:3000 | The map |
| http://localhost:3000/report | Submit a report |
| http://localhost:3000/admin | Moderation queue (needs a moderator role, see below) |
| http://localhost:54323 | Supabase Studio |
| http://localhost:54324 | Mailpit — magic-link emails land here in local dev |

To give yourself moderator access: sign in at `/login`, then

```bash
supabase db reset      # only if you want a clean slate; wipes data
```
```sql
update profiles set role = 'admin' where id = '<your-user-id>';
```

`/admin` shows your user id when you visit it without the role.

**Dev gotcha:** `supabase db reset` restarts the database container, which invalidates the
connection pool the Next dev server caches on `globalThis`. Restart `npm run dev` after a
reset or you'll get `CONNECT_TIMEOUT`.

`npm run import:gbif -- --limit 3000` imports a small slice if you just want something on
the map quickly. `-- --all` additionally pulls country-wide Taiwan occurrences.

GBIF drops connections during long sequential paging, so the importer retries with backoff
and — if a page still fails — records the offset, keeps going, and reports the gaps at the
end. Inserts are keyed on `(source, source_id)`, so **just run it again to fill gaps**;
already-imported records are skipped.

---

## Species pages

`/species` is a directory and `/species/[id]` a detail page, with
`/api/species/search` backing autocomplete.

Two data facts drive the design, and both are easy to get wrong:

- **Only 354 of 66,201 species have any records** (max 2,400, average 41, and 73
  with exactly one). The directory therefore defaults to species that actually
  have data, and `generateStaticParams` pre-renders only those — statically
  generating 66k mostly-empty pages would be absurd.
- **The record display branches on volume.** 6+ records get a heatmap, 1–5 get
  plotted points and a list, 0 gets a designed empty state. A density surface
  built from one point is noise.

Conservation fields are sparse (308 species have a protection level, 6,977 an
IUCN category, and 30% have no Chinese name), so every badge is conditional and
`StatusBadges` renders nothing at all when a species has no status.

**Privacy:** record counts come from `species_report_stats`, which is built on
`reports_public`. Counting from the base table would leak the record volume of
座標不開放 taxa. Those species show an explicit "coordinates are not published"
note rather than a misleading "0 records" — that reveals nothing usable, since
TaiCOL already publishes which species occur in Taiwan.

**Chinese search is deliberately a sequential scan.** `pg_trgm` needs three
characters to form a trigram, but Chinese species names are typically searched
with two (石虎, 山羌), so the index cannot help. Measured at ~18 ms over 125k
taxa, which is fine for debounced input — see `0005_taxa_search.sql`.

## Offline submission

Reports can be filed with no signal and are sent when connectivity returns.

The crux: submission is **three network steps** — sign, upload photos, post the
report — so the queue holds the raw *inputs* and runs the whole pipeline at flush
time. Pre-signing upload URLs at queue time would not work; they are short-lived
and a report queued overnight would flush against an expired one.

- `lib/offline/queue.ts` — IndexedDB store; photos are kept as Blobs
- `lib/offline/flush.ts` — the pipeline, with partial-upload resume
- `public/sw.js` — runtime caching so `/report` opens with no connection

**Idempotency was already solved**: `clientNonce` has a unique index and the API
returns `{ duplicate: true }`, so retrying after an ambiguous timeout is safe.
The one change needed was moving nonce generation from form-mount to queue time
so every retry of a given report reuses it.

**Background Sync is Chromium-only.** Safari and iOS do not implement it, and iOS
share in Taiwan is high, so the mechanism that actually carries the feature is
"flush when the user next opens the app". The UI says exactly that rather than
implying reports send themselves, and `app/manifest.ts` makes the site
installable so reopening is natural.

Partial uploads resume via `uploadedPaths`, and
`/api/jobs/cleanup-orphans` (daily cron) removes photos that were uploaded but
never attached to a report — without it, discarded queue items leak storage.

**Known limits worth stating to users:** clearing site data destroys the queue,
and iOS evicts IndexedDB after roughly seven days of non-use. The code requests
`navigator.storage.persist()` and the UI warns when an item has waited more than
three days.

## Languages

zh-Hant is the default and lives at the **un-prefixed root** (`/`, `/report`);
English is at `/en/...`. The audience is Taiwanese, so they get the short URLs and
are never redirected to a locale prefix.

```
apps/web/i18n/routing.ts     locales, default, prefix strategy
apps/web/i18n/navigation.ts  locale-aware Link + router — use these, not next/link
apps/web/messages/*.json     the catalogues
```

`packages/shared` deliberately holds **no display text**: it owns category keys,
colours and flags, while `messages/*.json` owns the words under matching keys. So
adding a locale never means touching shared code, and a category added without a
label fails a test rather than rendering a raw key path.

Three failure modes are guarded by `test/i18n.test.mjs`, all of which are
otherwise silent — a missing key renders as `"report.submit"` rather than
throwing:

- keys must match exactly across locales
- `en.json` must contain no Han characters (a forgotten translation)
- `{placeholders}` must match per key, or readers see a literal `{count}`

## Architecture

| Layer | Choice |
|---|---|
| Web | Next.js 16 (App Router) + TypeScript, Tailwind 4 |
| Data | Postgres 17 + **PostGIS 3.5** |
| Map | **MapLibre GL JS 6**, GPU heatmap layer |
| Tiles | Mapbox Vector Tiles generated in-database via `ST_AsMVT` |
| Species | TaiCOL (Catalogue of Life in Taiwan) |
| Seed data | GBIF Occurrence API |

```
apps/web            Next.js app (map UI + tile endpoint)
packages/shared     categories, Taiwan bounds, filter schema, tile strategy
scripts             migration runner + TaiCOL/GBIF importers
supabase/migrations SQL schema
```

The app talks to Postgres directly (`postgres` driver). Supabase is not required — the
schema is written to run on a vanilla PostGIS cluster, with Supabase-specific notes inline
in `0001_init.sql`.

---

## Three decisions worth understanding before changing anything

### 0. A report is not published until its species is known

A classifiable report (roadkill, invasive, injured, sighting) has **no taxon at submission
time**, so its sensitivity is unknown. Publishing it immediately would leave a 石虎 (leopard
cat) sitting on the public map at its exact coordinate until the classifier caught up —
exactly the disclosure the obscuring design exists to prevent.

So such reports are inserted as `status='pending'` **and** stamped with
`precision_override='coarse_10km'`. Two independent mechanisms, because this is the failure
that actually matters: the report is invisible, and even if some future code path published
it early it still could not appear at full precision. A report with no photograph has
nothing to classify, so it publishes immediately — which is what `requiresClassification()`
now turns on, since the two non-classifiable categories were retired.

`precision_override` can only ever make a location **coarser** — the trigger takes the most
conservative of (taxon policy, override), so it can never be used to reveal something the
species' own rating would have hidden.

### 1. Sensitive locations are protected by the schema, not by app code

Publishing precise coordinates of protected species enables poaching and collection. GBIF,
eBird and iNaturalist all obscure sensitive taxa, and **TaiCOL ships a per-taxon sensitivity
rating (敏感度) built for exactly this purpose**, which we honour:

| TaiCOL `sensitive` | Stored precision | Published |
|---|---|---|
| `座標不開放` | `suppressed` | **excluded from the map entirely** |
| `重度` / `縣市` | `coarse_50km` | offset within a ~0.5° cell |
| `輕度` | `coarse_10km` | offset within a ~0.1° cell |
| *(none)* but protected I/II/III | `coarse_10km` | offset within a ~0.1° cell |
| *(none)* | `exact` | true coordinate |

Two properties make this safe, and both are load-bearing:

- **The public never queries `reports`.** Every public read runs inside
  `asPublic()` (`apps/web/lib/db.ts`), which does `set local role web_anon` for the
  transaction. `web_anon` is granted `reports_public` and has no grant on the `reports`
  base table, so a public code path that accidentally selects a true coordinate fails
  loudly rather than leaking one. Verified: `set role web_anon; select * from reports` →
  *permission denied*.
- **Obscuring is deterministic**, computed once at write time from a hash of the report id.
  Re-randomising per read would let anyone average repeated requests back to the true point.
  Verified: 50 identical calls return one distinct result; across 2,000 random Taiwan
  points the published coordinate always lands in the same grid cell as the true one — so
  an observer learns the cell and nothing finer.

On the seed loaded so far (17,699 records): 845 blurred to ~10 km, 10 withheld entirely —
including 領角鴞 (collared scops owl, 保育II), 彩鷸 (greater painted-snipe, 保育II) and
鳳頭蒼鷹 (crested goshawk, 保育II).

### 2. Heatmap tiles are generated in the database

Shipping GeoJSON to the browser collapses at this data volume. `/api/tiles/{z}/{x}/{y}`
returns MVT from PostGIS in two regimes:

- **z ≤ 9** — `ST_SnapToGrid` aggregation, one square polygon per cell carrying `weight`.
- **z ≥ 10** — individual points, clickable.

The grid targets **128 cells across a tile** (`aggregationCellMeters()` in
`packages/shared`), and at z ≤ 9 each cell is emitted as a **square polygon**, not
a centroid. Measured on the seed data: a z6 tile covering Taiwan holds ~46k
reports and returns ~1,600 cells at ~39 KB in ~150 ms cold, well under the CDN
cache.

That constant is a rendering decision more than a payload one. Vector tiles render
at 512 CSS px, so it fixes the on-screen cell size at 512/128 = 4 px at every
zoom. Earlier values existed to serve a heatmap kernel, where small cells were
*desirable* because they had to melt into one another; drawn as discrete squares
they instead need to be individually legible.

Details that will bite you if changed:

- `ST_AsMVTGeom` uses a **64px buffer for the point regime** so symbols near a tile
  edge are not cut off — but a **0px buffer for the cell regime**, because
  overlapping polygon strips double-draw at any opacity below 1. See the gotcha
  list below.
- `geom_3857` is a **stored generated column** with its own GIST index. Transforming
  4326→3857 per request is the difference between ~20 ms and ~2 s.
- Filters live in the query string, so Vercel's CDN keys on them automatically.

---

## Environment gotchas already hit (don't re-debug these)

- **MapLibre must NOT be bundled by Turbopack.** Its Web Worker comes out broken:
  constructed then immediately closed, with no error, no failed request and no
  rejected promise. Vector tiles and GeoJSON are parsed in that worker, so every
  data layer stays permanently empty while the raster basemap renders perfectly —
  it looks exactly like a data or styling bug. Proven by running both builds side
  by side on one page against one endpoint: raw ESM returned 471 features, the
  bundled build 0. So `lib/map.ts` imports it from `public/maplibre/` via a
  `turbopackIgnore` dynamic import, and `npm run sync:maplibre` (wired to
  `predev`/`prebuild`) keeps those files in step with package.json.
- **Tile URL templates must be built by string concatenation, not `new URL()`.**
  The URL spec percent-encodes `{` and `}`, turning `{z}/{x}/{y}` into
  `%7Bz%7D/...`, which MapLibre never substitutes.
- **Empty tiles must return `200` with a zero-length body, not `204`.** MapLibre's
  array-buffer path handles a bodyless 204 inconsistently and the source can stay
  "not loaded" forever.
- **The map is NOT a heatmap layer, and turning it back into one will look blurry.**
  MapLibre's `heatmap` type is a kernel density estimate: each feature is splatted
  as a Gaussian and the splats are summed, so blur is intrinsic to the layer, not
  a setting. `heatmap-radius` and `heatmap-weight` only trade how blurry against
  how saturated — two rounds of tuning them could never have worked. The tile
  endpoint aggregates into cells and those cells are drawn as discrete `fill`
  squares with a `step` colour scale. `apps/web/test/map-bins.test.mjs` fails if a
  heatmap layer reappears in either map component.
- **Aggregated tiles carry TWO layers**, `reports` (cell polygons) and
  `reports_dots` (cell centroids), concatenated — an MVT is just a concatenation
  of layers. That is what makes the bins/dots toggle instant: switching is a
  visibility flip with zero refetches and one CDN entry, at ~+25 KB per z6 tile.
  The dots cannot be derived on the client, because MapLibre's circle layer draws
  a circle at every *vertex* of a polygon and a square cell would produce four.
- **Dot radius interpolates on `sqrt(weight)`, never the raw count.** Radius
  scaling squares the visual weight and wildly overstates dense cells; area must
  be what scales with the count.
- **The mode preference uses `useSyncExternalStore`, not `useState`.** Reading
  `localStorage` in a `useState` initialiser also runs during hydration, where the
  server could not have known the value — React reports a hydration mismatch and
  does not patch it. Restoring it via `setState` in an effect instead cascades
  renders and is rejected by `react-hooks/set-state-in-effect`.
- **Two sources, not one, and the aggregate source is capped at
  `TILE_AGGREGATION_MAX_ZOOM`.** This is what stops the map going blank at the
  handoff. With one uncapped source, crossing into the point regime hid the cells
  (their tiles stop carrying polygons) while the first point tiles were still in
  flight, and the parent tile has no points to fall back on — measured on a
  continuous wheel zoom, that produced a frame with **0%** of the view painted.
  Capping the aggregate source makes MapLibre overzoom its last tile instead, so
  the cells stay painted and fade out over the following zoom level while the
  points load in.
- **Point radius at the handoff is measured, not chosen by eye.** Cells tile the
  plane so their painted area is the sum of their areas; points cluster along
  roads and overlap heavily, so their union is far smaller. With identical data
  either side, a 2.4px radius painted 8.6% of the view against the cells' 23.9% —
  the map visibly emptied out at the crossover. 4.5px paints 22.4% and removes the
  cliff. Re-measure if the handoff zoom moves.
- **The point layer must be fully opaque the moment it takes over.** Tiles stop
  carrying cells above `TILE_AGGREGATION_MAX_ZOOM`, so that boundary is a hard cut
  whatever the opacity says. An older ramp faded points in from 0 at the handoff
  up to full several zoom levels later — a hangover from when a heatmap stayed
  painted until z13.5 and cross-faded with it. Once the heatmap was gone this left
  roughly a zoom and a half looking blank, with every point present and drawn at
  alpha 0. `map-bins.test.mjs` pins it. Its `minzoom` is derived from
  `TILE_AGGREGATION_MAX_ZOOM` for the same reason.
- **`TILE_AGGREGATION_MAX_ZOOM` is 13, so cells keep subdividing until they are
  effectively individual reports.** Measured over a dense area: 56% of cells hold
  exactly one report at z10, 69% at z12, **73% at z13**. By the handoff, most dots
  already *are* one report, so the swap to the point layer changes almost nothing
  on screen. It never reaches 100% — obscured records are snapped to a shared
  privacy-cell centre and so never separate, which is the design working.
- **Both regimes size their symbols from the same `SINGLE_REPORT_RADIUS` ramp.**
  A one-report dot and an individual point are therefore identical where they
  meet. Diverge these and the handoff visibly pops.
- **A paint property that depends on BOTH zoom and feature data must have the
  zoom `interpolate` outermost.** This one is vicious: MapLibre rejects the layer
  at `addLayer` time, logs to the console, and carries on rendering the map
  without it. Nothing throws. An `["*", zoomExpr, dataExpr]` radius blanked the
  dots across five zoom levels while every test still passed. Build the
  multiplication into the stop outputs instead — see `dotRadius` and `dotColor`.
  `e2e/map.spec.mjs` now reports `missingLayers` for exactly this reason.
- **The lowest density class brightens with zoom.** Dim at country zoom so the
  mass of one-report cells recedes; brighter by z13.5, where three quarters of
  cells are single reports and dimming them just makes the map look faint right
  before the handoff.
- **`AGGREGATION_CELLS_PER_TILE` sets the on-screen cell size directly.** Tiles
  render at 512 CSS px, so 128 cells/tile means 4 px per cell at *every* zoom,
  because the cell size in metres scales with zoom. Measured by comparison: 2 px
  reads as noise, 4 px reads as a bin.
- **The lowest density class is deliberately dim.** Most cells in the country hold
  one or two reports; a bright colour there turns the map into blue noise and
  buries the road corridors.
- **`fill-antialias` must stay `false`.** Neighbouring cells share an exact edge,
  and antialiasing them draws a hairline between every pair — a faint grid across
  the whole country.
- **The aggregated tile query expands its scan envelope by one cell and clips with
  a 0 px buffer.** A cell straddling a tile boundary must be counted from all its
  reports, or two neighbouring tiles draw the same square in two different colours.
  The 0 buffer is the other half: with a buffer each tile carries an overlapping
  strip of its neighbour's polygons, and any `fill-opacity` below 1 double-draws
  that strip as a dark band along every tile edge.
- **`components/species/SpeciesMap.tsx` has its own class breaks**
  (`SPECIES_DENSITY_CLASSES`), compressed because even the most-reported species
  holds a few thousand records against the corpus's 46k — reusing the main breaks
  would push nearly every cell into the lowest, dim class and the species map
  would read as empty.
- **The map syncs its state to the URL with `history.replaceState`, not the Next
  router.** `router.replace` treats a query change as a navigation and refetches
  the server component on every pan, discarding the map for a fresh render;
  `pushState` fills the history stack so the back button walks through every
  gesture instead of leaving the site. Measured: zero server round-trips across a
  four-step pan-and-zoom, `history.length` unchanged. Filters ride in the same
  query string, so a shared link carries what the sender was looking at as well as
  where — and they are re-parsed server-side with `mapFilterSchema`, so a
  malformed one is dropped rather than handed to the client.
- **Editing `messages/*.json` needs a dev-server restart.** next-intl loads them
  through a dynamic `import()`, and Turbopack keeps the resolved JSON module
  cached across HMR — so a newly added key renders as its own raw key path
  (`map.cellCount`) and logs `MISSING_MESSAGE`, while every pre-existing key keeps
  working. It looks exactly like a typo in the key. It is not; restart the server.
- **MapLibre GL 6 has no default export.** `import maplibregl from "maplibre-gl"` fails;
  use named imports.
- **`maplibre-gl.css` is unlayered, Tailwind 4 utilities are in `@layer utilities`, and
  unlayered CSS wins.** So `.maplibregl-map { position: relative }` silently overrode an
  `absolute inset-0` container, collapsing it to 0px height. The map container is sized with
  `h-full` for this reason.
- **MapLibre only sizes itself at construction** and listens for *window* resizes, so in a
  flex layout it gets stuck at its 400×300 fallback. A `ResizeObserver` on the container
  fixes it.
- **Every MapLibre lifecycle event (`load`, `idle`, `style.load`) is driven by
  `requestAnimationFrame`.** In a hidden/backgrounded tab rAF never fires, so none of them
  arrive and layers are never added — while `isStyleLoaded()` is still true. Layer setup
  therefore has a `setTimeout` backstop.

---

## Tests

```bash
npm test
```

61 tests, no external services beyond the database:

| Suite | Guards |
|---|---|
| `privacy.test.mjs` | Obscuring determinism, cell containment across 2,000 points, `precision_override` can only tighten, and the public role's inability to read `reports` |
| `tiles.test.mjs` | Aggregation conserves the exact record count, MVT layer/extent/properties, empty tiles are `200` not `204`, filters discriminate, bad input is rejected |
| `shared.test.mjs` | Taiwan bounds incl. Kinmen/Matsu/Penghu/Orchid Island, filter serialisation, submission validation |
| `i18n.test.mjs` | Catalogue key parity, no untranslated CJK in English, placeholder consistency, every category/precision key has a label |
| `species.test.mjs` | Public stats never include suppressed taxa, totals reconcile, slug canonicalisation, search by scientific name and Chinese synonym, empty/suppressed/unknown species states |

The privacy and i18n suites are mutation-checked: granting `select on reports to
web_anon` makes exactly one privacy test fail, and deleting a key / leaving
Chinese in `en.json` / changing a placeholder each fail their own i18n test.
A test that cannot fail is not a guard.

```bash
npm run test:e2e
```

Two real-browser checks. `test:map` asserts the heatmap actually paints;
`test:offline` cuts the network with Playwright, queues a report, restores the
connection and asserts it lands **exactly once** — plus that `/report` opens with
no connection at all. The offline test needs a production build, because the
service worker is disabled in dev and "does the page open offline" is the point.

Launches real headless Chromium, loads the map, and asserts tiles load and the
heatmap actually paints — then writes `apps/web/e2e/map-render.png` to eyeball.
This exists because MapLibre does all its work inside `requestAnimationFrame`:
any environment that suspends rAF shows a healthy basemap over a silently empty
data layer, which is indistinguishable from a real bug. Several of the gotchas
above were only findable with a genuinely rendering browser.

```bash
# Tile aggregation loses no records
docker exec conservation-db psql -U conservation -d conservation -c "
with env as (select st_tileenvelope(6,53,27) as e),
cells as (select st_snaptogrid(r.geom_3857, 40075016.686/2^6/64) as pt, count(*)::int w
          from reports_public r, env where r.geom_3857 && env.e group by 1)
select (select count(*) from reports_public r, env where r.geom_3857 && env.e) direct,
       (select sum(w) from cells) via_cells, (select count(*) from cells) n_cells;"
```

```bash
# The public role cannot reach a true coordinate
docker exec conservation-db psql -U conservation -d conservation -c \
  "set role web_anon; select * from reports limit 1;"
```

```bash
# Obscuring is deterministic
docker exec conservation-db psql -U conservation -d conservation -c "
select count(distinct st_astext(obscure_point(st_point(120.68,24.15,4326)::geography,
  '11111111-1111-1111-1111-111111111111'::uuid, 0.1)::geometry,9)) as must_be_1
from generate_series(1,50);"
```

```bash
# Importer is idempotent and resumable — re-running fills gaps, inserts no duplicates
npm run import:gbif -- --limit 600
```

**Reporting flow** — submit a classifiable report and confirm it is held back:

```bash
# Should return status:"pending", awaitingIdentification:true
curl -s -X POST http://localhost:3000/api/reports -H 'content-type: application/json' -d '{
  "category":"roadkill","lng":120.95,"lat":23.75,
  "observedAt":"2026-08-01T09:00:00Z","photoPaths":[],
  "clientNonce":"'"$(uuidgen)"'"}'
```

Then confirm `/reports/<id>` 404s while pending, and that assigning a protected species
blurs it before publication:

```sql
update reports set taxon_id = (select id from taxa where scientific_name='Prionailurus bengalensis')
 where id = '<id>';
select location_precision, round(st_distance(location, location_public)::numeric) as offset_m
  from reports where id = '<id>';   -- expect coarse_10km, ~5000m
```

---

## Reporting (M2)

| Path | What |
|---|---|
| `/report` | Mobile-first submission form |
| `/api/uploads/sign` | Mints short-lived signed Storage upload URLs |
| `/api/reports` | Validates, screens, and inserts a report |
| `/reports/[id]` | Public detail page — reads `reports_public`, 404s on suppressed |
| `/admin` | Moderation queue, role-gated server-side |
| `/login`, `/auth/callback` | Passwordless magic-link sign-in |

Things that are the way they are for a reason:

- **Photos never pass through the server.** The client uploads directly to Storage via a
  signed URL — Vercel caps request bodies at 4.5 MB, and proxying image bytes through a
  serverless function wastes duration for nothing. `statUploadedPhoto()` then confirms
  server-side that the object exists and is the size and type it claims.
- **EXIF is read, then destroyed.** `lib/image.ts` extracts GPS *first* and offers it as a
  suggestion (the photo may have been taken elsewhere), then re-encodes through a canvas —
  which both downscales 3–8 MB to ~250 KB and strips all metadata, since a canvas has no
  concept of EXIF. `imageOrientation: "from-image"` bakes the rotation into pixels, or
  portrait photos upload sideways.
- **`anon` has no insert grant.** All writes go through our route handlers on the app's own
  connection. If PostgREST could insert, anyone could POST to `/rest/v1/reports` and bypass
  Turnstile and rate limiting entirely.
- **Rate limiting lives in Postgres** (`bump_rate_limit()`), not Redis. One datastore, and
  this volume never justifies another service.
- **Idempotency by `client_nonce`**, so a double-tap — or an offline retry — cannot create
  two reports.
- **Server-only modules are enforced.** `lib/supabase/service.ts` and `server.ts` import
  `server-only`, so importing the service-role key from a client component is a build error
  rather than a shipped credential.

## Next

**M2 — Reporting.** Built: submission flow, direct-to-storage photo upload, EXIF
stripping, optional accounts, Turnstile, rate limiting, moderation queue, report pages.
Remaining: offline (IndexedDB) submission queue.

**M3 — AI.** Built: BioCLIP 2 zero-shot classifier over a Taiwan-restricted label set,
precomputed embeddings, async job queue and worker, confirm/correct UI, Modal deployment.
Remaining: deploy to Modal (needs a Modal account) and enable MegaDetector cropping.

### Measured classifier accuracy

Against 308 labelled Taiwan images (`apps/ml/evaluate.py`, 2026-08-05,
`bioclip2-vitl14-v1`, **70,805 candidate taxa**):

| Metric | Result |
|---|---|
| top-1 accuracy | **61.0%** |
| top-5 accuracy | **91.6%** |
| at score ≥ 0.73 | **90.4% precision**, covering **33.8%** of images |

**Both** bands in `apps/ml/pipeline.py` are fitted from this measurement rather than
guessed, and they are fitted against different criteria because they do different jobs:

| Band | Decides | Fitted on | Value |
|---|---|---|---|
| `BAND_HIGH` | auto-assign the species, no human involved | cumulative top-1 precision ≥ 90% | **0.73** |
| `BAND_MEDIUM` | show a top-5 list and ask the reporter to confirm | local top-5 accuracy ≥ 75% | **0.28** |

Resulting behaviour:

| Band | Share | top-1 | top-5 |
|---|---|---|---|
| high (≥ 0.73) | 33.8% | 90.4% | 97.1% |
| medium (0.28–0.73) | 58.1% | 47.5% | 91.6% |
| low (< 0.28) | 8.1% | 36.0% | 68.0% |

Two things worth keeping straight if you refit these:

- **`BAND_MEDIUM` must be fitted locally, not cumulatively.** Nothing is auto-assigned
  in that band, so top-1 precision is the wrong criterion — what matters is whether
  the answer is in the offered list. And because overall top-5 is ~92%, a *cumulative*
  top-5 criterion stays above any sane target right down to the lowest score in the
  set, so it would answer "never withhold the list" no matter what the data looked
  like down there. Binning by score and reading top-5 locally shows the real
  inflection: 68% below 0.28 against 76–100% in every bin above it. The earlier
  guess of 0.35 was measurably too high — it discarded a band whose top-5 is 84%.
- Only 25 images fall below 0.28, so that exact cutoff is provisional.

`evaluate.py --dump` writes per-image scores, and `--from-dump` refits both bands from
them with no model pass, which is how the table above was produced.

**The bands are wired to behaviour, not just recorded.** `reports.ai_band` is written by
the worker, and `report_ai_suggestions` withholds the top-5 entirely in the low band
(`0006_ai_band.sql`). A list that is wrong a third of the time does not merely waste the
reporter's time — it anchors them on a plausible-looking wrong species, and a bad
identification is worse for the dataset than no identification. The `classifications`
rows are still written for every band, because they are the record of what the model
actually said and are what makes comparing model versions possible; only the display is
governed. Note that `ai_band is distinct from 'low'` is deliberate: the column is null
for every report classified before that migration and for every non-classifiable
category, and a plain `<> 'low'` would silently hide all of them.

### Cropping was tried and measurably made things worse

MegaDetector cropping is implemented but **off by default**, gated behind
`ML_USE_DETECTOR=1`. The argument for it was strong — a roadkill photo is mostly
asphalt, so an uncropped classifier should end up classifying *road* — but the
measurement disagreed:

| | top-1 | top-5 | auto-identified |
|---|---|---|---|
| detector off | 60.8% | **91.5%** | **33.3%** |
| detector on | 61.0% | 87.0% | 25.3% |

Detection itself works (10/12 images; one crop cut the area 13×). The issue is
that the eval set is iNaturalist photography — live, well-framed animals that
already fill the frame — so cropping only strips context BioCLIP uses and removes
no distracting background, because there is none.

So this does **not** refute the roadkill argument; it cannot test it, since the
eval set contains no roadkill photos. The question stays open until the site's own
submissions provide some. Until then the configuration that measures better ships.

**Read that with the caveat it deserves.** The eval images come from iNaturalist: live,
well-framed animals. Real roadkill is dead, often damaged, and shot against asphalt from a
distance. These figures answer "can the model tell Taiwan species apart" — an optimistic
upper bound — not "is it ready for roadkill photos". Measuring that properly needs labelled
roadkill photography, which **TaiRON does not publish to GBIF** (its `media` array is
empty), so it will have to come from the site's own submissions.

### How the ML side runs

```bash
python3 -m venv apps/ml/.venv && ./apps/ml/.venv/bin/pip install -r apps/ml/requirements.txt
./apps/ml/.venv/bin/python apps/ml/build_embeddings.py   # ~9 min, writes a 109 MB matrix
npm run build:evalset                                    # 308 labelled images from GBIF
./apps/ml/.venv/bin/python apps/ml/evaluate.py           # accuracy + band fitting
modal deploy apps/ml/modal_app.py                        # production inference
```

`build_embeddings.py` encodes all 70,805 Taiwan taxon prompts once, so inference is a
single image forward pass plus one `(1,768) @ (768,70805)` matmul.

## The list view is meant to be an actual equivalent

`/reports` exists because a WebGL canvas conveys nothing to a screen reader, so
two things follow that are easy to get wrong and were both wrong until measured:

- The link to it is a **skip link** and sits *before* the map in DOM order. Placed
  after, it became the twelfth tab stop — behind the canvas, both zoom buttons and
  the attribution — which is no use to the people it exists for.
- It honours the **whole** filter (`category`, `taxonId`, `from`, `to`), parsed
  with the same `mapFilterSchema` the map and tile endpoint use, and the skip link
  carries the map's current filter across. A fallback that silently dropped the
  species and date filters would not be an equivalent view of the same data.

The species filter is a plain list of buttons, **not** an ARIA combobox, and that
is deliberate: Tab reaches each suggestion and Enter selects it, which works
today. A half-built combobox — the role without `aria-activedescendant` and
arrow-key handling — would announce a listbox that does not behave like one,
which is worse than a simple list of labelled buttons. What it was missing is any
signal that results appeared, so there is a polite live region for the count.

`e2e/pages.spec.mjs` asserts the tab order, so this cannot regress quietly.

## A note on what CI actually checks

`.github/workflows/ci.yml` applies every migration to a plain PostGIS container,
loads a committed fixture (`supabase/seed-test.sql`) rather than hitting the live
TaiCOL/GBIF APIs, then typechecks, lints, builds, and runs the suite plus both
real-browser specs.

`scripts/` gets its own typecheck pass. Those files run under `tsx`, which strips
types without checking them, so until `scripts/tsconfig.json` existed they were
the only TypeScript in the repo that nothing verified — and they are the code
that talks to GBIF, TaiCOL and the database.

## Publishing back to GBIF

`npm run export:dwca` writes a Darwin Core Archive to `data/export/dwca/`.

The one rule that matters: **only `source='user'` records are exported.** The
database holds ~46k TaiRON occurrences imported *from* GBIF, and GBIF
deduplicates on `occurrenceID` across the network — republishing those would
duplicate 路殺社's decade of fieldwork under our name and misattribute the
publisher. The script filters on it, asserts it again before writing, and
`apps/web/test/export.test.mjs` pins it.

Obscured records *are* exported, because they are still real occurrences at a
stated uncertainty; the generalisation is declared through
`coordinateUncertaintyInMeters`, `dataGeneralizations` and `informationWithheld`
rather than shipping a fuzzed point as though it were exact. Suppressed records
are omitted entirely.

`meta.xml` is generated from the same `TERMS` array that writes the header, so
the two cannot drift — a mismatched `meta.xml` is the most common way an archive
is rejected, and it fails as silently misaligned columns.

## Data & licensing

Roadkill records come from [臺灣動物路死觀察網 TaiRON](https://roadkill.tw) via
[GBIF](https://www.gbif.org/dataset/db09684b-0fd1-431e-b5fa-4c1532fbdb14), **CC BY 4.0 —
attribution is legally required**, so `license` and `rights_holder` are stored per record.
Species checklist from [TaiCOL](https://taicol.tw). Basemap © OpenStreetMap contributors
© CARTO.
