# Design inventory: the map (`/map`, `/en/map`)

Code read at c73bb8d. Screenshots: `shots/map-fold.png`, `map-en-fold.png`, `map-phone-fold.png`, `map-en-phone-fold.png`, plus interaction states I captured read-only from production with headless Playwright (script: `inventory/map-states.mjs`): `shots/map-x-filters-open[-phone].png`, `map-x-heat-type[-phone].png`, `map-x-grid[-phone].png`, `map-x-city-popup[-phone].png`, `map-x-points[-phone].png`, `map-x-panel[-phone].png`.

## What it is for

- `/map` (one route, both locales): see where wildlife has been recorded in Taiwan, narrow it (type, species, years), zoom until dots become single records, open one record, and share the view by URL. It is also the site's main "explore" door and the page with the `+ 通報` button closest to hand at the roadside.
- `loading.tsx`: hold a dark shell while the stats query runs so the page does not flash cream then black.

## What is on screen today

**Desktop 1440 (`map-fold.png`)**, top to bottom, all inside `100dvh`, no scroll:
1. Cream header strip, ~53px: 28px badge + two-line wordmark (left); three stat pairs `46,334 筆紀錄 / 458 個物種 / 2011–2017 資料期間` in 14px over 10px; four 12px nav links; language switch; small orange `+ 通報` pill.
2. The map, neutral near-black OpenFreeMap dark basemap. Taiwan is deliberately pushed left (right padding 42% of width, `HeatmapView.tsx:179`), so the island occupies x 210-620 of 1440 and the right 55% is empty sea whose only content is three Japanese island labels (與那國町, 石垣市, 宮古島市). Data = thousands of small dots in blue/cyan/green with a few amber and red blobs. The eye lands on the rainbow mass, then on nothing.
3. Overlaid chrome: `篩選` pill top-left; MapLibre +/- top-right (29px); bottom-right a 145px-wide green-black legend card holding two segmented toggles (熱區/方格/圓點, 密度/類型), six swatch rows, a 10px caption; bottom-left a scale bar; bottom-right an expanded white attribution pill under the legend.
4. Cream footer strip, ~28px, 10px type: data credit (external links to roadkill.tw, gbif.org, taicol.tw), "2,721 筆敏感物種位置已模糊化", About/Attribution/Privacy/Contact.

**Phone 390 (`map-phone-fold.png`)**: header is wordmark + `+ 通報` only (no nav, no stats, no language). The same 42% right padding applies, so the island is squeezed into the left 55% of a 390px screen, its west coast touching the edge, with the top quarter of the map empty except stray Matsu dots. The legend card (145 x 245 css px) sits over the south-east sea; white attribution pill overlaps the scale bar. Footer wraps to two lines (~67px) and carries the language switch. Opening filters (`map-x-filters-open-phone.png`) drops a 320px-wide panel over Taipei and the whole north; with the legend, roughly 40% of the map is under furniture.

**Other states**
- Filters open, desktop: a small card of four pills (全部, 外來入侵種, 一般目擊, 路殺或受傷), a 176px species search, two native year selects, 清除篩選.
- City zoom z11.5 (`map-x-city-popup.png`): the map nearly disappears: 2-3px dim navy dots on black, because the lowest density class is intentionally dim. Clicking a dot opens a stock white MapLibre popup ("此區 1 筆通報 / 每格約 153 公尺 / 放大以查看個別紀錄") in `system-ui` with slate greys.
- Record zoom z15 (`map-x-panel.png`): rose-red 7px dots under dense street labels; legend still says 密度 with 300+ in the same red. Clicking a dot opens a 320px right panel: heading "路殺", a dashed "沒有照片" box, 物種 紅鳩 (link), a 陸域 chip, date, an 11px "開啟完整紀錄" link, then ~75% empty dark panel. The selected dot is not marked on the map. Phone: same content as a bottom sheet (max 55% height); its lower edge cuts through the attribution pill.
- Heat + Type (`map-x-heat-type.png`): a blue-to-rose KDE surface under a legend listing report types.

## Components

| File | Role | Used by | Verdict | Note |
|---|---|---|---|---|
| `app/[locale]/map/page.tsx` | Server page: stats, deep-link + filter parsing, header/map/footer in 100dvh flex | route | keep | `parseView` and `mapFilterSchema` parsing are load-bearing; `getStats` reads `reports_public` via `sql`, not `asPublic` |
| `map/layout.tsx` + `components/map/MapHints.tsx` | Preload MapLibre modules + basemap style outside Suspense | route | keep | Performance-critical; must stay a client component |
| `map/loading.tsx` | Dark skeleton | route | restyle | Hard-coded English sr-only string (line 14) |
| `components/map/HeatmapView.tsx` (1133 lines) | Everything: layers, handoff, URL sync, legend JSX, popup HTML, hint, skip link, dead hero mode | `/map` only | rebuild the chrome, keep the engine | Split legend/popup/hint out; `presentation` mode, `addMainlandMask`, hero framing (lines 37-127, 147-166) are unused: delete |
| `components/map/MapFilters.tsx` | Collapsed filter button + panel | HeatmapView | rebuild | Pills language the owner dislikes; two of three type chips return empty tiles today |
| `components/map/MapModeToggle.tsx` | heat/bins/dots segmented control | HeatmapView, SpeciesMap | restyle | 11px, ~25px tall; test pins order of `MODES` |
| `components/map/MapColourToggle.tsx` | density/type | HeatmapView | restyle + fix | Needs a disabled/hidden state for heat and for the point regime |
| `components/map/mapMode.ts` | localStorage stores via useSyncExternalStore | both maps | keep | Defaults pinned by `test/map-bins.test.mjs` |
| `components/map/ReportPanel.tsx` | Record panel / bottom sheet | HeatmapView | rebuild | Structure right, content hierarchy wrong for photo-less data |
| `lib/map.ts` | `createMap`: raw-ESM MapLibre, basemap fallback, ResizeObserver, `style.load` ready | 4 map components | keep | Every comment documents a real failure |
| `lib/basemap.ts` | OpenFreeMap dark + label rewrite (zh-Hant first, no maritime borders) | lib/map | keep logic, restyle values | Label colour/halo constants are the lever for "geography legibility" |
| `SiteHeader`/`SiteFooter` `variant="app"` | Thin strips around the map | `/map` | merge/rebuild | Phone dead end; 10px footer |
| `globals.css:147-218` | MapLibre control skin | all maps | restyle | Popup still stock white |

## Design problems

1. **Default framing wastes the screen, worst on phones.** `HeatmapView.tsx:179` pads the right by 42% at every width to keep Fujian out. On 390px the island gets ~225px (`map-phone-fold.png`); on desktop 55% of the canvas is empty sea labelled with Japanese islands. A visitor's first impression is a small island in a void.
2. **The legend misdescribes the map in three states** (legend-heat, legend-type-heat, legend-points). At z>=14 every roadkill dot is `#e11d48` beside a legend whose red means "300+" (`map-x-panel.png`); heat mode shows numeric "per cell" classes for a KDE; heat+Type shows a type legend over density colours (`map-x-heat-type.png`). Trust problem on the page whose job is counting.
3. **Six views, one dataset.** All 46k records are roadkill: "類型" paints the country one colour, and the 外來入侵種 / 一般目擊 chips return 0-byte tiles (checked on production) so the map goes blank with no explanation (and the owner forbids a "nobody has reported" sentence). Controls promise variety the data cannot deliver.
4. **The middle zooms look empty.** z10-13 renders 2-3px navy dots on black (`map-x-city-popup.png`); `dotColor` only brightens at 13.5 (`HeatmapView.tsx:317-328`). A visitor zooming to their town sees almost nothing until z14.
5. **Record panel leads with absence.** Order is category, "沒有照片" placeholder, then species at 12px (`ReportPanel.tsx:94-151`). With zero photos in the data, every panel opens on an empty dashed box and is three-quarters blank. No place name, no TaiRON credit (the API already returns `source`), the "open full record" action is an 11px underlined link, and the selected dot is not highlighted.
6. **Two dark worlds.** Chrome is green-black `bark-900` with parchment text; the basemap is neutral grey-black with `#9a9a9a` labels; the data is a saturated rainbow; the popup is stock white with slate text (`HeatmapView.tsx:788-799`); the attribution is a white pill. Nothing ties the instrument to the cream/green/ember brand around it.
7. **Pills and tiny type everywhere.** Filter chips, toggles, hint and legend are 10-12px rounded pills (`MapFilters.tsx:129-312`, `MapModeToggle.tsx:42`, legend `HeatmapView.tsx:1024,1115`); footer and header stat labels are 10px. Toggle buttons are ~25px tall, the panel close is ~25x28px: legal under 2.5.8, poor one-handed at the roadside. This is exactly the interface language the owner rejected.
8. **Phone dead end.** Below 640px the map header has no nav and the app footer has no Species/Statistics/List links (`SiteHeader.tsx:97-99,130`; `SiteFooter.tsx:54-70`). The only exits are the wordmark and `+ 通報` (map-mobile-nav).
9. **The list alternative is invisible** to mouse and touch users (`HeatmapView.tsx:969-985` is `sr-only`), and the list has no link back carrying filters (list-toggle).
10. **Language switch discards the view and filters** (`LanguageSwitcher.tsx:38`) although the map writes `lng/lat/z` and filters to the URL on every move (lang-drops-query).
11. **Header stats are the rejected idea in miniature**: "46,334 筆紀錄" in 14/10px is decoration nobody reads, hidden on phones anyway (`SiteHeader.tsx:83-91,156-165`).
12. **Small defects.** Zoom hint never shows on first load (set only in `zoomend`, `HeatmapView.tsx:813-819`); `loading.tsx:14` English-only; `color-scheme: dark` and the paper-coloured focus halo are global rather than scoped to the map (`globals.css:99-101,238-248`); ~150 lines of dead hero code; stale "z10" comments (`HeatmapView.tsx:735-737`); `amber-*` warning in the panel is off-token (`ReportPanel.tsx:180`).

## What works

- The load path: `MapHints` preloads, layers added at `style.load`, sources created in final state, `setTiles` only on change, mode/colour switches are repaints not refetches. Fast, and documented with measurements.
- The aggregation-to-points handoff (two sources, overzoom, shared radius ramp) has no blank band and is pinned by tests.
- Dots and grid are countable; circle area tracks count via sqrt; the grid view (`map-x-grid.png`) is the calmest, most legible of the three.
- URL as state (view + filters, `replaceState`), server-side validation of hostile query strings, filter panel auto-opens when a link arrives filtered and names the species in the page's language.
- Side panel on desktop / bottom sheet on phone is the right structure; Esc closes; the blurred-location notice is carried into the panel.
- Traditional-Chinese basemap labels, maritime boundaries removed, Kinmen/Matsu reachable, FALLBACK_STYLE if OpenFreeMap fails.
- Skip link before the canvas, labelled application region, live region for species results, focus rings on MapLibre buttons.
- Dark skeleton avoids the cream-to-black flash.

## Constraints a redesign must respect

- **Privacy:** tiles, `/api/reports/[id]` and `namedTaxon` read `reports_public` as `web_anon`; suppressed taxa must not be named above an empty map (`page.tsx:26-33`); obscured records must keep saying so in the panel (`ReportPanel.tsx:177-183`); never draw a "precise" marker for an obscured record. `TILE_SOURCE_BOUNDS` margin must not shrink.
- **Owner decisions:** colour stays a density/type switch; TaiRON credited in full but do not add outbound journeys (the footer already links out in a new tab: see questions); no "nobody has reported" copy for empty filters.
- **Performance:** keep MapLibre as raw ESM from `public/maplibre` (bundled worker silently breaks, `lib/map.ts:9-25`); keep `MapHints` client-side and in `layout.tsx`; keep `onReady` at `style.load`; keep filters in the tile query string (CDN key); no `router.replace` on pan; no new heavy client code in the map chunk.
- **MapLibre traps documented in code:** zoom expression must be outermost (`:259-265`); container must be `relative h-full`, not `absolute inset-0` (`:946-951`); no `maxBounds` (`:500-505`); tile URL by concatenation (`:281-287`); fills un-antialiased (`:576-579`).
- **Licensing:** OpenFreeMap/OSM attribution must stay visible; the phone sheet is offset `bottom-6` for this and still clips the expanded pill.
- **Tests:** `test/map-bins.test.mjs` pins `MODES` order, non-heat default, `type: "fill"` present, handoff zooms, density classes; `e2e/pages.spec.mjs:233-329` pins layer ids `reports-cells/dots/points`, skip link before canvas in tab order, every control named, URL tracks view without growing history; `test/design-tokens.test.mjs` requires real tokens.
- **i18n/a11y:** every string in both catalogues (`map.*`, `report.group.*`); species names shown in page language; `100dvh` layout is deliberate for mobile browser chrome; honour reduced motion for any new transitions (today `duration: 0`).
- **Data truths:** no photos, no place names in the record payload, one category in practice, 2011-2017 only.

## Verified review claims in this area

- `legend-heat`: heat mode shows numeric per-cell classes for a smoothed surface.
- `legend-type-heat`: Type toggle changes the legend but not the heat layer.
- `legend-points`: at z>=14 (not z10) points are category-coloured under a Density legend; hexes collide so every dot reads as a wrong count.
- `map-mobile-nav`: below 640px the map has no nav and no footer route to Species/Statistics; no current-page indication anywhere.
- `list-toggle`: map-to-list link is a hidden skip link; list-to-map does not exist.
- `lang-drops-query`: language switch drops `lng/lat/z` and filters.
- Touching this area: `tiny-text` (`MapFilters.tsx:145`, 10px footer/attribution/scale), `dark-tokens-on-light` items 3-4 (global `color-scheme: dark`, focus halo), `header-badge` (28px badge on the map header).

## Questions for the owner

1. Should the map stay dark? A light, paper-toned basemap would unify the site but needs a new data palette; the current rainbow only works on black.
2. Default view: whole island centred (some Fujian coast visible on wide screens), or keep hiding the mainland at the cost of a half-empty screen? On phones, may the island simply fill the width?
3. Are three display modes worth keeping on `/map`, or one good default (dots or grid) with the others tucked away? Same for density/type while the data is 100% roadkill: hide Type and the empty type chips until other records exist, or keep them visible?
4. What should a record panel lead with when there is never a photo: species name large, then date, place, source? May we show a township name derived from coordinates (respecting blur)?
5. Do the header stats (records / species / range) stay on the map header?
6. The map footer links out to roadkill.tw, GBIF and TaiCOL in new tabs. Does that conflict with "credit fully but do not send readers away"?
7. Phone navigation on the map: one extra nav row (costs ~33px of map) or a menu button?
