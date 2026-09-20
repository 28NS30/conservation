# Inventory: supporting and system pages

Area: /about, /team, /attribution, /privacy, the four error/404 files, every loading.tsx. All paths relative to `apps/web`. Screenshots are in screenshot captures (not committed; regenerate with `apps/web/e2e/_shots.mjs`).

## What it is for

- **/about** — a stranger (or a wary researcher) finds out what this is, who runs it, and why some locations are blurred.
- **/team** — see the real people behind it. Currently 404s on purpose (empty roster).
- **/attribution** — satisfy the CC BY 4.0 licence condition; let a data user see source, licence, rights holder, counts.
- **/privacy** — a reporter learns what is collected and how to get their data corrected or removed (個資法).
- **[locale]/not-found** — a dead record/species id, or /team: get back to something useful.
- **global-not-found** — a mistyped or dead top-level URL (per its own comment, "most real 404s").
- **[locale]/error** — something threw; retry or leave.
- **global-error** — the root layout itself failed; retry.
- **loading.tsx x4** — hold the page's shape during the server round trip (reports list, species directory, stats, map).

## What is on screen today

**/about (about-fold, about-full, about-phone-*)** Desktop: site header, then a single 672px column (`max-w-2xl`) floating in a 1440 canvas with ~400px of empty paper each side. Top to bottom: 112px badge (left-aligned, lettering reads PROJECT ECOWATCH / 生態守望計畫), 30px h1 "關於本站", one-line lede (the site meta description), hairline rule, then five identical blocks — 18px bold heading over 14px grey-green paragraph — "這是什麼 / 為什麼有些位置是模糊的 / 還沒辨識出來的通報 / 怎麼參與 / 聯絡", an ember mailto link (a personal gmail), hairline, three pills (+通報 filled, 資料來源, 隱私 outlined), footer. The eye lands on the badge, then nothing: every block has the same weight, and the page is about 60% whitespace. Phone: the same stack; the badge is proportionally bigger (about 28% of width) and the page reads better than desktop because the column fills the screen.

**/attribution (attribution-full, attribution-phone-fold)** PageHeader (30px h1 + 14px lede), then five heading+paragraph sections. The first has ember inline links to 路殺社 and GBIF and a three-column table in 12px text: `CC BY 4.0 | Taiwan Biodiversity Research Institute | 46,334`, then a total row repeating 46,334. On phone the licence cell wraps to "CC BY / 4.0" and the rights holder to two lines. Dense, honest, flat.

**/privacy (privacy-full, privacy-phone-full)** PageHeader, then eight identical heading+paragraph sections, ending in the same gmail link. No anchors, no summary, no "last updated". A wall of 14px ink-600 text; fine to read, impossible to scan.

**/team (team-fold, team-phone-fold)** Renders the locale 404: no header, no footer, no badge — "404" in grey-green 30px, 18px title, 14px body, two small pills "回到地圖" / "瀏覽物種", dead-centre on an empty paper screen.

**global 404 (notfound-fold, notfound-phone-fold)** Nearly identical to the above but different: 36px "404", Chinese title with "Page not found" under it, different body sentence, pills "回首頁" / "查看地圖". Also no header, footer or mark.

**error.tsx** (not captured) same centred layout, title/body/digest in 11px mono, Retry + "Back to map". **global-error.tsx** (not captured, production-only) dark bark ground, slate-grey text, an emerald pill.

**Skeletons** Pulsing `bg-ink-900/10` bars shaped like the current pages: 7 chips + 15 rows (reports), search bar + 5 chips + 12 cards of 68px (species), 4 tiles of 76px + 4 panels (stats). Map: paper header strip over a bark-950 void.

## Components

| file | role | used by | verdict | note |
|---|---|---|---|---|
| `components/site/PageHeader.tsx` (PageHeader) | h1 + lede + slot | attribution, privacy, team, and other inner pages | restyle | The one shared title block; redesign the type here and every inner page follows. h1 is only 30px, lede 14px. |
| `PageHeader.tsx` (ProseSection) | h2 + 14px body | privacy only | merge | about (`Block`, about/page.tsx:106) and attribution (five inline `<section>`s) re-implement it by hand. One prose component. |
| `components/brand/Badge.tsx` | 512px PNG, rounded-full clip | about header, home | keep (artwork pending) | Docblock still cites a `Mark` component that no longer exists. |
| `app/[locale]/(site)/about/page.tsx` | trust page | — | rebuild | Content and composition both need work (see problems 1-3). |
| `.../attribution/page.tsx` | licence page, live SQL on `reports_public` | — | restyle | Data-driven table is right; presentation is 12px. |
| `.../privacy/page.tsx` | 個資法 statement | — | restyle | Copy is good; needs scan structure. |
| `.../team/page.tsx` + `lib/team.ts` | gated roster grid | footer link gated by `teamPublished()` | keep, restyle later | Do not design with fake people. |
| `app/[locale]/not-found.tsx` | record-level 404 | any `notFound()` incl. /team | rebuild | Merge visually with global-not-found; they cannot share i18n code but must share a design. |
| `app/global-not-found.tsx` | route-level 404, no layout, no next-intl | unmatched URLs | rebuild | Hand-written bilingual; imports globals.css so tokens work. |
| `app/[locale]/error.tsx` | route error boundary (client) | all locale routes | rebuild | Same template as 404. |
| `app/global-error.tsx` | last resort, inline hex only | root failures | restyle | No stylesheet available; must stay dependency-free. |
| `components/site/Skeleton.tsx` | Bar, HeaderSkeleton, Page | 3 loading.tsx | keep, re-shape | Shapes are hard-coded to today's layouts. |
| `app/[locale]/map/loading.tsx` | dark map shell | /map | keep | Rationale (no white flash) is sound. |

## Design problems

1. **/about does not answer "who is behind this".** The code comment says that is the page's job (about/page.tsx:19-22), but the page names no organisation, no BioWatch International, no 路殺社, no history — only "write to Neo Su" and a gmail address (about-full). For a stranger deciding whether to trust a wildlife map, this is the weakest moment on the site.
2. **/about describes a site that does not exist yet.** `about.whatBody` says anyone can report four kinds of thing and "everyone can see the aggregated heatmap"; it never says the 46,334 records on the map are TaiRON roadkill. The lede reuses `site.description` ("公開熱點地圖"), so the page opens with an SEO sentence. Crediting TaiRON "fully" should start here, not only in the footer.
3. **No hierarchy on any prose page.** h1 30px, h2 18px, body 14px `text-ink-600`, identical `mt-10/12` rhythm, eight times in a row on /privacy. On desktop a 672px column sits in 1440px of beige (about-fold, privacy-full). Nothing is bold, nothing is big, nothing is pulled out — exactly the "timid at large sizes" the review and the owner describe.
4. **Body text is 14px (and the licence table 12px)** for the pages that are nothing but reading (attribution/page.tsx:86; PageHeader.tsx:54). CJK at 14px in mid-green on cream is tiring; the review's target is 16px.
5. **Three hand-rolled copies of one prose pattern** (about `Block`, PageHeader `ProseSection`, attribution inline) with drifting spacing (`mt-12` vs `mt-10`, `mt-3` vs `mt-2`, `pt-14 sm:pt-20` vs `pt-12`).
6. **A 404 or error strips the whole site.** `not-found.tsx` and `error.tsx` live at `[locale]`, above the `(site)` layout, so the header, footer, wordmark and language switch all vanish (team-fold, notfound-fold). The visitor gets an unbranded near-empty screen with two 28px-high pills — the opposite of a confident identity.
7. **Two 404s that differ for no reason**: 30px vs 36px numeral, different body sentence, different button pairs (home+species vs home+map), `px-4 py-1.5` vs `px-5 py-2` (not-found.tsx:8-15 vs global-not-found.tsx:34-51).
8. **"回到地圖 / Back to map" goes to the home page** (error.tsx:34-38, not-found.tsx:12-14, messages `errors.backHome`). Verified claim `error-links`.
9. **global-not-found is Chinese-only in its actions.** `/en/typo` gets a zh title tag, 回首頁 and 查看地圖 buttons, and links to `/` and `/map` (zh) — an English visitor is dropped into the other locale (global-not-found.tsx:10, 43-54).
10. **global-error is from the retired palette and the wrong surface**: slate `#94a3b8`/`#475569` and emerald `#10b981` on bark, while every other error page is light paper (global-error.tsx:11-17).
11. **Contact is a personal gmail, hard-coded as fallback in three files** (about/page.tsx:42, privacy/page.tsx:45, SiteFooter.tsx:52) and is the 個資法 contact of record. It reads as a hobby project on the two pages meant to build institutional trust.
12. **GBIF wording**: /attribution correctly says "we intend to publish" (`attribution.ourDataBody`) while the home page says records "are published" — the supporting page is right and the rest of the site must match it (claim `gbif-copy`).
13. **Skeleton and loading copy is English-only** on a zh-TW-first site: `sr-only` "Loading…" (Skeleton.tsx:56) and "Loading the map…" (map/loading.tsx:14). Skeleton shapes will also lie the moment the real pages are redesigned.
14. **Small inconsistencies that read as carelessness**: 台灣 (6) vs 臺灣 (13) in zh-TW.json, both visible on /about; `lang` is `zh-TW`, `zh-Hant`, and `zh-Hant-TW` across the three shells; /about, /attribution, /privacy, /stats are missing from `app/sitemap.ts:40-47`; the attribution total row duplicates the only data row.

## What works

- The copy on /privacy and the blurred-locations section of /about is specific, plain and true ("那可能是一隻石虎"). Keep the words; change the setting.
- /attribution is generated from `reports_public` (licence, rights holder, count), so it cannot drift. Links to 路殺社, GBIF and TaiCOL are inline credits, not calls to leave.
- /team 404s while empty, the footer link is gated, and tests enforce both. Correct call.
- global-not-found exists at all, ships no client bundle, and is bilingual by hand; global-error is dependency-free.
- Skeletons mirror layout rather than spinning, are server-rendered, carry `aria-busy`, and the map's is dark to avoid a white flash.
- Phone layouts of all four prose pages are clean, with no overflow and comfortable line length.

## Constraints a redesign must respect

- **Privacy**: /attribution queries only `reports_public` through `asPublic` (attribution/page.tsx:37-46). Any new figure on these pages must do the same. /about must keep the promise, not the mechanism (comment, about/page.tsx:24-29: no database roles or offset internals).
- **Skeleton boundary position is load-bearing** (Skeleton.tsx:13-23): a loading.tsx above a route that calls `notFound()`/`redirect()` turns 404s and 307s into 200s. That is why list pages sit in `(directory)` and `(list)` groups. Do not add loading.tsx to /species/[id], /reports/[id], /team, or a parent of them.
- **global-not-found** bypasses layouts, router and next-intl; it must stay plain `<a>`, import globals.css itself, and keep both languages written out. **global-error** has no stylesheet: inline styles with token hex values only.
- **Team**: no placeholder people, ever; per-person written consent under 個資法; FlamaWatch needs its own agreement and is a separate organisation; add /team to the sitemap when the first person lands (lib/team.ts; test/team.test.mjs pins 404, no link, empty array literal).
- **個資法**: the privacy page must name a person and a working address; the mailto must stay reachable from both footers.
- **Tests**: e2e/pages.spec.mjs loads /about, /attribution, /privacy and fails on console errors and leaked message keys; `errors`, `about`, `privacy`, `attribution` are in its namespace list. CI enforces en/zh-TW key parity.
- **Tokens**: pages are paper/ink; bark/parchment are map-only (globals.css:11-20). ember-500 fails as text on paper — links use ember-700. A class without a `--color-*` token silently emits nothing.
- **i18n**: `"palt"` is applied to zh; no tracking tricks on Hanzi; new zh copy needs a native reader. Never write a "nobody has reported yet" sentence when rewriting /about.
- **Performance**: these are static/ISR server pages with zero client JS beyond the shell (error.tsx is the only client component). Keep it that way; Badge on /about uses `priority`.
- **Data truths**: no wildlife photography, no team photos, emblem artwork still says ECOWATCH and is 512px — at 112px on /about it is legible and the mismatch is readable.

## Verified review claims in this area

- `error-links` (partly confirmed) — "Back to map" label points at `/` on error.tsx and not-found.tsx only; global-error uses retired slate/emerald hex on a dark surface.
- `gbif-copy` — /attribution's "we intend to publish" is the accurate string; home strings contradict it. Fix the others toward this one.
- Adjacent, not owned here: `tiny-text` (footer 10-11px and the 12px licence table are the same disease), `header-badge` (Badge.tsx docblock references a deleted Mark), `season-coverage` (filed under "supporting" in the JSON but belongs to /season).

## Questions for the owner

1. Who is "we" on /about: an organisation name, BioWatch International as parent, named people? May the page say plainly that today's records come from 路殺社?
2. Is there, or will there be, a project email address to replace the personal gmail as public and 個資法 contact?
3. When will real team content (names, roles, headshots, consent) exist — should the redesign include a team layout at all in phase one?
4. Should /about, /attribution and /privacy stay three pages, or become one "About" with sections (fewer words, fewer destinations)?
5. 台灣 or 臺灣 as house style?
6. Should error and 404 pages carry the big emblem (consistent with "logo a lot bigger"), given the artwork still reads ECOWATCH?
