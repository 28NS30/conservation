# Direction: Emblem-led conservation programme ("The Roundel")

## 1. The idea

**The site wears the badge the way a ranger service wears its patch: one large emblem, solid blocks of the badge's own forest, cream and ember, a few heavy words, and actions that look like signs.**

Principles:
1. **The emblem is the loudest thing; words are few.** One heavy line and one action per screen. If a sentence can move to /about, it moves.
2. **Colour comes in blocks, never in outlines.** Hierarchy is made by full-bleed fields of forest, cream and paper and by 2px ink rules. No bordered beige boxes.
3. **A sign looks like what it does.** Filled rectangle = action. Underlined label = filter. Outlined tag = status. Nothing is a pill. Nothing is under 14px.

## 2. Palette

Sampled from `public/brand-badge.png` (ring `#112c1e`, sky `#efe3cd`, rivet `#b25f2b`, pangolin shadow `#514426`). Ratios are computed (WCAG 2.x).

| Token | Hex | Role |
|---|---|---|
| `field-900` NEW | `#112c1e` | The badge ring: header, footer, map land and panels, stat bands, selected choice, secondary button |
| `field-800` / `field-700` NEW | `#1a3d2b` / `#2a5a41` | Hover on field; rules and roads on field (decorative, 1.9:1) |
| `parchment-100` (kept, now the "plate") | `#ece2cd` | The badge's cream as a block: home hero, species hero, photo plate |
| `paper-50` (kept) | `#faf7f0` | Page ground. `paper-100` only for skeletons; `paper-200` retires |
| `ink-900 / 700 / 600` (kept) | `#16241c / #2f4a3a / #435b4c` | Headings / body / meta |
| `ember-700` (kept, promoted) | `#9a4e22` | Primary button fill on light, links, focus ring on light |
| `ember-400` (kept) | `#e08a4f` | Primary button fill on field, focus ring on dark, selected-record ring |
| `scale-800` NEW (extends `scale`) | `#514426` | Third block: the records board; invasive tag |
| `moss-700` (kept) | `#4a6835` | Chart bars, endemic tag |
| `alert-700` NEW | `#8f2d1f` | Errors and protected-species tag only |
| `bark-950` (kept) | `#0b1410` | Map water, map footer; other `bark-*` stay for map internals |
| `parchment-50 / 200 / 300 / 400` (kept) | — | Text on field: primary / secondary / map place labels / road labels |

Text pairings: ink-900 on paper-50 **15.06**, on plate **12.53**; ink-700 **9.08 / 7.55**; ink-600 **6.91 / 5.75**; parchment-50 on field-900 **13.07**; parchment-200 **9.33**; parchment-300 **6.62**; parchment-400 **4.82** (floor on field); parchment-50 on scale-800 **8.32**; paper-50 on ember-700 (button label) **5.63**; field-900 on ember-400 (button label on dark) **5.64**; ember-700 link on paper-50 **5.63**, on plate **4.68**; moss-700 **5.91 / 4.91**; scale-800 **8.90 / 7.41**; alert-700 **7.66 / 6.37**.
Rejected: paper-50 on ember-600 is **4.41** (fails at 16px), so ember-600/500 stop being button fills. Today's focus ring, ember-400 on paper-50, is **2.48**, under the 3:1 non-text minimum: the ring becomes a `--focus` variable, ember-700 on light (5.63), ember-400 on field (5.64).

FAMILIES in `design-tokens.test.mjs` gains `field`, `scale`, `alert`; Tailwind-default sky/amber/rose/emerald classes and `CATEGORIES[*].color` move onto these tokens; `color-scheme: dark` is scoped to the map.

## 3. Typography

- **CJK display: Noto Sans TC 900 (Black)**, OFL, Taiwan MOE glyph forms; the heavy Hei of road and trail signage. **CJK body: the existing system stack** (PingFang TC / Noto Sans TC / JhengHei) at 400 and 700: zero bytes.
- **Latin: Barlow** (OFL; drawn from highway signs and plates; true italics for binomials). Barlow 400, 400 italic, 600 for text; **Barlow Semi Condensed 700** for Latin display, buttons, nav and numerals (the width lets English nav fit at 640-768px). Four Latin-subset woff2 files, about 20 KB each. Barlow leads the stack, so digits and Latin inside Chinese are Barlow and Hanzi fall through to the system.
- **Cost.** A full Noto Sans TC weight is 4-6 MB, but the zh-TW catalogue uses only **609 unique Hanzi** (counted). A build step (`pyftsubset`) cuts the Black weight to those glyphs in two `unicode-range` files: `sign-core.woff2` (wordmark, nav, buttons, home; about 120 glyphs, roughly 40 KB, preloaded on home only) and `sign-rest.woff2` (roughly 150 KB, fetched only when a page needs it). Self-hosted, `font-display: swap`, immutable cache; a unit test fails if a catalogue Hanzi is missing. Species names (66k taxa) cannot be subset, so a species H1 is set wholly in the system heavy weight, never mixed per glyph (later option: a cached `/api/glyphs?text=` proxy, the OG pipeline's trick, about 4 KB per name). **/map sets `--font-sign` to the system stack, so the map gains zero font bytes.**

Scale, seven sizes replacing seventeen:

| px | Role |
|---|---|
| 14 | Floor: legal, attribution, status tags, table secondary |
| 16 | Body, nav, labels, inputs text, table cells, legends |
| 20 | Lede, button labels, list names, panel facts |
| 28 | H3, step titles, phone H2, stat labels |
| 40 | H2; every H1 and the home name on phone |
| 56 | Desktop H1 (page and species names), stat numerals |
| 80 | Home name, desktop only |

Rules. Letter-spacing 0 on Hanzi everywhere; no uppercase transform in either language; italics only for Latin binomials. Line-height: display 1.15 zh / 1.05 en; body 1.75 zh / 1.6 en. Headings use `text-wrap: balance`; the name breaks only between 福爾摩沙 and 守望計畫. `palt` stays. Numerals tabular. On /en the H1 is the English or Latin name; the Chinese name follows at 28px, upright, `lang="zh-TW"`.

## 4. Component language

- **Header band.** Solid field-900 on every page, server-rendered as now. Content pages: 72px band, emblem at 96px hanging 24px below it like a shield on a gate (Badge.tsx's own floor is 48px), name at 20px Black in parchment-50 with no Latin second line, nav at 16px, 通報 sign. Phone: 56px band with a 48px emblem, then a 44px nav row. Footer: the same field, emblem at 160px.
- **Buttons = signs.** Filled rectangle, 4px radius, 48px min height (56 on hero and submit), 20px display-weight label. Primary: ember-700 + paper-50 on light; ember-400 + field-900 on field. Secondary: field-900 + parchment-50. Tertiary: 2px ink-900 outline. One primary per viewport.
- **Filters = tabs and checkboxes, never filled.** Single choice: 16px labels on a 2px rule, the selected one with a 4px underline and `aria-current`/`aria-pressed`. Multi-choice (map): real 24px square checkboxes in 44px rows. Header nav uses the same underline for "you are here".
- **Status = tags.** 14px, 1.5px outline, 2px radius, no fill, not interactive, led by a shape glyph so colour is never the only cue: ▲ protected (alert-700), ● endemic (moss-700), ■ invasive (scale-800), plain ink-700 for IUCN and red-list words. StatusBadges logic untouched.
- **Form choices = choice plates.** Full-width 64px rows, 28px square radio, 20px label; selected = field-900 fill, parchment-50 text, check mark. Tests read `aria-checked`, not class strings.
- **Cards are gone.** Content sits on paper between 2px ink-900 rules (1px ink-900/20% between rows). Grouping is a full-bleed block (field, plate or scale-800), at most one of each per viewport.
- **Kickers are gone.** Sections open with a 40px heading; field labels 16px bold; table headers 14px bold.
- **Lists:** the whole row is the link: name 20px bold, Latin italic 16px beneath, count right in Barlow Semi Condensed 28px. **Tables:** 2px header rule, 16px cells, right-aligned numerals, stacked rows on phone.
- **Legends:** swatch shape equals mark shape (square, circle, gradient bar); the title names the unit; 16px.
- **Charts:** 200px tall (160 phone), moss-700 bars, peak bar ink-900 with its value printed at 20px, full month labels at 14px, a `<details>` data table beneath.
- **Empty states:** filters with no results are not offered (they appear when data does); zero-record species pages omit the records section and keep the report sign. **Loading:** flat blocks in the real block colours, no shimmer.
- **Inputs:** 56px tall, 2px ink-600 border (6.91:1), 16px text, label above.

## 5. Imagery

No photographs exist, so animals arrive the way the pangolin did: **as emblems.**
1. **Species roundels.** A forest silhouette on a cream disc inside the badge's ring with two ember rivets, built in SVG. About ten group silhouettes (frog, snake, lizard, turtle, bird, small mammal, carnivore, pangolin, bat, land crab) cover every recorded taxon via TaiCOL class/order. Stopgap today: PhyloPic CC0 silhouettes, credited on /attribution. A silhouette cannot be mistaken for report evidence.
2. **The badge taken apart.** The redraw is delivered as layered SVG; pangolin, tree, road-and-car and grass tufts become page furniture (footer grass line, 404 pangolin, success-screen emblem).
3. **Place crops.** Four static WebP crops (about 30 KB each) of the real map in the new palette at z11, screenshotted from public tiles by a script, so blurring is inherited. They show streets and dots, not an island silhouette.

## 6. The map in the same world

- **Basemap repaint, zero runtime cost:** inside the existing `transformBasemap` pass, set water `bark-950`, land `field-900` (the badge ring: the island is literally the inside of the emblem), roads `field-700`, boundaries parchment-400, place labels parchment-300 (6.62), road labels parchment-400 (4.82), halo bark-950. Same style URL, same tiles, same preloads.
- **Density ramp, single hue, lightness-monotonic (colour-blind safe), from the badge's grass to its sky:** `#4f8264` (3.36:1 on land, bright enough to end the empty look at z10-13) → `#7fa663` (5.37) → `#a8c48a` (7.79) → `#d9d48f` (9.81) → `#f6efe0` (13.07); the 300+ class keeps the cream fill and adds an ember-400 ring (dots) or outline (one thin line layer over the few top grid cells). **Type mode** (the switch stays): roadkill/injured ember-400 fill, sighting `#a8c48a` fill, invasive hollow cream ring: fill versus ring is a non-colour cue using only circle paint properties.
- **Chrome:** the same forest header band as every page; a solid field-900 panel instead of floating pills; popups, scale and attribution reskinned in CSS to field-900/parchment (attribution always visible). The legend is generated from the active layer and zoom: counts for grid/dots, "低 → 高" bar for heat, "每一點是一筆紀錄" at z14+. Header stats are removed.
- **Speed:** no new requests, no web font on /map; repaint only. Add the missing first-tile budget test.

## 7. Compositions

### Home
**Desktop (1440, 1200px container).** Forest band, 72px: nav right in parchment-50 16px, "通報" ember-400 sign; no wordmark, because the hero carries it. **Hero = full-bleed plate** to the fold. Left: emblem at **480px** (needs the redraw; with today's 512px PNG ship 400px and accept softness at 2x). Right, 656px column, vertically centred: name at 80px Black ink-900 on one line (8 × 80 = 640px); tagline 20px; two signs side by side, 56px: **通報** (ember-700) and **看地圖** (field-900). Bottom edge of the plate: one 14px line, "紀錄來源：路殺社（TaiRON），CC BY 4.0", linking to /attribution. No question, no doors, no count.
Below the fold, three blocks and the footer: (1) **Map block**, full-bleed field-900: left "地圖" at 40px, one 20px sentence, cream-outline sign "開啟完整地圖"; right a 2×2 grid of place crops (陽明山 / 臺中 / 花蓮 / 墾丁), each an image with the place name at 28px on a forest foot, linking to the existing z11 views; under them three plain 20px links for the entry species. (2) **Records board**, full-bleed scale-800: "這一週，在別的年份" at 40px, five ruled rows (date in Barlow, species at 20px, Latin italic), no blank first row, no coordinates. (3) **Credit**, on paper: one 28px sentence thanking 路殺社 volunteers, link to /about. Footer, then nothing: how-it-works, blurring and open-data copy move to /about.
**Phone (390).** One 56px band only: four nav links left, 中文/English right; no emblem or name, the hero has them. Plate: emblem **280px** centred (today 172px), name 40px on one line (8 × 40 = 320 ≤ 358), tagline 16px on two lines, two full-width 56px signs stacked; about 730px with the band, inside an 844px viewport. Place crops become a 2×2 grid of 171px squares; board rows stack name over date.
On /en: "FormosaWatch" at 80/40px Barlow Semi Condensed 700, Chinese name at 28px beneath.

### Map
**Desktop.** Band 56px, emblem 48px inside it with no overhang (map height belongs to the map), name at 20px, nav, 通報. Left: docked field-900 panel, 320px, collapsible to a 56px rail: tabs "地圖 | 清單" (carry filters), display tabs 方格 / 圓點 / 熱區, colour tabs 密度 / 類型, type checkboxes (only types with records), year selects 48px, species search 48px, legend pinned at the panel's foot. Canvas: island fitted with symmetric padding inside the remaining width; Kinmen and Matsu stay reachable. Zoom buttons 44px field blocks. Record panel, right, 400px, field-900: species name 28px parchment-50, Latin italic 20px, date 20px, blurred-location notice as a plate, source line "路殺社（TaiRON）· CC BY 4.0", cream sign "完整紀錄"; the photo area renders only when a photo exists; the selected dot gets an ember-400 ring. Footer strip bark-950, 14px.
**Phone.** Band 56px with a JS-free `<details>` menu (five 56px links) beside 通報. Island fills the width (16px padding). Bottom bar 56px, field-900: 篩選 · 圖例 · 清單, each opening a sheet capped at 60% height; a 28px one-line legend strip sits above the bar; compact attribution stays visible above the sheet.

### Report (look and feel)
A field form. **Desktop:** left sticky field-900 column (360px): emblem 120px, "通報" at 56px, three progress lines (照片 · 地點 · 牠是什麼) that gain check marks; right 640px column on paper, steps separated by 2px rules with 28px titles. Photo = a 160px plate, 2px ink border, camera glyph and "拍照或選照片" at 20px. Location = picker in the forest basemap, 320px tall, no pin until chosen, overlay line "點地圖選位置" and a secondary sign "用我現在的位置"; once chosen, an ember pin and a confirmation row with a check. Condition = three choice plates. Species search = 56px input; optional details behind a `<details>`. Blocker sentence at 16px above a full-width 64px ember sign. **Phone:** single column, 16px gutters, submit sign sticky at the bottom with the blocker above it. **Success:** full-screen field-900, emblem 160px, "收到了。" at 40px, one status line driven by the API's returned status, signs "再通報一筆" and "看地圖". Errors: alert-700, 16px, beside the field.

### Species detail
**Desktop.** Full-bleed plate: roundel 220px left; right the Chinese name at 56px (system heavy), Latin italic + authority 20px, also-known-as 16px, tag row. Directly under it a field-900 **stat band**, three columns: "3,978 筆紀錄" · "2011–2017" · "4月最多", numerals Barlow Semi Condensed 56px parchment-50, labels 16px. Then two columns on paper: left a **portrait map frame 480×600** (the island is tall; symmetric fit, cooperative gestures, legend beneath, link "在完整地圖上看" to /map?taxonId); right the monthly chart at 200px with its sentence, linked lineage at 16px, source line. Closing block, field-900: "看到牠了？" and the ember sign "通報黑眶蟾蜍" prefilled with the taxon. Withheld and sparse states keep their logic; zero-record pages are plate, lineage and report sign only.
**Phone.** Roundel 140px centred, name 40px, Latin 20px, tags; stat band becomes three rows (numeral 40px left, label right); map 358×440; chart 160px; closing block with a full-width sign.

## 8. Asks, risks, effort

**Asks.** (1) Redrawn badge: layered SVG, current names, plus a letterless small mark for 40px and below (reverses "one logo everywhere"). (2) Ten group silhouettes; approve PhyloPic CC0 meanwhile. (3) Decisions: one Report action on home instead of three doors; credit as text linking to /attribution, not roadkill.tw; hide filter types with no records; drop header stats; 台 or 臺; allow one display webfont. (4) Native zh-TW review of about 25 short new strings. (5) Agreement to rewrite pinned tests: pages.spec.mjs:87-165, home.test.mjs (preload sizes, link counts), report-form.test.mjs:24,31, verify-deploy's text marker, FAMILIES.

**Risks.** Enlarging the emblem enlarges PROJECT ECOWATCH and the PNG's softness until the redraw lands; this direction depends on that asset more than any other. Heavy Hei in blocks can turn municipal; restraint (one primary, one block of each colour per viewport) keeps it proud. Species names in system heavy differ per device. A single-hue ramp separates adjacent classes less than the rainbow; size encoding and a truthful legend carry the rest. Ten silhouettes must not read as clip-art.

**Effort.** Prototype (tokens, fonts, Button/Tabs/Tag/ChoicePlate/Block/Rule, four pages, zh + en, 390 and 1440): 6-8 working days. Full rollout: 5-7 weeks (foundation and chrome 1.5; home 0.5; map chrome, basemap and legend 1.5; report skin 1; species and directory 1; records, stats, season, supporting and error pages 1; test rewrites, axe, contrast-in-CI and screenshot baselines 1; BioWatch 2-3 days after), plus 1-2 weeks of illustrator time running in parallel.
