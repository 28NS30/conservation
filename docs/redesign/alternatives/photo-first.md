# Report flow C: photo first

One route, one client component, no wizard chrome (so the nonce, the offline cache and the queue behave as today). The page asks four things in the order a person at a roadside meets them: **photo, place, what, condition**. Each section appears when the one before is answered and stays on screen, editable; focus moves to the new heading (no smooth scroll under reduced motion). "通報類型" is never asked. Controls are full-width 56-64px rows with 12px corners and 17px labels; pills are gone. Body text is 15px minimum, helpers 13px.

## How the stored category is produced

`deriveCategory(condition, { taxonIsInvasive, saysIntroduced })`, a pure function added to `packages/shared`, run client-side at submit and at enqueue. The API still receives `category`.

| Condition | Species | Stored |
|---|---|---|
| dead | any / unknown | `roadkill` |
| alive, hurt | any / unknown | `injured` |
| alive, well | named, `isInvasive === true` | `invasive` |
| alive, well | named, not invasive (or `null`) | `sighting` |
| alive, well | unknown, "I think it's introduced" ticked | `invasive` |
| alive, well | unknown | `sighting` |

**Precedence: condition beats invasiveness.** A dead green iguana is `roadkill`. The taxon keeps `is_invasive` for ever, so "invasive records" can always be rebuilt by joining `taxa`; "it was dead" lives nowhere except `category`. The owner should confirm this rule. When the derived value is `invasive` the form says so in one line, so the reporter sees what was filed.

**Unknown species:** filed `sighting` unless the reporter ticks the one optional line shown only in the alive + unsure branch. Without it nobody could file an unnamed invasive, which would break "trust the reporter".

**Deep links:** `?category=injured` preselects hurt; `sighting` and `invasive` preselect alive-and-well (`invasive` also opens the search on the invasive register with the existing widen link); `roadkill` preselects nothing, because that door covers two answers. The header's "+ 通報" preselects nothing: no silent default. New `?taxonId=` prefills the species.

## Screens, 390px phone

**S0. First load.** Site header, queue banner if anything is waiting, then:

| | zh-TW | en |
|---|---|---|
| H1 | 先拍一張 | Start with a photo |
| Primary, 160px block with camera glyph (`capture="environment"`) | 拍照 | Take a photo |
| Secondary, 56px (no `capture`, `multiple`) | 從相簿選 | Choose from library |
| Text button, 44px | 沒有照片，直接填 | No photo, continue |
| One line, 13px | 照片、地點、物種、狀況。大約一分鐘，不用註冊。 | Photo, place, species, condition. About a minute, no account. |
| Privacy, 13px | 上傳前會縮小照片，並移除照片裡的隱藏資訊。 | Photos are shrunk and stripped of hidden data before upload. |

Nothing else is above the fold. Both inputs stay `sr-only` with focus-within rings. Tapping either button starts loading the map module while the person is in the camera.

**S1. Photo added.** The first photo becomes a full-width 4:3 hero; others are 72px thumbnails beside a "再加一張 / Add another" tile; each has a 44px "移除 / Remove". While encoding: "照片處理中… / Preparing photo…". EXIF `DateTimeOriginal` (new, read in `lib/image.ts` with the existing `exifr`) sets the time if it is between 1990 and now; it is shown, never hidden (S5). With no photo this area is a slim row "沒有照片 / No photo" plus "加照片 / Add one".

**S2. Place (required).** H2 **在哪裡看到的？ / Where was it?** Status line with a hollow pin: **還沒設定地點 / No place set yet**. The map shows the whole island with **no marker** and an overlay "或在地圖上點出位置 / Or tap the map to mark it".
- If a photo carried GPS: "照片裡有拍攝地點 / This photo recorded where it was taken", the map eases there and draws a dashed ring (offered, not set). Buttons: **用照片的地點 / Use the photo's place**, "不是這裡 / Not here". Phone browsers usually strip GPS from fresh camera captures, so expect this mainly for library and desktop picks.
- Primary: **用我現在的位置 / Use where I am now**; busy: "定位中… / Finding you…".
- Once set, a solid pin drops and the status reads "地點已設定 · 誤差約 {m} 公尺 / Place set · accurate to about {m} m", or "（來自照片）/ (from the photo)", or "（手動標記）/ (marked by hand)". Only then: "點地圖可以微調 / Tap the map to fine-tune". Coordinates in `text-ink-600`.
- Refused or timed out, shown beside the button: "拿不到你的位置，請直接在地圖上點出來。/ Couldn't get your position. Tap the map to mark it instead."
- Outside bounds: "這個地點不在臺灣範圍內，送出後會先由人工確認。/ That spot is outside Taiwan, so a person checks the report before it appears."
- Map cannot load: "沒有網路，地圖載不出來。仍然可以用「我現在的位置」。/ No signal, so the map can't load. 'Use where I am now' still works."

**S3. What (required: a name, or "not sure").** H2 **牠是什麼？ / What was it?** A 56px search field, "輸入名稱，例如：石虎 / Type a name, e.g. leopard cat", and under it a full-width button **我不確定 / I'm not sure** (`aria-pressed`, not a 16px checkbox). Results stay a plain list of 52px buttons; "入侵種 / Invasive" is a square text tag. Chosen: name, italic binomial, "更改 / Change". Unsure with a photo: "會記成「未鑑定」，等物種確認後才公開。/ Filed as unidentified; it goes public once the species is confirmed." Search unreachable: "沒有網路，查不了名稱。先選「我不確定」，名稱可以寫在備註。/ No signal, so names can't be searched. Choose 'I'm not sure' and put the name in the notes." (That report is held with the 10km override: safe.)

**S4. Condition (required, nothing preselected).** H2 **牠當時的狀況？ / How was it?** A real radio group drawn as three rows: **已死亡 / Dead**, **活著，但受傷了 / Alive, but hurt**, **活著，看起來沒事 / Alive and well**.
- Hurt shows a `role="note"` directly beneath: "這裡只做紀錄，不會有人因此到現場。/ This only records what you saw. Nobody is sent out." followed by a referral sentence from key `report.injuredReferral`, which renders nothing while empty. **The owner must confirm the agency and wording; no number is invented here.**
- Alive + invasive taxon: "牠是外來入侵種，這筆會歸在「外來入侵種」。/ This is an invasive species, so the report is filed under invasive species."
- Alive + unsure: optional checkbox row "我覺得牠是外來種 / I think it's an introduced species".

**S5. Send.** A time row, "時間　今天 07:32（照片的拍攝時間）/ Time: today 07:32 (from the photo)" or "（現在）/ (now)", with "更改 / Change" revealing the datetime input. A disclosure "加備註或聯絡信箱（選填）/ Add a note or contact email (optional)". With no photo: "沒有照片的通報，會先由人工確認才公開。/ Without a photo, a person checks the report before it appears." Turnstile (`theme="light"`, mounted once a place is set), then the blocker sentence with normal spacing ("請先完成上面的驗證 / Finish the check above first"), then **送出通報 / Send report** (56px). The existing privacy note closes the page.

## States

- **Submitting:** button reads "送出中… / Sending…"; sections go inert.
- **Published** (`status === "published"`, which the form discards today): full-height receipt. H1 **已經在地圖上了 / It's on the map**; a line echoing exactly what was filed (species · condition · time); **看這筆紀錄 / View the record**, **再通報一筆 / Report another** (remount, fresh nonce), "回地圖 / Back to the map".
- **Held** (`status === "pending"`): H1 **收到了，還沒公開 / Received, not public yet**. Reason from the response: awaiting identification, "你沒有指定物種，這筆會等物種確認後才出現在地圖上，目前沒有固定時程。/ You didn't name the species, so this appears once the species is confirmed. There is no fixed timetable."; otherwise "這筆通報會先由人工確認才公開。/ A person checks this report before it appears." **No view link** (it 404s). Signed-in reporters get a pointer to "我的通報"; anonymous reporters get an on-device receipt row. No AI, no minutes.
- **Injured**, either outcome: the no-dispatch note and referral slot repeat at the top of the receipt.
- **Offline or Turnstile unreachable:** the button becomes **先存在這支手機 / Save on this phone** and enqueues directly. This fixes a live defect: with Turnstile on, an offline phone never gets a token, so the button stays disabled and the queue is unreachable. The queue already mints its own token at flush.
- **Queued:** H1 **存在這支手機了，還沒送出 / Saved on this phone, not sent yet**; body reuses `offline.explain` (the iPhone caveat stays); "再通報一筆".
- **Errors** sit beside their cause, from a code-to-sentence map, never raw: unreadable photo; more than 4 photos; `challenge_failed` ("驗證過期了，請再試一次。"); `rate_limited`; upload or signing failure (offer "remove photos and send"); `validation_failed` beside the time or email field; `taxon_not_found`; 5xx ("伺服器出了問題，通報還沒送出，內容都還在。" plus "Save on this phone"); IndexedDB refused ("存不進這支手機。請留在這一頁，有訊號後再送一次。"). Also fixes `t("queueFailed")` being read from the wrong namespace.

## Desktop

Two columns at `lg`, `max-w-5xl`: left, a sticky hero that is a drop zone ("把照片拖到這裡，或選擇檔案 / Drop photos here, or choose files"; "拍照" is hidden under `(pointer: fine)`, CSS only); right, the same four sections, all visible from the start with unanswered ones dimmed, and a 360px map. Receipts use the full width.

## Code

- **Keep untouched:** `api/reports`, `api/uploads/sign`, `reportSubmissionSchema`, `REPORT_GROUPS` and the map filter, `flush.ts`, the Turnstile internals, the server-side privacy logic.
- **Rebuild:** `ReportForm.tsx` UI (keep the nonce, the submit pipeline and the enqueue fallback; add `status`, the error map and the offline path). `LocationPicker.tsx`: no marker until set, offered ring, source-aware status, lazy-loaded, zero-duration ease under reduced motion.
- **Restyle:** `SpeciesPicker.tsx` (unsure as a button, offline message, initial value), `QueueBanner.tsx` (labelled receipts, public or held).
- **Extend:** `lib/image.ts` (EXIF time); `queue.ts` optional `label` and `serverStatus` on receipts (no DB version bump); `report/page.tsx` (`?taxonId=`, drop the H1 and lede); about 45 new keys in each catalogue and about 12 retired.
- **Tests:** rewrite `test/report-form.test.mjs` (it pins the pills and the `<h3>`); update selectors in `e2e/offline.spec.mjs`; add `deriveCategory` and error-map unit tests; keep `offline-challenge.test.mjs` passing (no token in the enqueue payload).
- **Later, optional:** species confirmation re-derives `sighting` to `invasive`; a dependency-free site-wide "N waiting" bar.

## Cost

About 9-10 engineer-days: form 3, picker 1, receipts and queue 1, errors and copy 1, species and EXIF 0.75, tests 1.5, device QA 1 (iOS Safari and Android Chrome: camera capture, library GPS, HEIC, geolocation refusal). Plus a native zh-TW reader and the owner's referral wording. No new dependency; `/report` gets lighter at first paint because MapLibre loads after the first tap.
