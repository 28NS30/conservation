# Inventory: records and accounts

Routes (all under `apps/web/app/[locale]/(site)/`): `/reports` (list), `/reports/[id]` (detail), `/me`, `/login`, `/admin`. Paths below are relative to `apps/web/`. Screenshots seen: reports-list, report-detail, login (desktop + phone). `/me` signed-in and `/admin` have no screenshots; described from code and from production HTML (signed-out states).

## What it is for

- `/reports`: scan what has been recorded, newest first, without a map; it is also the map's screen-reader/no-JS equivalent.
- `/reports/[id]`: look at one observation — what animal, when, where, whose data — and move on to the species or the map. It is the page people land on from the map panel, the home ledger, species pages, `/me`, and the post-submit "view this report" link.
- `/me`: a signed-in reporter checks how far each of their submissions has got and which species they have recorded.
- `/login`: get a magic link by email. Optional; reporting never needs it.
- `/admin`: a moderator publishes or rejects held submissions.

## What is on screen today

### /reports (reports-list-*.png)
Desktop: 30px title 通報列表, a 14px lede that says "recent reports… the text version of the map, for screen readers", four pill chips (全部 filled black; 外來入侵種 / 一般目擊 / 路殺或受傷 with coloured dots), then a 12px four-column table (日期, 類型, 物種, 位置) of 50 hairline-ruled rows, a one-line ≈ legend, and "第 1 頁 … 下一頁 →" in 12px. The table sits in a `max-w-4xl` column with the last column ending at about 60% width, so the right third is empty. Nothing draws the eye: every visible row reads `2017/12/31 · 路殺 · <name> · 24.636, 120.883`. The 類型 column is the same word 50 times and the date barely changes. It reads as a database export — the exact thing the code comment at `reports/(list)/page.tsx:111-118` says it wanted to avoid (the photo column that was meant to fix it never renders because no record has a photo).
Phone: same table, fits 390px without horizontal scroll (good), chips wrap to two lines, rows are ~29 CSS px tall.

### /reports/[id] (report-detail-*.png)
A narrow `max-w-xl` column. Top to bottom: 12px "← 回到地圖"; a red dot and the H1 — which is the category, 路殺, at 18px (smaller than every other page's 30px title); 12px timestamp "2017/12/31 上午8:00:00"; H2 物種; the SpeciesCard (夜鷺, italic binomial + author, two blue status badges, rows for 棲地 / 分類 / 紀錄 "257 筆 · 最常出現在10月"); an 11px underlined "see all records of this species"; H2 位置; the coordinate "23.7758, 120.5832" in 14px; a 224px near-black static MapLibre tile with an orange pin and an expanded attribution pill covering a third of its bottom edge; an 11px source line "資料來源: GBIF · Taiwan Biodiversity Research Institute · CC BY 4.0". Then ~100px of blank and the footer. The species card is the only thing with visual weight and it is the best-made element here. The animal's name is the third thing you read, not the first. The black map slab is the loudest object and belongs to a different visual world from the cream page. Phone is the same stack and works; it is simply short and quiet.
Not visible with today's data but in code: a 2-column photo grid above the card, a notes block, an amber "blurred" notice, and the AI-suggestions list (`SpeciesConfirm`).

### /login (login-*.png)
Title 登入, one-line lede ("reporting needs no account"), an email field whose only label is the placeholder `you@example.com`, and a full-width button that renders beige-on-beige (disabled until an `@` is typed), so the page's single action looks dead on arrival. Then an empty half-screen. On phone the button's bottom edge touches the footer rule (`login/page.tsx:35` has `pt-16` and no bottom padding). After sending: one ember-tinted sentence, no address shown, no resend, no change-email.

### /me (code + production signed-out HTML)
Signed out: title, one sentence, ember pill "登入". Signed in: four bordered stat tiles (total / published / identified / species), a "species you have recorded" grid of bordered link rows, then "your reports" as a stack of bordered rounded rows: colour dot, name, 11px "category · date", and an 11px text journey "✓ 已送出 → 已鑑定 → 已發布 → 開放資料"; rejected rows get a 10px rose chip. Each row links to `/reports/[id]`. Empty: a bordered box with "還沒有通報紀錄" and an ember pill.

### /admin (code)
Title 審核佇列, 12px count, then up to 100 bordered cards: dot + category + timestamp + raw flag reason, species, notes, 5-decimal true coordinates with a Google Maps link, 96px cropped square thumbnails, ember "發布" and outlined "退回" (which opens `window.prompt`). After acting, the card collapses to "已發布 · 1a2b3c4d".

## Components

| file | role | used by | verdict | note |
|---|---|---|---|---|
| `app/[locale]/(site)/reports/(list)/page.tsx` | server page: filter parse, query, table | — | rebuild layout, keep data layer | filter parsing/`withFilter` and the `reports_public` query are right; the table is the problem |
| `reports/(list)/loading.tsx` | skeleton | list | restyle | draws 7 chips; page has 4 |
| `reports/[id]/page.tsx` | server page | map panel, home, species, /me, form, QueueBanner | rebuild layout, keep queries | no `generateMetadata`; hierarchy inverted |
| `components/species/SpeciesCard.tsx` | species facts card | detail (and species area) | keep, restyle | emits its own `<h2>` under the page's `<h2>物種` |
| `components/report/ReportMap.tsx` | static locator map; true-radius circle for obscured records | detail | keep logic, restyle basemap/frame | comments at :11-20 and :38-55 are load-bearing |
| `components/report/SpeciesConfirm.tsx` | pick among AI candidates | detail | restyle | tracked-uppercase heading; raw English errors |
| `components/site/PageHeader.tsx` | title + lede | list, /me, login, admin | restyle | detail does not use it |
| `me/page.tsx` (+ inline `Journey`, `Status`) | private history | header (signed in only) | restyle; extract Journey as the shared receipt | security comments :37-63 must survive |
| `login/page.tsx` | magic link form | /me, /admin | rebuild (small) | not a `<form>`, no label |
| `admin/page.tsx` + `components/admin/ModerationRow.tsx` | moderation queue | — | rebuild row | internal tool; lowest priority |
| `admin/actions.ts`, `reports/[id]/actions.ts` | server actions | — | keep untouched | role re-checks and candidate constraint are tested |

## Design problems

1. **Two of the three filter chips are dead ends that print the forbidden sentence.** Production `/reports?group=invasive` and `?group=sighting` return zero rows and render 目前沒有通報。/ "No reports yet." (`list.empty`, page.tsx:217-218). All 46k records are roadkill. This breaks the owner's standing rule and makes the page look broken on the second click.
2. **The list is a spreadsheet.** 12px text, identical 類型 cell on every row, coordinates instead of places, no count of how many records exist, no year jump — 46k records behind a "next" link, 50 at a time (page.tsx:221-306, reports-list-fold.png).
3. **The lede tells sighted visitors the page is not for them** ("適合螢幕閱讀器使用") and promises "最近" while the newest row is 2017/12/31 (zh-TW.json `list.subtitle`; reports-list-fold.png).
4. **The way into a record is an unstyled date** in body colour with no underline (page.tsx:263-271); the species name — the thing people would click — goes elsewhere. Active species/date filters are applied invisibly.
5. **No route between list and map for sighted users**: the map's link here is `sr-only`; the list has no "view on map"; `/reports` is only in the footer.
6. **Detail leads with the category, not the animal.** H1 is "路殺" at 18px (page.tsx:122-130); the species is an H2 section below. No `generateMetadata`, so the page people share has the generic site title.
7. **False precision in time**: imported records show "上午8:00:00" — UTC midnight rendered in Taipei (page.tsx:132-136, report-detail-fold.png). Date-only records should show a date.
8. **Coordinates as the headline of "位置"** with no place name; the dark map slab clashes with the page (report-detail-fold.png). "← 回到地圖" is hard-wired to `/map` whatever page you came from (page.tsx:115-120).
9. **Source line is 11px and names GBIF and TBRI but not 路殺社/TaiRON** (page.tsx:239-257) — on the one page where a record's credit matters most.
10. **Pending/rejected reports 404** from `/me`, the success screen and offline receipts, because detail reads only `reports_public` (page.tsx:54-72; me/page.tsx:211-213).
11. **Login**: placeholder-only label, no `<form>` so Enter does nothing, raw Supabase error text, dead-looking primary button, no resend/change email, callback errors (`?error=`) never shown, button flush to footer on phone (login/page.tsx:35-60; login-phone-fold.png).
12. **Accounts are a one-way door**: there is no sign-out anywhere in the app (grep finds none), `/me` never says which email is signed in, and `/login` is reachable only via `/me` or `/admin`.
13. **`/me` is all 10–12px metadata**: the journey — its whole point — is an 11px arrow-separated sentence (me/page.tsx:300-323); stat tiles and bordered rows repeat the card-everything language the owner dislikes.
14. **Admin**: 96px cropped evidence, `window.prompt` for rejection, flag reasons shown as raw English strings from `lib/abuse.ts:78-88`, an untranslated "Grant yourself access with: update profiles…" SQL hint shown to any signed-in non-moderator (admin/page.tsx:55-61), and exact coordinates of unreviewed (possibly protected) species sent to Google Maps in a URL (ModerationRow.tsx:75-85).
15. **Status colours are off-system**: amber/rose come from Tailwind defaults, not `@theme` tokens (detail :222, me :330, ModerationRow :62), so states will drift from any new palette.

## What works

- The privacy architecture: public pages read `reports_public` as `web_anon`; detail cannot render an unpublished or suppressed record even by mistake.
- The whole map filter (`group`, `taxonId`, `from`, `to`) survives into the list and through paging.
- Obscured records are honest: ≈ mark with a visible legend only when needed; the detail map draws the real 10/50 km footprint rather than a pin; the amber notice says why.
- SpeciesCard is genuinely good content built from real TaiCOL data, and "records" not "rarity" is the right word.
- The photo column that only exists when a photo exists; the list works with no JavaScript and fits a phone without sideways scroll.
- `/me`'s idea — a private, four-state journey and a personal species list, nothing gamified — and the header only showing "my reports" when signed in.
- Passwordless, optional accounts; login copy says so in one line.

## Constraints a redesign must respect

- Public routes read only `reports_public` via `asPublic`; photos may be read with the privileged connection only after a public row proved visibility (detail :74-77, list :119-129). Never pass `reports` coordinates to `ReportMap`.
- `/me` must stay private, noindex, scoped by session user id, with the signed-out guard before the query and no `searchParams` — `test/my-reports.test.mjs` greps the source for these. Any pending-report receipt must not show coordinates or be readable by anyone but its owner; anonymous reporters have no session to prove ownership.
- `test/sign-in.test.mjs` pins `/auth/callback` in the login page; `test/admin-auth.test.mjs` pins role re-checks; `test/confirm-species.test.mjs` pins the candidates-only rule. `e2e/pages.spec.mjs` and `e2e/focus.spec.mjs` load `/reports` and signed-out `/me`.
- The list must remain a true text equivalent of the map: same three groups, same filter schema, real table semantics or an equally navigable structure, caption, works without JS. Keep it a server component; no client bundle. Detail's MapLibre instance is the only heavy client code here — keep it static and lazy.
- Signed photo URLs expire (900 s): plain `<img>`, not `next/image`.
- Data truths: every record is imported roadkill with no photo, a date but no real time, and no place name column — a design that depends on photos, times or localities needs new data work. Do not write "no reports yet" anywhere.
- Every new string in both catalogues; zh-TW reviewed by a native reader; no tracked-uppercase tricks on CJK; status colours as `@theme` tokens (unknown token = silently no CSS).
- "Open data" on `/me` means "qualifies for export"; nothing has been published to GBIF — copy must not claim otherwise.

## Verified review claims in this area

- `list-row-target` — only the date links to a record; species/date filters applied but not shown.
- `list-toggle` — map→list link is screen-reader-only; no list→map link.
- `detail-photo-grid` — lone photo stuck in half a 2-col grid, no enlargement, `alt=""`.
- `receipt-404` — pending/rejected reports 404 from success screen, `/me`, offline receipts.
- `receipts-indistinct` — offline "sent" receipts are identical "開啟" links into this area.
- `login-a11y` — unlabeled email input, no form submit, no resend/change-email.
- `moderation-ux` — 96px cropped thumbnails of 2048px files; `window.prompt` rejection.
- `ledger-coords` — coordinates instead of places is the site-wide convention (list :289, detail :209); the GBIF import never ingested county/township/locality, so place names need a data job (a township join on `location_public` reveals no more than the blurred point already does).
- Touching this area: `tiny-text` (names `me/page`, `SpeciesConfirm`, `ModerationRow`), `gbif-copy` (`me.journeyHint`), `lang-drops-query` (language switch on a filtered list drops `group/taxonId/from/to/page`), `status-copy` (receipt wording feeds `/me` and any held-report view).
- Not a review claim but the same pattern as `raw-errors`: login :30, SpeciesConfirm :54 and ModerationRow :44 print `error.message` verbatim (English, untranslated).

## Questions for the owner

1. With only roadkill in the data, should the list show the three type chips at all, or hide empty types until they have records?
2. Is the list a first-class "browse the records" page (in the main nav, paired with the map), or does it stay a quiet accessibility equivalent?
3. On a record page, what leads: the animal's name, the place, or the date? And is a place name (township/road) worth a reverse-geocoding job, since the data has only coordinates?
4. Should each imported record credit 路殺社/TaiRON by name, not just GBIF and TBRI?
5. What should a reporter see for a report that is held or rejected — a private receipt page, or just a status row on `/me`? What about anonymous reporters?
6. Do accounts deserve any visible entry point (and a sign-out), or stay deliberately hidden until real reporters exist?
7. Who moderates, on what device, in which language? That decides how much design `/admin` earns.
8. English list rows show only Latin binomials (no English common names exist in the data). Acceptable?
