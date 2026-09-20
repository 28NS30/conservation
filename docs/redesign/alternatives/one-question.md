# Report flow C: one question per screen

Planning only. Code read at c73bb8d; screenshots `report-phone-fold/full`, `report-fold`, `home-phone-fold`. Paths relative to `apps/web`.

## Idea

`/report` becomes a five-screen stepper: **photo, place, alive?, species, check and send**. One 32px question per screen, full-width rectangular rows at least 64px tall, one 56px primary button pinned to the bottom safe area. No pills, no text under 14px, no footer. The opening question is no longer "what type is this" but a camera button.

Order, for someone at a roadside: the photo first because it is the instinct, the irreplaceable evidence, and it may carry GPS; place second because it is the only required answer; then one tap for condition; species last because it is the question most people cannot answer and the only one that needs signal.

## Frame (390px)

- Slim bar, 56px: badge and "通報 / Report" (link home), language switch, "✕ 離開 / Leave". `/report` moves out of `(site)` into its own route group so the two-row header and the viewport-tall footer go.
- Progress: five segments plus "2／5". Below it "← 上一步 / Back", 44px target.
- Step lives in the URL **hash** (`#where`) via `pushState`, so browser Back is step Back, and the service worker still serves `/report` offline (`public/sw.js:55` matches with `ignoreSearch: false`; a query string would miss the cache).
- On step change, focus moves to the H1; progress is announced. Reduced motion: no slide, and the map jumps instead of `easeTo`.
- **Draft**: every answer, photo blobs and the `clientNonce` are written to a new IndexedDB database `conservation-draft` (separate from the queue's, so `e2e/offline.spec.mjs`, which opens the queue DB at version 1, is untouched). Reload, language switch, or Android discarding the tab while the camera is open all come back to: "上次有一筆還沒送出的通報，要繼續嗎？ / You have an unfinished report. Continue?" [繼續 / Continue] [重新開始 / Start over]. Drafts expire after 24h.

## Screens

**1. Photo (optional).** H1 "先拍一張照片 / Take a photo first". Help: "有照片，別人才能確認這筆紀錄。/ A photo is what lets others check this record."
- Tile, 200px tall, camera icon: "拍照 / Take photo" (`capture="environment"`). Row: "從相簿選 / Choose from library" (second input, no `capture`; this settles inventory question 7). Text button: "沒有照片，直接繼續 / Continue without a photo".
- Quiet link at the bottom: "動物還活著、需要救援？/ Animal alive and needs help?" opens the injured notice (3b) at once.
- *Processing*: tile shows "處理中… / Processing…"; Next disabled.
- *Photo added*: two-column thumbnails, each with a 44px "移除 / Remove"; tile "再加一張（最多 4 張）/ Add another (up to 4)"; primary "下一步 / Next". Note: "上傳前會縮小照片，並移除裝置與位置資訊。/ Photos are shrunk and stripped of device and location data before upload." No "EXIF", no "(0/4)".
- *Failed*: "這張照片無法處理，請換一張或重拍。/ That photo could not be processed. Try another."

**2. Place (required; nothing defaulted).** H1 "在哪裡看到的？/ Where was it?"
- *Unset*: dashed status line "尚未設定位置 / No location set yet". The map (280px, whole island) has **no marker** and an overlay "點一下地圖標出位置 / Tap the map to mark the spot". Next is disabled and says why.
- Rows: "用我現在的位置 / Use where I am now"; when a photo carried GPS, "用照片的拍攝地點 / Use the photo's location" as an equal row (offered, never applied); the map is the third way.
- *Locating*: spinner, "定位中… / Locating…".
- *Refused or timed out*: beside the row, "拿不到你的位置，請在地圖上點選。/ Couldn't get your position. Pick the spot on the map."
- *Set*: "已設定位置 / Location set", coordinates in an ink token, "誤差約 12 公尺" for device fixes only; "不對？點地圖或拖曳圖釘修正。/ Not right? Tap the map or drag the pin." Outside Taiwan warns, does not block (the server flags it).
- *Offline*: "沒有網路，地圖載不出來；用「我現在的位置」就可以。/ No signal, so the map can't load. 'Use where I am now' still works."

**3. Condition (required, no default, tap advances).** H1 "牠還活著嗎？/ Was it alive?" (existing copy). Rows: "已死亡 / No, it was dead"; "還活著，但受傷 / Yes, but hurt"; "還活著，沒事 / Yes, alive and well". Buttons with `aria-pressed`, not radios, so arrow keys cannot auto-advance.

**3b. Injured notice (only after "hurt"; not counted in progress).** H1 "我們不會派人過去 / Nobody will be sent". Body: "這裡只留下紀錄，沒有救援人員。動物需要幫忙，請聯絡：〔救援管道，待負責人確認〕/ This only makes a record; there is no rescue team behind it. If the animal needs help, contact: [channel to be confirmed by the owner]". Primary "知道了，繼續通報 / Understood, continue". **Blocks shipping until the owner supplies the channel; no number is invented.** Repeated on the result screen.

**4. Species (optional).** H1 "知道是什麼動物嗎？/ Do you know what it is?"
- 56px search input, "輸入名稱，例如 石虎 / Type a name, e.g. leopard cat". Hits are 56px rows (the existing Tab-reachable button list and live region stay). Picking a row advances.
- Row "不確定 / Not sure" sends `taxonUnknown`. With a photo: "沒關係，有照片就能之後再確認。/ That's fine. The photo lets it be identified later." The word "模型" goes.
- *Searching*, *no hits* ("查不到這個名稱。").
- *Offline* (today this fails silently): "沒有網路，現在無法搜尋。/ No signal, so search isn't available." The row becomes "先略過 / Skip for now" and sends neither field, because "not sure" would be untrue for someone who knows the name. Hint: "知道名稱的話，可以在下一步的備註寫下來。"

**5. Check and send.** H1 "確認後送出 / Check and send".
- Ruled rows, each with "修改 / Change" (jumps to the step, returns here): photos, place, condition, species, time ("今天 18:49", default now, native `datetime-local` on Change).
- Disclosure "補充說明或留下信箱（選填）/ Add a note or your email (optional)". Email help: "只用來聯絡你，不會公開。"
- One truthful line, from the same rule as `route.ts:105-108`: photo without species, "沒有物種名稱的通報，要等確認物種後才會公開。/ Without a species name this is held until the species is confirmed."; no photo, "沒有照片的通報，會先由人看過才公開。/ Reports without a photo are checked by a person before they appear." Otherwise no promise. Then the existing privacy sentence.
- Turnstile, `theme="light"`, above the button. Button: "正在驗證瀏覽器… / Checking your browser…" (disabled), then "送出通報 / Send report", then "上傳照片 1／2… / Uploading photo 1 of 2…".
- **Offline, or no token after 8s: the button becomes "先存在手機裡 / Save on this phone" and enqueues.** Today the button is disabled while `turnstileEnabled && !turnstileToken` (`ReportForm.tsx:550-555`), and Turnstile cannot solve offline, so in production a fully offline reporter cannot reach the queue at all. The queue mints its own token at flush, so this is consistent with its design.

## Results (full screen, keyed on the response's `status`, which the form discards today)

- **Published**: "已經上地圖了 / It's on the map". "謝謝你，這筆紀錄已經公開。" Buttons: "看這筆紀錄 / View it" (i18n `Link`), "再通報一筆 / Report another" (new nonce, draft cleared), "回地圖 / Back to the map".
- **Held**: "收到了，還沒公開 / Received. Not public yet". If `awaitingIdentification`: "這筆通報沒有物種名稱，要先確認是什麼動物才會公開。目前由人處理，時間不一定。/ …it stays private until someone confirms the animal. That is done by hand and we can't say how long it takes." Otherwise: "這筆通報會先由人看過才公開，時間不一定。" **No view link** (it 404s). Signed in: link to "我的通報". Anonymous: nothing more is promised.
- **Queued**: "存在手機裡了，還沒送出 / Saved on this phone. Not sent yet", the existing iPhone-honest body, a summary of what was saved, "再通報一筆", "回首頁". `QueueBanner` becomes one 48px row on screen 1 and on results; it keeps owning the queue's Turnstile.
- **Errors**, mapped from codes, never raw: `rate_limited` "你送得太快了，請過幾分鐘再試。通報內容還在。"; `challenge_failed` resets the widget, "驗證過期了，請再按一次送出。"; `photo_*` returns to screen 1 with the message on the photo; `taxon_not_found` returns to screen 4; 5xx or unknown "伺服器出了問題，通報沒有送出。內容還在這支手機上。" with [再試一次] [先存在手機裡]; IndexedDB unavailable "無法存到這支手機。請不要關閉這個頁面，有網路後再按送出。"

## Category

Derived on the client; the API still receives `category`. dead gives `roadkill`; hurt gives `injured`; alive gives `invasive` when the chosen hit has `isInvasive` or the visitor came through the invasive door, else `sighting`. A dead invasive files as `roadkill` (the taxon still marks it invasive); owner to confirm. A door (`?category=`) counts as an answer: `invasive` and `sighting` pre-answer screen 3 (visible and changeable on screen 5) and `invasive` keeps the register-scoped search; `roadkill` still asks. `?taxonId=` pre-answers screen 4. The header's "+ 通報" defaults nothing. `REPORT_GROUPS` and the map filter are untouched.

## Desktop (1024px and up)

Two panes in `max-w-5xl`. Left, 420px: the same stepper. Right: the record so far, a large photo, then from screen 2 onward the live map at about 520px, which *is* the picker (mouse-sized), plus summary rows. Screen 1 adds drag-and-drop and has no `capture`. Enter is Next.

## Code

- **Unchanged**: `api/reports/route.ts`, `api/uploads/sign`, `reportSubmissionSchema`, `lib/image.ts`, `lib/offline/queue.ts`, `flush.ts`, `Turnstile.tsx` (pass `theme`).
- **`ReportForm.tsx`** stays the container, keeping nonce, `submit()` and the `enqueue` block in place, so `test/offline-challenge.test.mjs`, which slices that file, still passes; its JSX is replaced. It keeps `status`.
- **New**: `components/report/flow/` (`FlowShell`, `StepPhoto`, `StepWhere`, `StepCondition`, `InjuredNotice`, `StepSpecies`, `StepReview`, `Result`); `components/ui/ChoiceRow` and `BigButton`, the non-pill control language the rest of the site can reuse; `lib/report/flow.ts`, a pure reducer with `deriveCategory`, unit-testable; `lib/offline/draft.ts`.
- **Rebuild** `LocationPicker` (marker added only on first value; overlay; keep `relative`). **Restyle** `SpeciesPicker` (`scope` prop, offline state) and `QueueBanner` (labelled receipts; link only when published).
- `StepWhere` loads through `next/dynamic`, so MapLibre and its CSS leave `/report`'s first paint: lighter than today, and `/map`'s load path is not touched.
- About 45 keys in each catalogue; rewrite `test/report-form.test.mjs` (it pins the pills' class string and the `<h3>`); add a 390px Playwright walk in both locales, including offline.

## Cost

Eight to nine working days: shell and screens 3, picker 0.5, draft 1, errors and copy 1, desktop 1, banner 0.5, tests 1.5. A clickable proof of screens 1 to 3 plus a result, for the owner to judge first: 1.5 days. About ten taps and no scrolling, against eight taps and two scrolls today. External blockers: the injured-wildlife channel, a native zh-TW read, the dead-invasive rule.
