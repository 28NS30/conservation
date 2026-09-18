# Direction: Contemporary Taiwanese field journal (田野誌)

## 1. The idea

FormosaWatch looks like a well-printed Taiwanese natural-history journal: a huge emblem on the cover, animal names set large in Ming-style type, ink on clean paper, heavy rules instead of boxes, and a map that is a printed survey sheet rather than a night-vision instrument.

1. **Printed, not themed.** No paper textures, fake stamps, handwriting or torn edges. The journal feeling comes only from type, rules, margins and ink.
2. **The name is the picture.** There are no photographs, so the animal's Chinese name, set very large in a serif, is the image. Anything pictorial that is not evidence is printed in ink tone; only a reporter's photo is ever in colour.
3. **One thing leads, rules do the rest.** Each screen has one large statement and one ember action. Everything else is separated by rule weight (2px ink = new section, 1px soft = new row), never by a tinted box.

## 2. Palette

Existing family names are kept; `design-tokens.test.mjs` FAMILIES gains `wash`, `madder`, `ochre`, `indigo`. Ratios are computed (WCAG formula; script at `directions/fj-contrast.py`).

| Token | Hex | Use | Contrast |
|---|---|---|---|
| paper-50 | `#fbfaf6` | the sheet: every page and the map's land (was #faf7f0, less yellow) | — |
| paper-100 | `#f1eee4` | one tinted band per page at most; hover row; photo frame | 1.11 vs sheet, never a border |
| paper-200 | `#d9d4c5` | 1px row rule, decorative | 1.42 |
| ink-900 | `#16241c` | headings, body, 2px rules, outline buttons | 15.43 paper-50 · 13.88 paper-100 · 12.97 map water |
| ink-600 | `#435b4c` | secondary text, input borders | 7.08 · 6.37 · 5.95 |
| ink-500 | `#51695b` | metadata; the lightest text allowed | 5.71 · 5.14 · 4.80 |
| ember-700 | `#9a4e22` | primary button fill, link underline | paper label 5.77; as text 5.77 / 5.19 |
| ember-800 | `#7d3e1a` new | button hover | label 7.81 |
| ember-600 | `#b25c28` | focus ring on paper; selected-record ring (non-text) | 4.51 paper · 3.79 water |
| ember-400 | `#e08a4f` | focus ring on bark only | 7.06 on bark-950; 2.54 on paper, banned there |
| moss-700 | `#4a6835` | published / alive / endemic | 6.05 |
| madder-700, -500 | `#8c2a2a` `#b5403a` new | errors, protected status; roadkill mark | 8.11 · 5.35 |
| ochre-700, -500 | `#76560a` `#a97c12` new | caution, "location blurred", invasive; mark | 6.47 · 3.60 (mark only) |
| indigo-600 | `#2c5a85` new | sighting mark (red/yellow/blue is CVD-safe) | 6.91 |
| wash-1…6 | `#a2c397 #77a372 #518257 #326140 #19412b #092316` | map density ramp, one hue, even OKLCH lightness steps | 1.86 · 2.77 · 4.30 · 6.89 · 10.97 · 15.91 |
| map water | `#e2e8e4` | sea, map only | 1.19 vs land |
| bark-950 | `#0b1410` | the back cover: footer, OG cards, PWA splash, nothing else | — |
| parchment-50, -200, -400 | `#f6efe0 #d8cbb0 #9d9179` | text on bark | 16.35 · 11.67 · 6.03 |

Survive: paper, all ink, ember 400/600/700, moss-700, bark-950, parchment 50/200/400. Retired: bark 600–900, parchment 100/300/500, scale, moss 300–500, ember 300/500 in UI, and every Tailwind default (sky, amber, rose, emerald, slate). `color-scheme` becomes `light`. Ember never encodes data: it means "act" or "yours/selected".

## 3. Typography

- **Display, zh:** Noto Serif TC Bold 700 (OFL), one static weight. Ming is Taiwan's editorial register; Kai faces such as LXGW WenKai were rejected because 標楷體 reads as government forms and homework. Fallback: `"Songti TC","Noto Serif CJK TC","Source Han Serif TC","PMingLiU",serif`.
- **Display Latin and binomials:** Source Serif 4 (OFL), 600 roman + 400 italic, basic-Latin subsets of about 30–40 KB.
- **Text, controls, map chrome, numbers:** today's system sans stack, zero bytes. `tabular-nums` replaces `font-mono`.

**Cost.** A full Noto Serif TC weight is roughly 7–12 MB, about 250–300 bytes per glyph as WOFF2. Never ship it whole, and not Google's ~100 unicode-range slices either (a headline page pulls 0.5–1 MB). A build script (`scripts/subset-fonts.mjs`) emits two self-hosted, immutable files with exact `unicode-range`: **core** = every Hanzi in `zh-TW.json` (609 today) plus punctuation and digits, est. 160–190 KB; **names** = Hanzi in the zh names of taxa with public records plus county names, minus core, est. 150 KB, fetched only where those characters are set in serif. `font-display: swap`; core is preloaded on home only. The script also writes its character set as JSON: a species h1 containing any character outside it renders wholly in the fallback stack, so glyphs never mix. **/map loads no web font** (mark-only header, sans chrome). Serif is never used below 24px.

**Scale (phone / desktop px):**

| Step | Size | Face | Role |
|---|---|---|---|
| masthead | 48 / 88 | serif | project name on home, short species names, 404 |
| title | 34 / 56 | serif | page h1; one lead figure per stats page |
| heading | 24 / 32 | serif | section heads, finding sentences, gazetteer links |
| lead | 19 / 22 | sans | tagline, ledes, Latin name under a title |
| body | 16 / 17 | sans | reading text, labels, inputs, nav, buttons (600), rows |
| meta | 14 | sans | captions, legends, annotations, footer; smallest size for anything tappable or instructive |
| fine | 12 | sans | map attribution, scale bar, chart ticks, image credits only |

**zh:** letter-spacing 0 everywhere including the name; no uppercase; line-height 1.2 display, 1.75 body; measure 28–34 characters; `palt` on serif steps only; `line-break: strict`; `text-wrap: balance` on headings; `font-synthesis: none`; number and 筆 in a no-break span. **en:** display tracking −0.01em, line-height 1.1 / 1.55, 60–72ch, no all-caps labels. **Italic is for Latin binomials only** (`<i lang="la">`). On /en the large name is "FormosaWatch"; the Chinese name follows at lead size with `lang="zh-TW"`.

## 4. Component language

- **Grid replaces cards.** One 12-column grid, max 1200px, 24px gutters, 20px phone margins. A 2px ink rule spans the grid above each section; on desktop the section heading sits in a left margin (cols 1–3) and content in cols 4–11. Rule plus margin heading **replaces every uppercase kicker**. Nothing is boxed unless it is an input, a map or a picture.
- **Button (action):** rectangle, 4px radius, 52px tall phone / 48 desktop, body 600. Primary ember-700 fill, one per view. Secondary 1.5px ink-900 outline. Disabled: ink-500 outline and text, with the reason printed beside it. Never `rounded-full`.
- **Link:** ink-900 text, 1px ember-700 underline offset 3px.
- **Filter (tabs on a rule):** plain text labels standing on a 1px rule, 44px hit height; selected is ink-900 600 with a 3px ink underline, `aria-pressed`/`aria-current`; optional count at meta. No fill, no border. The same control serves nav current-page, directory filters, map view modes and Map|List.
- **Choice (form):** full-width rows 56–64px between 1px rules with a 22px radio mark; selected = 3px ink left bar, paper-100 ground, filled mark; `role="radiogroup"`, so tests read `aria-checked`, not class strings.
- **Status (annotation):** no capsule. An 8px square in the status colour plus meta 600 text in its 700 step: `■ 保育類 II級`, `■ 特有種`, `■ 位置已模糊`; inline with middots, a body-size definition list on detail pages.
- **Lists (ledger rows):** the whole row links, 56px minimum; name body 600, italic Latin meta, right-aligned tabular count, and in ranked lists a 3px ink bar under the row scaled to the count, so 3,978 visibly outranks 90. Hover paper-100. **Tables:** 2px top rule, meta 600 heads, 52px rows, stacked two-line rows under 640px.
- **Legend:** a strip of six contiguous 28×10 swatches with break numbers under the joins, titled by what is drawn ("每格紀錄數"); heat shows a continuous strip labelled 少 → 多, no numbers; at record zoom, "每個點是一筆紀錄" with type marks. It lives in the panel.
- **Charts:** at least 200px phone / 240 desktop, 2px baseline, bars ink-600 with the peak ink-900, printed values (peak only under 480px), a `<details>` data table, months 1–12 (zh) or Jan–Dec (en). The finding sentence is the chart's title.
- **Empty:** no illustration and no "nothing yet". Filters with no data are not rendered; a zero-record species page omits the records section; a filtered-to-empty list names the active filter and offers 清除篩選.
- **Loading:** the page's real rules draw at once; text is paper-100 bars on the final grid, no shimmer. The map skeleton is sheet plus water tint.
- **Footer = back cover:** the one bark-950 surface: badge at 96px on its native green, body-size links, credit and 個資法 contact at meta.

## 5. Imagery

Documentary photography does not exist, so this direction does not wait for it.

1. **The emblem**, very large, is the only picture home needs.
2. **Type as image:** `黑眶蟾蜍` at 88px is the species hero, and it works for all ~66k taxa with no asset.
3. **Reference plates, ink-toned.** A `taxon_media` table (self-hosted file, author, licence, source URL) filled by hand for the ~60 most-recorded species from Wikimedia Commons, iNaturalist and GBIF media, **CC0 and CC BY only**. Rendered `grayscale(1)` multiplied onto paper-100 so mixed-quality photos become one green-black series; fine-size caption "參考圖 · 非本站紀錄 · 作者, CC BY 4.0"; source URLs listed on /attribution, not linked outward. **Colour = evidence, ink tone = reference**: the separation the review demands becomes structural.
4. **Commissioned line plates** for 12 flagship species (穿山甲, 石虎, 黑眶蟾蜍, 龜殼花, 雨傘節, 斯文豪氏攀蜥, 白鼻心, 食蟹獴, 領角鴞, 紅鳩, 麻雀, 大頭蛇) by the badge's illustrator: ink line plus one flat tint, SVG under 15 KB.
5. **Atlas plates:** pre-rendered AVIF crops of the real paper map at the four MAP_PLACES (a script drives /map headlessly; about 70 KB at 1600w). Public tiles only, so blurring is inherited.
6. Optional: 6–8 of the team's own road-through-habitat photographs, ink-toned, for /about and BioWatch.

The plate slot collapses when empty; day one ships with 1, 2 and 5.

## 6. The map

The map becomes a **light survey sheet**, reversing the recorded "map stays dark" decision: on paper a single-hue ink ramp works, and the instrument finally shares a material with the site.

- **Basemap:** same OpenFreeMap tiles, same single style fetch; `transformBasemap` also recolours: land paper-50, water `#e2e8e4`, landuse fills off, roads ink-900 at 12–25% opacity, land boundaries 1px ink-500 dashed, place labels ink-600 and road labels ink-500 with a paper halo. Land outside a Taiwan/Penghu/Kinmen/Matsu/Lanyu polygon takes the water tint +4% and loses its labels below z9 (`within` filter), so the island is **centred** with symmetric padding instead of pushed 42% left; Kinmen and Matsu stay reachable. `MapHints` preload URL, `FALLBACK_STYLE` (#fbfaf6) and the basemap fixture change together. No new requests, client code or fonts.
- **Ramp:** wash-1…6 on the existing breaks. The lowest class still recedes (the insight in `map-bins.test.mjs`, inverted for a light ground; the test must flip knowingly). Dots get a 0.75px ink-700 outline and class 1 steps to wash-2 from z10, not z13.5, which fixes the empty middle zooms. Type mode uses madder / ochre / indigo marks and lists only types present. Selected record: ink centre, 3px ember-600 ring.
- **Chrome:** one paper panel with a 2px ink edge: Map|List tabs carrying filters, species search, years, view tabs (方格 default, 圓點, 熱區), the 密度|類型 switch (kept per owner decision; disabled with a stated reason in heat), legend strip. Type-filter tabs render only for groups that have records. Popup and attribution restyled paper/ink; attribution always visible. Header stats removed.

## 7. Compositions

### Home
**Desktop 1440.** Header 72px: no wordmark on home (the hero is the identity); body-size nav with current-page underline, 中文/EN, primary "通報". The hero fills the first viewport: emblem **520px** in cols 1–5 (interim 400px; 520 needs a 1040px+ source), vertically centred; cols 7–12 hold `福爾摩沙／守望計畫` at 88px on two lines, "Project FormosaWatch" at lead, the existing one-line tagline at lead, then one primary button "通報一筆" (200×52) with a text link "看地圖". At the hero's foot, a 2px rule and one meta colophon line crediting 路殺社（TaiRON）, GBIF, CC BY 4.0, linking to /attribution. No provenance bar, no "你看到了什麼？", no doors: the choice moves into the form. Section 2, the route into the map: an atlas plate 888×560 in cols 1–9, a real place (rotating daily through MAP_PLACES) and one link to /map at that view, captioned at meta; cols 10–12 are a gazetteer, "從地方看" with four places and "從動物看" with three species, each a heading-size serif link 48px tall, then a secondary button "打開地圖". Section 3: "這一週，在別的年份", seven ledger rows (tabular date, name, italic Latin; no blank row, no coordinates). Section 4: one paragraph of at most 60 Hanzi on who runs this, plus "關於本計畫". Back cover. About 2.3 screens.
**Phone 390.** One 48px header row: four nav links and the language switch, no JS. Emblem **300px** centred (interim 256px, pixel-exact at 2x from the 512 source), name 48px centred on two lines, tagline 19px, full-width 52px primary button, "看地圖" link; the button ends near y=650. Plate full-bleed 390×260, gazetteer as 48px rows, ledger with date above name, paragraph, back cover.

### Map
**Desktop.** 56px header (mark only, nav with current state, 通報), 2px rule. 360px left panel as in section 6; the island is centred in the remaining canvas. Selecting a record swaps the panel's content ("← 篩選與圖例" returns; Esc too): species name at heading size in sans 600, italic Latin, status annotations, the date (no invented time), the ochre blurred-location annotation or coordinates at meta, "路殺社（TaiRON）志工紀錄 · CC BY 4.0", a colour photo only when one exists (no "no photo" box), secondary button "開啟完整紀錄". Footer strip at meta: credit, obscured count, contact.
**Phone.** 56px header: mark, 通報, and a `<details>` "選單" that drops the nav over the map (no JS, no focus trap). The island fills the width (fit padding 12/16/80). A persistent 64px bottom bar carries the legend strip and a "篩選" button; it opens the same panel as a sheet capped at 60dvh, or a record at 45dvh, with attribution moved above it. All targets 44px.

### Report (look and feel)
Paper, sans controls; serif only for the title and step headings. **Desktop:** cols 1–4 sticky: "新增通報" at title size, a one-sentence lede, and a live slip (photo thumb, place, time) set like a specimen label between two rules. Cols 5–11: steps under 2px rules with heading-size titles: 照片, 位置, 牠的狀況, 是什麼動物（選填）, 補充 (`<details>`). The photo control is a full-width 3:2 dashed ink-600 frame on paper-100 labelled "拍照或選擇照片"; thumbnails 96px with 44px remove targets. The location map uses the paper basemap, 360px tall, **no pin until chosen**, with a centred secondary button "使用目前位置"; once set, an ember pin (ember = yours) and a meta line with 重設. Condition is three choice rows, nothing preselected; the injured row opens an ochre-ruled notice whose wording comes from the owner. Errors sit beside their field in madder-700 with a recovery action. **Phone:** the same order in one column; a sticky 72px bottom bar under a 2px rule holds the blocker sentence ("還差：位置") and the 52px primary button. **Receipt:** a full page: "收到了。" at title size, one status annotation driven by the API's returned status (已公開 / 等待辨識 / 已存在這支手機), the slip as a definition list, primary "再通報一筆", secondary "看地圖"; a record link only when published.

### Species detail
**Desktop.** Linked lineage breadcrumb at meta. Cols 1–8: Chinese name at 88px when five Hanzi or fewer, else 56px; binomial in Source Serif italic at lead, authority roman at meta, 也稱作 at meta. Cols 9–12: the plate slot (4:5, ink-toned, credited); when empty the name block spans all twelve columns. Under a 2px rule, a generated finding sentence at heading size: "2011–2017 年間有 3,978 筆路殺紀錄，四月最多。" Status and habitat as a body-size definition list. Then two columns: month chart (cols 1–7, 240px, printed values) and a **portrait** paper map (cols 8–12, 440×616, because Taiwan is tall), island centred, cooperative gestures on, legend strip beneath, links "在大地圖上看" and "看紀錄列表" carrying taxonId. Closing band: "看到牠了？" with a primary "通報黑眶蟾蜍" to `/report?taxonId=`, then a meta source line naming 路殺社. Zero-record taxa show name, status and the action only; withheld taxa show the ochre annotation and no map or count.
**Phone.** Name 48px (may wrap), Latin 19px, plate full-width 4:3 if present, finding sentence 24px, status list, chart 200px, map 350×420, the two links as 48px rows, full-width primary button, source line.

## 8. Asks, risks, effort

**Asks:** (1) the emblem redrawn with the FormosaWatch name as SVG or 2048px+, plus a simplified mark for 40–56px; (2) approval for a light map; (3) approval for two subsetted serif files; (4) approval to replace the three doors with one action and rewrite the tests that pin them; (5) a native zh-TW reader for new strings (finding templates, receipt statuses, colophon); (6) the illustrator for 12 line plates and someone to curate about 60 CC0/CC BY photos; (7) injured-wildlife referral wording; (8) whether the header 通報 button stays on home.

**Risks:** the light map reverses a recorded decision and its two darkest classes are close (prove on real tiles, grid view first); a bigger hero enlarges the ECOWATCH lettering until the redraw lands; the subset pipeline is new build machinery, and rare names fall back to system Ming, which differs by device; serif leaking onto controls would read as a literary magazine; photo curation is slow and legally fiddly; about eight test files need deliberate rewrites (home pins, report class-string pin, map-bins luminance, basemap fixture, `_contrast.mjs` constants).

**Effort (one designer-developer):** prototype of the four pages with tokens, six components, font subsetting and the paper basemap, 8–12 working days. Full rollout across all pages, tests, OG/manifest/global-error hex and skeletons, a further 25–35 days. Image curation 3–5 days; illustration external; BioWatch inherits the system in 3–5 days afterwards.
