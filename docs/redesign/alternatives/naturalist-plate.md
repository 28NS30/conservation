# Direction: Naturalist's plate (博物圖版)

## 1. The idea

Every page is a plate from a Taiwanese field guide: one animal drawn in ink, its Chinese name set very large in a Ming-style serif, and the data (where, when, what it is related to) drawn as small exact figures beside it, on clean paper with ruled lines instead of boxes.

Three principles:

1. **The animal is the headline.** If a page concerns a species, the largest things on it are its picture and its Chinese name. Counts, coordinates and categories are captions.
2. **Rules, not fills; one box only.** The only bordered container in the system is the *plate* (a figure: silhouette, diagram or map). Everything textual is open layout separated by ink rules and whitespace. No tinted cards, no pills.
3. **Never draw what we do not have, and say what a drawing is.** Artwork is reference, not evidence. Every figure carries a caption naming what is depicted, who drew it and its licence. A stand-in (a relative, an order glyph) is labelled as a stand-in. Absence is handled by leaving things out, never by a placeholder or an apology.

## 2. Palette

Contrast computed with the WCAG formula (script: `directions/np-contrast.mjs`).

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `paper-50` (kept) | #faf7f0 | page ground | |
| `paper-100` (kept, demoted) | #f3ece0 | wells only: inputs, footer band | |
| `paper-200` (kept) | #e7dcc9 | decorative hairlines between list rows (1.27:1, never a control boundary) | |
| `plate-0` (new) | #fffdf8 | the sheet inside a plate frame | |
| `ink-900` (kept) | #16241c | silhouettes, display type, plate borders, links | 15.06 on paper-50, 15.85 on plate-0, 13.72 on paper-100 |
| `ink-600` (kept) | #435b4c | body-secondary, captions, map labels | 6.91 / 7.28 / 6.30 |
| `ink-500` (kept) | #51695b | quietest text; input borders; coastline | 5.57 / 5.87 / 5.08 |
| `ember-500` (kept) | #cf7238 | primary button fill only, label in ink-900 | ink-900 on ember 4.69 (white would be 3.43, so never white); ember on paper 3.21, never text |
| `ember-700` (kept) | #9a4e22 | link hover, error text | 5.63 on paper-50 |
| `seal-700` (new, cinnabar) | #a3271f | protected/sensitive seal; roadkill in Type mode | 6.85 paper-50, 7.20 plate-0, 6.91 map land |
| `moss-700` (kept) | #4a6835 | endemic seal; sighting ring | 5.91 / 6.22 |
| `ochre-700` (new) | #7a5a12 | invasive seal | 5.95 / 6.26 |
| `chart-land` / `chart-sea` (new) | #fbf8f1 / #e4e9e2 | map ground (1.16:1 between them, so the coast is a 1px ink-500 line: 5.62 / 4.84) | ink-600 labels 6.97 on land, 6.01 on sea |
| `stipple-1..6` (new) | #dcc592 #c9a35f #b07f38 #8a5a26 #553620 #16241c | density ramp, pale ochre to ink | on land 1.59, 2.23, 3.33, 5.54, 10.23, 15.19; every dot also carries a 0.75px ink-600 stroke (6.97) so the two palest classes meet 3:1 by outline |

Survives: paper, ink, ember, moss-700. Retires from the UI: bark, parchment, scale, moss-300..500, and every Tailwind default sky/amber/rose/emerald. `color-scheme` becomes `light`. OG cards and `global-error.tsx` move to paper/ink by hand. `FAMILIES` in `design-tokens.test.mjs` gains plate, seal, ochre, stipple, chart. Links are ink-900 with an underline, so ember stays an action colour and cinnabar is the only red.

## 3. Typography

- **Display (CJK):** Noto Serif TC 700 (= Source Han Serif, OFL). One weight only. The Ming/Song face is what printed 圖鑑 use; it gives the voice the badge lacks.
- **Display (Latin) and binomials:** Source Serif 4 (OFL), roman 600 and italic 400, Latin subset, about 25-30 KB each. It is the Latin companion Source Han Serif was designed around.
- **Body and UI:** the existing system sans stack (PingFang TC, Noto Sans TC, JhengHei). Zero bytes.
- No monospace. Data uses `tabular-nums`.

**Cost control.** A full CJK weight is 5 MB+ and Google's unicode-range slices cost several 50-100 KB files per page, so subset at build time instead. `display-ui.woff2` holds only the Hanzi used in display-role catalogue strings (the whole zh-TW catalogue has 610 unique Hanzi; headings need roughly 250, an estimated 70-90 KB) and is preloaded on content pages. `display-species.woff2` holds the extra Hanzi in recorded species' names (an estimated 400-500 glyphs, about 150 KB) behind a `unicode-range` of only its own codepoints, so it downloads only when needed. Both use `font-display: swap`, immutable caching and the fallback `"Songti TC", "Noto Serif CJK TC", "PMingLiU", serif`. The build emits the codepoint set; a species name with any glyph outside it (the long-tail taxa) renders wholly in the system Song stack, so one name never mixes fonts. **`/map` paints no serif glyph on load** (emblem-only header), so its load path fetches no font. Budget to prove in the prototype: 90 KB preloaded, 200 KB lazy, 0 on `/map`.

**Scale (7 steps, replacing 17):**

| Step | Size / line-height | Face | Role |
|---|---|---|---|
| display | clamp 40 to 72 / 1.12 | serif 700 | home name; species name on its own page |
| title | clamp 30 to 40 / 1.2 | serif 700 | page h1; headline figures ("3,978") |
| heading | 26 / 1.3 | serif 700 | section h2; species name in panels and plate rows |
| lead | 20 / 1.6 | sans 400, or serif for names in lists | tagline, ledes, the finding sentence, large button labels |
| body | 16 / 1.75 zh, 1.6 en | sans | prose, nav, inputs, list rows, buttons |
| small | 14 / 1.6 | sans | captions, credits, legends, table column heads, footer |
| micro | 12 / 1.4 | sans, **Latin and digits only** | axis ticks, bar values, basemap attribution. Hanzi never go below 14. |

**zh vs en.** Letter-spacing on Hanzi is always 0; only uppercase Latin micro labels may take +0.08em, and there are no uppercase kickers on zh pages at all. `palt` on display, heading and UI labels, off in running prose. `line-break: strict`, `text-wrap: balance` on headings; the project name breaks only between 福爾摩沙 and 守望計畫. Italic is for Latin binomials only: `font-synthesis: none`, and `:lang(zh) em { font-style: normal }`. On `/en` a species h1 is the italic binomial at display size with the Chinese name upright at heading size beneath (`lang="zh-TW"`); the home name is "FormosaWatch" in Source Serif 4 with the Chinese name second.

## 4. Component language

- **Buttons** are rectangles, 2px radius, 1px ink-900 border, 48px tall (56 in heroes), body-size 600 label. Primary: ember-500 fill, ink label, one per view. Secondary: paper fill. Tertiary: underlined text with an arrow.
- **Filters** are words, not shapes: a row of index tabs at body size with counts, selected = ink-900 with a 2px underline rule and `aria-current`/`aria-pressed`, unselected ink-600, 44px hit height. Multi-select options are checkbox rows (20px square box, 44px row).
- **Status badges** are seals (印): square-cornered 1.5px outline, serif 14px, cinnabar (保育類), moss (特有種), ochre (入侵種). Never clickable, never filled, never rotated. On species pages each seal is paired with a plain sentence ("第二級保育類野生動物").
- **Form choices** are full-width 64px radio rows (mark, lead-size label, small hint), `role="radiogroup"`, selected = 2px ink border.
- **Cards** are gone. Sections open with a 1px ink-900 rule and a heading. The **plate** is the one box: plate-0 fill, 1px ink border, an inner hairline 6px in, a small caption beneath ("圖 2 月份分布"). Kickers are replaced by those figure captions or by nothing.
- **Lists** are index rows: 72px, 48px silhouette, serif name at lead size, italic binomial, seals, right-aligned count with a thin relative bar, hairlines between; names wrap, never truncate. The directory groups rows under class headings (兩生類, 爬蟲類, 鳥類, 哺乳類) and states "354 種中的 1-80" with paging.
- **Tables** are real tables at body size, a 1px ink rule under small column heads, numbers right-aligned; stacked rows on phones.
- **Legends** live in the caption of the plate they explain and are generated from the actual layer, mode and zoom regime.
- **Charts:** the seasonal strip: 12 columns, at least 160px tall, value printed above each bar (micro digits), month labels at small ("4月" / "Apr"), peak bar ink-900, others ink-500, a lead-size sentence above ("四月最常被記錄。") and the series as a visually hidden table.
- **Empty states** name the filter, not the absence ("目前篩選：2015-2017 · 龜殼花", with a 清除篩選 button); options with no records are not offered; zero-record species simply have no records section.
- **Loading:** the plate frame renders at once with a paper-100 block inside; no shimmer under reduced motion; localised sr-only text.

## 5. Imagery: where the animals come from

A resolution chain, computed at build time into a `taxon_artwork` manifest (taxon, source, depicted taxon, matched rank, creator, licence, file). First hit wins:

1. **Commissioned plate** (species-exact). About 20 flagship species in one hand: the ten most recorded (黑眶蟾蜍, 麻雀, 龜殼花, 奧氏後相手蟹, 斯文豪氏攀蜥, 紅鳩, 大頭蛇, 雨傘節, 紅斑蛇, 赤尾青竹絲) plus emblematic ones (穿山甲, 石虎, 白鼻心, 食蟹獴, 領角鴞). Single-colour ink line, lateral view, SVG, rights assigned or licensed so the project may release them CC BY 4.0. Ideally the same illustrator redraws the emblem, making the pangolin plate no. 1.
2. **PhyloPic, exact species.** Vector silhouettes, vendored into `public/plates/` (SVGO, single path, `fill="currentColor"`, 2-15 KB each); no hotlinking, no runtime dependency. Licence policy: accept only CC0, Public Domain Mark and CC BY; reject NC and SA (the API exposes `filter_license_nc/sa`; new uploads are limited to CC0, PDM and CC BY 4.0, older images vary).
3. **PhyloPic, nearest ancestor** (genus, then family). Caption must say so: "示意剪影：同科的 *Anaxyrus woodhousii*".
4. **House order glyphs**: a closed set of about 24 drawn in-house (蛙, 蛇, 蜥蜴, 龜, 雀形目, 鳩鴿, 鴞, 鷺, 猛禽, 鼠, 鼩, 蝙蝠, 食肉目, 偶蹄, 穿山甲, 兔, 蟹, 螺, 昆蟲, 蜘蛛, 魚, 植物, 真菌, 其他). This is the guaranteed floor, keyed on the `order`/`class` columns already on `taxa`.
5. **Nothing.** The plate frame is dropped and the page becomes a typographic plate: display name, binomial, and the lineage ladder drawn as the figure.

I sampled the PhyloPic API today (build 557) with 16 names. Species nodes existed for 3 (*Passer montanus* PDM, *Prionailurus bengalensis* CC0, *Rattus norvegicus* whose primary image is BY-NC-SA, so rejected); 11 of the 12 most-recorded species had none. CC0 genus or family silhouettes existed for Duttaphrynus, Streptopelia, Bufonidae, Viperidae, Colubridae, Elapidae, Agamidae and Soricidae; Sesarmidae had nothing. Expect roughly 10-20% exact, most vertebrates at family level, invertebrates on house glyphs, which is why tier 1 is not optional for the top ten. Someone who knows Taiwan's herps and birds approves the top 100 matches; anything misleading drops to the order glyph.

Marks generated from data need no licence and exist for all 66k taxa: the **seasonal strip**, the **lineage ladder** (界 to 種 as a stepped line diagram with linked rungs), four **habitat marks** (line pictograms replacing habitat pills) and **seals**. No mini-islands, no data-art.

Evidence stays separate: report photographs are unframed and labelled 通報照片; silhouettes appear only inside a captioned plate; a record with no photo shows no placeholder. `/attribution` gains a generated artwork-credits table.

## 6. The map joins the plate world

The map becomes a light chart, the distribution plate of the book. Same OpenFreeMap vector tiles, its positron style instead of dark, passed through the existing `lib/basemap.ts` rewrite and preloaded by `MapHints` exactly as now (a URL constant and colour constants change; nothing is added to the load path). Land `chart-land`, sea `chart-sea`, 1px ink-500 coast, roads as ink hairlines that strengthen with zoom, labels ink-600 with a land-coloured halo in the basemap's existing glyphs. The skeleton becomes paper, which removes the cream-to-black flash.

Density uses the `stipple` ramp: darker and larger means more, monotonic in lightness (colour-blind safe), and every dot is outlined so z10-13 no longer looks empty. Heat mode uses the same ramp with a "fewer to more" legend and no numbers. Type mode separates by form as well as hue: roadkill solid cinnabar, invasive solid ochre with ink outline, sighting a hollow moss ring. At z14+ the legend switches to "single records" regardless of the density/type setting. Selected record: 2px ink ring with a paper halo. Mode order (heat, bins, dots), non-heat default, layer ids, tile URLs, `replaceState` sync and the density/type switch are untouched.

## 7. Compositions

### Home
**Desktop (1440, 1200 container, 12 columns).** Header 72px: name only on this page (the emblem is below), nav at body size with an underlined current page, language switch, no header report button here. Hero: emblem in columns 1-5 at 480px (360px until the vector redraw exists; the PNG cannot honestly go larger), vertically centred. Columns 7-12: the name at display size, no tracking; the tagline at lead size on one line; two buttons side by side, primary 通報一筆 and secondary 打開地圖, both 56px; one small credit line "紀錄來源：路殺社（TaiRON），經 GBIF 釋出，CC BY 4.0" linking to `/attribution`. Under 30 words above the fold; the dark provenance strip is gone.
Band 2, the route into the map, is a **plate row**: five plates (220 x 300) of the most recorded non-sensitive species, each a large ink silhouette, the serif name at heading size, italic binomial, one fact line ("3,978 筆 · 四月最多"), the whole plate a link to `/map?taxonId=`. Beneath, one line at lead size: "或從一個地方開始：臺北 · 臺中 · 臺南 · 花蓮" (the existing `MAP_PLACES`), and a tertiary link to the full map. No map picture.
Band 3, 歷年本週: five ledger rows (serif date, 32px silhouette, name), no coordinates, no blank first row. Band 4: three sentences of at most 20 words (what, who, privacy), each linking to `/about`. Footer. About two screens.
**Phone (390).** Header 56px: 44px emblem and the four nav words in one row (fits zh and en; wraps at 320); language switch in the footer. Hero centred: name at display (40px, two lines), emblem 260px (240 interim), tagline at body size, full-width primary then secondary button, credit line. Plate row becomes a 2-column grid of four plates plus the places line. Ledger rows stack. About three screens.

### Map
**Desktop.** Standard 72px header (emblem 48px, no name, so no serif at first paint). One left panel, 360px, paper-50 with an ink right rule, replaces the filter pill, the floating legend and the right-hand record panel. Top to bottom: heading 分布圖; species search (48px input); year range; display tabs 熱區 / 方格 / 圓點; colour tabs 密度 / 類型; the legend directly under the tabs that change it; "以列表檢視" carrying the filters; credit lines. Type options with no records are not listed. The island is fitted to the remaining 1080px with 48px padding, centred; Fujian's coast may appear as unlabelled land; Kinmen and Matsu stay pannable. Selecting a dot swaps the panel to a **specimen label**: 160px silhouette plate with caption, species name at heading size, italic binomial, date (no invented time), the blurred-location notice when obscured, "來源：路殺社（TaiRON）", primary 完整紀錄, secondary 這個物種, and a back link to filters. Footer strip 32px at small size with credit, obscured count, contact.
**Phone.** Same 56px emblem-plus-nav header, which ends the dead end. Island fits the width with 24px padding. A 64px bottom bar holds "篩選與圖例" with an inline six-swatch ramp, and a 48px ember 通報 rectangle at its right end; tapping raises a 60% sheet with the panel content; a record opens the same sheet as a specimen label. Basemap attribution is MapLibre's compact control above the bar, always visible.

### Report (look and feel)
The form is a specimen label being filled in. Paper ground, one serif question per step at heading size, 64px radio rows for dead / hurt / alive, the photo control an empty plate frame with a camera line icon and a labelled 56px button "拍照或選照片", the location picker a light chart plate with no pin until a place is chosen (then an ink crosshair and a "位置已選" line), optional details behind a quiet "補充說明" rule. Errors sit beside their field in ember-700 sentences. **Desktop:** form column 560px left, a sticky 400px label preview plate right that fills in as you answer; choosing a species makes its silhouette appear in the preview. **Phone:** single column; a sticky 72px bottom bar holds the blocker sentence above the full-width submit button so it can never be clipped. **Receipt:** the completed label as a full plate: silhouette or order glyph, name or 未鑑定, date, "位置已記下", and a seal driven by the returned status (已發布 in moss, 待審 in ochre) with one sentence on what happens next, then 再通報一筆 and 回到地圖.

### Species detail
**Desktop.** Row 1: plate in columns 1-7 (4:3, about 680 x 510), silhouette at 70% of plate width, class and order top-left in small, caption beneath with depicted taxon, creator and licence. Columns 8-12: name at display size (names over six Hanzi step down to title), italic binomial at lead with upright authority, 也稱作 in small, seals with their sentences, the finding sentence at lead ("2011-2017 年間 3,978 筆紀錄，四月最多。"), then primary 我也看到了 (carries `taxonId` into the form), secondary 在地圖上看, tertiary 所有紀錄. Row 2: 圖 1 分布, a portrait plate (3:4, 560 x 720) so the container matches the island, which fills it; cooperative gestures, legend in the caption, dots in ink. Beside it 圖 2 月份 (seasonal strip) over 圖 3 分類 (lineage ladder with linked rungs) and habitat marks. Row 3: 同科物種, four small plates. A source line closes the page.
**Phone.** Plate full width (358 x 268), name at 40px, binomial, seals, finding sentence, full-width primary and secondary buttons, map plate 358 x 480, strip, ladder, relatives in a 2 x 2 grid.
**States.** Stand-in art is captioned as such; no art at all gives the typographic plate; zero records omits row 2's map and strip and keeps the ladder and the report action, with no sentence about absence; withheld taxa show a cinnabar seal 座標不開放 and no map or count.

## 8. Asks, risks, effort

**Asks.** (1) Emblem redrawn as vector with the current name, preferably by the illustrator of the flagship plates. (2) Budget and a rights agreement for about 20 species plates and 24 order glyphs (illustrator quote needed; lead time 6-10 weeks). (3) Approval of the licence policy and per-image credits. (4) Approval of a light map. (5) Approval of one self-hosted display font. (6) One report action on the home page instead of three doors, with `pages.spec`/`home.test` rewritten as intent (emblem at least 40% of phone width, one report link and one map link above the fold, plate links non-sensitive). (7) A naturalist to vet the top 100 silhouette matches. (8) A native zh-TW reader for captions, status and finding sentences. (9) House style decision 臺灣 vs 台灣.

**Risks.** Species-level silhouettes are scarce for Taiwan's fauna, so without the commission the top species wear foreign relatives. PhyloPic styles vary between contributors and need curation. The light map may feel less dramatic than the dark one, and the stipple ramp must be proven on the real 46k records at z7, z11 and z15. CJK font payload and Windows fallback quality. A museum look can turn twee: no paper textures, ornaments or sepia. The emblem and the commission are outside dependencies. About a dozen tests pin markup this direction changes.

**Effort.** Prototype (home, map, report, species detail; two widths, two locales; token and font pipeline; artwork matching script with a coverage report; rough order glyphs): about 4 person-weeks, 2.5 elapsed with a designer and developer in parallel. Full rollout (directory, records, stats and season, supporting and error pages, account, OG cards, BioWatch, test rewrite with baselines, zh review): a further 8-10 weeks, with illustration running alongside.
