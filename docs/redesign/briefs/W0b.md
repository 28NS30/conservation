# W0b — Trust fixes: map legend honesty and phone navigation

Repo `/Users/neo/conservation` at `c73bb8d`. Paths are relative to `apps/web`. zh-TW is unprefixed (`/map`); English is `/en/map`.

**Goal**
At every zoom, display mode and colour setting, the legend on `/map` describes what is drawn, and the density/type switch never shows a state the map is not in. On a phone a visitor can get from the map to Species, Statistics, About and the record list, and back from the list with filters kept. The map loads no slower.

**Why / evidence**
- `legend-points`. Single records take over at z14 (`components/map/HeatmapView.tsx:716`), painted by category (`:721`), deliberately (`:905-906`). The legend reads only `colour` and `mode` (`:1032-1117`), so at z14+ it still says 通報密度 … 300+, and colliding hexes (`packages/shared/src/index.ts:15-18`) make every roadkill dot read "300+". Shot `map-x-points-phone.png`. (Not z10: stale comments misled the review.)
- `legend-type-heat`. The colour effect repaints only cells and dots (`:899-917`); the heat ramp is fixed (`:636-652`); the switch renders regardless (`:1026-1030`). Shot `map-x-heat-type-phone.png`.
- `legend-heat`. Heat shows six numeric per-cell classes for a smoothed surface (`:596-600`).
- `map-mobile-nav`. `components/site/SiteHeader.tsx:97-99` hides the nav below `sm` on `variant="app"`; `:130` (`!app &&`) drops the phone row; the app footer (`SiteFooter.tsx:54-70`) has no Species or Statistics. No link sets `aria-current`. Shot `map-phone-fold.png`.
- `list-toggle`. The only map-to-list link is `sr-only` (`HeatmapView.tsx:969-985`); `app/[locale]/(site)/reports/(list)/page.tsx` builds `activeFilter` (`:158-163`) but never links to `/map`.

**Scope**
In: legend logic and a heat bar; colour-switch lock; list link on the map, map link on the list; phone nav row on the map header; `aria-current` in the header nav; stale z10 comments; tests.
Out: legend/toggle restyle, type sizes, ramp and category colours (the hex collision), the mode toggle doing nothing above z14.2, popup, record panel, zoom hint, framing, empty type chips → **W5**. Header/footer rebuild, tab bar → **W3**. Language switch dropping the query → **W0d**. `list.empty` (目前沒有通報。) → **W0c**. List rows → **W8**. SpeciesMap → **W7**. Visual baselines, first-tile budget → **W13**.

**Depends on / Blocks**
Depends on nothing; blocks nothing. W13 baselines `/map` after this merges. W3 and W5 later replace the stopgap row and the legend's skin; the e2e here reads `data-legend`, ARIA and hrefs, never classes, so it survives.

**Decisions needed from the owner** (none blocks starting)
1. Phone nav on the map. Default: the site's existing second header row below 640px (≤ 40px of map, no JS) until W3's tab bar. Alternatives: menu button; footer links.
2. When colour cannot apply (heat; z14+). Default: the switch stays, shows the effective colour, and disables the other option; the stored choice is untouched. Alternative: hide it.
3. Native zh-TW read. Blocks shipping the new strings only; fallback below.

**Design spec (behaviour)**
Legend kind is a pure function of (mode, colour, zoom); first match wins:

| Condition | `data-legend` | Heading | Body | Caption | Switch |
|---|---|---|---|---|---|
| zoom ≥ `TILE_AGGREGATION_MAX_ZOOM + 1` | `points` | `map.reportType` | round swatch per `CATEGORY_KEYS` (four; `injured` has its own paint), label `categories.k` | `map.perRecord` | Type pressed, Density `aria-disabled` |
| mode `heat` | `heat` | `map.density` | gradient bar from `HEAT_STOPS`, `map.low` / `map.high` at the ends (keys exist, unused), no numbers | none | Density pressed, Type `aria-disabled` |
| colour `type` | `type` | as today | as today | `map.typePerCell` | live |
| otherwise | `density` | as today | as today | `map.perCell` | live |

- The regime is a boolean `useState` set on the map's `zoom` event and once after `setReady(true)` (so `?z=15` paints right). Derive the threshold; never write 14.
- Locking never writes `colourStore`. `aria-disabled`, not `disabled`: focusable, click a no-op, reason in an sr-only `aria-describedby` sentence and `title`.
- `HEAT_STOPS` feeds both the `heatmap-color` expression and the gradient. Stop values, paint, layers, sources and tile URLs do not change.
- Skin: reuse the legend card's classes. W2's Legend primitive later replaces the markup; `legendFor()` and `data-legend` stay. The two directions do not differ here.

**List switch.** Map: a visible link beside the 篩選 button, passed into `MapFilters` as a `trailing` node in the button's row so the open panel drops beneath both (a sibling overflows 390px); the skip link's href, the inactive filter button's classes, label `list.viewAsList`. The skip link stays. List: a `list.viewOnMap` link to `/map` plus `activeFilter` (never `page`), by the chip row but outside that `<nav>`.

**Phone nav.** Below `sm` the app header shows the second row other pages have (nav + `LanguageSwitcher`); the app footer loses its `sm:hidden` switcher. Link boxes ≥ 24×24 CSS px; the row is `flex-wrap`, so English at 320px (and the signed-in 我的通報) wraps. A client `NavLink` (`usePathname` from `@/i18n/navigation`, already bundled via `LanguageSwitcher`) sets `aria-current="page"` on an exact match and `"true"` on a descendant such as `/species/123` (W3's rule), with underline and `text-ink-900`.

Copy (**needs native read**):

| Key | zh-TW | en |
|---|---|---|
| `map.low` / `map.high` (new values) | 少 / 多 | Fewer / More |
| `map.perRecord` | 每一點是一筆紀錄 | Each dot is one record |
| `map.colourLockedHeat` | 熱區只能顯示密度 | Heat shows density only |
| `map.colourLockedPoints` | 個別紀錄一律依類型上色 | Single records are always coloured by type |
| `list.viewOnMap` | 在地圖上檢視 | View on map |

Fallback: keep 低 / 高, omit the caption and both reasons, label the list's link with `nav.map`.

**Implementation steps** (one commit each)
PR 1, legend:
1. New pure `components/map/legend.ts` (`import type` only): `legendFor()`, `HEAT_STOPS`, `heatColorExpression()`, `heatGradientCss()`. New `test/map-legend.test.mjs` imports it by `.ts` path (as `test/basemap.test.mjs` does): truth table at z13.99 and 14 for all six mode × colour pairs; the expression deep-equals today's literal.
2. `HeatmapView.tsx:636-652` uses `heatColorExpression()`.
3. `HeatmapView.tsx`: `pointsRegime` state; `zoom` listener beside `:813`; set after `:752`.
4. `messages/en.json`, `messages/zh-TW.json`: add keys to `map` and `list` (CI checks parity).
5. `HeatmapView.tsx:1032-1117`: switch on `legendFor()`; add `data-legend`; rewrite the `:1036-1040` comment.
6. `MapColourToggle.tsx`: props `effective`, `locked`.
7. Comment-only: `HeatmapView.tsx:734-739`, `packages/shared/src/index.ts:308-314` (z10 → z13).
8. New `e2e/map-chrome.spec.mjs` (plain node script like its siblings); `package.json` script `test:mapchrome`; one step in `.github/workflows/ci.yml`.

PR 2, list switch: (9) `MapFilters.tsx` `trailing`; `HeatmapView.tsx` one `listHref` for both links. (10) `reports/(list)/page.tsx` link. (11) e2e cases.

PR 3, phone nav: (12) new `components/site/NavLink.tsx`, used in both `SiteHeader.tsx` loops. (13) `SiteHeader.tsx:130-132`: drop `!app &&`; hide class `app ? "sm:hidden" : "md:hidden"`; rewrite the `:124-129` comment; `SiteFooter.tsx:67` remove the switcher. (14) e2e cases.

**Acceptance criteria**
- `e2e/map-chrome.spec.mjs`, on `/map` and `/en/map`: stored `heat` + `type` → `data-legend="heat"`, no "300+", Type `aria-disabled="true"`, Density `aria-pressed="true"`. `?lng=120.68&lat=24.14&z=15` with stored `density` → `points`, four swatches, no "300+"; then `window.__map.jumpTo({zoom:10})` → `density` with "300+"; `localStorage["conservation.mapColour"]` unchanged throughout. `bins` + `type` → `type`.
- At 390×844: visible header links to `/species` and `/stats`, boxes ≥ 24×24; exactly one *visible* `header nav a[aria-current="page"]` (both navs are in the DOM); header grows ≤ 40px; `scrollWidth <= innerWidth` at 390 and 320, both locales.
- `/en/map?group=roadkill` has a visible link to `/en/reports?group=roadkill`; `/en/reports?group=roadkill&page=2` links to `/en/map?group=roadkill`.
- `npm test`, `test:pages`, `test:focus` (locked button ringed), `test:map` stay green.
- WCAG 2.2: 1.4.1 (bar has text ends), 1.4.10 at 320px, 2.5.8, 4.1.2. No new animation.
- Performance, production build, 390×844, cold context, median of 5 against `main`: first `/api/tiles/` response within 5% or 50 ms; `/map` JS up ≤ 3 KB gzip; no new request type. `git diff main --stat` is empty for `lib/map.ts`, `components/map/MapHints.tsx`, `app/[locale]/map/layout.tsx`, `app/api/tiles`.
- Screenshots, 390×844@2x and 1440×900, both locales: default, heat + stored type, bins + type, z15, `/reports?group=roadkill`.

**How to verify**
`npm run db:up`; `psql` the `supabase/migrations/*.sql` then `supabase/seed-test.sql`, as `ci.yml` does; `NEXT_PUBLIC_E2E=1 npm run build` (exposes `window.__map`); `npm run start --workspace @conservation/web`; then `npm test`, `npm run test:pages`, `npm run test:map`, and with `--workspace @conservation/web`: `test:focus`, `test:mapchrome`. Playwright sends no Accept-Language, so `/map` is zh-TW; open `/en/map` explicitly. Seed state with `context.addInitScript` writing `conservation.mapMode` and `conservation.mapColour`. Use headless Playwright (a hidden preview pane stalls MapLibre). Mass local timeouts mean a starved database: re-run. In `next dev`, bogus `JSON.parse` 500s after editing `messages/*.json` mean a corrupt cache: stop the server, then `rm -rf apps/web/.next`; never delete `.next` under a running server.

**Risks and traps**
- Privacy: nothing here reads data. The list-to-map link carries only `group`, `taxonId`, `from`, `to`. No per-row "show on map" links: a generalised coordinate opened at z15 looks exact.
- Deliberate, keep: "one report has no density to express" (fix the legend, not the paint); "Before the map in DOM order, deliberately. This is a skip link" (add a second, visible link); "Swatches with real counts, not a gradient bar" (still true for bins and dots); the legend hiding on phones while a record is open.
- Knowingly reversed: "The map's own header stays single-row: there, vertical space is the instrument."
- In `variant="app"` the `<header>` is itself the `flex-wrap` container (inner div is `contents`), so the row needs `basis-full` and its own bleed.
- `pages.spec.mjs` Tabs 12 times at 1000px and finds the list link by the text 列表/"list"; extra focusable header items make that check pass vacuously. Keep the phone row `display:none` there and the visible list link after the canvas in the DOM.
- `test/map-bins.test.mjs` greps `HeatmapView.tsx` source (`type: "fill"`, `id: POINT_LAYER,`, `const dotRadius`); leave those in place.
- A colour class with no `--color-*` token emits nothing (`test/design-tokens.test.mjs`): reuse existing classes; the gradient is an inline style, like the swatches.
- Shared files: `messages/*.json` (W0a, W0c, W0d too: add keys, never reformat, rebase); `HeatmapView.tsx` (PR 1 before PR 2). Do not edit `pages.spec.mjs` or `map-bins.test.mjs`.

**Suggested PR breakdown and effort**
PR 1 legend (1-8), about 1 day. PR 2 list switch (9-11), half a day, after PR 1. PR 3 phone nav (12-14), half a day, independent. Total S/M: 2 person-days or 6-8 agent-hours, plus the native read.
