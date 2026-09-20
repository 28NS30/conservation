# Direction: One instrument

## 1. The idea

FormosaWatch is one field tool printed in two inks: every screen is the same survey sheet (pale ground, ink lines, ember records), whether it shows a map, a species or a camera.

**Principles**

1. **Ember means a record.** The only saturated colour is the dot on the map, the dot inside the Report button, and the dot on the receipt. Everything else is ink on ground. If something is ember and is not a record or the act of making one, it is wrong.
2. **Lines, not boxes.** Hierarchy comes from cartographic line weight (2px sheet edge, 1px row rule, dotted graticule) and from type size. No tinted cards, no shadows, no radius above 4px, no translucent chrome.
3. **Readable at arm's length in sun.** Nothing under 13px, controls 48px, state shown as glyph + words.

### Ground: light, with a night lighting of the same tokens

Decided with a veiling-glare model (1000-nit phone, 50,000 lux, 4.5% glass reflectance, so about 716 cd/m² of reflected veil added to every pixel):

| In sun | Light ground | Dark ground |
|---|---|---|
| Primary text | 2.25:1 | 2.19:1 |
| Secondary text | 2.04:1 (ink-600) | 1.57:1 (parchment-300) |
| Data, lowest to highest class | 1.71 to 2.27 (new day ramp) | 1.05 to 1.60 (today's rainbow on black); 1.17 to 2.19 (best ember ramp I could build on bark) |

Primary text ties; nothing else does. On a dark ground the quiet end of any ramp sits near the ground, where glare erases it, and the dark area mirrors the sky and the user's face. On a light ground all data is dark, so every class survives and the densest places survive best. Honest cost: more OLED power at full brightness, acceptable for a 60-second task.

So **Day is the product**, designed and shipped first. **Night** is the same semantic tokens remapped under `prefers-color-scheme: dark` (rainy-night amphibian surveys are real), reusing today's measured bark/parchment values: the current "two materials" become two lightings of one. Night ships in rollout, not in the prototype.

## 2. Palette

Semantic tokens; Tailwind families stay `paper, ink, ember, moss, bark, parchment` plus new `water`, `ramp`, `kind`, `status` (extend FAMILIES in design-tokens.test.mjs in the same PR).

| Token | Day | Night | Use |
|---|---|---|---|
| ground | paper-50 `#faf7f0` | bark-950 `#0b1410` | Page, map land, panels |
| water | `#e8ece6` | `#070d0a` | Map sea; recessed page bands. Cool against warm ground, so it separates by hue, not by a 1.1:1 tint |
| field | `#ffffff` | bark-900 `#0f1c16` | Inputs only |
| ink-900 `#16241c` | | parchment-50 `#f6efe0` | Text, coastline, 2px rules, the primary button block |
| ink-600 `#435b4c` | | parchment-300 `#b8ab94` | Secondary text, place labels, input borders |
| ink-500 `#51695b` | | parchment-500 `#8b8270` | Meta text, 1px rules, major roads, chart bars |
| paper-200 `#e7dcc9` | | bark-600 `#315744` | Dotted graticule, minor roads. Decorative only |
| ember-500 `#cf7238` | | same | The record dot (non-text) |
| ember-700 `#9a4e22` | | ember-400 `#e08a4f` | Focus ring only (today's tested ring; the one declared exception to principle 1). Links are underlined ink |

Measured: ink-900 on ground 15.06, on water 13.48, on field 16.11. ink-600: 6.91 / 6.19 / 7.40. ink-500: 5.57 / 4.99 / 5.96. ember-700 on ground 5.63, on water 5.04. Ground label on ink-900 button 15.06. Ember dot on ink-900 4.69 (night: ember-600 `#b25c28` on parchment-50, 4.12). Night: parchment-50 on bark-950 16.35, parchment-300 8.28, parchment-500 4.93, ember-400 7.06.

**Density ramp** (replaces the rainbow in `DENSITY_CLASSES`; one hue family, darker = more, lowest class still passes 3:1 as a graphic):
Day `#bd7a30` 3.28 · `#c0602a` 3.97 · `#a8431d` 5.63 · `#852a17` 8.38 · `#5c1a14` 12.17 · `#2e0f0e` 16.48 (on ground).
Night `#9a5223` 3.21 · `#bd642c` 4.48 · `#d97f3c` 6.29 · `#eea35c` 8.94 · `#f6c98a` 12.16 · `#fdeecb` 16.29 (on bark-950).

**Kind** (the owner's density/type switch stays): roadkill `#b3401f` 5.35, invasive `#6f3a86` 7.48, sighting `#1f6f78` 5.45 (night `#f0824a` 7.13, `#c49ae0` 8.06, `#5cc4c0` 9.01). Shape repeats colour at no GPU cost: roadkill filled disc, sighting hollow ring, invasive filled with 2px ink stroke.

**Status** (glyph colour; words stay ink): ok moss-700 `#4a6835` 5.91, warn `#8a5a00` 5.54, stop `#a3271f` 6.85, info `#2f5d7a` 6.61. Night: moss-400 7.39, `#e5b04a` 9.49, `#f08a7a` 7.69, `#8fb8d6` 8.91.

**Survive:** paper-50/200, all four inks, ember-400/500/600/700, moss-700/400, bark-950/900/600, parchment-50/300/500. **Retired:** paper-100 as card fill, `scale-*`, the other bark/parchment/moss steps, ember-300, every Tailwind-default sky/amber/rose/emerald class. `color-scheme` becomes `light dark` (fixes the black checkbox). global-error and the OG files get the hex values by hand.

## 3. Typography

The basemap's labels are Noto Sans (OpenFreeMap glyphs) and Android's system CJK is Noto Sans CJK TC, so the Chinese voice is **Noto Sans TC**: site and map literally share a typeface, and the voice comes from weight and size (road-sign gothic), not an exotic face.

- **CJK display:** Noto Sans TC **900**, one weight, used only at the top two scale steps.
- **CJK body and headings:** system stack (PingFang TC, Noto Sans CJK TC, Microsoft JhengHei). No download.
- **Latin:** IBM Plex Sans 400/600 + 400 italic; Plex Sans Condensed 600 for the English nav at 640 to 768px and big English titles; **IBM Plex Mono 500** for data only (dates, counts, coordinates, IDs). All OFL. Latin is listed first in the stack so Latin glyphs never come from the CJK font.

**Cost and speed.** A full CJK weight is 2.5 to 5 MB; never load one whole. (a) At build, subset the 900 weight to the Hanzi in display-role strings of `zh-TW.json` (300 to 500 glyphs, roughly 50 to 90 KB), one file, preloaded on content pages. (b) Dynamic titles (species names) fall through by `unicode-range` to sliced Noto Sans TC via `next/font/google` (self-hosted, about 100 slices, only needed ones fetched), `display: swap`. (c) Latin totals about 75 KB; only Plex Sans 400 is preloaded. (d) **/map and /report load zero CJK font files**, enforced by a test. Budget: 150 KB of CJK font on home, measured in the prototype.

**Scale (7 steps, px):**
13 Meta (legend, table heads, credit line; the floor) · 16 Body/UI (all reading text, buttons, inputs, nav) · 18 Lead (list primaries, ledes, panel values) · 24 Heading · 32 Title (phone page titles, panel species name, readouts) · 48 Display (desktop page titles, species name, phone hero name) · 72 Hero (desktop home name, stats lead numeral).

**Rules.** zh: letter-spacing 0 everywhere, no uppercase, line-height 1.7 body and 1.2 display, `palt` kept, breaks only between 福爾摩沙 and 守望計畫. en: line-height 1.55 and 1.1, tracking 0 (display -0.01em), no all-caps labels. Italic for Latin binomials only, never Hanzi, authority upright. Numbers in data roles are Plex Mono with `tabular-nums`. The Chinese name inside /en keeps `lang="zh-TW"`.

## 4. Component language

- **Button (action):** filled rectangle, 4px radius, 48px (56 for a page's main action), 16px/600 label. Primary is an ink-900 block, ground label, leading ember dot: a piece of the badge (green field, ember rivet). In the sun model ink-on-ember reads 1.33:1 and ground-on-ink 2.25:1, so the block is ink, not ember. Secondary: 1.5px ink outline. Tertiary: underlined link. Disabled: outlined with the reason in words, never faded.
- **Filter (layer control):** joined square segments sharing a 1px ink border, selected = ink fill; multi-select = checkbox rows with a data swatch. An applied filter is a 32px square-cornered token with × (44px hit area). Never filled ember, never round.
- **Status badge:** no container. 10px shape glyph in a status colour + ink text at 13 or 16px ("◆ 保育類 II", "● 已公開", "◐ 位置已模糊 10 km").
- **Kickers:** deleted. A label above a heading, where truly needed, is 13px/600 sentence case.
- **Cards:** deleted. A panel is ground with a 2px ink top rule. Recessed bands use water.
- **Lists:** ledger rows 56 to 64px, 1px rules, the whole row is the link, primary 18px, numerals mono and right-aligned, chevron. **Tables:** real tables, 13px/600 heads, 48px rows, mono numerals.
- **Readout:** 13px label over a 32px mono value, laid out in a grid. Replaces stat tiles and panel metadata.
- **Legends:** generated from the live layer, mode and zoom, so they cannot lie: classed swatches for grid and dots, a continuous "少 → 多" bar for heat, "一點一筆" plus the blurred-circle symbol at z14 and above.
- **Charts:** 160 to 200px tall, ink-500 bars, peak bar in ramp 3, value printed over every bar, 13px labels ("Jan", not "J"), dotted graticule.
- **Empty:** no sentence about absence. Show the active filter tokens and a Clear button; type options with zero public records are not offered. **Loading:** the sheet's own geometry (rules and water-coloured blocks); the map skeleton is flat ground and water, so there is no dark flash.

## 5. Imagery

Animals appear the way a map shows things: as **symbols**. Fourteen animal-group silhouettes (frog, toad, snake, lizard, turtle, songbird, raptor, bat, small mammal, carnivore, pangolin, crab, deer/boar, other) in solid ink, drawn by whoever redraws the badge, assigned from the TaiCOL class/order already stored. Used at 24px in rows, 56px in the record panel, 96 to 160px on species pages. Interim: PhyloPic silhouettes filtered to CC0/PD/CC BY with credits stored, labelled as group symbols, never portraits. The second image is **data**: a 12-cell month strip in ramp colours on every species row, and real map crops rendered headlessly from the new style as static WebP. Photographs are not required. When report photos or reference photos ever exist they sit in one viewfinder frame (ink border, corner ticks, mono caption); reference images carry a "參考" tab so they never pass as evidence.

## 6. The map joins the same world

Extend the existing `transformBasemap(style, locale)` with a `scheme` argument: a pure JSON rewrite before MapLibre sees the style, so no new requests, same tiles, same preload (base it on OpenFreeMap `positron` to need fewer overrides). Background = ground; water = water; landuse/landcover hidden; one added line layer on the existing `water` source-layer gives a 1.25px ink-700 coastline; motorway/trunk ink-600, primary ink-500, minor paper-200; county boundaries dashed ink-500; place labels ink-600 (6.91) with a ground halo; buildings from z14 in `#efeae0`. Data: the ramp above through the same `DENSITY_CLASSES` constant, so the legend follows. z10 to 13 stops looking empty because the lowest class is now 3.28:1 instead of dim navy. Selected record: ink ring around an ember dot (a one-feature GeoJSON source). Popup and attribution become ground panels with 1.5px ink borders. Chrome is opaque (no blur, no shadows: cheaper to paint than today). Scheme changes are repaints, never refetches.

## 7. Compositions

**Shared chrome.** Header 64px (phone 60), ground, 2px ink bottom rule. Left: badge at 48px (its legibility floor) + the Chinese name only, 18px/700 (on /en: "FormosaWatch"). Desktop right: nav at 16px with a 3px ink underline and `aria-current`, 中/EN, Report button. **Phone: a bottom tab bar site-wide**, 64px + safe area, five server-rendered links with no JS: 地圖 · 物種 · [通報, raised ink block with ember dot] · 統計 · 關於. This ends the phone-map dead end. The footer is a "sheet margin": one 13px line "資料：路殺社 TaiRON，經 GBIF 釋出 · CC BY 4.0 · 聯絡", linking to /attribution rather than off-site.

**Home, desktop (1440).** 1200px frame. Hero 640px tall: badge 520px on the left, vertically centred (gated on the redrawn vector; the prototype uses the soft PNG). Right column 600px: name at 72 (Noto 900, one line, 576px), "Project FormosaWatch" at 18 with no tracking, the tagline at 18, then two 56px buttons side by side: [● 通報一筆紀錄] [打開地圖 →]. Under a 1px rule, the credit line at 13 mono: "資料：路殺社（TaiRON）經 GBIF 釋出 · 2011–2017 · CC BY 4.0". No count, no dark bar. **Band 2, the map window:** a full-bleed 520px static crop of the real Day map at z13 (roads with ember dots: a road you drive, not an island conceit). An opaque 380px ground panel on its left holds one 24px heading, a secondary button "用我的位置" (`/map?locate=1`; the map asks for position client-side, so no coordinates travel in navigation), then the four MAP_PLACES and three entry species as ledger rows with symbols. **Band 3:** this week in the record, five ledger rows (mono date, symbol, name), blank first row removed. Sheet margin. About two screens; explanation moves to /about.
**Home, phone (390).** Header. Badge 240px centred. Name at 48 on two lines (福爾摩沙 / 守望計畫), tagline at 16, primary button 56px full width, secondary below. About 600px, above the tab bar. Then the map window as a 390×300 crop with the panel stacked beneath, then the ledger.

**Map, desktop.** A docked opaque left rail, 360px (it uses the sea a tall island wastes): Map/List segment carrying the filters; species search 48px; View segments (熱區/方格/圓點, order unchanged); Colour segments (密度/類型); year selects; kind checkboxes with swatches; legend at the bottom. Default camera: `fitBounds` on the main island with padding {left 400, others 40}, which centres the island in the free canvas; Kinmen and Matsu stay reachable, no maxBounds. Record panel docks right at 400px: symbol 56px, species at 32, italic binomial at 16, a readout grid (日期 / 類型 / 位置 精確 or 已模糊 10 km / 來源 路殺社 TaiRON), then [完整紀錄] and "這個物種的所有紀錄 →". No photo placeholder, ever. Header stats are removed.
**Map, phone.** Header 60, map, a 28px sheet-margin credit line, tab bar. Top-left a 48px square "圖層" button, top-right the 地圖/清單 segment. A 32px opaque legend strip sits above the credit line (six swatches with thresholds, 13 mono; tap to expand). 圖層 raises an opaque half-height sheet with the rail's contents. The island fills the width (padding 24). The record sheet is the same panel at 45% height, attribution still visible above it.

**Report (look, not flow).** Full-screen like a camera: tab bar hidden; top bar 48px with ×, title and a connection status badge. **Viewfinder:** a 4:3 ink-900 field with four ground-coloured corner ticks and a centred 72px shutter (ember disc in a ground ring) over "拍照或選照片" at 16. A photo fills the frame (`contain`), ticks stay; 64px filmstrip below, 44px remove targets. **Place:** Day-style map 300px, fixed centre crosshair (hollow ink ring until set, then ember-filled), mono readout "23.4871, 120.9533 ±12 m", status "● 位置已確認", buttons [◎ 用我的位置] [用照片的位置]. **Choices** (dead / hurt / alive): joined 56px rows, 18px labels, radio ring, selected = ink fill (the test reads `aria-checked` instead of a class string). Species: 56px white field. **Action bar:** sticky 72px under a 2px ink rule: readiness line left ("照片 ✓ · 位置 —"), [● 送出] right. **Receipt:** a full-screen slip: 32px status-driven title, readout grid of what was saved, status badge (已公開 / 等待鑑定 / 等待審核 / 存在手機), [再通報一筆] and, only if published, [在地圖上看]. Desktop: viewfinder and filmstrip sticky left (560), form right (560).

**Species detail, desktop.** 1200 frame, 680 + 440 columns. Left: linked lineage at 13; name at 48 with a 96px group symbol at the row's right end; binomial at 18 italic + upright authority; status as glyph + text rows at 16; a readout row at 32 mono: 3,978 筆紀錄 · 2011–2017 · 4 月高峰; month chart 200px with printed values; [● 通報這個物種] (carries taxonId) and "看 3,978 筆紀錄 →". Right, sticky: a **portrait** map 440×560 (the island is tall, so it finally fills its frame), Day style, single-hue ramp, cooperative gestures, legend strip beneath, "在大地圖開啟 →". Zero-record taxa: the page ends after the identity block and the Report button; no records section and no sentence about absence. Withheld taxa: no map, no count.
**Species detail, phone.** Name at 32 with a 64px symbol, binomial at 16, status rows, three readout cells at 24, portrait map edge to edge 390×440 between 2px rules, chart 160px, primary button.

## 8. Asks, risks, effort

**Asks.** (1) Badge redrawn as SVG with FormosaWatch lettering, plus a simplified mark for 40px and below. (2) Fourteen group symbols in the same hand (or approval of PhyloPic as interim). (3) Decisions: light by default; "ember means a record" replacing "ember is for actions only"; one Report action on home (the three-doors test rewritten on purpose); the phone tab bar; credit links go to /attribution; kinds with no records are not offered. (4) A native zh-TW reader for about 25 new strings; injured-wildlife referral wording from the owner. (5) One CJK display weight on content pages, never on /map or /report.

**Risks.** A light map is less theatrical than neon on black and the owner may miss the drama: render z7, z11 and z14 with real tiles in week one. Dense ember may bury road labels. KDE heat needs its alpha ramp re-tuned for a light ground. Night doubles contrast QA. `_contrast.mjs` hard-codes ground colours and `data-on-dark` changes meaning. Upstream basemap restyles (mitigated by matching on type and source-layer, as today). PhyloPic licences vary per image. The tab bar needs safe-area and keyboard care. The CJK budget is unproven until measured.

**Effort.** Prototype (four pages, two widths, two locales, Day only, real tiles): 2.5 to 3 weeks for one designer-developer. Full rollout: 9 to 11 weeks (tokens and components 2, map 2, report skin 1.5, species and directory 1, records, stats and season 1.5, supporting and system pages 1, Night 1, visual baselines with axe and contrast in CI 1), plus 0.5 for BioWatch afterwards. Asset lead time runs in parallel.
