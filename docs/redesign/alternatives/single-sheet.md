# Report flow C: the single calm sheet

One page, one column, no wizard, no pills. The page is a numbered spine: **1 Photo, 2 Where, 3 Condition, 4 Species, 5 Time, More**. One section is open at a time (the first thing still needed). Finished sections fold to a one-line summary with a text button 改 / Change. Later sections stay visible as quiet headings and can be opened in any order, so nobody is trapped. A bar fixed to the bottom says exactly what is missing and carries the page's only button. The opening question is gone: the first thing on screen is the camera.

Type scale: H1 32px, section headings 22px semibold with a tabular numeral, body 16px, helpers 14px (nothing under 14). Controls are 52px rows and full-width buttons, ruled with hairlines like a field notebook, not rounded-full. Choices are native radios drawn as list rows; actions are buttons; nothing else looks like either.

## Phone, 390px, section by section

H1 **通報動物 / Report an animal**. No lede (it listed the categories a third time). QueueBanner above the H1 only when it has something to say.

**1 · 先拍一張 / Start with a photo** (optional, asked first). A 4:3 ruled panel with two real buttons: **拍照 / Take photo** (`capture="environment"`) and **從相簿選 / Choose from library** (no `capture`; fixes the "cannot pick an existing photo" problem). Helper: 有照片，別人才能幫忙確認物種。/ A photo lets others confirm the species. Text button beneath: **沒有照片 / No photo**, which folds the section to "沒有照片" and moves on.
After adding: 96px thumbnails, each with a 44px 移除 / Remove target; **再加一張（最多 4 張）/ Add another (up to 4)**; helper 上傳前會移除照片裡的拍攝資訊。/ Camera data is removed before upload. While preparing: 處理照片中… / Preparing photo…

**2 · 在哪裡？/ Where?** (required; summary reads **尚未設定 / Not set** until it is). Buttons, stacked: **用我現在的位置 / Use my current location** (primary), **在地圖上點 / Pick on the map**. If a photo carried GPS, a third button appears first and becomes primary: **用照片的拍攝地點 / Use the photo's location**; it is never applied silently, and choosing another way dismisses it.
The map mounts only when this section opens (phone) and shows the whole island with **no pin** and the caption 點一下發現的地方 / Tap where you saw it. Once set: z14, pin, caption 點地圖可以移動圖釘 / Tap the map to move the pin, and for device fixes 誤差約 {m} 公尺. Folded summary: 已設定 · 誤差約 12 公尺 / Set · within about 12 m. Locating: the button reads 定位中… / Locating…; the other buttons stay usable. Outside Taiwan: inline, not blocking: 這個位置不在台灣範圍內，送出後會先由人員確認。/ This is outside Taiwan; a person will check it before it is public.

**3 · 牠怎麼了？/ How was it?** (required, **no default**). Three radio rows: **已死亡 / Dead** · **活著，但受傷 / Alive, but hurt** · **活著，沒事 / Alive and well**. Choosing "hurt" reveals at once, and repeats on the receipt: 這裡只做紀錄，不會有人到場救援。需要救援請聯絡〔單位待確認〕。/ This only records what you saw. Nobody is sent out. For rescue, contact [channel to be confirmed]. **Ship-blocker: the owner must supply the channel; nothing is invented.**

**4 · 是什麼動物？/ What animal?** (選填 / optional, but open when reached because it decides publish vs held). Search field (52px) and, as an equal row below it, a checkbox row **我不確定 / I'm not sure** with 不確定比亂猜好。/ Not sure beats a guess. ("模型" removed.) Suggestions stay a Tab-reachable button list. Offline, instead of failing silently: 沒有網路，查不了名稱。可以先選「我不確定」。/ No connection, so names can't be searched. Choose "I'm not sure" for now. `?taxonId=` arrives with this section already folded.

**5 · 時間 / When**: a folded row from the start that states its default: 現在 · 18:49 · 改 / Now · 18:49 · Change. Opens a `datetime-local`.

**補充（選填）/ More (optional)**: a native `<details>`, closed: 備註 / Notes, 聯絡信箱 / Email (僅用於聯繫，不會公開。/ Only to follow up. Never public.). Then the Turnstile widget, `theme="light"`, in a box with reserved height, and the one-line privacy note.

**The bar** (fixed, safe-area padded, paper with a top hairline; `scroll-padding-bottom` so focus is never obscured; hidden while the on-screen keyboard is up):

| Situation | Text | Button |
|---|---|---|
| things missing | 還差：地點、狀況 / Still needed: location, condition | 送出通報 / Send report, outline, `aria-disabled`; tapping scrolls to and focuses the first missing section |
| Turnstile solving | 正在檢查瀏覽器… / Checking your browser… | same |
| Turnstile needs a tap | 還差：人機驗證 / Still needed: the check above | same |
| ready, photo + named species | 送出後會直接公開 / Goes public as soon as you send | filled ember |
| ready, otherwise | 送出後先由人員確認，再公開 / A person checks it before it is public | filled ember |
| submitting | 上傳照片 1/2… then 送出中… / Uploading photo 1 of 2… Sending… | `aria-busy`, sheet inert |
| offline, or Turnstile never loaded | 沒有網路 / You're offline | **先存在手機 / Save on this phone** |

The "ready" line mirrors the server's rule (photo, named species, inside Taiwan) and is only a forecast; the receipt, driven by the returned `status`, is the authority.

The last row fixes a defect found while reading: `ReportForm.tsx:550-555` disables submit without a token, and offline the widget can never solve, so with production keys the queue is unreachable from a page opened offline. "Save on this phone" calls `enqueue` directly; the queue already mints its own token at flush.

## How `category` is produced

The reporter answers condition only; the client derives the stored value and sends the same field. New pure function in `packages/shared` beside `REPORT_GROUPS`: `deriveCategory(condition, invasive)`: dead → `roadkill`; hurt → `injured`; alive → `invasive` if `invasive` else `sighting`, where `invasive = species?.isInvasive ?? arrivedByInvasiveDoor`. Condition wins for a dead invasive (the taxon still carries `is_invasive`); owner to confirm. `?category=` keeps working, so the homepage doors and `pages.spec.mjs` survive: roadkill/injured/sighting pre-check the matching radio, `invasive` pre-checks "alive" and scopes the species search to the register (SpeciesPicker's existing `group` prop, fed by `groupOf(category)`). Bare `/report` checks nothing.

## Desktop (≥1024px)

Two columns inside 1120px. Left, 520px: the same spine. Right: the location map, sticky, full column height, mounted at load as today; clicking it sets the place, and "use my location" becomes a text button over it. The photo panel accepts drag-and-drop and paste. The bar becomes sticky at the foot of the left column. Ctrl/Cmd+Enter sends. For people filing several records, the receipt offers **同地點再一筆 / Another at this place**, which keeps place and time and returns focus to Photo.

## Outcomes (full-sheet receipts, 28px heading, a summary of what was filed)

Driven by the response's `status`, never by guesswork:
- **published**: 已公開在地圖上 / It's on the map. 謝謝你，這筆紀錄現在大家都看得到。 Link 看這筆紀錄 / View this record.
- **pending, awaiting identification**: 已收到，還沒公開 / Received, not public yet. 還沒有物種名稱，所以會先由人員確認物種，再放上地圖。要多久，我們沒辦法保證。/ With no species named, a person will identify it before it goes on the map. We can't promise how long. No link. Signed in: 可以在「我的通報」看到狀態。
- **pending, no photo**: same heading; 沒有照片的紀錄會先由人員看過，再放上地圖。/ Records without a photo are looked at by a person first.
- **pending, other flag**: same heading; 這筆紀錄會先由人員看過，再放上地圖。
- **queued**: 存在這支手機裡，還沒送出 / Saved on this phone, not sent yet. 回到有訊號的地方，再打開這個網站就會送出。iPhone 不會在背景送，請記得回來開一下。
- Every receipt: **再通報一筆 / Report another** (remounts the form with a new `key`, so a new nonce) and 看地圖 / See the map. Injured receipts repeat the nobody-is-sent statement first.

**Errors** are mapped by code to sentences, shown in the bar (`role="alert"`) and at the section concerned; the form and its contents always stay: geolocation refused (拿不到定位，請在地圖上點一下。), photo unreadable (這張照片讀不了，換一張試試。), `rate_limited` (送得太頻繁了，過幾分鐘再試。), `challenge_failed` (驗證過期了，請再送一次。, widget reset), photo_* and signing failures (有照片傳不上去，請移除後重新加入。), `taxon_not_found`, `validation_failed` on time (時間看起來不對。), 5xx/unknown (送不出去，問題在我們這邊。內容都還在。 plus 先存在手機), queue write failed (存不進這支手機，請先不要關掉這一頁。).

## Code

- **Keep untouched:** `api/reports`, `api/uploads/sign`, `reportSubmissionSchema`, `lib/offline/*`, `lib/image.ts`, `Turnstile.tsx` (pass `theme="light"`, use `onReady.reset`).
- **Rebuild UI, keep logic:** `ReportForm.tsx` splits into `ReportSheet` (state, submit pipeline, nonce, enqueue: moved verbatim), `SheetSection`, `SubmitBar`, `Receipt`, `lib/reportErrors.ts`. Store `status` from the response.
- **Rebuild:** `LocationPicker` (no marker until a value exists; lazy mount; token fix for coordinates; `easeTo` duration 0 under reduced motion).
- **Restyle:** `SpeciesPicker` (row checkbox, offline message, `initialTaxon`), `QueueBanner` (type sizes, labelled receipts), `report/page.tsx` (`?taxonId=`, two-column shell).
- **Add:** `deriveCategory` + shared test; about 45 message keys in both catalogues (parity CI).
- **Rewrite tests:** `test/report-form.test.mjs` (pins pill classes and the `<h3>`); add an offline-save source test.

## Cost and open points

About 7 to 9 working days: sheet and bar 3, location picker 1.5, receipts and errors 1.5, desktop 1, tests and catalogues 1, plus a native zh-TW read and phone checks (iOS/Android camera vs library, keyboard vs fixed bar). Backend: none. Owner decisions needed: the injured-wildlife channel; dead-invasive precedence; whether an unnamed invasive may file as `sighting` until identified.
