# Plan: species pages & offline submissions

Two independent features. Species pages are mostly presentation over data that
already exists; offline submissions are genuinely hard and platform-constrained.
They share nothing, so they can be built in either order or in parallel.

---

# 1. Species pages

## Context

The database holds **66,201 Taiwan species**, but only **354 have any reports**
(max 2,400, average 41, and 73 with exactly one). Conservation fields are sparse:

| Field | Populated (of 66,201) |
|---|---|
| `common_name_zh` | 46,494 (70%) |
| `family` / `name_author` | ~65,600 (99%) |
| `iucn` | 6,977 |
| `redlist` | 6,547 |
| `cites` | 1,511 |
| `sensitivity` | 1,142 |
| `is_endemic` | 9,832 |
| `protected_status` | **308** |
| `is_invasive` | 251 |

Two consequences drive the whole design:

1. **The page must degrade gracefully.** Most species have no badges, no Chinese
   name (30% don't), and no records. A layout that assumes a rich profile will
   look broken for the overwhelming majority.
2. **A "heatmap" is the wrong presentation for most species.** 73 species have a
   single record. Sparse species need a list or a pin, not a density surface.

Right now the 354 species in the data have nowhere to live, and the map's only
species affordance is a popup. The tile endpoint **already supports `taxonId`**,
so the filtered map is nearly free.

## Routes

| Route | Purpose |
|---|---|
| `/species` | Directory — defaults to the 354 species that actually have records |
| `/species/[id]` | Detail |
| `/api/species/search?q=` | Autocomplete, also feeds the map's species filter |

**URL shape:** `/species/32116-prionailurus-bengalensis`, parsed by taking the
leading integer. Canonical URL includes the slug; a bare `/species/32116`
redirects to it. Keeps ids stable while giving humans and search engines
something readable. Chinese slugs are deliberately avoided — percent-encoded CJK
in URLs is unreadable when shared.

## Detail page content

Everything below the first block is conditional and disappears cleanly when absent.

- **Identity** — `common_name_zh` as the headline, falling back to
  `scientific_name` for the 30% without one; scientific name with `name_author`
  in italics; `alt_names_zh` as "也稱作 / also known as".
  In the English locale the scientific name is the headline, since TaiCOL
  supplies no English common names.
- **Taxonomy** — kingdom → phylum → class → order → family breadcrumb.
- **Status badges** — 保育 I/II/III, CITES, IUCN, Taiwan red list, 特有種,
  外來種/入侵種. Conditional; the whole row vanishes for most species.
- **Habitat** — from the `is_terrestrial` / `is_freshwater` / `is_brackish` /
  `is_marine` flags.
- **Records**, branching on count:
  - **0** → "no reports yet", plus a prompt to submit one. This is the case for
    ~65,850 species, so it must be a designed state, not an empty div.
  - **1–5** → a list of the individual records with dates and a small map, not a
    heatmap.
  - **6+** → the existing heatmap, filtered with `?taxonId=`, plus a monthly
    distribution bar chart (roadkill is strongly seasonal — this is the most
    scientifically interesting thing on the page).
- **Privacy notice** — when the taxon is sensitive, say so plainly: locations are
  blurred and why. Being visibly careful is what earns trust with conservation
  researchers.
- **Call to action** — "seen one? report it", linking to `/report` with the
  category pre-selected.

## Privacy rules (non-negotiable)

- All record queries go through `asPublic()` and read `reports_public`. **Never
  query `reports` for a count on a public page** — that would leak the existence
  and volume of records for `座標不開放` taxa.
- A suppressed taxon has zero rows in `reports_public`. Rather than rendering a
  misleading "0 records", show an explicit "coordinates for this species are not
  published" note. That reveals nothing a poacher can use — TaiCOL already
  publishes which species occur in Taiwan — and it is honest.
- The mini-map uses the same tile endpoint, so blurring is inherited rather than
  reimplemented.

## Search

Add `pg_trgm` GIN indexes in a new migration:

```sql
create extension if not exists pg_trgm;
create index taxa_sci_trgm on taxa using gin (scientific_name gin_trgm_ops);
create index taxa_zh_trgm  on taxa using gin (common_name_zh gin_trgm_ops);
create index taxa_alt_gin  on taxa using gin (alt_names_zh);
```

Trigram matching handles Latin typos well. For Chinese it is weaker (words are
2–3 characters), but substring matching on an indexed column is fast enough at
66k rows. Rank results so species **with records** surface first — someone
searching 石虎 wants the page with data, not an arbitrary synonym entry.

## Rendering strategy

Do **not** statically generate 66,201 pages. `generateStaticParams` returns only
the ~354 species with records; everything else renders on demand with ISR.
`sitemap.ts` lists those 354 plus protected and invasive species.

## Files

```
apps/web/app/[locale]/species/page.tsx           directory + search
apps/web/app/[locale]/species/[id]/page.tsx      detail
apps/web/app/api/species/search/route.ts         autocomplete
apps/web/components/species/StatusBadges.tsx
apps/web/components/species/SpeciesMap.tsx       wraps createMap + taxonId filter
apps/web/components/species/MonthlyChart.tsx
supabase/migrations/0005_taxa_search.sql
apps/web/messages/{zh-TW,en}.json                new `species.*` keys
```

Reuse `createMap` from `lib/map.ts` — it already carries the MapLibre workarounds
(vendored ESM, container sizing, ResizeObserver). Do not construct a Map directly.

## Verification

- A species with many records renders a heatmap; one with a single record renders
  a pin, not a density blob; one with none renders the empty state.
- A `座標不開放` species page exposes **no coordinates at all**, and the tile
  request for its `taxonId` returns an empty tile.
- Search finds 石虎 by Chinese name, by `Prionailurus`, and by the synonym in
  `alt_names_zh`.
- `/species/32116` redirects to the slugged canonical URL; an unknown id 404s.
- Both locales render with no missing keys (the existing i18n test covers this
  once `species.*` keys are added).

## Effort

Roughly: migration + search endpoint (small), directory page (small), detail page
(medium — the branching record presentation is most of it), monthly chart (small).
The mini-map is nearly free because the tile endpoint already filters.

---

# 2. Offline submissions

## Context

Roadkill happens on mountain roads. Those are exactly the places with no signal,
so a reporting flow that requires connectivity fails precisely where it matters
most. This is the highest-value remaining M2 item for real-world use.

## The core constraint

Submission is **three network steps**, not one:

```
POST /api/uploads/sign   →   PUT photo(s) to Storage   →   POST /api/reports
```

So we cannot simply "queue the final request". Being offline breaks step one.
**The queue must hold the raw inputs and run the entire flow at flush time.**

This also settles a question that would otherwise be tempting: do not pre-sign
upload URLs at queue time. Signed upload URLs are short-lived, and a report
queued overnight would flush against an expired URL.

## Storage

IndexedDB, one object store. Photos are stored as `Blob`s — already downscaled
and EXIF-stripped by `lib/image.ts`, so ~250 KB each, ≤4 per report, ~1 MB per
queued report.

```ts
type QueuedReport = {
  id: string;              // === clientNonce, generated at QUEUE time
  createdAt: number;
  payload: { category, lng, lat, observedAt, notes?, contactEmail? };
  photos: Blob[];
  uploadedPaths: string[]; // partial-progress marker, see below
  attempts: number;
  lastError?: string;
  status: "queued" | "sending" | "failed";
};
```

Use `idb` (~1.3 kB) rather than hand-rolling — raw IndexedDB is verbose and its
error handling is easy to get subtly wrong.

## Idempotency is already solved

`clientNonce` exists, the reports table has a unique partial index on it, and
`POST /api/reports` already returns `{ duplicate: true }` for a repeat. That is
normally the hardest part of an offline queue and it is done.

**One change needed:** the nonce is currently generated per *form instance*. It
must be generated at *queue time* and stored on the item, so every retry of a
given queued report reuses the same nonce. Without that, a retry after an
ambiguous timeout creates a duplicate report.

## Partial progress

If two of four photos upload and the connection dies, record the returned paths
in `uploadedPaths` and skip them on retry. Otherwise each attempt re-uploads and
orphans objects in Storage.

That implies a **cleanup job**: a cron route deleting Storage objects older than
24h with no matching `report_photos` row. Without it, abandoned queue items leak
storage quietly.

## Flush triggers — and the platform reality

This is the part to be honest about rather than promise magic.

| Trigger | Works on |
|---|---|
| App open (page load) | Everywhere |
| `online` event | Everywhere |
| `visibilitychange` → visible | Everywhere |
| **Background Sync API** | **Chromium only** |

Background Sync flushes even with the tab closed, but **Safari and iOS do not
implement it**, and iOS share in Taiwan is high. So the primary mechanism is
"flush when the user next opens the app", with Background Sync as a bonus on
Android.

**The UI must say this plainly** — something like "will send when you're back
online and open the app" — rather than implying it sends itself. A user who
believes a report was transmitted and finds out weeks later it wasn't is worse
off than one who was told the truth.

## Service worker

Needed for two things:

1. **Background Sync** (Chromium).
2. **Making `/report` load at all with no signal.** This is the one that actually
   matters: a queue is useless if the page won't open. If the tab is already
   open, client-side navigation works without a service worker — but "closed the
   tab, reopened in a valley" needs one.

**Recommendation: a hand-written `public/sw.js` doing runtime caching only** —
network-first with a short timeout, falling back to cache, for pages and static
chunks; stale-while-revalidate with a size cap for CARTO basemap tiles; never
cache `/api/*` or auth routes.

Deliberately *not* using Serwist or next-pwa initially. Build-time precaching of
Next's hashed chunks is the only thing they meaningfully add, and runtime caching
covers the dominant scenario (the user loaded the app before losing signal).
Revisit if "first visit is offline" turns out to matter, which it mostly cannot.

Add `app/manifest.ts` so the site is installable. An installed PWA makes
"reopen the app" a natural action rather than a chore, which directly improves
flush rates on iOS.

## Data-loss risks (must be surfaced, not buried)

- Browser "clear site data" destroys the queue. Call
  `navigator.storage.persist()` to request durable storage.
- **iOS evicts IndexedDB for sites unused for ~7 days.** A queued report from a
  weekend trip can silently vanish. Surface queued reports prominently on next
  open, and consider a gentle warning if an item is more than a few days old.
- Show `navigator.storage.estimate()` pressure if the queue grows large.

## UI

- Submit while offline → an explicit "queued" confirmation stating when it will
  send, not a generic success.
- A persistent indicator when the queue is non-empty: "N reports waiting".
- A queue view: per-item retry, delete, and the last error.
- On successful flush, confirm and link to the published report.

## Files

```
apps/web/lib/offline/queue.ts        idb wrapper: enqueue / list / flush / remove
apps/web/lib/offline/flush.ts        the sign → upload → submit pipeline
apps/web/components/report/QueueBanner.tsx
apps/web/app/manifest.ts
apps/web/public/sw.js
apps/web/app/api/jobs/cleanup-orphans/route.ts   cron, with vercel.json entry
```

`ReportForm.submit()` becomes: try online first; on network failure (or if
already offline) enqueue and report that honestly.

## Verification

Playwright supports `context.setOffline(true)`, so this is genuinely testable
end to end rather than by inspection:

- Go offline → submit → assert the report is in IndexedDB and the UI says queued.
- Reload while still offline → the queue survives.
- Go online → assert the report lands in the database with the right coordinates.
- **Flush twice → exactly one report** (the idempotency guarantee).
- Kill the network after the first of two photo uploads, then retry → both photos
  attached, no orphaned objects, no duplicate report.
- With a fresh service worker, load `/report`, go offline, reload → the page
  still opens.

## Effort

Larger than species pages. The queue and flush pipeline are straightforward; the
service worker, the partial-upload resume, and honest UI states are where the
time goes. The orphan-cleanup job is small but should not be skipped.

---

# Recommended order

**Species pages first.** They are lower risk, they make the 354 species in the
data useful immediately, and they need no new platform capabilities. Offline is
more valuable in the field but touches service workers, IndexedDB and iOS
eviction behaviour — worth doing with a clear run at it.

If time is short, the cuttable parts are: the monthly distribution chart
(species), and Background Sync (offline — the app-open flush covers most cases,
and it is the only path on iOS anyway).
