# The app submits; the site explains

Recorded 23 September 2026, from the team.

**The website becomes a homepage about the project** — what it is, what it is
for, who is doing it. **Submission moves to native iOS and Android apps**,
because somebody standing over a dead animal on a mountain road is not going to
fill in a web form. The app should read EXIF from the photograph to get the
location.

That is the right call and this document does not argue with it. What follows is
what it costs, what it saves, and the two things that will bite in week one.

---

## Two constraints to settle before anyone writes app code

### 1. The submission API cannot be called from an app today

`POST /api/reports` verifies a Cloudflare Turnstile token and answers **403
`challenge_failed`** without one (`lib/abuse.ts:17-36`, `route.ts:68`).
Turnstile is a browser challenge. A native app has no browser to solve it in,
and shipping a hidden WebView to farm tokens is both fragile and exactly the
pattern Cloudflare's heuristics penalise.

It fails open in two places worth knowing: with no `TURNSTILE_SECRET_KEY`
configured it allows everything (that is how local development works), and if
Cloudflare is unreachable it allows the submission rather than losing it.
Production has a real key, so the app gets the 403.

The replacement has to be something an app can prove. The obvious pairing is
**App Attest** on iOS and **Play Integrity** on Android — both give the server a
token it can verify against Apple's or Google's endpoint, both establish "this
is a real install of our app on a real device", and neither asks the reporter to
identify a bus. The web form, if it keeps one, keeps Turnstile.

Everything else the app needs is already there and already correct:

| | |
|---|---|
| `POST /api/uploads/sign` | rate-limited, server-generated paths, no account needed |
| `POST /api/reports` | `clientNonce` is a UUID and the insert is `on conflict do nothing`, so a retry on a flaky connection cannot duplicate a report |
| `GET /api/species/search` | the picker |
| `GET /api/tiles/{z}/{x}/{y}` | the map, if the app shows one |

The idempotency in particular was built for the web app's offline queue and is
exactly what a mobile client needs.

### 2. Reading the EXIF location is real work, and not the work you expect

Both platforms hand a picked photo to an app with its GPS removed. Neither
makes it impossible; both make it a decision with a permission attached, and
the details have moved recently enough that the obvious answers are out of
date.

**iOS.** `PHPickerViewController` — the picker that needs no permission prompt
— returns an image with location metadata stripped. Apple treats a photo's
coordinates as a separate asset from its pixels, and there is no flag on the
picker that turns them back on. Getting the coordinate means going through the
photo library proper, which means asking. **`DateTimeOriginal` survives the
picker**, so the capture-time half needs no permission at all, and
`lib/exifTime.ts` ports across unchanged.

**Android.** The stale advice — and what an earlier draft of this document said
— is `ACCESS_MEDIA_LOCATION` plus `MediaStore.setRequireOriginal()`. There is
now a documented opt-in that costs **no media-library permission**:
`MediaStore.EXTRA_REQUEST_LOCATION_METADATA_ACCESS`, set on the photo-picker
intent. Prefer it.

Two traps if you fall back to the old route: `ACCESS_MEDIA_LOCATION` does
**not** compose with Android 14's partial "selected photos" grant, so an app
declaring `READ_MEDIA_VISUAL_USER_SELECTED` gets redacted coordinates however
loudly it asks; and the new extra needs a recent enough picker to be honoured.

**And for the main case none of it is needed.** A photo taken inside the app
comes with a live GPS fix — more accurate than EXIF, timestamped now, no
library permission. EXIF location earns its prompt on exactly one path: *"I
photographed this an hour ago and am reporting it now."* That path is real and
worth supporting. It is not the common one.

The existing web code already reads both GPS and capture time from EXIF
(`lib/image.ts`, `lib/exifTime.ts`) and the rules it encodes transfer whole:

- **The time is applied; the coordinate is only offered.** A photo taken
  somewhere else is an ordinary thing — last week's trip, a screenshot — and
  filing it at the wrong place puts a wrong dot on a public map. A photo taken
  at another *time* is the same photo, and when it was taken is when the animal
  was seen.
- A camera with a dead battery reports 1970, or all zeroes, or a date after the
  report was filed. `parseExifDateTime` has sixteen tests about readings that
  cannot be believed, and that logic is worth porting rather than rewriting.

---

## What this does to the plan in `docs/redesign/`

The design work is not wasted; most of it changes address.

| | |
|---|---|
| **W6 Report flow** (13d) | **Moves to the app.** The flow is already decided and prototyped — photo at the top, every question under it, condition asked before species so an injured animal is never filed by inference, category derived rather than asked. `/lab/roundel/report/photo-first` stops being a web prototype and becomes the app's interaction spec. |
| **W8** My reports, login | Moves with it. A reporter's own records belong where they report. |
| **W11 Moderation console** | **Matters more, not less.** It was theoretical while nothing could be submitted. |
| **W4 Home** | **Becomes the main event**, and its job changes: its primary action is now "get the app", not "report an animal". |
| **W5 Map, W7 Species, W9 Statistics** | **Stay.** The site keeps its public data — see below. |
| **W1 direction, W2 tokens, W3 chrome** | Still needed. The app needs its own equivalent, and it should not be a port of the web tokens — platform conventions win on a phone. |
| **W12 BioWatch site, W13 QA harness** | Unchanged. |

**The site keeps the public data.** Asked and answered: the map, the species
pages and the statistics stay. So W5, W7 and W9 survive in full, and the
records list with them.

That is the right call for the reason the site exists at all. The map of 46,334
records is the most convincing thing this project owns; it is already public;
and a page that only describes the work persuades nobody who has not already
decided. "Information about the project" now means the project's information
too, not just prose about it.

It also means the site and the app are not the same product wearing two skins.
The site is where the data is read, by anyone, on any device, without
installing anything. The app is where a report is made, by someone standing in
front of an animal. Each can be judged on whether it does its own job.

---

## What is already done and still true

The submission backend is finished and, as of this week, correct in production:
migrations 0009 to 0013 applied, the REST API closed, an unnamed report blurred
because it is unnamed, a reclassified taxon re-blurring its records, the
category following the species, and the classifier no longer publishing what a
moderator rejected.

None of that cares whether the report arrives from a browser or a phone.

---

## The stack: Expo / React Native

Decided 23 September 2026, after evaluating Expo, Flutter, native Swift +
Kotlin and Capacitor against the constraints above rather than in general.

**The reason is one implementation of the privacy rules.**

`packages/shared` is 579 lines with one dependency (zod), one import, and no
Node builtin or DOM global anywhere in it — checked, not assumed. Metro imports
it as raw TypeScript. So `deriveCategory`, `recategorise`,
`reportSubmissionSchema`, `LOCATION_PRECISION` and `UNIDENTIFIED_PRECISION`
stay as **one** implementation across the website, iOS and Android.
`lib/exifTime.ts` ports across whole.

Several of those are privacy rules, and this project has already been bitten
twice by the same thing in the small: the GBIF remap could weaken a blur by
correcting a name, and three separate code paths disagreed about what
`precision_override` meant. Both were one codebase. A second implementation in
another language, maintained by a small team, is that failure mode with a
language barrier added.

**What the alternatives actually offered, once checked rather than remembered:**

- **Flutter** looked strongest on iOS EXIF: `image_picker`'s
  `requestFullMetadata`, first-party, resolving the `PHAsset` for you. That
  mechanism **was deleted from the plugin in January 2025**
  (flutter/packages #8190, "Removes use of PHAsset on iOS 14+"). The advantage
  is gone. Its background-upload story is genuinely better than Expo's, and
  that is the real cost of not picking it. Against it: every rule above gets
  rewritten in Dart, the one language in this project with no existing code.
- **Native Swift + Kotlin** wins EXIF and attestation outright — first-party
  APIs, no wrapper, no bus-factor-one package. But that is roughly 300 lines.
  The offline queue is the defining constraint and the most stateful, least
  testable part of the app, and it is exactly what gets written twice.
- **Capacitor** would reuse the most code of all, and fails the product. Its
  background runner has no IndexedDB, so the queue — which lives in IndexedDB,
  inside a webview that dies when the app closes — cannot be read by anything
  that runs after the app is gone. "Signal came back" would mean "the reporter
  opens the app again", in an app whose whole purpose is working where the
  network does not.

**The cost being accepted.** Everything hard here — EXIF GPS, App Attest, Play
Integrity, MapLibre Native, background upload — needs a custom dev build on
physical hardware. None of it runs in Expo Go and most of it does not run in a
simulator. That tax is paid on day one or it is paid every day: the dev-build
pipeline and a real device for each platform are the first task, not a later
one.

**First thing to settle on hardware**, before any of the flow is built: pick a
photo from the library on each platform and print what comes back. That answers
the permission question for real, in an hour, and everything above is
documentation until it does.
