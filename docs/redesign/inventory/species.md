# Design inventory: Species (directory + detail)

Paths are relative to `apps/web/`. `DIR` = `app/[locale]/(site)/species/(directory)/page.tsx`, `DETAIL` = `app/[locale]/(site)/species/[id]/page.tsx`. Screenshots are in screenshot captures (not committed; regenerate with `apps/web/e2e/_shots.mjs`).

## What it is for

- `/species` (directory): find an animal by the name you know (Chinese, vernacular or Latin) and see which species are being recorded most.
- `/species/<id>-<slug>` (detail): learn what this animal is, whether it is protected/endemic/invasive, where in Taiwan it has been recorded and in which months; then report one.
- Species OG image: make a shared link ("look how many 石虎 ...") read as the animal, not as a generic site card.

## What is on screen today

### Directory, desktop (species-dir-fold / -full)
max-w-5xl column. Top to bottom: 3xl h1 物種名錄; one-line grey lede; a 576px search box that looks like a disabled field (paper-100 on paper-50, 1px border); five small pill filters (有紀錄 active in solid ink, 全部, 保育類, 入侵種, 特有種); then a two-column grid of 80 identical beige bordered rows. Each row: 14px Chinese name, 12px italic Latin, optional 10px chips, count + 筆 right-aligned in grey. Then the footer. No total, no "80 of 354", no next page.
The eye lands on the h1 and then nothing: every row has the same weight, the largest number (3,978) is set the same as the smallest (90), and the only colour on the page is a scatter of tiny rose/orange chips. Rows with chips are taller, so grid rows are ragged (DIR:107 `h-full` makes the chipless neighbour a half-empty box). Full page is 3,909px: a spreadsheet with rounded corners.

### Directory, phone (species-dir-phone-fold / -full)
Same order in one column. Header + nav row + title + search + pills use the first 650px; about five species fit in the first viewport. Full page is ~7,060 CSS px (over eight screens) of identical cards. The pills fit on one row in zh; five English labels ("Invasive species") will wrap.

### Detail, desktop (species-detail-fold / -full, -en-)
max-w-3xl (720px) column. 12px back link; 3xl name; 16px italic Latin + authority; 12px "也稱作"; 10px status chips (sky blue); 12px habitat pills with a coloured dot; 11px lineage breadcrumb (plain text, not links). Then h2 通報紀錄, "3,978 筆通報紀錄 2011-2017" in 14px grey, a 720x320 dark map, a 56px-tall bar chart with 9px month numbers, an 11px summary, and a small outlined pill "+ 我也看到了，通報一筆". Whole page is 1,331px; roughly a third of it is footer.
The eye lands on the black map panel because it is the only dark, saturated object. But the island occupies the left third and the right ~60% is empty black sea, under a white attribution pill wider than the island. The name is second; the one compelling number (3,978) is grey body text. The strongest story on the page (April peak: toad breeding migration) is the smallest thing on it.
EN: the h1 is the bare binomial, upright; the Chinese name beneath is italicised; there is no English common name anywhere (the data has none).

### Detail, phone (species-detail-phone-fold / -full)
Same stack. Header block is tidy and legible. The map is 256px tall and crops the island: the west coast touches the left edge, the southern tip sits under the attribution pill, and half the panel is empty sea. Chart is readable. CTA pill is small and low-contrast. Footer is 45% of page height.

### States not in the screenshots (from code)
- Sparse (1-5 records): map in dots mode plus a list of rows "date | lat, lng ≈" (DETAIL:225-249); no chart.
- 6-39 records: map without the heat option, plus chart.
- Zero records (~65,850 taxa, rendered on demand): centred box "目前還沒有這個物種的通報" + ember pill "+ 成為第一筆通報" (DETAIL:189-198).
- Coordinates withheld (座標不開放): amber notice, no map, no count (DETAIL:185-188).
- Sensitive but mapped: 11px amber "locations are blurred" line under the map (DETAIL:219-223).
- Heavily-listed species (e.g. 石虎) stack six 10px chips.

### OG image (`species/[id]/opengraph-image.tsx`)
1200x630 dark bark card: 62px badge + letter-spaced "PROJECT FORMOSAWATCH", 78px name in the page's language (CJK font subset fetched per card, Latin fallback), Latin second line, ember "N 筆紀錄", optional outlined pills 保育類 / 台灣特有種, grey footer line. Competent, but it is the old dark identity while the site is now paper; its strings are hard-coded, not in the message catalogues.

## Components

| File | Role | Used by | Verdict | Note |
|---|---|---|---|---|
| `components/species/StatusBadges.tsx` | Conservation/endemic/invasive/sensitive chips; codes translated to words | DIR, DETAIL, SpeciesCard | restyle | Logic is excellent and hard-won (three data traps, lines 54-128). Presentation is 10px chips in off-system sky/rose/amber. Keep logic, redo the look; consider a plain-language status line on detail. |
| `components/species/HabitatChips.tsx` | 陸域/淡水/半鹹水/海域 pills with colour dot | DETAIL, SpeciesCard, `map/ReportPanel` (dark tone) | restyle | Null-safe logic is right. Hex colours inline (lines 18-21), not tokens. Yet another pill. |
| `components/species/MonthlyChart.tsx` | 12-bar month histogram | DETAIL | rebuild | 56px tall, 9px labels, `role="img"` hides values, hover-only titles. Near-duplicate of `stats/Columns.tsx`: merge into one chart. |
| `components/species/SpeciesMap.tsx` | Per-species MapLibre map, heat/bins/dots toggle | DETAIL | restyle (keep data path) | Tile reuse = inherited blurring. Framing, empty half, no legend, scroll capture and attribution overlap are the problems. |
| `components/species/SpeciesSearch.tsx` | Debounced search box | DIR | rebuild | Drops `filter`; visually reads as disabled; no clear button, no result count. |
| `components/species/SpeciesCard.tsx` | "Field card": name, badges, habitat, lineage, records + peak month | `reports/[id]` only | merge | Duplicates the DETAIL header almost field for field but is not used there. One species-identity block should serve both. |
| `species/(directory)/loading.tsx` | Skeleton | DIR | keep (re-mirror) | Must match the new grid. |
| `lib/species.ts` | Queries, slug, ranking, `isIndexworthy` | all | keep | Privacy- and relevance-critical; has `offset` already. |
| `species/[id]/opengraph-image.tsx` | Share card | detail | restyle | Align to new identity; move strings to catalogues. |

## Design problems

1. **No hierarchy in the directory.** 80 identical beige boxes; count, name and status all whisper (DIR:107-127; species-dir-full). A visitor cannot tell what is common, what is protected, or where to start. The review calls it efficient but discovery-poor.
2. **The list silently stops at 80 of 354** with no total or pagination (DIR:51-55). 274 recorded species are reachable only by search. [directory-cap]
3. **Empty state lies for real species.** Default filter is "recorded", so searching a checklist species with no records says 找不到符合的物種 (DIR:89-92) with no pointer to 全部.
4. **Typing in search drops the chosen filter** (`SpeciesSearch.tsx:29`). [species-search-drops-filter]
5. **Names truncate** (DIR:110,114 `truncate`): long binomials and subspecies names are cut in exactly the field people use to distinguish species.
6. **Pills everywhere.** Filters, habitat, status chips, map toggle and CTA are all small rounded capsules (DIR:76; `HabitatChips.tsx:49`; DETAIL:194,263). This is the interface language the owner said they dislike; links, filters, facts and actions look alike.
7. **Tiny type, in CJK.** Status chips 10px (`StatusBadges.tsx:141`), lineage 11px (DETAIL:176), chart labels 9px (`MonthlyChart.tsx:30`), notices 11-12px (DETAIL:186,220). [tiny-text] The legally meaningful facts on the page are its least legible.
8. **Species map composition is broken.** `fitBounds` pads 52% on the right (`SpeciesMap.tsx:106-116`) to keep Fujian out, so desktop shows an island in the left third of a 720px black slab; on phones the same rule crops the west coast and the south (species-detail-phone-fold). The expanded attribution pill covers the bottom. The panel is short (h-64/h-80) and wide while Taiwan is tall and narrow: the container shape fights the subject.
9. **Map captures scroll and has no legend.** Fully interactive, `navigation:false`, no cooperative gestures (`lib/map.ts:144-170`): a wheel or one-finger drag passing over it zooms/pans instead of scrolling the page. Dot size and bin colour are never explained. Emerald #34d399 dots (`SpeciesMap.tsx:244`) belong to no site palette.
10. **Dark map slab on a paper page.** The only dark object on a light page reads as an embedded widget rather than part of the page. Given the owner's coolness toward the homepage map, do not assume the map should lead here.
11. **The best content is buried.** Seasonality is what `lib/species.ts:213` calls the most scientifically useful chart; it is 56px tall with a caption "共 3,978 筆，4 月最多。". No sentence-level interpretation anywhere ("most often found in April").
12. **Chart values are invisible to AT, touch and keyboard** (`MonthlyChart.tsx:22,28`). [chart-a11y]
13. **Dead ends.** Detail links only back to the directory and to `/report`. No link to `/map?taxonId=` or `/reports?taxonId=` although both exist (`map/page.tsx:97`, `reports/(list)/page.tsx:101`; string `species.seeAllRecords` is used only on report detail). Lineage is plain text, so you cannot browse to relatives.
14. **"Seen one? Report it" forgets the species** (DETAIL:193,262). [report-prefill] And the CTA is a faint outlined pill at the very bottom.
15. **Zero-record copy contradicts a standing owner decision.** "目前還沒有這個物種的通報 / No reports for this species yet" + "成為第一筆通報" (DETAIL:189-198; `cardRecordCount` =0 "尚無紀錄") is the sentence the owner said never to write, and it is what ~65,850 on-demand pages show.
16. **Sparse-record rows lead with raw coordinates** and the only link is the date (DETAIL:226-248); "≈" is an unexplained glyph for "obscured".
17. **English pages are second-class.** Binomial h1 is upright, the Hanzi secondary is italicised (DETAIL:151, DIR:114; the OG file's own comment, line 138, says italic is wrong for Hanzi, and SpeciesCard gets it right). No English common names exist, so /en/species is a wall of Latin.
18. **No imagery, and none available.** Nothing on either page looks like an animal. Any picture-led redesign has no pictures to use.
19. **Off-system colour.** Status tones use Tailwind default sky/rose/amber (`StatusBadges.tsx:40-46`), habitat dots are inline hex, map colours are neon; none are `@theme` tokens.
20. **"通報紀錄 / reports" wording** for data that is 100% imported TaiRON roadkill, with no source line on the page itself (only the footer).

## What works

- Data honesty is first-rate: status codes rendered as words in both languages, split CITES listings, plant vs wildlife statutes, unknown habitat drawn as nothing rather than a false absence.
- Data-aware states: heat gated at 40 records, chart at 6, list at 1-5, withheld and blurred cases each handled and explained.
- Search quality: alternate-name matching, exact-match ranking (石虎 lands on the taxon with the records).
- Detail header on phone: name, Latin, authority, aka, read cleanly in order; zh typography is unforced.
- Default "recorded" filter, and chips keep `q`.
- The OG card leads with the Chinese name and degrades to Latin instead of erroring.
- Pages are server-rendered and light; MapLibre is the only heavy client code and only on species with records.

## Constraints a redesign must respect

- **Privacy.** All reads go through `asPublic` and `species_report_stats`/`reports_public` (`lib/species.ts:36-41`); never count from `reports`. Withheld taxa show no count, no map, no coordinates, in the page and in the OG card (DETAIL:125-129; OG:57-60). `test/species.test.mjs` pins: no leaked suppressed taxa, empty tiles for suppressed taxa, no `dd.dddd, ddd.dddd` pairs in their HTML. The species map must keep using `/api/tiles?taxonId=` so blurring is inherited. Sparse lists show `location_public` only.
- **Map performance.** Reuse `createMap` and the preloaded MapLibre path; do not add a second map or mount one on zero-record or directory pages. `bounded:false` and the east-weighted fit are there for stated reasons (`SpeciesMap.tsx:87-116`); replace them knowingly. `test/map-bins.test.mjs:100-127` pins the heat gate and the fallback when the stored preference is heat. The mode toggle shares one preference with `/map`; the owner's "colour is a switch between density and type" decision must stay consistent across both.
- **Scale and SEO.** ~400 pages prerendered, ~65,850 on demand; `isIndexworthy` decides `noindex`. A new layout must look intentional with zero badges, zero habitat, zero records, no Chinese name (the common case across the checklist). Canonical slug redirect and `revalidate = 300` stay.
- **i18n.** Every string in both catalogues (parity is CI-enforced); e2e checks for leaked `species.*` keys. Italic only for Latin binomials. No letter-spacing on CJK. `recordsShort` 筆 must stay on one line with its number (DIR:120-121). New zh-TW copy needs a native reader. OG strings currently bypass the catalogues.
- **Tokens.** New colour classes need `--color-*` tokens or they emit nothing (design-tokens test names the species card and picker).
- **A11y.** 24px minimum targets, AA contrast on paper, chart values exposed as text, a keyboard/touch path for anything hover-only, reduced motion.
- **Data truths.** All records are imported roadkill, 2011-2017 for the top species; no photos, no licensed imagery, no English common names. "Records", never "rarity" (`SpeciesCard.tsx:98-101`). Reference imagery, if ever added, must stay distinct from report evidence (review).
- **Owner decisions.** Credit TaiRON without sending readers away; never write a "nobody has reported yet" sentence; trust the reporter.
- `e2e/pages.spec.mjs` visits `/species` and `/species/28758-duttaphrynus-melanostictus` (7s settle); `SpeciesCard` is also rendered on report detail and `HabitatChips` inside the dark map panel.

## Verified review claims in this area

- `directory-cap`: directory hard-capped at 80, no pagination or total; empty state is false for unrecorded species.
- `species-search-drops-filter`: search rewrites the URL with only `q`.
- `report-prefill`: species-page report links are bare `/report`; the form cannot accept a taxon.
- `tiny-text`: 10px status chips, 9px chart labels (shared with stats/report form).
- `chart-a11y`: `role="img"` hides bar values; hover-only titles (shared with `stats/Columns.tsx`).
- Adjacent, owned elsewhere: `lang-drops-query` (language switch loses `q`/`filter` here too).

## Questions for the owner

1. With no photographs and no licence to any, what should a species page look like: typographic only, commissioned illustration for a flagship few, or links out for reference images?
2. Should the species page lead with the map at all, or with the name, status in plain words, and one sentence of findings (count, years, peak month), with the map second?
3. What should the ~65,850 zero-record pages say, given "never write nobody has reported yet"? Omit the records section entirely? Keep those pages at all in the "全部" filter?
4. Directory: a ranked list of what is recorded most, or a browse-by-group entry (蛙, 蛇, 鳥, 哺乳類) with search on top? Should taxonomy be navigable?
5. English: accept Latin-only headings, or source English common names (GBIF/IUCN vernaculars) as a data task?
6. Is the collectible "species card" idea (SpeciesCard's header comment) still wanted, and should it and the species page share one identity block?
7. Wording: "通報紀錄 / reports" or "路殺紀錄 / records from TaiRON" while every record is imported roadkill? Should the species page carry its own source line?
8. Should the species map keep the heat/grid/dots toggle, or follow whatever the main map ends up with and default to one view?
