# Design direction

Contrast figures are computed (WCAG 2.x; `tools/contrast.mjs`, `tools/ramp.mjs`). "Sun" uses One Instrument's glare model (1000-nit screen, 716 cd/m² veil).

## 1. Recommendation

**Recommended: "Roundel", the emblem-led direction, cut back and grafted.** Runner-up: **"Field journal"**, corrected. Two of three judges ranked emblem-led first, including the owner's advocate, whose lens weighs most. It is the only one that does not look like today's cream-and-hairline site at thumbnail size, it is built from the one thing the owner likes (the badge), and it keeps the dark map, so no recorded decision is reversed and the map load path is untouched. The engineer ranked it third; each defect that judge found is fixed below.

**Cut from emblem-led:** the 96px emblem hanging from the header; the brown `scale-800` block (1.57:1 against forest, secondary text failed AA); the 56px stat band; the map crops under the home hero; PhyloPic roundels; Barlow (it put font requests on /map); Black weight at 20px (clogs 灣, 蟾蜍 at 1x); the dark receipt and dark report column (sun).

**Grafted in.** From Field journal: the 520 / 300px emblem with one ember action; **the name is the picture** (species name at hero scale, image slots collapse when empty); the finding sentence instead of stat tiles; build-time Hanzi subsets that publish their charset, so a name is never set in mixed fonts. From One Instrument: the phone tab bar; a sticky submit bar that says what is missing; legends generated from the live layer; a lowest density class at 3:1 by fill; the glare check. From Naturalist's plate: no map picture on home; no Hanzi under 14px; `palt` on display and labels only; pinned tests rewritten as intent; one illustrator for the badge and any later art. From the engineer: a first-tile budget test before any repaint; data layers under place labels; a haloed selection ring; type marks that differ by form, not hue.

The runner-up is genuinely different: paper, Ming serif, rules and a light map, against forest blocks, heavy Hei and a dark map.

### A fair prototype test

Both prototypes share the primitives in 2.5; a direction is a theme file, a font set and a basemap scheme, so the loser costs a theme, not a rebuild. Both show home, map, report and species detail (黑眶蟾蜍, one nine-Hanzi species, one zero-record taxon) with the same copy, report flow and home structure (one report action, no map picture), at 390 and 1440, in zh-TW and /en, on real tiles, with the same emblem file (today's PNG upscaled once to 1040px). The owner views both on their own phone, once outdoors at midday.

| | Roundel must show | Field journal must show |
|---|---|---|
| Identity | Three zh-TW readers shown home cold do not say "a government agency" | Thumbnails are not mistaken for today's site; Ming masthead and gothic badge read as one voice |
| Map | Lowest class visible at z11 on a phone in sun; the island reads against the sea | z7, z11 and z14 keep their energy; coast visible; labels survive dense cells |
| Species page | Looks finished with zero artwork | Same, including the iOS fallback when a name leaves the subset |
| Surfaces | Forest and cream never look muddy | One tinted band per page is hierarchy enough |
| Budgets | ≤60 KB font preloaded on home, 0 on /map, first-tile time unchanged | ≤190 KB serif core, 0 on /map, first-tile time unchanged on positron |

Both must be axe-clean, pass the contrast script, hold CLS under 0.05 and complete the report form by keyboard.

Estimate: foundation plus Roundel 7-9 days; the Field journal theme 5-6 more.

## 2. Roundel: working system spec

### 2.1 Colour tokens (`@theme` in `apps/web/app/globals.css`)

| Token | Hex | Role | Pairs |
|---|---|---|---|
| `--color-field-900` NEW | `#112c1e` | Badge ring: chrome bands, map land and panels, secondary sign | parchment-50 13.07, parchment-200 9.33, parchment-300 6.62, ember-400 5.64 |
| `--color-field-800` NEW | `#1a3d2b` | Hover and selected row on field | parchment-50 10.50, parchment-200 7.50 |
| `--color-field-700` NEW | `#2a5a41` | Rules and roads on field, decorative (1.88) | never text |
| `--color-parchment-100` kept ("plate") | `#ece2cd` | Cream block: heroes, receipt, closing block | ink-900 12.53, ink-700 7.55, ink-600 5.75 |
| `--color-paper-50` kept | `#faf7f0` | Page ground | ink-900 15.06, ink-700 9.08, ink-600 6.91 |
| `--color-ink-900/700/600` kept | `#16241c #2f4a3a #435b4c` | Headings / body / meta, input borders | above |
| `--color-ember-700` kept | `#9a4e22` | Primary sign on light; link underline; focus ring on light | paper-50 label 5.63 (sun 1.96); vs plate 4.68 non-text |
| `--color-ember-800` NEW | `#7d3e1a` | Primary hover; the only ember allowed as text on plate | on plate 6.34, paper label 7.62 |
| `--color-ember-400` kept | `#e08a4f` | Primary sign on field; focus ring on field; selected-record ring; roadkill mark | field-900 label 5.64; on bark-950 7.06 |
| `--color-moss-700` / `moss-300` kept | `#4a6835 #a8c48a` | Endemic glyph, chart bars / sighting ring on map | 5.91 on paper; 7.79 on land |
| `--color-alert-700` NEW | `#8f2d1f` | Errors, protected glyph | 7.66 paper, 6.37 plate |
| `--color-bark-950` kept | `#0b1410` | Map water, map halo | parchment-300 8.28 |
| `--color-parchment-50/200/300` kept | `#f6efe0 #d8cbb0 #b8ab94` | Text on field: primary / secondary / map place labels | parchment-300 only on field-900 |
| `--color-ramp-1…6` NEW | `#4f8264 #6a9663 #87ac6a #a5c287 #dad593 #f6efe0` | Density, grass to sky, one hue, lightness-monotonic | on land 3.36, 4.39, 5.80, 7.60, 9.92, 13.07; every step 1.31 from its neighbour |

Also kept: `paper-100` (skeleton bars only), `ember-300` (hover of ember-400, 7.23). Retired: `scale-*`, `bark-600…900` outside map internals, `parchment-400/500` as chrome text (3.87 on field-800), `ember-500/600` as fills (paper label 4.41), `paper-200`, all Tailwind default hues. `CATEGORIES[*].color` moves to these tokens. `FAMILIES` in `design-tokens.test.mjs` gains `field`, `alert`, `ramp`. A unit test asserts `DENSITY_CLASSES` equals `--color-ramp-*`, step 1 ≥ 3:1 on land and neighbours ≥ 1.25.

Surface classes `.on-paper`, `.on-plate`, `.on-field` set `--text`, `--text-quiet`, `--rule` and `--focus` (ember-700 on light, ember-400 on field; today's ember-400 ring on paper is 2.48:1 and fails). `color-scheme: light` on `:root`, `dark` scoped to the map.

Honest costs: land against water is 1.25:1, as today, so the data draws the island (a coastline layer is a prototype experiment only; ocean polygons can show seams). In sun the lowest class is 1.22:1 on a dark map against about 1.7 on a light one; that is the price of the recorded dark-map decision and why the outdoor test exists.

### 2.2 Fonts

- **Display, zh and Latin: Noto Sans TC 900** (OFL; it matches the badge's lettering), self-hosted as one family `FW Sign` in three committed `woff2` files split by `unicode-range`, so a missing glyph costs a fetch, never a mixed face: `sign-home` (Hanzi in the `site`, `nav`, `home` and `footer` namespaces plus Basic Latin and digits, est. 45-55 KB, preloaded on home only), `sign-ui` (the rest of the 610 catalogue Hanzi, est. 130-150 KB, lazy), `sign-names` (recorded species and county names, est. 150 KB, lazy). `scripts/subset-fonts.mjs` writes them and `sign-charset.json`; outputs are committed, not built on Vercel. A test fails if a catalogue Hanzi is outside home ∪ ui. A species h1 containing any character outside the charset is set wholly in system 700.
- **Everything else: the existing system stack**, zero bytes. Binomials use system italic. No separate Latin family in v1.
- Font CSS is imported by the home and `(site)` layouts only; **/map imports none**, and a test asserts it.
- `:lang(zh) em, :lang(zh) i { font-style: normal }`; `font-synthesis-style: none` (not `font-synthesis: none`, which strips bold from Android system Hanzi).

### 2.3 Type scale (Tailwind v4 `--text-*` tokens)

| Utility | px / line-height zh, en | Face | Role |
|---|---|---|---|
| `text-note` | 14 / 1.6 | system | Floor. Credits, legends, table heads, footer |
| `text-body` | 16 / 1.75, 1.6 | system | Prose, nav, inputs, rows |
| `text-lead` | 20 / 1.6 | system 400/700 | Taglines, sign labels, row names, binomial under a title |
| `text-head` | 28 / 1.3 | sign | h3, step titles, finding sentence, home route links |
| `text-title` | 40 / 1.15, 1.1 | sign | h2; every h1 on phone |
| `text-display` | 56 / 1.15, 1.05 | sign | Desktop h1; long species names; short species names on phone |
| `text-hero` | 80 / 1.1 | sign | Home name; species names of six Hanzi or fewer, desktop |

Letter-spacing 0 on Hanzi; no `uppercase`; `palt` on `text-head` and above and on labels, off in prose; `line-break: strict`; `text-wrap: balance` on headings; the name breaks only between 福爾摩沙 and 守望計畫; `tabular-nums`, no mono. Sign weight never below 28px and on at most two headings per viewport (the guard against a forestry-bureau look). The token test is extended to fail on `text-[Npx]` and Tailwind's default size utilities.

### 2.4 Space, radius, border, elevation

4px base; gaps 8, 16, 24, 40, 64, 96. Two measures: `--container-page` 1200px, `--container-prose` 680px; gutters 16px phone, 32px desktop. Radius 4px on signs and inputs, 0 on blocks and sheets; `rounded-full` is banned by test outside the emblem. Borders: 2px `--rule` opens a section, 1px `--rule` at 20% separates rows (decorative), 2px ink-600 bounds an input (6.91). No shadows, blur or translucency. Motion: 150ms colour transitions; under reduced motion the map uses `jumpTo`.

### 2.5 Primitives (`components/ui/*`, server components unless noted)

- **Button ("sign").** Filled rectangle, 48px min height (56 in heroes and submit), `text-lead` 700 label, 24px side padding. Primary: ember-700 + paper-50 on light, ember-400 + field-900 on field. Secondary: field-900 + parchment-50 (on field, a 2px parchment-50 outline). Tertiary: 2px ink-900 outline. Disabled: outline only, the reason printed beside it. Renders `<a>` or `<button>`.
- **LinkAction.** `--text` colour, 2px ember underline offset 4px, optional trailing arrow; 44px hit height when standalone.
- **Field.** Label above (`text-body` 700), optional hint, 56px control, 2px ink-600 border, paper-50 fill, the error sentence directly beneath in alert-700 with a recovery action. Covers input, select, textarea, search.
- **Choice** (the pill replacement; client). `role="radiogroup"` of full-width 64px rows, 28px radio mark, `text-lead` label, optional hint; selected = field-900 fill, parchment-50 text, check glyph; nothing preselected. State is `aria-checked`; tests read that, never class strings.
- **Filter.** Single choice: `text-body` words standing on a 2px rule, selected word gets a 4px underline and `aria-current`/`aria-pressed`, 44px hit height. Multi choice: 24px square checkboxes in 44px rows. Options with no public records are not rendered. The header nav uses the same underline.
- **StatusTag.** No container. 12px shape glyph plus words in `--text` at `text-note` 700 (rows) or `text-body` (detail pages): ▲ alert-700 protected, ● moss-700 endemic, ■ ink-900 invasive, ◐ ink-600 location blurred. Never interactive.
- **DataRow / List.** Whole row is the link, 64px min; name `text-lead` 700, italic binomial `text-body` beneath, right-aligned count `text-lead`; 1px rules; hover field-800 or paper-100. Tables: 2px head rule, `text-note` 700 heads, stacked two-line rows under 640px.
- **Section.** `surface="paper|plate|field"`: full-bleed ground, inner container, a `text-title` heading. Two field Sections never touch.
- **Figure.** Frame for a chart or embedded map: a heading that states the finding, the graphic, a `<details>` data table, a `text-note` source line. Charts 240px (200 phone), moss-700 bars, the peak in ink-900 with its value at `text-lead`, month labels at `text-note`.
- **Legend.** Generated from active layer, mode and zoom: six contiguous swatches with break numbers for grid and dots; a 少 → 多 bar without numbers for heat; "每一點是一筆紀錄" with the three type marks at z14+. Swatch shape equals mark shape.
- **EmptyState.** Names the active filters and offers 清除篩選. Never a sentence about absence, never an illustration.
- **Skeleton.** Flat bars in the real block colours on the final grid; no shimmer; localised sr-only text; the map's is field-900.
- **Notice.** `role="note"`/`"alert"`; 4px left bar (ink-600 info, alert-700 error), `text-body`, no fill. Carries the blurred-location and injured-wildlife messages.

### 2.6 Rules

1. Ember means "press here" or "the one you selected". One ember element per content viewport.
2. Filled rectangle = action; underlined word = filter; glyph plus words = status. Nothing is a pill.
3. Blocks are forest or cream, never bordered boxes, never brown. Cards only for things you can pick up (none today).
4. One emblem per viewport: home hero, footer, receipt. The header carries a 48px mark.
5. No kickers, no uppercase, no tracked Hanzi, no Hanzi under 14px.
6. Reading and form-filling happen on paper or plate; forest is for chrome, the map and one block per page.
7. An empty slot collapses; nothing is drawn that does not exist.
8. /map gains no font, no request and no client module.
9. Public pages read `reports_public` only; embedded maps use the public tiles, so blurring is inherited.

## 3. Field journal: runner-up spec

**Tokens.** `paper-50 #fbfaf6` sheet and map land; `paper-100 #f1eee4` one band per page; `paper-200 #d9d4c5` row rule; `ink-900/600/500 #16241c #435b4c #51695b` (15.43 / 7.08 / 5.71); `ember-700 #9a4e22` primary fill (paper label 5.77), `ember-800 #7d3e1a` hover, `ember-600 #b25c28` focus ring on paper (4.51); `moss-700`; `madder-700 #8c2a2a`, `ochre-700 #76560a`, `indigo-600 #2c5a85` for status and type marks; map water `#e2e8e4` with a 1px ink-500 coast (5.71 / 4.80); `bark-950` footer only. Density ramp, corrected to clear 3:1 by fill: `#6e9b6c #528358 #3c6b47 #295538 #173e29 #092316` (3.06, 4.24, 5.94, 8.20, 11.44, 15.91; neighbours 1.38-1.40).

**Type.** Noto Serif TC 700 in committed `core` (est. 160-190 KB, preloaded on home) and `names` (est. 150 KB, lazy) subsets with charset JSON; Source Serif 4 600 and 400 italic for Latin display; system sans for everything functional; nothing on /map. Steps phone/desktop: masthead 48/88, title 34/56, heading 24/32 (serif, never below 24); lead 19/22, body 16/17, meta 14 (sans). No 12px Hanzi.

**Three defining moves.** (1) Rules instead of surfaces: a 2px ink rule with a margin heading opens every section; nothing is boxed except inputs, maps and pictures. (2) The name is the picture: species and project names in Ming at masthead size on white paper. (3) A light survey-sheet map built on OpenFreeMap **positron**, with an inline mask polygon outside Taiwan, data layers under labels and an ink selection ring with a paper halo. It reverses the recorded dark-map decision, so it needs the owner's explicit approval.

## 4. Roundel page compositions

**Shared chrome.** Desktop header: field-900 band, 72px (56 on /map); 48px mark and the name at `text-lead` system 700 left (neither on home); nav at `text-body` with the Filter underline, 中文/English, 通報 sign right. Phone: 56px band (40px mark, name, language switch) and a **fixed bottom tab bar**, 64px plus safe area, field-900, five server-rendered links: 地圖 · 物種 · [通報, raised ember-400 block] · 統計 · 關於. On home the 通報 block is outlined, not ember (the hero sign is the ember); on /report the bar is hidden. Footer: field-900, emblem 160px, `text-body` links, the CC BY credit at `text-note`.

**Home, desktop (1440).** The hero is a plate Section filling the first viewport (min 640px). Emblem **520px** left, vertically centred; 40px gap; right column 640px: the name at `text-hero` on two lines (福爾摩沙 / 守望計畫), the existing tagline at `text-lead`, two 56px signs: **通報一筆** (primary, `/report`) and **看地圖** (secondary). At the plate's foot one `text-note` line, 紀錄來源：路殺社（TaiRON），CC BY 4.0, linking to /attribution. No question, doors, count or Latin second line. At 768-1279 the emblem is 360px. /en: "FormosaWatch" at `text-hero`, the Chinese name at `text-head` with `lang="zh-TW"`.
Below: (1) field Section 地圖, no picture: two columns of DataRows with names at `text-head` in system 700, the four `MAP_PLACES` and three entry species (the existing non-sensitive set), each opening the map at that view, plus an outlined sign 開啟完整地圖. (2) paper Section 這一週，在別的年份: five DataRows (date, name, binomial), no blank first row, no coordinates. (3) one `text-head` sentence crediting 路殺社 volunteers, with a LinkAction to /about. Footer. How-it-works, blurring and open-data copy move to /about.
**Home, phone (390).** Plate: 24px pad, emblem **300px** centred (172 today), name at `text-title` on one line (320 ≤ 358), tagline at `text-body`, one full-width 56px ember sign 通報一筆; about 615px, clear of the tab bar. 看地圖 is the tab bar's first item.

Home stops emitting `/report?category=` links; the route still accepts them and maps each to a preselected condition (see the report-flow chapter).

**Map, desktop.** Docked field-900 panel, 320px, collapsible to a 56px rail: 地圖 | 清單 (carries filters), species search, years, display Filter 方格 / 圓點 / 熱區, colour Filter 密度 / 類型, type checkboxes, Legend pinned at the foot. Header stats removed. `fitBounds` with left padding 360 centres the island; Kinmen and Matsu stay pannable. The repaint happens inside `transformBasemap`, same style URL and preload: water bark-950, land field-900 (the island is the inside of the badge), roads field-700, place labels parchment-300 with a bark-950 halo. Type mode by form: roadkill and injured solid ember-400, invasive solid parchment-50, sighting a hollow moss-300 ring. Selected record: a 3px ember-400 ring separated from the dot by a 2px bark-950 halo. Record panel right, 400px, field-900: name at `text-head` system 700, italic binomial at `text-lead`, date, blurred-location Notice, source line, sign 完整紀錄; a photo area only when a photo exists. Zoom buttons 44px.
**Map, phone.** Band, map, tab bar. Top-left a 48px secondary sign 篩選; top-right 地圖 | 清單. A 32px Legend strip sits above the tab bar with the compact attribution above it, always visible. 篩選 opens a field-900 sheet capped at 60dvh; a record opens the same sheet at 45dvh. The island fits the width with 16px padding.

**Report (look only; the flow chapter sets order and logic).** All on paper. Desktop: sticky left column, 360px, on plate: 通報 at `text-display` and progress lines (照片 · 地點 · 牠是什麼 · 狀況) that gain check glyphs. Right column 640px, steps opened by 2px rules with `text-head` titles. Photo: a 200px plate block with a 2px ink border, camera glyph and 拍照或選照片 at `text-lead` 700, then a secondary sign 拍照 and a tertiary 從相簿選. Place: forest-basemap picker 320px tall, **no pin until chosen**, overlay line 點地圖選位置, secondary sign 用我現在的位置, then a confirmation row with a check. If street labels cannot be read outdoors in the prototype, the picker alone takes a light positron scheme. Condition: three Choice rows; the hurt row opens a Notice whose wording comes from the owner. Species: a 56px Field plus a full-width 我不確定 Choice. **Phone:** one column, tab bar hidden; a sticky 72px bar under a 2px rule holds the readiness line (還差：地點) and the ember 送出 sign. **Receipt:** a plate Section filling the viewport: emblem 160px, 收到了。 at `text-title`, one StatusTag line driven by the API's returned status, signs 再通報一筆 and 看地圖, a record link only when published.

**Species detail, desktop.** Plate hero: linked lineage at `text-note`; the Chinese name at `text-hero` when six Hanzi or fewer, else `text-display`; italic binomial at `text-lead` with upright authority; 也稱作 at `text-body`; StatusTags. No artwork slot in v1. On paper under a 2px rule: the finding sentence at `text-head` (2011–2017 年間有 3,978 筆紀錄，四月最多。). Two columns: a **portrait** map Figure 480×600 (the island is tall) with cooperative gestures, Legend beneath and LinkActions 在完整地圖上看 and 看紀錄列表 carrying `taxonId`; right, the monthly chart Figure and the lineage. Closing plate Section: 看到牠了？ with the ember sign 通報黑眶蟾蜍 to `/report?taxonId=`, then the 路殺社 source line. Zero-record taxa: hero and closing block only. Withheld taxa: a Notice, no map, no count.
**Phone.** Name at `text-display` when six Hanzi or fewer, else `text-title`; binomial; tags; finding sentence; map 358×440; chart 200px; full-width sign.

## 5. Asks of the team, and the fallback

1. **Badge redraw** (critical path): layered SVG plus a 1024px PNG; lettering 福爾摩沙守望計畫 / PROJECT FORMOSAWATCH / 台灣 or 臺灣 TAIWAN (house style decided once); colours matched to the tokens above; and a **letterless small mark** (pangolin in the ring) for 64px and below, the favicon and a maskable icon. *If it never arrives:* today's PNG ships at 520/300px from a one-time 1040px upscale, soft and reading ECOWATCH; the header mark is the same PNG, never under 48px; announcement and the custom domain wait for the redraw. With no users yet, shipping big now costs nothing; the owner decides.
2. **Artwork:** none is needed to launch. Later, if wanted: ten group silhouettes and a few flagship species from the badge's illustrator, filling the collapsed slot on the species hero. *If never:* the name stays the picture.
3. **Native zh-TW read** of about 30 new strings (home route labels, finding-sentence templates, readiness and receipt lines, legend labels), plus the injured-wildlife referral wording from the owner. *If delayed:* live strings are reused (共 3,978 筆，4 月最多。 stands in for the finding sentence) and unread copy stays out of production.
4. **Owner decisions:** which prototype wins; the enlarged old-name emblem now, or wait; one report action in place of three doors; one self-hosted display font; the phone tab bar; map header stats removed; credit linking to /attribution; and leave to rewrite pinned tests (`home.test.mjs`, the `pages.spec.mjs` doors, `report-form.test.mjs` class pins, `map-bins.test.mjs` colours) as intent: emblem at least 70% of phone width, one report link and one map link above the fold.
