# Remaining work

Last reviewed 2026-08-05.

## Done since this list was written

Everything in the original "Legal / trust", "Robustness" and "Accessibility"
sections shipped: `/about`, `/attribution`, `/privacy`, error and not-found
boundaries, `/api/health`, `robots.ts`, ESLint, `.gitignore`, the `/reports` list
view as a non-map fallback, and the date-range and species filters that the tile
endpoint had always supported. Also done, with results recorded below: the Modal
deployment, i18n, species pages, the offline queue, and `/stats`.

## Open

### 1. Finish the GBIF seed
Done: 46,402 of 46,416 TaiRON records loaded. Three pages (offsets 36600,
39000, 42600) were lost to transient GBIF errors and have been backfilled; the
remaining 14 are records the filters reject (off-map, no coordinate, no date).

Note for next time: a plain re-run does **not** fill such gaps. Resume position is
derived from the number of rows already stored, so it lands past them — use
`npm run import:gbif -- --offset <first failed offset>`. The script now says so
when it reports failures.

Watch disk: the box sits near 95% full, and it was disk pressure — not the
importer — that hung Docker previously.

### 2. Real roadkill photos for the eval set
The open question the current measurements **cannot** answer.

The eval set is 308 iNaturalist images: live, well-framed animals that fill the
frame. Real roadkill is dead, often damaged, frequently distant and against
asphalt. Every accuracy figure in the README is therefore an optimistic upper
bound for the category the project exists to serve, and it is also why
MegaDetector cropping measured *worse* (it strips context while removing
background that these photos do not have). TaiRON publishes no images to GBIF, so
this needs either a direct request to 路殺社 or the site's own submissions.

Until then the honest position is the one shipped: cropping off by default behind
`ML_USE_DETECTOR=1`, and both bands fitted on the data that exists.

### 3. Deployment
The one step that needs an account holder: set `CRON_SECRET` in the Vercel
project so `/api/jobs/classify` is authenticated in production. It is open
locally and closed in production by default, so forgetting it fails safe (the
worker returns 401 and jobs queue) rather than exposing the endpoint.

### 4. Nice to have
- **Administrative boundaries.** `/stats` ranks hotspots by 5 km grid cell and
  labels them with coordinates, because there is no county/township geometry in
  the database to name them with. Importing 縣市/鄉鎮 boundaries would make
  hotspots readable and would also allow filtering the map by county.
- **OG images** for species and report pages. Blocked on a judgement call rather
  than effort: `next/og` ships no CJK font, so Chinese renders as blank boxes
  unless a subsetted font (~1–2 MB, SIL OFL) is committed to the repo. Latin-only
  previews are trivial but weak for a Taiwanese audience.
- **NLSC (國土測繪中心) basemap layer** toggle. This is the keyless route to
  Chinese place labels — CARTO's dark basemap romanises them ("TAICHUNG"), and the
  alternative is a MapTiler key. The catch is that NLSC's map is light-themed and
  the whole data palette is tuned for a dark background, so it needs a second
  palette rather than just a source swap.
- ~~**Publish back to GBIF**~~ — the exporter is built (`npm run export:dwca`).
  It writes `occurrence.txt` / `meta.xml` / `eml.xml` and deliberately exports
  only `source='user'` records: republishing the imported TaiRON data would
  duplicate 路殺社's occurrences under our name. It currently emits zero rows,
  which is correct — there are no user submissions yet. What remains is the
  non-code part: fill in the real `DATASET` contact/homepage, register with an
  IPT or GBIF publisher account, and upload.
- **Talk to 路殺社 / TBIA** before launch — complement them, don't compete.
