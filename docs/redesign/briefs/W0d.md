# W0d — Trust fixes: state that gets thrown away, and basic a11y

Paths relative to `apps/web`, read at c73bb8d. Bugs, not design: use today's tokens; W2 reskins later. Claim ids: `../verified-claims.json`.

**Goal**
A visitor never loses what they chose: switching language keeps the map view, filters, search and page; the species search keeps the filter; "report this species" arrives with the species filled in; the directory reaches every recorded species, not the first 80. Lists name their filters, login works with Enter and a screen reader, charts give numbers without hover, no English page scrolls sideways on a phone, and no dark-UI leftovers remain on cream pages.

**Why / evidence**
- `lang-drops-query`: `components/LanguageSwitcher.tsx:38` replaces with the bare pathname.
- `species-search-drops-filter`: `components/species/SpeciesSearch.tsx:29` rebuilds the URL from `q` alone.
- `directory-cap`: `species/(directory)/page.tsx:51-55` `limit: 80`, no offset or total (`lib/species.ts:142-151` takes `offset`); `:89-92` says 找不到符合的物種 for a real species hidden by the default `recorded` filter.
- `list-row-target`: `reports/(list)/page.tsx:263-271` the only record link is a body-coloured date, 15px tall; `taxonId/from/to` apply (`:100-103`) but show nowhere; zero rows prints `list.empty` 目前沒有通報。, the banned sentence, live on `/reports?group=invasive`; no other W0 brief owns it.
- `login-a11y`: `login/page.tsx:43-59` no `<form>`, label or submit; `:38-42` dead end after send; `:30` raw Supabase English; `?error=` from `app/auth/callback/route.ts:16,22` never read.
- `chart-a11y`: `components/stats/Columns.tsx:29,44`, `components/species/MonthlyChart.tsx:22,28`: `role="img"`, values only in `title`; `stats/page.tsx:80-84` English axis J F M A M J J…; `Columns.tsx:4-7` claims a table that does not exist.
- `dark-tokens-on-light`: `globals.css:99-101` `color-scheme: dark` (black checkbox in `shots/report-phone-fold.png`); `ReportForm.tsx:425,430,441` `sky-*` at 1.02–1.28:1; `LocationPicker.tsx:127` `text-parchment-400` 2.90:1; `globals.css:246` halo hard-coded paper-50.
- `report-prefill`: `species/[id]/page.tsx:193,262` bare `/report`; `report/page.tsx:23` reads only `category`; `ReportForm.tsx:53` cannot be seeded.
- `tiny-text`, target size only (production, 390px): photo remove `ReportForm.tsx:356` 20×20; EXIF Skip `:441` ~17px; language buttons 22×17; pager links 15px tall.
- Sideways scroll, re-measured on production: `/en/stats` scrollWidth 421 at 390 and 320; `/en/species` 364 at 320 and 360; zh-TW is clean (the planner's "/species" is `/en/species`). Grids with no base column template (`stats/page.tsx:144`, `(directory)/page.tsx:97`) grow to the longest Latin name; `minmax(0,1fr)` forced in the live DOM fixed both.
- Nothing honours `prefers-reduced-motion`; W0a defers it here.

**Scope**
In: the items above, a shared `Pager`, a shared chart table, tests.
Out: report errors, receipts, lazy pin (W0a). Legend, phone nav, map/list toggle (W0b). GBIF and classifier wording (W0c). Type scale, 9–12px text, other default-palette hues (W2). Header/footer link sizes, switcher look (W3). MapLibre easing under reduced motion (W5, W6). Deriving category, stripping `?taxonId` offline, drafts across a language switch (W6). Directory hierarchy, chart size (W7, W9). Whole-row `DataRow`, place names, sign-out (W8). Unowned, for the planner: `species.noRecords`/`beFirst` (`species/[id]/page.tsx:189-198`) is also a banned sentence; W0d changes only its href.

**Depends on / Blocks**
Neither. W6 reuses `initialSpecies`; W7/W8 reuse `Pager`; W2's `Figure` and `.on-field` absorb the chart table and `.on-dark`; W3 supersedes the switcher fix but keeps its e2e. W13 baselines follow PRs 2 and 6.

**Decisions needed from the owner** (none blocks starting)
1. Charts gain a closed disclosure 顯示數字 / Show the numbers. Default: yes.
2. English month axis 1–12, as on the species chart (Jan–Dec cannot fit 16–26px columns at W2's type floor). Default: numerals; long names in the table.
3. Native zh-TW read of strings marked ※. Blocks merging PRs 2–5 only; do it in review.

**Design spec (behaviour)**
- Language switch: go to `pathname + location.search + location.hash`, read at click time (catches the map's `replaceState` writes); keep `replace`; 24px minimum button box.
- Species search: the page passes its validated `filter`; the box writes `{ pathname: "/species", query: { q?, filter } }`, never `page`, also when cleared.
- Directory: `?page=N`, 80 per page, `countSpecies()` sharing `listSpecies`' WHERE, `t.id` as last `order by` key, N clamped. Range line ※ 第 {from}–{to} 種，共 {total} 種 / {from}–{to} of {total} species. `Pager`: prev/next keeping `q` and `filter`, 44px hit height, labels from `list.previous/next/pageN`. Empty with `q` and `filter ≠ all`: probe `listSpecies({ q, filter: "all", limit: 1 })`; on a hit show ※ 「{filter}」裡沒有符合「{q}」的物種。 / Nothing under "{filter}" matches "{q}". and link ※ 改搜尋全部物種 / Search all species instead.
- Reports list: with `taxonId/from/to` set, one line under the chips: ※ 目前篩選 / Filtered by, the species name linked to its page (omitted if the public lookup returns null), the date range, 清除篩選 / Clear filters (reuse `map.clearFilters`; keeps `group`); same text in `<caption>`. `list.empty` becomes ※ 沒有符合的紀錄。 / No matching records., plus the clear link when any filter, `group` included, is active. Date link: `block`, `text-ink-800`, underlined, padded so phone rows are ≥44px. `Pager` replaces `:321-340`.
- Login: `<form onSubmit>`, visible label ※ 電子信箱 / Email, `autoComplete="email"`, `type="submit"`, 44px controls, `pb-24`. Catalogue errors only, `role="alert"`: ※ 寄不出去，請稍後再試。 and a 429 variant. Sent (`role="status"`): ※ 已寄到 {email}, 重新寄送 (disabled 60 s), 換一個信箱 (keeps the address). `?error=` shows ※ 登入連結已失效，請重新寄送。
- Charts: keep bars and `role="img"`; add `<details>` holding a `<table>` (caption = label; ※ 月份 or 年份 | 筆數), numbers in the page locale, `title` with the long month name. `components/stats/ChartTable.tsx`, server-rendered, labels as props (no new namespace for `pages.spec.mjs` NAMESPACES).
- Surfaces: `:root { color-scheme: light; --focus-halo: var(--color-paper-50) }`; `.on-dark { color-scheme: dark; --focus-halo: var(--color-bark-950) }` on the wrapper at `map/page.tsx:115`; both focus rules read the variable. EXIF strip `border-ink-900/12 bg-paper-100 text-ink-700`; Use `bg-ember-500/15 text-ember-700`; Skip `text-ink-600`; both ≥32px tall. Coordinates `text-ink-500`. Photo remove: 24px disc, 44px hit area by pseudo-element, clear of the "+" tile. One global `prefers-reduced-motion: reduce` rule zeroing transitions and animations.
- The two directions do not differ structurally here.

**Implementation steps** (one commit each)
1. `LanguageSwitcher.tsx`; rewrite its stale comment `:8-18`.
2. `SpeciesSearch.tsx`, `(directory)/page.tsx:62`.
3. `species/[id]/page.tsx:193,262` → `{ pathname: "/report", query: { taxonId: s.id } }`; `report/page.tsx`: `parseSpeciesId` + `getSpecies` (not the map's `namedTaxon`: zero-record taxa must prefill), bad id ignored; `ReportForm.tsx:30-41,53` `initialSpecies`.
4. `grid-cols-1` at `stats/page.tsx:144`, `(directory)/page.tsx:97`, `(directory)/loading.tsx`.
5. `lib/paging.ts` (pure `pageWindow`), `components/site/Pager.tsx`, `countSpecies`, tiebreak, directory page, messages.
6. Reports list page; public name lookup in `lib/species.ts`; messages.
7. Login; keep the literal `/auth/callback` in `login/page.tsx` (`test/sign-in.test.mjs:36-41` greps it); read `?error=` in a child inside `<Suspense>` so the form stays in the static HTML.
8. `ChartTable.tsx`; `Columns.tsx` (`locale` prop, fix comment `:4-7`); `MonthlyChart.tsx`; `stats/page.tsx:80-84`; messages.
9. `globals.css:99-101,210-217,238-248` plus the motion rule; `map/page.tsx:115`; `LocationPicker.tsx:127`; `ReportForm.tsx:356,425-446`.

**Acceptance criteria**
- `e2e/pages.spec.mjs`: add `/en/species`; new `checkWidths()`: `scrollWidth <= innerWidth` at 320/360/390 on `/en/stats`, `/en/species`, `/reports`, `/login`; new `checkState()`: on `/en/reports?taxonId=28758&from=2015-01-01` click `button[lang="zh-TW"]` → `/reports`, same query; `/en/map?lng=120.5&lat=23.5&z=9` → `/map`, lng/lat within 0.01; on `/species?filter=invasive` type 龜, then clear: `filter=invasive` and the active chip survive both.
- `test/paging.test.mjs` (unit). `test/species.test.mjs`: walking `/species?page=N` to the end yields exactly the ids the DB counts, no repeats (the CI fixture is small: never assert 354 or a second page); `?page=99` is 200; no empty state contains 還沒有 or 目前沒有.
- `test/report-form.test.mjs`: `/report?taxonId=28758` renders 黑眶蟾蜍 in the picker; a zero-record id prefills; `?taxonId=abc` is ignored; `?category=` cases pass unchanged.
- New `test/a11y-basics.test.mjs`: `/login` has a `<form>`, a `label[for]` matching the input, `type="submit"`; every `<figure>` on `/stats` and the toad page holds a `<table>`; `/en/stats` axis labels are unique; `:root` is `color-scheme: light`; no `sky-` or `parchment-` class under `components/report/`.
- `e2e/focus.spec.mjs` passes with `/login` added; `node apps/web/e2e/_contrast.mjs` and `--mobile` report nothing new; every control touched meets WCAG 2.5.8.
- Manual: Enter submits login; VoiceOver reads label and alert; `/report` checkbox and date picker are light, map year selects dark. Screenshots at 390×844 and 1440×900, both locales: directory, filtered and empty list, login (empty, error, sent), stats with a table open, EXIF strip.
- Performance: no new client component except the login error child; `/map` requests and bundles unchanged.

**How to verify**
From the repo root: `npm run db:up`, `npm run dev`, then `npm test`, `npm run test:pages`, `npm run test:focus --workspace @conservation/web`, `npm run typecheck --workspace @conservation/web`, `npm run lint --workspace @conservation/web`. Playwright sends no Accept-Language, so unprefixed paths render zh-TW; test `/en/...` explicitly (the overflow exists only there). After editing `messages/*.json`, stop the dev server before `rm -rf apps/web/.next`. Mass timeouts are local DB contention: re-run first.

**Risks and traps**
- Privacy: names only through `asPublic`. On the list, join `species_report_stats` as the map does: "naming one above an empty map would be the only thing on the page confirming it had been recorded here" (`map/page.tsx:29-32`). Prefill may use `getSpecies`; it reports 0 for withheld taxa.
- No `redirect()` under `(directory)/loading.tsx`: "Any route beneath it that calls redirect() or notFound() then answers 200 instead" (`Skeleton.tsx`). Clamp and render.
- `useSearchParams` in the switcher breaks the static home build (no Suspense wraps `SiteHeader`).
- Deliberate: `Columns.tsx:31-32` index keys, `:41-42` 2px minimum bar; `(directory)/page.tsx:120-121` count and 筆 on one line; `MapFilters.tsx:283,297` dark `<option>`s (so dark is scoped, not removed).
- `/report?taxonId=` is its own service-worker cache key (`public/sw.js:55`); W6 strips it; leave `sw.js` alone.
- Shared files: `messages/*.json` (W0a–c too: append, never reformat, rebase); `ReportForm.tsx`, `LocationPicker.tsx` (W0a edits `:231-241`, `:415`, `:458`, `:543-559` and the picker's marker: keep step 9 to class-only hunks); `species/[id]/page.tsx` (hrefs only); `globals.css` (land before W2); `pages.spec.mjs` (add functions and rows; leave `checkHome`).

**Suggested PR breakdown and effort**
1. URL state, steps 1–3 (0.5 d). 2. Directory and overflow, steps 4–5 (1 d). 3. Reports list, step 6 (0.5 d). 4. Login, step 7 (0.5 d). 5. Charts, step 8 (0.5 d). 6. Surfaces, targets, motion, step 9 (0.5 d). Size M: about 3.5 person-days or 12–14 agent-hours. PRs are independent; 1 and 6 add no copy.
