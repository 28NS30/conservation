# Inventory: the report flow (`/report`)

Paths are relative to `/Users/neo/conservation/apps/web` unless they start with `packages/` or `supabase/`. Screenshots are in screenshot captures (not committed; regenerate with `apps/web/e2e/_shots.mjs`). Revision c73bb8d.

## What it is for

- `/report` (and `/en/report`): someone standing beside an animal records what, where and when in about a minute, with no account, and leaves knowing whether it was sent.
- `/report?category=<key>`: the same form, arrived at from one of the homepage's three "What did you see? / 你看到了什麼？" doors, with the type preselected.
- Queue banner (top of `/report` only): someone who reported with no signal sees that the report is still on the phone, and later that it went.
- Success / queued / error states: replace or annotate the form in place; there is no receipt page.
- `POST /api/uploads/sign` then `POST /api/reports`: the only write path. Anonymous is the normal case.

## What is on screen today

The owner's complaint has two halves. The words "What did you see?" are the homepage's doors block (`app/[locale]/page.tsx:221-233`, `home-phone-fold.png`): an H2, a hint line, three stacked bordered cards with a 5px colour edge. The pills are `/report` itself, which asks the same question again as "Type / 通報類型".

**Phone, 390px, zh-TW (`report-phone-fold.png`, `report-phone-full.png`).** The page is about 2,230 CSS px tall; the viewport is 844.

1. Header, two rows (about 90px): 32px badge, wordmark, orange "+ 通報" pill; then 地圖 / 物種 / 統計 / 關於 and the language switch.
2. H1 "新增通報" (the only large type on the page) and a lede that lists the four categories again.
3. "通報類型", 14px label, three 12px pills with 8px colour dots. "路殺或受傷" arrives filled black: `roadkill` is the silent default (`components/report/ReportForm.tsx:45-47`).
4. "牠還活著嗎？", 12px label, two smaller pills, "已死亡" preselected.
5. "物種 選填": search input (the biggest control on the page, 15px), then a checkbox "我不確定那是什麼" with a two-line hint that mentions "模型".
6. "照片 (0/4)": one 80px dashed square holding a bare "+". Below it, 11px: a sentence about EXIF stripping, then an amber sentence warning of manual review.
7. "位置" with a "使用目前位置" pill at the right; the top 60px of a near-black map. **The fold is here.** The only required field is not yet visible.
8. Below the fold: dark 224px map of the whole island with a red pin already standing at Taiwan's centre; 11px "點地圖可調整位置"; datetime (prefilled now); notes textarea; email; a blank band of about 100px where Turnstile mounts; the blocker sentence, **clipped by the button beneath it**; a disabled beige "送出通報"; an 11px privacy note; then a footer as tall as a viewport.

**Desktop, 1440px (`report-fold.png`, `report-en-full.png`).** The same single 576px column (`max-w-xl`, `report/page.tsx:38`) centred in empty paper. The fold cuts through the map. Nothing uses the width. English is the same; on a phone the third pill wraps to a second row (`report-en-phone-fold.png`).

**What the eye lands on:** the H1, then the black filled pill, then the black map. The photo control and the submit button, the two things that matter, are the quietest objects on the page.

### Tap by tap: first-time visitor, phone, roadside, dead animal

1. Home: tap the "路殺或受傷" door, or the header's "+ 通報" (which lands on the same default).
2. `/report`: type and "已死亡" are already chosen. Zero taps if the defaults happen to be right; nothing says they are defaults. The first screen is classification, not the animal.
3. Species: skip, or tick "not sure" (1 tap), or tap, type, pick (3+ and needs signal; offline the search fails silently, `SpeciesPicker.tsx:79-81`).
4. Tap "+". The input has `capture="environment"` (`ReportForm.tsx:374`), so phones open the camera directly; a photo already taken in the camera app probably cannot be chosen (verify on iOS and Android). Shoot, confirm: about 3 taps. A thumbnail appears with a 20px remove button.
5. Scroll. Tap "使用目前位置", allow the OS prompt (2 taps). The map eases to z14; coordinates appear in a dark-surface token, nearly unreadable on paper (`LocationPicker.tsx:127`).
6. Scroll past time, notes, email. Turnstile solves itself or wants a tap.
7. Tap "送出通報". The form is replaced by a small ember-tinted card: 16px "感謝您的通報！", "我們已收到", one status sentence, a "查看這筆通報" link.

About 8 taps, 2 scrolls, 2 OS dialogs. The count is fine. The presentation is the problem: a questionnaire of 12px pills and 11px captions, with evidence and place below classification.

**What happens to that report** (`app/api/reports/route.ts:105-109`, `lib/abuse.ts:78-82`):

| Reporter did | Stored status | Card says | Link |
|---|---|---|---|
| photo + named species | published | "已發布至地圖" | works |
| photo, species blank or unsure | pending, 10km override | "AI 正在辨識…通常一兩分鐘" | 404 |
| no photo (any species) | pending, flagged | "已發布至地圖" (false) | 404 |

The classify cron is declared only in the repo-root `vercel.json`, which Vercel ignores (`apps/web/vercel.json` has only `regions`), so it has never run in production: row two waits for a moderator, not "a minute or two".

**Queued:** amber card, "已存到裝置，等待送出", 12px body; the form is gone and there is no "report another". **Error:** the form stays, with a rose strip above the button containing whatever string was thrown.

**Anonymous vs signed-in:** the form is identical. A session only adds `reporter_id` (`route.ts:42-46`), switches the rate-limit key from IP to user, and shows "My reports" in the header. Only a signed-in owner can later confirm the species, and only once published. An anonymous reporter of a pending record has no way back to it.

## Components

| File | Role | Used by | Verdict | Note |
|---|---|---|---|---|
| `app/[locale]/(site)/report/page.tsx` | shell, validates `?category=` | route | restyle | should also accept `?taxonId=` |
| `components/report/ReportForm.tsx` | all state, submit pipeline, done/queued/error | page | rebuild UI, keep logic | nonce, queue fallback and EXIF offer are sound |
| `components/report/SpeciesPicker.tsx` | scoped search + "not sure" | form | restyle | plain button list is deliberate a11y (`:154-160`) |
| `components/report/LocationPicker.tsx` | MapLibre pin picker, `useGeolocate` | form | rebuild | needs a real unselected state; `relative` is load-bearing (`:119-124`) |
| `components/report/QueueBanner.tsx` | pending queue, receipts, owns the queue's Turnstile | page | restyle, consider site-wide | queue only sends from a page that mounts this |
| `components/report/Turnstile.tsx` | Cloudflare widget | form, banner | keep | default `theme="dark"` with a stale "dark panel" comment (`:55,61`); the form is light |
| `components/report/ReportMap.tsx` | read-only record map, true-radius circle | `reports/[id]` | keep | belongs to the detail area |
| `components/report/SpeciesConfirm.tsx` | owner/moderator confirms AI guess | `reports/[id]` | restyle | belongs to the detail area |
| `lib/offline/queue.ts`, `lib/offline/flush.ts` | IndexedDB queue, resumable flush | form, banner, SW | keep | `lastError` stores English strings |
| `lib/image.ts` | downscale, strip EXIF, read GPS | form | keep | |
| `app/api/reports/route.ts`, `app/api/uploads/sign/route.ts` | write contract | form, flush | keep | returns `status`; the form discards it |
| `packages/shared/src/index.ts` | `CATEGORIES`, `REPORT_GROUPS`, schema | form, map filters, tiles | keep; extend if category is derived | groups are shared with the map on purpose (`:42-44`) |

## Design problems

1. **The page opens on taxonomy, not on the animal.** Two pill rows and a species search fill the first phone viewport; photo is at the bottom edge and location is off-screen (`report-phone-fold.png`). At a roadside the natural order is photo, place, then what.
2. **The same question is asked twice.** Homepage doors, then "Type" pills (`ReportForm.tsx:269-296`). The lede (`report.subheading`) lists the categories a third time.
3. **Silent defaults on the most consequential field.** "+ 通報" files `roadkill` / dead unless the reporter notices a 12px pill (`ReportForm.tsx:45-47`).
4. **Pills for everything.** Type, condition, "use my location" and "change species" share one rounded-full 12px language (`ReportForm.tsx:282, 310, 418`; `SpeciesPicker.tsx:123`), so choices, actions and filters look alike. This is the interface language the owner rejected.
5. **The main evidence action is a bare 80px "+"** with no label or accessible name (`ReportForm.tsx:369-370`); its caption talks about EXIF, not about the animal.
6. **Location looks done when it is not.** A pin stands at Taiwan's centre before anything is chosen (`LocationPicker.tsx:74-76`); the helper always says "tap to adjust" (`ReportForm.tsx:458-459`).
7. **The one sentence explaining the dead button is clipped by the button.** `-mb-1` (`ReportForm.tsx:544`) overrides Tailwind v4's `space-y` bottom margin; visible in `report-phone-full.png` and `report-en-full.png`.
8. **Success is a small tinted box that can lie and can 404** (`ReportForm.tsx:227-245`; table above). For a volunteer this is the whole reward.
9. **Queued and done states strand the visitor:** no "report another", no way home, no description of what was saved.
10. **Raw strings reach people:** `challenge_failed`, "upload signing failed (403)", and a broken key that renders literally as `report.queueFailed` (`ReportForm.tsx:203`, wrong namespace). A geolocation refusal shows "Tap the map to adjust" in the error strip (`:415`).
11. **Dark-UI leftovers on a light page:** the EXIF offer is pale sky-blue on paper at about 1.1:1 (`ReportForm.tsx:425-445`); coordinates use `text-parchment-400`; Turnstile renders dark.
12. **"Alive, but hurt" promises nothing and warns of nothing:** no guidance before or after submit that nobody is dispatched.
13. **Small and fragile:** 11px helper text throughout, a 20px remove button (`ReportForm.tsx:356`), 12px pills with 8px dots, a native 16px checkbox.
14. **Desktop is a phone column in a void**, with a footer taller than the success card.
15. **Copy leaks the machinery:** "EXIF", "模型", "人工審核", "(0/4)".

## What works

- One page, no account, no wizard chrome; time prefilled; about 8 taps.
- "Not sure" is a recorded judgement, not an empty field (`SpeciesPicker.tsx:220-225`).
- Photo GPS is offered, never applied silently (`ReportForm.tsx:104-107`); accuracy is kept only for device fixes.
- Offline: network failure becomes a queue item under the same nonce; photo upload resumes; receipts survive 24h; iOS's limits are stated honestly.
- Whole-island first framing so the east coast is tappable (`LocationPicker.tsx:63-72`); tap-to-place rather than drag.
- `aria-pressed` on choices, focus ring on the hidden file input, live region for search results.
- The blocker sentence exists at all (the idea is right; the rendering is broken).

## Could category be derived?

Mostly yes. The four stored values squash two axes: condition (dead / hurt / alive) and whether the taxon is invasive. Ask condition only, as three large choices. Dead gives `roadkill`, hurt gives `injured`, alive gives `invasive` when the named taxon has `is_invasive` (`supabase/migrations/0001_init.sql:36`; already on every search hit as `SpeciesHit.isInvasive`, `SpeciesPicker.tsx:12`), otherwise `sighting`. Derive client-side and keep sending `category`, so the API schema, the offline payload and the map's three groups are untouched. Costs: the invasive-scoped search becomes a ranking; an unnamed invasive files as `sighting` until someone identifies it; a dead invasive needs a precedence rule (today the reporter faces the same ambiguity); `test/report-form.test.mjs` pins the three groups, the `<h3>牠還活著嗎？</h3>` markup and the selected pill's class string.

## Constraints a redesign must respect

- **Privacy:** an unidentified report with a photo is held `pending` with a 10km override (`route.ts:92-109`); naming a species publishes at once at that taxon's blur. Any receipt for a pending report must not expose it to strangers; anonymous reporters have no session to prove ownership.
- **Trust the reporter:** the named species is stored as `taxon_source='user'`, never overwritten by the model.
- **Idempotency:** one `clientNonce` per form instance, reused as the queue id (`ReportForm.tsx:79-82`).
- **Queue:** stores inputs, not requests; needs one fresh Turnstile token per item, and the widget lives in `QueueBanner`. The service-worker flush (`components/ServiceWorker.tsx:24-26`) passes no token, so with Turnstile on, queued reports send only from a page that mounts the banner. Never imply background sending on iOS.
- **Upload path:** browser to Storage by signed URL (Vercel's 4.5 MB body cap); at most 4 photos; downscale and EXIF strip before upload.
- **Shared groups:** `REPORT_GROUPS` drives the form and the map filter; keep them in step.
- **Performance:** MapLibre loads here only for the picker; do not pull it earlier or add client weight. `/report` must open offline from the service worker's runtime cache.
- **a11y:** suggestions stay Tab-reachable buttons unless a full combobox is built; file input `sr-only`, not `hidden`; 24px minimum targets, 44px preferred; reduced motion for `easeTo`.
- **i18n:** every new string in both catalogues; zh-TW needs a native reader; never write a "nobody has reported yet" line; injured-wildlife referral wording must come from the owner, not be invented.
- **Tokens:** `sky-*` is not a project token; a class without a `--color-*` token emits nothing.
- **Tests:** `test/report-form.test.mjs`, `test/report-species.test.mjs`, `test/offline-challenge.test.mjs`, `e2e/offline.spec.mjs`; `e2e/pages.spec.mjs:103-152` requires three doors above the fold on the homepage.

## Verified review claims in this area

- `receipt-404`: "View this report" 404s for every pending submission.
- `status-copy`: success text keys off `awaitingIdentification`, so flagged reports are told "published"; "a minute or two" is unsupported.
- `location-default`: a default pin shows before any location exists; the helper text presupposes one.
- `raw-errors`: API codes and English literals are shown verbatim; `queueFailed` uses the wrong namespace.
- `injured-guidance`: no service expectation for "Alive, but hurt", before or after submit.
- `form-emphasis`: every heading has the same weight; the photo control is a bare "+".
- `report-prefill`: species pages link to a bare `/report`; the form cannot take a species.
- `tiny-text` (part): 11px helpers and the 20px photo-remove button.
- `dark-tokens-on-light` (part): sky-blue EXIF offer and parchment coordinates on paper.
- `receipts-indistinct`: sent receipts are N identical "Open it / 開啟" links.

## Questions for the owner

1. May the form ask only "dead / hurt / alive" and derive invasive from the named species? If an invasive animal is dead, which category wins?
2. Should the homepage keep three doors at all, or one large "Report" action with the choice made inside the form?
3. Photo first, then place, then what: acceptable as the new order?
4. Will the classifier be switched on (paid GPU)? If not, what should a photo-only reporter be told about when the record appears?
5. What should an anonymous reporter keep as a receipt for a pending report: nothing, an on-device receipt, or an emailed link?
6. What is the correct referral for injured wildlife (agency, number, wording in both languages)?
7. Should a photo chosen from the library be allowed, or camera only?
8. Should the queue banner appear site-wide so queued reports send on any visit?
