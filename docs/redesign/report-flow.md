# Report flow: recommendation

Planning only. Code read at c73bb8d; paths relative to `apps/web`.

## Decision

**Build the one-question stepper, with photo-first's data plumbing and single-sheet's never-dead button. Prototype photo-first beside it.**

Two of three judges (roadside reporter, owner's advocate) put one-question first, both at 8/10. It alone stays big and few-worded after the first tap, and it alone removes the two-row header and the viewport-tall footer that make today's page read as a government form. The engineer ranked it last for reasons fixed below: a 24 h persisted nonce on an editable draft, `QueueBanner` unmounting after step 1, and an under-budgeted estimate. Photo-first is the runner-up (engineer's first, advocate's second). The two share screen 1, the controls, the frame and the derivation, so a second proof costs about half a day and shows the owner the one real difference: screens that swap versus sections that pile up.

The rejected phrase 你看到了什麼？ and the category-first pattern are removed everywhere. The homepage gets **one** action, 通報動物 / Report an animal, linking to `/report`, beside 看地圖 / Open the map. `DOORS` in `app/[locale]/page.tsx:70-74,221-258` is deleted, and `e2e/pages.spec.mjs:103-152` is rewritten to assert one `/report` action above the fold from 360px up and no `?category=` links.

## Grafts onto one-question

- **From photo-first:** `deriveCategory` in `packages/shared`; the reporter's photo as a header and on the receipt; photo-metadata time; `loadMapLibre()` on the camera tap; `label` and `serverStatus` on queue receipts; "remove photos and send"; the H1 先拍一張.
- **From single-sheet:** a pinned button that is `aria-disabled`, never dead, with a caption naming what is missing; a named species outranks the entry link; Turnstile reset through `onReady.reset`; 同地點再一筆.
- **Cut:** the "2／5" numeral, the rescue link on screen 1, the ruled review table with small 修改 links, the "Continue?" dialog, and any advice to write a species name in `notes` (a public column in `reports_public`).

## Frame

`/report` moves to a new route group `app/[locale]/(flow)/` with its own layout; the URL does not change.

- 56px bar: badge and 通報 / Report (links home), language switch, ✕ 離開 / Leave.
- Five progress segments, no numeral. ← 上一步 / Back, 44px.
- Step in the hash (`#place`): browser Back is step Back, and the service worker still serves `/report` offline (`public/sw.js:55`, `ignoreSearch: false`). A later hash with an earlier answer missing lands on the first gap.
- One `BigButton` (56px) pinned to the bottom safe area, with a one-line caption above it.
- `QueueBanner` stays mounted in the shell for the whole visit (one 48px row, only when the queue is not empty), because it owns the queue's Turnstile widget and flush triggers.
- The form's Turnstile (`theme="light"`) mounts in the shell on arrival, so it has the whole visit to solve; its slot is visible only on the Send screen. Device QA must confirm a clipped widget still solves; if not, show it on the Place step.
- H1 32px; rows at least 64px with 18px labels; nothing under 16px except the 14px privacy sentence; no letter-spacing on Chinese. Steps swap instantly and focus moves to the H1.

## Screens, 390px phone

**1. Photo (optional).** H1 **先拍一張 / Start with a photo**. A 200px tile **拍照 / Take a photo** (`capture="environment"`); a row **從相簿選 / Choose from library** (no `capture`, `multiple`); a text button **沒有照片，直接繼續 / Continue without a photo**. One help line: 拍完就到下一步。/ You go on once it's taken. Nothing else. Tapping either photo control calls `loadMapLibre()`. When the first photo is ready the flow goes straight to step 2: no Next tap, no timer. Coming back shows a 4:3 hero, thumbnails with 44px 移除 / Remove, and 再加一張（最多 4 張）/ Add another (up to 4).

**Steps 2 to 4** carry a 72px thumbnail row with 加照片 / Add photo, so the person sees their photo was kept.

**2. Place (required, nothing defaulted).** H1 **在哪裡？ / Where was it?** Order on screen: **用我現在的位置 / Use where I am now**; when a photo carried GPS, **用照片的地點 / Use the photo's place** (offered, never applied); then the map, which fills the remaining height (at least 200px), shows the whole island with **no marker** and the overlay 點地圖標出位置 / Tap the map to mark the spot. A device fix of 50 m or better advances on its own; a coarser fix, a photo place or a map pick waits for 下一步 / Next. Caption while unset: 先設定地點才能繼續 / Set a place to continue.

**3. Condition (required, no default, a tap advances).** H1 **牠的狀況？ / How was it?** Rows: **已死亡 / Dead**, **活著，但受傷 / Alive, but hurt**, **活著，沒事 / Alive and well**. Buttons with `aria-pressed`, so arrow keys cannot advance.

**3b. Only after "hurt".** H1 **我們不會派人過去 / Nobody will be sent**. Body from `report.injuredReferral`, supplied by the owner. Button 知道了，繼續 / Understood, continue. Repeated on the receipt.

**4. Species (a tap advances).** H1 **是什麼動物？ / What animal?** A 56px search field, 輸入名稱，例如：石虎 / Type a name, e.g. leopard cat; hits stay a Tab-reachable list of 56px buttons. Rows: **不確定 / Not sure**; only when alive and well, **不確定，但應該是外來種 / Not sure, but I think it's introduced**. Offline, or when a search has not answered in 4 s: 現在查不了名稱。/ Names can't be searched right now. and the row **先略過 / Skip for now**.

**5. Send.** H1 **確認後送出 / Check and send**. The photo large, then four quiet 56px rows (place, condition, species, time); the whole row is the Change target. Time reads 今天 07:32（照片時間）/ (from the photo) or （現在）/ (now). A closed disclosure 補充說明或信箱（選填）/ Add a note or email (optional), then the privacy sentence. Only this screen may scroll; the button stays pinned.

The caption above the button only warns: no photo, 沒有照片的通報，會先由人看過才公開。; a photo without a name, 沒有物種名稱，要等確認物種後才會公開。; otherwise nothing. It never promises publication. Button: 正在驗證瀏覽器… / Checking your browser…, **送出通報 / Send report**, 上傳照片… / Uploading photos…, 送出中… / Sending…

## Desktop (1024px and up)

Same frame, two panes in `max-w-5xl`. Left, 420px: the same stepper; Enter is Next; the button sits at the foot of the pane. Right, sticky: the record taking shape. On step 1 it is a drop zone (把照片拖到這裡，或選擇檔案 / Drop photos here, or choose files; 拍照 hidden under `(pointer: fine)`). From step 2 it holds a 520px map that is the picker, then the photo and summary rows.

## How `category` is produced

`deriveCategory(condition, { taxonIsInvasive, saysIntroduced })`, a pure function in `packages/shared`, called by one `buildPayload()` that feeds both the direct POST and `enqueueCurrent()`. `saysIntroduced` is true for the "introduced" row and for arrivals by `?category=invasive`.

| Condition | Species answer | `is_invasive` | Stored `category` |
|---|---|---|---|
| dead | any | any | `roadkill` |
| hurt | any | any | `injured` |
| alive and well | named | true | `invasive` |
| alive and well | named | false | `sighting`, even via the invasive link |
| alive and well | named | null | `invasive` if `saysIntroduced`, else `sighting` |
| alive and well | not sure, thinks introduced | n/a | `invasive` |
| alive and well | not sure, or skipped | n/a | `sighting` |

`taxon_source`: named is `user`, not sure is `unknown`, skipped is null.

Status is independent of category, because all four categories are `classifiable` (`packages/shared/src/index.ts:15-18`). Every row above combines with every row below (28 cases):

| Photo | Species | `status` | Precision | Receipt |
|---|---|---|---|---|
| yes | named | `published` | the taxon's own blur | **已經在地圖上了 / It's on the map**, with 看這筆紀錄 |
| yes | not sure or skipped | `pending`, awaiting identification | 10 km | **收到了，還沒公開 / Received. Not public yet.** 沒有物種名稱，要先確認是什麼動物才會公開。這是人工處理，時間不一定。 No link. |
| no | named | `pending`, flagged | the taxon's own blur | same heading; 沒有照片的通報，會先由人看過才公開。 No link. |
| no | not sure or skipped | `pending`, flagged | **10 km (new; null today)** | same as the row above |

A place outside Taiwan, or a link in the notes, makes any row `pending`, with 這筆通報會先由人看過才公開。 The receipt reads the returned `status`, never a guess, and treats `duplicate: true` as the status it carries. Every receipt offers 再通報一筆 / Report another, 同地點再一筆 / Another at this place (a keyed remount seeded with place and time, so a new nonce and token) and 回地圖 / Back to the map. Signed-in reporters are pointed to 我的通報; anonymous ones get an on-device receipt row. No AI, no minutes.

**Links in:** `?taxonId=` prefills step 4. `?category=` is still accepted: `invasive` scopes the search to the register and sets `saysIntroduced`; the other three pre-answer nothing, because a silent default on condition misfiles injured animals. The client then calls `replaceState` to `/report`, so a reload hits the offline cache.

## States

- **Photo:** empty; processing; added; unreadable (這張照片讀不了，換一張或重拍。); fifth photo refused.
- **Place:** unset; locating; refused or timed out at 15 s (拿不到你的位置，請在地圖上點選。); coarse fix (stays, shows 誤差約 {m} 公尺); set; outside Taiwan (warns only); map unavailable (地圖載不出來；用「我現在的位置」就可以。).
- **Species:** idle; searching; slow; no hits; offline; picked; prefilled.
- **Send:** checking; check needs a tap (還差：人機驗證); ready; ready with hold warning; uploading; sending.
- **Waiting too long:** no token after 8 s adds a secondary button 等不到驗證？先存在手機裡; the primary keeps waiting, so nobody mid-challenge is misrouted. A submit running past 12 s adds 訊號不好？先存在手機裡, which aborts and enqueues under the same nonce. With `navigator.onLine` false the primary itself becomes **先存在手機裡 / Save on this phone**.
- **Results:** published; held (three reasons, above); queued (**存在手機裡了，還沒送出 / Saved on this phone. Not sent yet**, reusing `offline.explain`).
- **Errors, mapped from codes, never raw:** `rate_limited`; `challenge_failed`; `photo_*` and signing failures (step 1, offering 拿掉照片再送 / Remove photos and send); `taxon_not_found` (step 4); `validation_failed`; 5xx (伺服器出了問題，通報沒有送出。內容還在。 plus retry and save); IndexedDB refused (存不進這支手機。請留在這一頁，有訊號後再送。).
- **Draft:** restored silently, with 重新開始 / Start over on step 1; or locked (see below).

## Offline queue and Turnstile

- One `enqueueCurrent()` serves the network-failure fallback, both time-boxed saves and the offline button. No token enters the payload, so `test/offline-challenge.test.mjs` keeps its meaning; `ReportForm.tsx` stays the container file that test slices.
- This closes a live defect: `ReportForm.tsx:550-555` disables submit without a token, and Turnstile cannot solve offline, so in production a page opened offline can never reach the queue.
- The widget resets after **any** non-2xx from `/api/reports`, because `verifyTurnstile` has spent the token by then.
- `markUploaded(id, reportId, serverStatus)` also stores a `label`, with no IndexedDB version bump. `QueueBanner` then links only published receipts and describes held ones; today they link to 404s. Receipts for direct submissions use their own `addReceipt()` writer, never `enqueue`.
- **Draft**, in a separate database `conservation-draft`: answers, photo blobs and the nonce, not the email. It expires after 30 minutes, not 24 hours, and is cleared on send, save or Start over. It covers Android discarding the tab while the camera is open, reloads and the language switch. Once a submit has started the draft is **send-only**: a resume opens the Send screen with Change disabled. That removes the engineer's failure case, where an edited resend returns `duplicate: true` with the old payload under a success message.
- The "Use where I am now" row ships in the static bundle; only the map is lazy. `loadMapLibre()` also runs when the browser is idle and online, so the same-origin module reaches the runtime cache. OpenFreeMap tiles are never prefetched (`sw.js:84-88`), and `/map`'s load path is untouched.

## API and schema

No migration; `reportSubmissionSchema` is unchanged. Two small server edits:

1. `route.ts:109`: every report without a `taxon_id` gets `UNIDENTIFIED_PRECISION`, photo or not. Today a no-photo, unnamed report that a moderator publishes appears at exact coordinates.
2. `confirmSpecies` (`reports/[id]/actions.ts`) and `setReportTaxon` (`admin/actions.ts`): when the confirmed taxon `is_invasive` and the category is `sighting`, re-derive to `invasive`; otherwise the map's invasive switch undercounts for good. The tile SQL is left alone.

## Components

- **Keep:** `api/uploads/sign`, `flush.ts` (one argument added), `Turnstile.tsx`, `ReportMap`, `SpeciesConfirm`, `REPORT_GROUPS` and `report.group.*` (the map filters read them).
- **Rebuild:** the JSX of `ReportForm.tsx`; `LocationPicker.tsx` (no marker until a value exists, overlay, ink token for coordinates, no ease under reduced motion).
- **Restyle or extend:** `SpeciesPicker` (rows, slow and offline states, `initialTaxon`), `QueueBanner`, `queue.ts`, `lib/image.ts` (EXIF `DateTimeOriginal` as device-local time, clamped to 1990 to now).
- **New:** `(flow)/layout.tsx`; `components/report/flow/*` (FlowShell, StepPhoto, StepPlace, StepCondition, InjuredNotice, StepSpecies, StepSend, Receipt); `components/ui/ChoiceRow` and `BigButton` (the site's replacement for pills); `lib/report/flow.ts`; `lib/report/errors.ts`; `lib/offline/draft.ts`.
- **Delete:** the type and condition pills, `PageHeader` on this page, the keys `subheading`, `type`, `noPhotoWarning`, `identifying`, `speciesUnsureHint` and `exif*`, the homepage `DOORS`, and the wrong-namespace `t("queueFailed")`.
- **Tests:** rewrite `test/report-form.test.mjs` and the homepage door assertions; add `deriveCategory` and error-map unit tests and a 390px Playwright walk in both locales, including offline.

## Is it better? No analytics needed

Run one script on production and on each proof: five people including the owner, own phone, outdoors at midday, one hand. Record taps (OS taps included), scrolls, seconds, wrong turns, and the answer to "Is your record public right now?"

| Task | Today | Target |
|---|---|---|
| Dead snake, photo, can't name it | 8 taps, 2 scrolls; told "a minute or two"; link 404s | 8 taps, 0 scrolls; told it is held, no link |
| The same without a photo | told "published" (false) | 6 taps; told a person checks it |
| Injured animal | never told that nobody comes | told before sending |
| Airplane mode from page load | dead button | "Saved on this phone" |
| DevTools "Slow 3G" | can hang on 送出中… indefinitely | sent or saved within 60 s |

Automated: steps 1 to 4 at 390×664 never scroll, in both locales; `_contrast.mjs` runs over every step; the e2e walk's click count is the tap budget.

## Proofs and cost

Two clickable proofs, static, 2 days together: the stepper (screens 1 to 3 and a receipt) and photo-first (the same screen 1, then sections revealed on one page in the same frame). If the owner prefers photo-first, it must still ask condition before species, make species skippable and gain the pinned button. The build after the choice: 12 to 14 days, including the draft (1), device QA on iOS Safari and Android Chrome (1) and tests (2).

## Decisions for the owner

1. One 通報動物 action on the homepage in place of the three doors.
2. A dead invasive files as `roadkill` (condition wins), and a confirmed species re-derives `sighting` to `invasive`.
3. The injured-wildlife referral: agency, number, wording in both languages. Blocks shipping.
4. A good GPS fix advances on its own, or the pin is always shown first.
5. A 30-minute on-device draft that restores silently.
6. Whether the classifier will run; until then held receipts say "by hand, no timetable".
7. Anonymous held reports get an on-device receipt only, no emailed link.
8. Library photos allowed.
9. 牠的狀況？ in place of the existing 牠還活著嗎？
10. A native zh-TW reader for all new copy.
