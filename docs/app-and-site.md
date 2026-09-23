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

### 2. Both mobile OSes strip the EXIF location you are planning to read

This is the one that will surprise somebody in week one.

**iOS.** `PHPickerViewController` — the modern picker, the one that needs no
permission prompt — hands back an image with **location metadata removed**.
Apple treats a photo's coordinates as separate from the photo. To read them you
need `PHPhotoLibrary` authorisation and to go through `PHAsset`, at which point
the system asks the reporter for photo-library access, and the asset's
`location` is a `CLLocation` rather than something you parse out of EXIF.

**Android.** Since Android 10, `MediaStore` **redacts location** from images
returned to apps. You need the `ACCESS_MEDIA_LOCATION` permission *and* a call
to `MediaStore.setRequireOriginal(uri)` before the EXIF GPS tags are there at
all.

So "read the EXIF to get the location" works, but only with a photo-library
permission prompt on both platforms, and only through each platform's own API
rather than a shared EXIF parser.

**And for the main case it is unnecessary.** A photo taken inside the app, with
the camera, comes with a live GPS fix that is more accurate than EXIF, is
timestamped now, and needs no library permission at all. EXIF location matters
for one path — *"I photographed this an hour ago and am reporting it now"* —
which is a real path worth supporting, and is the one that costs a permission
prompt.

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
| **W1 direction, W2 tokens, W3 chrome** | Still needed, for a smaller site. The app needs its own equivalent, and it should not be a port of the web tokens — platform conventions win on a phone. |
| **W12 BioWatch site, W13 QA harness** | Unchanged. |

**One question is genuinely open**, and it is worth answering deliberately
rather than by omission: *does the site keep the public data — the map, the
species pages, the statistics, the records list?*

They are W5, W7, W9 and part of W8, about 25 days of the plan. The case for
keeping them is that the map of 46,334 records is the most convincing thing this
project owns, it is already public, and a page that only describes the work
persuades nobody who has not already decided. The case for dropping them is that
every page kept is a page to design, translate, test and keep true.

"A homepage that just has information about the project" reads like dropping
them. Nobody should act on my reading of one sentence.

---

## What is already done and still true

The submission backend is finished and, as of this week, correct in production:
migrations 0009 to 0013 applied, the REST API closed, an unnamed report blurred
because it is unnamed, a reclassified taxon re-blurring its records, the
category following the species, and the classifier no longer publishing what a
moderator rejected.

None of that cares whether the report arrives from a browser or a phone.
