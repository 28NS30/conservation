# Design inventory: "datastories" (Statistics + the seasonal goal)

Routes: `/stats`, `/season` (and `/en/...`). All paths below are relative to `/Users/neo/conservation/apps/web/`.
Files: `app/[locale]/(site)/stats/page.tsx`, `app/[locale]/(site)/season/page.tsx`, `components/stats/Bars.tsx`, `components/stats/Columns.tsx`, `lib/stats.ts`, `lib/coverage.ts`, message namespaces `statsPage` and `season`.
Screenshots: `shots/stats-*.png`, `shots/season-*.png` (zh-TW only; there is no English capture of either page).

## What it is for

- `/stats`: let a curious visitor (or a journalist, teacher, road agency) learn in a minute what the 46k records say: which animals, when in the year, where.
- `/season`: give everyone who reports one shared, un-farmable target (first record in an empty 5 km square) and make them want to go and file one.

## What is on screen today

### /stats, desktop (1440; `stats-fold.png`, `stats-full.png`)
A 1024px column (`max-w-5xl`). Top to bottom:
1. `PageHeader`: 30px h1 "資料統計", one 14px grey line: "所有已公開通報的彙整。資料每 15 分鐘更新一次。"
2. A full-width ember-tinted banner linking to `/season` ("本季目標" + one line + arrow). It is the only coloured block on the page, so it is what the eye lands on first, above any statistic.
3. Four equal metric tiles in a row: 46,334 / 458 / 84% / 2011–2017. 20px numbers under 11px labels; all four have identical weight.
4. Two-column grid of bordered `paper-100` cards: "月份分布" (12 moss bars, July in ember, 64px tall, 9px axis digits, "7月最多。" under it) beside "逐年通報" (7 bars, 2011 and 2012 are 2px slivers). No y-axis, no values printed.
5. "最常通報的物種": ranked list of 15 (rank, zh name, italic Latin name, count, share%). Beside it "熱點路段": ranked list of 8, each "以〈species〉為主" + a lat/lng pair + "1,264 筆".
6. Full-width "關於位置精確度" card: one paragraph about 2,721 blurred records and a link labelled "關於本站".
The fold holds the header, banner, tiles, both charts and the first four rows of each list: dense, tidy, and entirely the same beige. Everything is a rounded card inside a rounded-card grid; nothing is large. The right column ends ~350px before the left, leaving a visible hole under the hotspot card (`stats-full.png`, right side, y≈1140–1480), and the two chart cards are different heights for the same reason (`items-start`).
The "By category" panel is not rendered at all: it is gated on `cats.length > 1` and the corpus is 100% roadkill.

### /stats, phone (390; `stats-phone-fold.png`, `stats-phone-full.png`)
Same order, single column, about four phone screens (3,270 CSS px including the footer). Fold: title, lede, season banner, 2×2 tiles, top of the month chart. The charts actually read better here than on desktop because the card is nearly as wide but the page is not competing with it. Then 15 species rows and 8 hotspot rows make two long, visually identical lists; by the hotspot list the page is a wall of small grey rows.

### /season, desktop (`season-fold.png`, `season-full.png`)
A 768px column (`max-w-3xl`), so the title sits 128px further right than on `/stats`. Top to bottom:
1. h1 "本季目標" + a two-line lede.
2. One large card: letter-spaced ember eyebrow "本 季 · 至 9 月 3 0 日"; a 48px **"0"** followed by "/ 40"; "個新達成的 5 公里方格"; an empty grey progress track; the sentence "本季還沒有新的方格。…"; an ember pill "我要通報".
3. h2 "目前的地圖覆蓋" + two tiles: "1,366" squares with a record; "458 / 66,201" species of the checklist. Then a paragraph about the 2,721 records left out.
4. h2 "為什麼算方格，不算筆數" + two paragraphs of reasoning (no bounty, no leaderboard).
5. A rule and two outline pills: "開啟地圖", "完整統計".
The eye lands on a giant zero over an empty bar. The rest is prose. There is no picture of a square, a map, or the island anywhere on a page whose whole subject is geography.

### /season, phone (`season-phone-fold.png`, `season-phone-full.png`)
Identical order; the fold is title, three-line lede, and the "0 / 40" card down to its button. About two and a half screens, nearly all of it text.

## Components

| file | role | used by | verdict | note |
|---|---|---|---|---|
| `components/stats/Columns.tsx` | DOM-only vertical bars (months, years); 64px tall, 9px labels, values only in `title` | stats ×2 | rebuild | Keep zero-JS server rendering; print values, real size, locale. Merge with near-duplicate `components/species/MonthlyChart.tsx`. |
| `components/stats/Bars.tsx` | Horizontal proportion bars with visible counts and % | stats, category split only | restyle + reuse | Never renders in production (one category). The better pattern; top species and hotspots should use it. |
| `Section` (`stats/page.tsx:31-55`) | Beige rounded "dashboard panel" | stats | delete | The uniform-tile language: 14px titles, 11px hints. |
| metric tiles (`stats/page.tsx:110-138`) | Four headline numbers | stats | rebuild | Duplicates the header stat strip (`SiteHeader.tsx:83-88`); no hierarchy. |
| season banner (`stats/page.tsx:93-108`) | Link to `/season` | stats | move | Should follow the data, not precede it. |
| `Figure` (`season/page.tsx:153-171`) | Number + label + hint | season | merge | Same thing as the stats tile; one shared component. `<dd>` before `<dt>`, `<p>` inside `<dl>`. |
| goal card (`season/page.tsx:66-101`) | Counter, progress bar, CTA | season | rebuild | Problems 1, 2, 8. |
| `lib/stats.ts` | Aggregates over `reports_public` (also feeds the homepage) | stats, home | keep | Correct, tested, privacy-reviewed. |
| `lib/coverage.ts` | Coverage scalars | season | keep + extend | Counts only; showing squares needs a `coveredCells()` sibling with the identical filter. |

## Design problems

1. **The season page's hero is a zero, and it will stay a zero.** `newThisSeason` counts only `source = 'user'` rows (`lib/coverage.ts:77-89`) and there are no user reports, so the biggest type on the page is "0 / 40" over an empty bar (`season-fold.png`), and it resets to 0 every quarter (next: 1 October). The accompanying sentence "本季還沒有新的方格 / Nothing new yet this season" (`messages/*.json` `season.noneYet`, rendered `season/page.tsx:92`) is, in effect, the "nobody has reported yet" sentence the owner has banned. `speciesHint` ("其中絕大多數在本站從未被通報過") is the same kind of sentence. To a visitor this reads as an abandoned campaign.
2. **The goal cannot be acted on.** The page tells people to find a square with no record and shows no squares; "開啟地圖" is a bare `/map` link (`season/page.tsx:136-141`) and the map draws only occupied cells on a different grid. (Verified claim `season-coverage`.)
3. **"458 / 66,201" makes the project look negligible and compares unlike things** (`season/page.tsx:113-117`, `lib/coverage.ts:93`): road-killed vertebrates and crabs against an all-kingdoms checklist. 0.7% is not a fact a visitor can do anything with.
4. **Too many words justifying the design to a visitor who never questioned it.** Two paragraphs on why not a bounty and why no leaderboard (`season/page.tsx:124-133`), plus a paragraph on excluded records. It is the code comment (`season/page.tsx:24-41`) published as body copy. The owner asked for fewer words.
5. **Stats is a grid of equal beige tiles with no lead.** Every panel has the same card, 14px title, 11px hint (`stats/page.tsx:42-54`); the four headline numbers are 20px (`:133`). Nothing says "here is the finding". The most striking facts (黑眶蟾蜍 is nearly three times second place; July peaks; 2017 towers over every earlier year) are left for the reader to extract. The review says the same: lead with the question each chart answers.
6. **Charts are too small and carry no numbers.** 64px tall (`Columns.tsx:12`), 9px axis labels (`:46`), no y-axis, values only in a hover `title` (`:44`) that touch and keyboard users never get, formatted with no locale. English month axis is J F M A M J J A S O N D (`stats/page.tsx:80-84`). (Verified `chart-a11y`, `tiny-text`.)
7. **"Refreshed every 15 minutes" next to "2011–2017"** (`statsPage.intro`; tile at `stats/page.tsx:121-126`). The freshest thing the page says about itself is contradicted by the tile below it. The by-year chart ends nine years ago with no explanation beyond a survey-effort caveat.
8. **Letter-spaced, uppercase eyebrow on Chinese text**: `uppercase tracking-[0.22em]` on "本季 · 至 9月30日" (`season/page.tsx:67`) visibly spreads the CJK glyphs and digits apart (`season-phone-fold.png`). This is exactly the trick the bilingual constraint forbids.
9. **Hotspots are unreadable as places.** Rows are "以奧氏後相手蟹為主 / 22.631°N, 121.475°E" (`stats/page.tsx:261-274`); three of the eight rows have the same title and differ only in digits. By the coordinates those three are Green Island and 26.149°N is Matsu, but the page never says so. The zh title "熱點路段" (road sections) also mis-describes 5 km squares; the English says "Hotspots".
10. **The season promo sits above the statistics** (`stats/page.tsx:93-108`), is the only coloured element in the first viewport, and sends the reader to problem 1 before they have seen a single number.
11. **Ragged desktop grid.** `items-start` (`stats/page.tsx:144`) with a 15-row list beside an 8-row list leaves a 340px hole in the right column and mismatched chart-card heights (`stats-full.png`).
12. **Micro-type**: 9px protected/invasive chips (`stats/page.tsx:208,213`), 10px share% and unit (`:228,:278`), 11px hints. Protected/invasive status is the most newsworthy attribute in the list and the least legible.
13. **Sibling pages disagree**: `max-w-5xl` vs `max-w-3xl` makes the h1 jump 128px sideways between them, and the season page's pills (`season/page.tsx:97,138,144`) are the interface language the owner dislikes.
14. **Mislabelled link**: the stats panel keyed `coverage` is about location blurring, and its link "關於本站 / About the project" (key `howObscuringWorks`) goes to `/about`, not to the privacy explanation (`stats/page.tsx:288-300`).

## What works

- Zero client JavaScript on both pages; six aggregates in parallel; `revalidate = 900`. Fast and cheap.
- The top-species list: zh name first with Latin beneath (swapped for English), count, share, each row a link to the species page. It needs scale and a visual magnitude, not a rethink.
- Honest caveats: "changes reflect survey effort as well as events" (`byYearHint`) and the statement that blurred records still count. The review asks for these to be kept.
- The coverage idea is thoughtful and un-gameable, and "1,366 squares" is a real, non-zero, growing number.
- The ember peak bar with a plain sentence under it ("7月最多。"): a chart with its conclusion written out.
- Hotspot rows deep-link to `/map?lng&lat&z=11`; the season end date is derived, so never stale.

## Constraints a redesign must respect

- **Privacy lives in the queries.** Every aggregate goes through `asPublic()` on `reports_public` (`lib/stats.ts:4-12`). Hotspots and coverage exclude obscured rows because a blurred record sits at a 10/50 km cell centre and would manufacture a hotspot pointing at a sensitive species (`lib/stats.ts:200-211`, `lib/coverage.ts:19-24`). Any new squares layer, place-name join or map must reuse `where not is_obscured` and the `floor(x/5000)` lattice. Enforced by `test/stats.test.mjs:46-120` and `test/coverage.test.mjs`.
- `/season` must keep saying obscured records are excluded from squares but counted elsewhere: `test/coverage.test.mjs:161-177` greps the English HTML for the covered count (en-US format) and the literal phrase "left out of the squares above".
- An import is a backfill, not an arrival (`lib/coverage.ts:65-76`): imported cells are never "newly reached".
- No reward, points, ranking or leaderboard (recorded decision, `season/page.tsx:38-40`); anonymous reports count equally.
- Never a "nobody has reported yet" sentence: the zero state needs designing around, not rewording. Do not state GBIF publication as a present fact.
- The category panel stays hidden while there is one category (`stats/page.tsx:145-148`).
- Bilingual: key parity in CI; `e2e/pages.spec.mjs:29-32` loads all four URLs and fails on a leaked key or console error; `generateMetadata` on `/season` must pass `{ km }` (`season/page.tsx:16-21`). No letter-spacing or uppercase on CJK. New zh-TW copy needs a native reader.
- Small load-bearing details: columns keyed by index because narrow English month names collide (`Columns.tsx:31-32`); 2px minimum bar so zero does not read as missing (`:41-42`); `Bars` floors slices at 0.8% (`Bars.tsx:39-40`).
- Accessibility: ember-500 fails as text on paper (use ember-700); chart values reachable without hover; the progress bar may stay `aria-hidden` only while the number is in text.
- Performance: keep both pages server-rendered with no chart library; if `/season` gains a picture of squares, use static SVG or a link into `/map`, not MapLibre on a content page.
- Tailwind classes need a `--color-*` token (`test/design-tokens.test.mjs`); the `amber-*`/`rose-*` chips lean on Tailwind's default palette, not project tokens.

## Verified review claims in this area

- `chart-a11y`: `Columns.tsx` uses `role="img"` with only a title; no value table; hover-only values; English narrow month labels are ambiguous; the doc comment claims a table that does not exist.
- `season-coverage`: `coverage()` returns only scalars; nothing on `/season` or `/map` shows which squares are empty, so the goal is not actionable.
- `tiny-text` (shared): 9px chart labels and chips, 10px share/unit text on `/stats`.
- `gbif-copy` (shared, borderline): `season.noRewardBody` reads as if records are already published as an open dataset.
- Related but owned elsewhere: `ledger-coords` (the homepage ledger is fed by `lib/stats.ts`; same "coordinates instead of places" problem as hotspots). `biowatch-stats` concerns the parent site's hardcoded fallback figures, not these pages.

## Questions for the owner

1. Should `/season` exist publicly before there are real reporters? Options: hide it until launch, or lead with the non-zero figure (1,366 squares mapped) and drop the "0 / 40" counter until it can move.
2. Is 40 squares per quarter a real commitment or a placeholder (`NEXT_PUBLIC_SEASON_TARGET`)?
3. Do you want a picture of the squares (the island with covered cells filled)? You disliked "records in the shape of the island" on the homepage; this would be functional rather than decorative, but it is the same visual family.
4. Keep "458 / 66,201 species", replace the denominator with something comparable (e.g. Taiwan's terrestrial vertebrates), or drop it?
5. May hotspots carry township/county names? That needs an administrative-boundary table in the database (same work as the homepage ledger fix).
6. One page or two? Stats and the goal could be a single "what the records say / where the gaps are" story; should `/season` stay a separate URL and should either be in the header nav?
7. How much of the "why squares, no rewards" reasoning must stay visible, versus moving to About?
8. Is "Refreshed every 15 minutes" worth saying while the newest record is from 2017, and how should the page explain the 2017 cut-off?
