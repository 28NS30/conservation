# Design inventory: foundation and shared chrome

Scope: `apps/web/app/globals.css`, `app/[locale]/layout.tsx`, `components/brand/*`, `components/site/*`, `components/LanguageSwitcher.tsx`, `app/manifest.ts`, `app/icon.png`, `app/apple-icon.png`, `public/brand-badge.png`, both `opengraph-image.tsx`. Paths below are relative to `apps/web`. Repo at c73bb8d. Counts are `grep` over `app/` + `components/` `*.tsx`.

## What it is for

- Header: tell the visitor whose site this is, get them to Map / Species / Statistics / About, switch language, and always offer "+ Report".
- Footer: secondary routes (Season, Report list, Attribution, Privacy, Contact), the CC BY credit (a licence condition, not decoration), language switch.
- PageHeader / ProseSection: make every inner page open the same way (title, one-line lede).
- Skeleton: hold the layout still while a server page streams.
- Tokens / type: make the pages and the badge read as one organisation.
- Icons / manifest / OG: what the project looks like in a browser tab, on a phone home screen, and in a LINE / Threads link preview.

## What is on screen today

**Desktop header, every page except the map** (home-fold, species-dir-fold, stats-fold, privacy-full, login-fold): a 56px cream bar with a hairline under it. Left: 32px badge (a dark-green disc, nothing in it legible) + `福爾摩沙守望計畫` at 15px with 0.18em tracking, over `PROJECT FORMOSAWATCH` at 9px, 0.3em tracking, 70% opacity. Right: four 12px grey-green links, an 11px `中文 / English` switch, then a small terracotta pill `+ 通報` (12px). Nothing marks the current page. The eye lands on the orange pill; everything else is one quiet grey line. It is tidy and forgettable, and it is the same size of type as a footnote.

**Home** adds a near-black strip under the header: 11px monospace `46,334 筆紀錄 · 2011–2017 · 來源：路殺社 (TaiRON) 經 GBIF 釋出 · CC BY 4.0`, with 路殺社 linking out to roadkill.tw in a new tab.

**Phone header** (home-phone-fold, species-dir-phone-fold, report-phone-fold): two rows. Row 1: badge + wordmark + `+ 通報`. Row 2: `地圖 物種 統計 關於` left, `中文 / English` right, 12px, hairlines above and below. No menu button, no JS. Works; costs about 90px before content; link targets are roughly 16px tall.

**Map header** (map-fold): same bar on paper-100, 28px badge, 13px/8px wordmark, plus three live stats (`46,334 筆紀錄`, `458 個物種`, `2011–2017 資料期間`, 14px over 10px labels), the nav, switcher, pill. On a phone (map-phone-fold) it collapses to wordmark + pill only: no nav at all, language switch moves to the footer.

**Footer, site variant** (privacy-full, login-fold, home-full bottom): paper-100 band, three columns: 32px wordmark + one 12px sentence; `探索` list (Map, Species, Statistics, Season, Report list); `關於` list (About, Attribution, Privacy, Contact) + language switch. Column heads 11px uppercase `tracking-widest`; links 12px ink-500. Below a hairline: 11px source credit. On phones it stacks into a tall list of 12px links (privacy-phone-full). **Footer, map variant**: one 10px line, credit left, four links right.

**Inner page openings**: `text-3xl` semibold title, 14px lede, `mb-8`. Column widths differ by page: species/stats start at x=232 (max-w-5xl), privacy/about at x=408 (max-w-2xl centred), login at x=544 (max-w-sm centred), home at x=194 (1100px). The header logo only lines up with the content on some of them.

**404** (notfound-fold): no header or footer at all; a centred `404`, zh + en title, two pills. Clean, but anonymous: no mark, no name.

**Badge artwork**: pangolin crossing a road, tree, car, ember rivets, cream sky, forest ring. Genuinely distinctive. Ring lettering reads `生態守望計畫 / PROJECT ECOWATCH`. 512px PNG; at the home hero's 320 CSS px on a 2x screen it is being upscaled.

## Components

| File | Role | Used by | Verdict | Note |
|---|---|---|---|---|
| `app/globals.css` | @theme colour tokens, system font stack, focus rings, MapLibre control skin | everything | restyle | Colours only. No type scale, radius, spacing, shadow or semantic (surface/text/border/action) tokens. Comments are excellent and must be kept. |
| `app/[locale]/layout.tsx` | html/body, intl provider, SW, Analytics | every page | keep | Loads no web font. No `viewport`/theme-color export. |
| `components/brand/Badge.tsx` | next/image of the 512px PNG, clipped round | home hero (320), about (112), Wordmark | keep, new source art | Docblock refers to a `Mark` component deleted in 5798555. |
| `components/brand/Wordmark.tsx` | badge + zh name + tracked Latin | header, footer | rebuild | Hard-coded zh string in both locales (deliberate). 28/32/44px badge; Latin at 8/9/10px. |
| `components/site/SiteHeader.tsx` | one header, three variants | `(site)/layout`, home (`page wide`), map (`app`) | rebuild | `variant="site"` overlay is dead code: nothing renders it since the hero map left the home page. Async server component (reads session for "My reports"). |
| `components/site/SiteFooter.tsx` | full footer + thin map strip | same three | restyle | Credit is load-bearing. Not `wide`-aware. |
| `components/site/PageHeader.tsx` (+`ProseSection`) | inner page title block | 12 pages; about opts out | restyle | The right idea; carries no width, so pages pick their own measure. |
| `components/site/Skeleton.tsx` | `Bar`, `HeaderSkeleton`, `Page` | 3 `loading.tsx` | keep | `"Loading…"` sr-only string is hard-coded English. Boundary-position warning in its comment is load-bearing. |
| `components/LanguageSwitcher.tsx` | client locale toggle | header x2, footer x2 | restyle + fix | Drops the query string; 11px; comment is stale. |
| `app/manifest.ts` | PWA manifest | installs | fix | `short_name: "生態守望"` is two names old; dark theme colour on a light site; circular badge reused as `maskable`. |
| `app/icon.png` (256), `apple-icon.png` (180) | tab / home-screen icon | browsers | rebuild with the new mark | At 16px it is a green disc. |
| `app/[locale]/opengraph-image.tsx`, `species/[id]/opengraph-image.tsx` | share cards (dark, badge, subset CJK font) | LINE / Threads / FB | restyle last | Well engineered; hex values duplicated from tokens; species card uses an off-palette `#fb7185`. |
| (missing) Button, Chip, Card, Input, Kicker | — | — | create | None exist. Every page re-types the class string. |

## Design problems

1. **There is no type system, only sizes.** 17 distinct sizes in use: `text-sm` 82, `text-xs` 68, `text-[11px]` 59, `text-lg` 22, `text-[13px]` 14, `text-[10px]` 11, `text-[12px]` 9, `text-base` 8, `text-3xl` 8, `text-2xl` 7, `text-[9px]` 6, `text-[15px]` 6, plus 8/17/19/40/50px one-offs. 16px body text is used 8 times on the whole site; 14px and below is used about 250 times. A visitor on a phone outdoors reads a site set almost entirely in caption sizes, and nothing looks more important than anything else. This is the mechanical cause of the owner's "pills and small labels" complaint.
2. **The brand is set in its own smallest type.** Wordmark Latin is 8–10px at 0.3em tracking and 70% opacity (`Wordmark.tsx:49,60`); the badge beside it is 28–32px where the file's own comment says it "turns to mud below about 48px" (`Badge.tsx:8`). In the header the identity is a green dot and a grey line (home-fold, map-fold). The owner asked for the opposite: big logo, few words.
3. **The logo says a different name.** Ring reads PROJECT ECOWATCH / 生態守望計畫 next to an h1 that says 福爾摩沙守望計畫 (home-fold). Same stale name in `manifest.ts:15` `short_name`. The 512px source is also too small for a 320px hero at 2x. Known, waiting on the team; any design that enlarges the badge enlarges the contradiction.
4. **No web font and no display face.** `--font-sans` is a system stack (`globals.css:94-97`): SF/PingFang on Apple, Noto/JhengHei elsewhere, so the site's Chinese looks different per device and there is no typographic voice to pair with an illustrated badge. `font-mono` (7 uses) is likewise whatever the OS has.
5. **Tracked Chinese is the house style.** Wordmark sets Hanzi at 0.16–0.2em (`Wordmark.tsx:44-47`), the home h1 and kickers use 9 different arbitrary `tracking-[…]` values, 11 `uppercase` sites. Wide-tracked CJK is exactly the "letter-spacing trick" the brief warns about; it survives in a logo lock-up, not as a system.
6. **One surface, one border, one radius: everything is the same card.** `border-ink-900/10|12` 56 uses (19 distinct border colour/opacity combos in total), `bg-paper-100` family 37, `rounded-lg` 44, `rounded-full` 61. paper-100 on paper-50 measures 1.10:1 and the paper-200 hairline 1.27:1, so a card is barely distinguishable from the page (species-dir-fold, stats-fold). Stats tiles, species rows, charts, the season banner and the home doors all get the same box. Shadows are effectively unused (6), so nothing lifts either.
7. **Pills mean three things.** `rounded-full` is the primary action (`+ 通報`), the filter chip (species-dir-fold), the form choice (report-phone-fold) and the status badge. The primary ember button alone exists in 13 hand-typed variants (radius full/lg/xl, five paddings, two sizes). A visitor cannot tell a filter from an action by shape.
8. **Navigation is 12px grey with no "you are here".** `SiteHeader.tsx:100-108`: every link gets the same class, no `aria-current`. On the phone map there is no nav at all and the map footer has no Species/Stats link (`SiteHeader.tsx:130`, deliberate; map-phone-fold).
9. **Page columns do not agree.** 10 different `max-w-*` measures (xs to 7xl plus a literal 1100px); header is `max-w-5xl` except home (`wide`, 1100px), but the home footer is still `max-w-5xl`, so on home the footer sits 38px inside the content (home-full bottom: footer logo x=232, content x=194) — the very misalignment the `wide` prop's comment says "read as a mistake".
10. **Dark-surface leftovers on light pages.** `:root { color-scheme: dark }` (`globals.css:99-101`) paints native controls dark on cream — visible as the black checkbox in report-phone-fold. Tailwind default palettes (`sky`, `amber`, `red`, `emerald`) appear in 14 files outside the token set; the input focus halo is hard-coded paper-50 though inputs also sit on the dark map.
11. **Language switch loses the visitor's place** (`LanguageSwitcher.tsx:38`): map position, filters, species search and report category are all dropped.
12. **Two materials, no bridge.** Pages are cream/ink, the map is bark/parchment, and the only place they touch is a cream header bolted onto a black canvas (map-fold) and a black provenance strip bolted under a cream header (home-fold). Neither reads as intended.
13. **Install / share identity is dark while the site is light.** Manifest `background_color`/`theme_color` `#0b1410`, OG cards bark-950; a circular badge declared `maskable` will be cropped by Android's mask. 404 carries no mark at all.
14. **Small inconsistencies that read as carelessness:** footer says 台灣, hero says 臺灣; zh footer credit reads "TaiRON via GBIF" with an English "via"; Skeleton's "Loading…" is English only; stale comments describe a home-page map overlay that no longer exists (`SiteHeader.tsx:12-14`, `LanguageSwitcher.tsx:14-16`).

## What works

- The palette is sampled from the badge and documented with measured contrast ratios; ink-on-paper text passes AA everywhere it is used correctly. The ember accent is disciplined: it really is only on actions.
- The badge illustration itself: specific, Taiwanese, memorable.
- Chinese leads, Latin follows, in the wordmark and the OG cards. `:lang(zh) { font-feature-settings: "palt" }`.
- One global `:focus-visible` ring, plus fixes for datetime inputs and MapLibre buttons; a focus e2e spec backs it.
- Phone nav with no JS, no menu, no focus trap. Header and footer are server components; content pages ship almost no client JS.
- "My reports" appears only when signed in; Team link appears only when the roster is real.
- PageHeader/ProseSection already fixed the inverted-hierarchy headings once; the instinct to centralise is right, it just stopped at two components.
- OG pipeline: real badge, 4 KB CJK font subset, Latin fallback; copy read from the catalogues.
- Skeletons match layout and their comment records a real routing trap.

## Constraints a redesign must respect

- `test/design-tokens.test.mjs` fails on any class naming a missing step in families `paper, ink, ember, moss, bark, parchment`. Renaming families means updating `FAMILIES`; adding a family (or `scale`, currently unchecked) should add it there. The ink ramp stops at 500 on purpose (lightest AA step on paper).
- `test/home.test.mjs:37` pins the badge preload and its `imageSizes`; `e2e/pages.spec.mjs:85-130` pins home badge widths (320/272/172px), a one-line Latin name, no horizontal overflow at 320–1440, doors above the fold. These encode the owner's "bigger logo" request; change them knowingly.
- English nav needs about 660px in one row (`SiteHeader.tsx:93-96`): that is why inline nav starts at `md`. Any new header must be checked in English at 640–768px.
- Header is an async server component reading the session; keep it off the client bundle. No Suspense wraps it, so `useSearchParams` in the switcher would break the static home build (use `window.location.search` at click time).
- Map chrome height is the map's; MapLibre CSS loads after globals, hence the doubled-class selectors (`globals.css:162-165`). Do not touch the map's load path; a web font must not block it (subset, `display: swap`, CJK via unicode-range or stay system for body).
- The CC BY credit to TaiRON/GBIF and the contact link must be on every page including the map strip (licence and 個資法, `SiteFooter.tsx:14-15,48-51`). Obscured-record count in the footer is a privacy disclosure; keep it.
- Analytics only when `process.env.VERCEL` (`layout.tsx:57-61`). `Skeleton.tsx:13-23`: never put a `loading.tsx` above a segment that redirects or 404s.
- `global-error.tsx` and OG routes cannot use Tailwind; tokens are duplicated as hex there and must be updated by hand.
- Bilingual parity in both catalogues; zh-TW first; any wordmark/tagline change needs a native reader. Badge stays as drawn until the team redraws it.

## Verified review claims in this area

- `header-badge` — full badge rendered at 28–32px in header/footer; the simplified Mark was deleted in 5798555 as a deliberate "one logo" trade.
- `tiny-text` — 59x 11px, 11x 10px, 6x 9px, 1x 8px; whole map footer 10px; photo-remove button 20px.
- `dark-tokens-on-light` — `color-scheme: dark` on a light site; `sky-*` and `parchment-400` text on paper (1.1–2.9:1); focus halo hard-coded to paper-50.
- `map-mobile-nav` — no nav and no second row on the phone map; no current-page state anywhere; map footer has no Species/Stats either.
- `lang-drops-query` — switcher replaces with bare pathname; loses map view, filters, search, category.
- `error-links` — `errors.backHome` says "Back to map" but goes to `/`; `global-error.tsx` still half slate/emerald and on the dark surface.
- `list-toggle` (shared with map) — header nav has no `/reports`; the only map-to-list link is an sr-only skip link.

## Questions for the owner

1. When will the redrawn badge exist, and will it come as vector? Should the redesign assume a simplified small-size mark drawn from it (pangolin silhouette / scales), reversing the "one logo everywhere" decision of 5798555?
2. "Only a little bit of text next to it": in the header, is that the Chinese name alone (dropping the tracked Latin line in zh-TW), with `FormosaWatch` alone in /en? Today both locales show the Chinese-led lock-up.
3. May the site load one web font (a Traditional Chinese display face for titles only), given the map must stay fast? Or must it stay system-font?
4. The home strip and footer link out to roadkill.tw / gbif.org / taicol.tw in new tabs. The standing rule says readers are not sent away. Should the credit become plain text + a link to /attribution?
5. Should the pages stay cream while the map stays dark, or should the chrome around the map (header, footer, panels) go dark so the map page is one material?
6. Is a persistent header "+ Report" button still wanted once the home page and map each have their own primary report action?
7. Is a phone menu button acceptable (small client JS) or should navigation stay JS-free as now? Should "Report list" and "Season" be first-level destinations?
8. `short_name` for the installed app: 福爾摩沙守望 or 守望計畫? (Currently the retired 生態守望.)
