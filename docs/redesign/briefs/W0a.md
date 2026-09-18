# W0a — Trust fixes: report receipts and status truth

Repo `/Users/neo/conservation`; paths are relative to `apps/web`; code read at c73bb8d. Read `apps/web/AGENTS.md` first: this is Next 16, so check `node_modules/next/dist/docs/` before writing route code.

**Goal**
After sending a report, a visitor is told the truth: on the map or held, decided by the server's answer, and no link they are given is a 404. Failures arrive as sentences in their language beside the control that failed, the map picker never looks answered when it is not, and someone reporting a hurt animal is told nobody will come.

**Why / evidence** (claim ids from `../verified-claims.json`)
- `receipt-404`: `components/report/ReportForm.tsx:237-242` always links to `/reports/{id}`, but `app/[locale]/(site)/reports/[id]/page.tsx:54-72` reads only `reports_public`, so every held report 404s, also from `me/page.tsx:211-212` and `QueueBanner.tsx:159-160`. The `<a>` at `:238` drops `/en`.
- `status-copy`: `ReportForm.tsx:169-172,235` discards the API's `status` (`app/api/reports/route.ts:105-108,158-166`); a no-photo report is `pending` yet told "已發布至地圖". `report.identifying` promises "通常一兩分鐘"; the classify cron has never run in production.
- `raw-errors`: `ReportForm.tsx:109,131-132,165-167,209` show codes and English literals; `:203` renders the literal `report.queueFailed`; `:138-142` ignores upload errors; `lib/offline/flush.ts:70,81,130,139,143` store English that `QueueBanner.tsx:225-227` prints. A non-2xx spends the Turnstile token, so a retry fails with `challenge_failed`.
- `location-default`: `LocationPicker.tsx:74-76` pins Taiwan's centre before anything is chosen; `ReportForm.tsx:458-459` always says 點地圖可調整位置, and `:415` reuses it as the geolocation error.
- `injured-guidance`: nothing at `ReportForm.tsx:297-321` or `:227-245` says no one is dispatched.
- `receipts-indistinct`: `QueueBanner.tsx:155-167` renders N identical 開啟 links; `offline.sentCount` lacks an English plural.
- Overlap: `-mb-1` (`ReportForm.tsx:544`) overrides `space-y-6`, so the button clips the blocker sentence (`shots/report-phone-full.png`).

**Scope**
In: the six claims, the overlap, a Turnstile reset after a failed send, "report another", a minimal receipt state on `/reports/[id]`.
Out: form order, pills, category derivation, drafts, on-device receipts for direct sends, the `route.ts:109` precision gap (W6). Record detail and `/me` layout (W8). `sky-*`/parchment tokens on paper, 11px text, reduced motion (W0d). `report.speciesUnsureHint` ("the model will still try") and `docs/launch-checklist.md:235` (W0c). Moving the crons (owner). New tokens and the Notice primitive (W2). Moderation (W11).
Carries over to W6/W8: `lib/report/outcome.ts`, `lib/report/errors.ts`, `lib/receipt.ts` and the receipt branch, `serverStatus`, every new message key, the Turnstile reset, the no-marker rule, the new tests. Throwaway: all JSX, classes and markup-matching assertions for `ReportForm.tsx`, `QueueBanner.tsx`, `LocationPicker.tsx`.

**Depends on / Blocks**
Depends on nothing. Blocks nothing; W6 and W8 build on its modules; W13 baselines after it lands.

**Decisions needed from the owner**
1. Injured referral: agency, number, wording. Blocks only that sentence. Default: ship the no-dispatch sentence alone; invent nothing.
2. A receipt state on `/reports/[id]` for anyone holding the id. Default: yes; ids are random UUIDs given only to the reporter, and the page shows "not public", nothing else. If refused, drop PR4; PR1's conditional links stand.
3. A native zh-TW reader. Truly blocking: unread copy stays out of production.

**Design spec** (behaviour; both directions are structurally identical here)
Existing tokens only (`ink-*`, `ember-700`, `paper-*`, `bark-950`, `parchment-50`); no new `amber/rose/sky` classes; leave `globals.css` alone. Notes are `role="note"` with `border-l-4 border-ink-600 pl-3 text-sm text-ink-700`, the shape of W2's Notice, which later replaces them.

*Outcome*, a pure function `outcomeOf(status, awaitingIdentification, photoCount)`:
| Server said | Title | Body | Link |
|---|---|---|---|
| `published` | 已經在地圖上了 / It's on the map | none | 看這筆紀錄 / View this record |
| `pending`, awaiting id | 收到了，還沒公開 / Received. Not public yet. | 沒有物種名稱，要先確認是什麼動物才會公開。這是人工處理，時間不一定。/ Someone has to identify the animal first. That is done by hand, with no timetable. | 看目前狀態 / Check its status (PR4 only) |
| `pending`, no photo | same | 沒有照片的通報，會先由人看過才公開。/ A person looks at reports without a photo first. | same |
| anything else | same | 這筆通報會先由人看過才公開。/ A person will look at this report first. | same |
`duplicate: true` counts as the status it carries. Done and queued cards add 再通報一筆 / Report another (keyed remount: new nonce, new token). No minutes, no "AI".

*Receipt state.* `/reports/{id}` with no public row calls `receiptState(id, viewerId)`; `null` gives today's 404. Otherwise HTTP 200, `noindex`: title 收到了，目前沒有公開 / Received. Not public right now.; body 沒有照片或沒有物種名稱的通報，會先由人看過。部分物種的位置不會公開。/ A person looks at reports without a photo or species name first. Some species' locations are never shown.; links to `/report` and `/map`. Strangers get this one undifferentiated state; the signed-in owner also sees `me.status.rejected` when rejected. No date, category, species, notes, photo, map or coordinate.

*Errors.* `report.errors.*`, draft zh given, English to match: `rate_limited` 送出太多次了，請過幾分鐘再試。; `challenge_failed` 瀏覽器驗證沒有通過，請再試一次。; `photo` (all `photo_*`, `sign_failed`, `bad_count`, `bad_request`, upload failure; shown in the Photos section) 照片傳不上去。可以重試，或拿掉照片再送。; `photoUnreadable` 這張照片讀不了，換一張或重拍。; `taxon_not_found` (by the species picker) 找不到這個物種，請重新選一次。; `validation_failed` 有欄位的內容不對，請檢查後再送。; `server` (`bad_json`, `insert_failed`, 5xx, and the `unknown` fallback) 伺服器出了問題，通報沒有送出。內容還在。Raw codes go to `console.error` only; old IndexedDB rows holding English fall back to `server`.

*Location.* No marker until a value exists. While unset: an overlay 點地圖標出位置 / Tap the map to mark the spot (`bg-bark-950 text-parchment-50`, `pointer-events-none`), and the helper reads `needLocation`; once set, `tapToAdjust`. Geolocation failure, under the map with `role="alert"`: 拿不到你的位置，請在地圖上點選。/ Couldn't get your location. Tap the map instead.

*Injured.* When `category === "injured"`: 這裡只做紀錄，不會有人前往現場。/ This only records what you saw. Nobody will be sent. under the condition choice, and again on the done and queued cards.

*Queue receipts.* One row each, at least 24px tall: link text "{observed date in the page locale} · {category}", then 看這筆紀錄 or 看目前狀態 by the stored `serverStatus`. English `sentCount` gains an ICU plural.

All strings above: **needs native read**.

**Implementation steps** (one commit each)
1. `lib/report/outcome.ts`: `outcomeOf`; `test/report-outcome.test.mjs`.
2. `messages/*.json`: add `report.receipt.*`; delete `identifying`, `published`, `thanks`, `received`, `viewReport` (used only at `ReportForm.tsx:231-241`).
3. `ReportForm.tsx`: store `status`; render by outcome; `Link` from `@/i18n/navigation`; link only when published. Wrap the form in a keyed host in the same file for "report another".
4. `ReportForm.tsx:543-559`: drop `-mb-1`; wrap blocker and button in `space-y-2`; `aria-describedby` from button to blocker.
5. `lib/report/errors.ts` (`ReportError {code,status}`, `errorKey`, `slotOf`) plus `report.errors.*`.
6. `ReportForm.tsx`: carry the sign response's code; check `uploadToSignedUrl`'s `error` as `flush.ts:80-81` does; throw `ReportError`; add `photoError` and `speciesError` slots; `tOffline("queueFailed")`; after any non-2xx, reset Turnstile through `onReady` and clear the token. Fix the stale comment at `Turnstile.tsx:61-67`.
7. `flush.ts`: store codes in `lastError`; pass `data.status` to `markUploaded`. `queue.ts`: optional `serverStatus`, no version bump. Leave the `res.status === 403 && data.error === "challenge_failed"` line and its position alone (a test pins both).
8. `QueueBanner.tsx`: translate `lastError`; distinct receipt rows (held ones are plain text until PR4 lands); plural.
9. `LocationPicker.tsx`: lazy marker, overlay in an outer wrapper; `ReportForm.tsx:415,458`: `locationError`, conditional helper; rewrite the comment at `:538-541`.
10. `lib/receipt.ts` (`import "server-only"`): `select status, reporter_id from reports where id = $1 and source = 'user'`, returning an enum. `reports/[id]/page.tsx`: receipt branch before `notFound()`; `generateMetadata` sets noindex when not public.
11. Injured note plus key; extend `test/report-form.test.mjs`.

**Acceptance criteria**
- For each outcome (fake `/api/reports` with Playwright `page.route`) the card matches the table in zh-TW and `/en`; no link 404s; `/en` links keep `/en`. Neither catalogue contains 一兩分鐘 or "minute or two".
- Each forced code shows its sentence in the right slot; no snake_case, literal key or English appears under zh-TW. A retry after a 4xx carries a fresh token (check on a deployment with Turnstile keys).
- `/report` before any tap: no marker, overlay visible, blocker and button boxes do not intersect at 390 and 1440.
- Receipt page for a pending user report: 200, `noindex`, HTML free of the row's notes, of either coordinate to two decimals, and of a map container. A random UUID and an unpublished `gbif` row: 404.
- New `test/report-errors.test.mjs`: every `error: "<code>"` in both route files resolves to a key in both catalogues; `ReportForm.tsx` never feeds `.message` to `setError`; `QueueBanner.tsx` has no `{i.lastError}`. New `test/receipt.test.mjs`: the line above, and `lib/receipt.ts` contains none of `location`, `notes`, `contact_email`, `st_x`, `select *`. Existing tests and `e2e/offline.spec.mjs` pass unchanged except `report-form.test.mjs` (extended).
- axe-clean on `/report` and the receipt page; new text at least 4.5:1 (`e2e/_contrast.mjs`); new targets at least 24px and keyboard-reachable. No new client dependency; `/map` untouched.
- Screenshots at 390×844 and 1440×900, zh-TW and `/en`: unset form, injured chosen, each card, a photo error, two receipts, receipt page.

**How to verify**
`cd apps/web && npm run typecheck && npm run lint`. With `npm run dev` up: `npm test` (needs :3000 and `DATABASE_URL` in the root `.env`; mass timeouts are local contention, so re-run first). With `npm run build && npm run start`: `npm run test:offline` (the service worker is off in dev) and `npm run test:pages`. If unrelated pages 500 with JSON.parse errors after a catalogue edit: stop the server, `rm -rf .next`, restart; never delete `.next` while it runs. For a pending row locally, POST `/api/reports` without photos (local Turnstile keys are empty), then open `/reports/<id>` and `/en/reports/<id>`. Playwright sends no Accept-Language, so unprefixed paths render zh-TW; test `/en/...` explicitly. Screenshot the picker with headless Playwright; the in-app pane stalls MapLibre.

**Risks and traps**
- Step 10 is the only new read of `reports` on a public route: keep it in `lib/receipt.ts` and return an enum, never a row. Never tell strangers why a record is not public; "withheld as sensitive" on a once-public id confirms a protected species at a known place.
- Deliberate, leave alone: "`relative` is load-bearing, not cosmetic" (`LocationPicker.tsx:119`), so the overlay goes in an outer wrapper, not among MapLibre's children; "sr-only, not hidden" (`ReportForm.tsx:376`); "Offer the photo's own GPS rather than applying it" (`:104`); no token in the queued payload (`offline-challenge.test.mjs` slices `ReportForm.tsx`, which must stay the container file).
- Every page inlines the whole catalogue, so tests must match rendered elements, never bare strings.
- Shared files: `messages/*.json` (W0b-d edit them too): add nested blocks, never reformat, rebase before each PR. W0d also edits `ReportForm.tsx`.
- `me/page.tsx` stays untouched if PR4 ships; if not, make its non-published rows plain blocks.

**Suggested PR breakdown and effort**
PR1 steps 1-4 (0.5 d). PR2 steps 5-8 (1.5 d). PR3 step 9 (0.5 d). PR4 step 10 (1 d; needs decision 2). PR5 step 11 (0.25 d; the referral follows the owner's answer). About 4 person-days, or 12-14 agent-hours, plus the native read.
