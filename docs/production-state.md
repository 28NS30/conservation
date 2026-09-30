# What is actually in production

The planning documents in this directory were written before the work they
describe landed, and several still present finished work as pending. That is not
a filing problem: it cost real time this week, because an audit re-raised three
things as top priorities that had been done for days, and the only way to settle
any of them was to query production.

This file exists so that stops happening. It records **verified** production
state, with the date, the method, and — where it matters — an explicit "not
known". It is not a plan and contains no intentions.

Last verified **25 September 2026, 19:40 (Asia/Taipei)**; the "Changed on" sections were each verified on their day, the latest on **30 September 2026, 22:45**.

## How these were checked

Two ways, both from outside the repo:

- HTTP against `https://preservation-web-one.vercel.app` — the live production
  alias. There is no custom domain: `biowatchintl.org` and
  `formosawatch.biowatchintl.org` are **NXDOMAIN**, not registered, so the
  `vercel.app` alias is the only address the site has.
- SQL through the Supabase Management API query endpoint, using the token in the
  macOS keychain. Production `DATABASE_URL` is marked Sensitive in Vercel and is
  genuinely unobtainable from here.

## Schema

**Migrations 0001–0019 and 0021–0023 are applied** (0020 was never used; see
"Changed on 29 September 2026"). `/api/health` returns
`"schemaCurrent": true`, and that is a *data* assertion rather than a shape
check — `lib/schemaStatus.ts` verifies the rules the migrations were written to
establish, not merely that the columns exist.

**The `_migrations` ledger holds 22 rows.** It is baselined. Production
`DATABASE_URL` is not obtainable from here, so migrations since 0014 were
applied through the Management API's query endpoint, each as one transaction
ending in its own ledger row, after a dry run that aborts itself and reports
what the file would change (the "only tightens" proof for every blur change).

> `docs/plan-finish.md:345` still says migrations 0009 and 0010 are missing and
> that "the live site rejects every submission", and prints a `--baseline`
> command as pending work. Both are stale — that was true on 15 September.

## The GBIF taxon remap is applied

This is the one nothing recorded, and it is why an audit spent effort re-deriving
it. Verified directly:

| check | result |
|---|---|
| records still attached to 狼 (the wolf) | **0** |

The remap moved 14 dog records off the wolf, returned 鼬貛's 747 records to the
species directory, and put 草花蛇 (445) and 食蟹獴 (97) onto their corrected
protected names.

> `docs/redesign/README.md:60` still says "The naming fault it fixes is still
> live — 狼 still holds 14 dog records". It does not.

**Not known: how it reached production.** Either `scripts/taxon-remap.sql` was
run, or a post-remap dump was restored via `scripts/dump-for-production.sh`.
Nothing records which. The *outcome* is certain; the provenance is not.

Also void: the "331 loosenings needing an explicit yes/no". Commit `edd54e6`
regenerated the SQL so that correcting a name can never weaken a blur. The
loosening count is **0**. And `scripts/taxon-remap-report.csv` is not a valid
before/after record — it was regenerated after the local apply, so
`old_taicol_id` already holds the new taxon.

## The location-privacy invariants hold

Both are the whole point of the trigger ladder, and both are at zero:

| invariant | result |
|---|---|
| untaxoned reports sitting at `exact` | **0** |
| reports at `exact` on a taxon rated sensitive | **0** |

So W0e — the "live privacy exposure" the redesign README still leads with, 7,336
published records at exact coordinates including 542 of two protected species —
is fixed in production, not merely written.

> `docs/redesign/README.md:96` says "Applying it to production needs your
> credentials." It has been applied.

## The public data surface is closed

Migration 0013 revoked the table grants. The remaining hole could not be closed
in SQL, because `postgres` does not own the three PostGIS objects — so it was
closed in the dashboard instead: **PostgREST no longer exposes the `public`
schema.**

Every table now answers **404** to a valid client key — 404 rather than 401,
meaning PostgREST does not know they exist:

```
404  /rest/v1/taxa          404  /rest/v1/reports
404  /rest/v1/spatial_ref_sys   404  /rest/v1/geometry_columns
404  /rest/v1/geography_columns
200  /auth/v1/settings      ← unaffected; magic link is the only sign-in path
```

That also retired two things SQL could not reach: `anon` held DELETE and
TRUNCATE on `spatial_ref_sys` (deleting SRID 4326 breaks every geography
operation on the site), and `anon` could call 785 functions as RPC endpoints.
Nothing in this codebase calls PostgREST — there is not one `.from(` or `.rpc(`
anywhere — so closing it cost nothing.

## Corpus

From `/api/health`: **46,334 reports, 125,438 taxa, 506 species.**

Every public row is `source='gbif'`. Whether production has ever received a
**user** submission is **not directly checkable from here** — the base `reports`
table is not readable — but `/attribution` totals the same 46,334, which is
strong indirect evidence that it has not.

Note two stale numbers that are harmless because every page computes its own at
request time: the species count is **506**, not the 458 in
`api/health/route.ts:19-20` and `apps/biowatch/README.md`; and the record count
appears as 46,402 in some comments.

## The jobs have never run

Both crons were declared in the repo-root `vercel.json`, which Vercel does not
read, **and** both routes exported only `POST` while Vercel Cron issues `GET`.
Either fault alone was enough. So the submit → identify → publish loop has
executed **zero times** in production, which is indistinguishable from "nobody
has submitted anything" — see `docs/launch-checklist.md`.

The Modal classifier they point at **is** deployed and serving, so this was the
only missing link.

Both faults are fixed in [#67](https://github.com/28NS30/conservation/pull/67).
This section is therefore the shortest-lived thing in this file: once that merges
and deploys, the first `0 3 * * *` run is the first time the loop has ever
executed, and **that run is worth watching** — nothing downstream of it has been
exercised against production data.

## The design lab is reachable

`LAB_ENABLED=1` is set in Vercel production and a redeploy has picked it up.
`/lab`, `/lab/roundel`, `/lab/journal` and the Roundel deep pages all answer 200.
`/lab/journal/map` and `/lab/journal/report/stepper` 404 **by design** — only
home is built for both directions (`lib/lab/directions.ts`).

## Changed on 28 September 2026

Each verified from outside after the change.

**30 bird records blurred to 10 km.** TaiCOL's 12 August 2026 update rated four
species 輕度 (sensitive) that our copy of TaiCOL still had as unrated: 棕背伯勞
*Lanius schach*, 小水鴨 *Anas crecca*, 黑腹濱鷸 *Calidris alpina*, 紅胸濱鷸
*Calidris ruficollis* — confirmed against TaiCOL's live API, not taken from the
audit. Their 30 records were at exact coordinates. Each got
`precision_override = 'coarse_10km'`, which the trigger combines with the taxon
policy by taking the stricter, so it can only tighten, and it survives a
TaiCOL re-import that would wipe a hand-edited rating. Both site-wide invariants
were re-checked at zero afterwards. The durable fix is the TaiCOL refresh in the
plan.

**Sign-in URLs.** Supabase's `site_url` was `http://localhost:3000`, so every
sign-in email pointed at localhost and nobody could sign in. It is now
`https://preservation-web-one.vercel.app`, and the redirect allow-list holds the
exact callback URL (`/auth/callback`, no query string).

**Sign-in code length: 6** (was 8). But the email TEMPLATES could not be
changed: Supabase refuses template edits on a free-tier project that uses its
built-in mailer ("Please upgrade your plan or configure a custom SMTP
provider"). So emails still contain only the link, in English, until a custom
SMTP provider is configured. The built-in mailer also sends only 2 emails an
hour and only to members of the Supabase project, so the public cannot sign in
yet either way.

**The team's design is live** (#75): forest-green header with the report and
language blocks, the rotating photo hero, photograph rows. The team's text
changes are live (#74).

## Changed on 28 September 2026, evening

Each applied through the Management API and verified from outside.

**0014 (#77), stricter wins.** A record's blur is the strictest of its own
taxon, every row up to its species, a table of local floors the TaiCOL import
never touches (53 rows), and its override. Dry run and apply: 0 records
changed (the 30 above were already stamped), 0 loosened. The floors table is
closed to `anon`, `authenticated` and `web_anon`.

**0015 (#79), English names.** Four columns on `taxa`, then 2,515 names loaded
from `scripts/english-names.json` and the overrides file, keyed by TaiCOL id
(all 2,515 matched). No blur changed; the columns do not fire the re-blur
trigger.

**0021 (#81), the Red List.** Species Taiwan's Red List rates NCR, NEN, NVU or
RE get at least 10 km, read from the species above a subspecies too.
102 records went from exact to 10 km (長腳赤蛙 46, 粉紅鸚嘴 29, 緬甸蟒 12, 小雲雀
9 and four more), 0 loosened, no other record moved. Map tiles are CDN-cached
for up to a day with no version in the URL; the deploy that followed started a
fresh cache, which is what made the change visible on the map.

**Now live in the code:** sign-in with a 6-digit code as well as the link,
return to the page you were on, a header sign-in link, session refresh (#78);
the copy fixes across every page (#80); the season goal unlisted until a person
files a report (#83); the GBIF importer skipping our own reports coming back
through TaiRON (#84); a stable order on the records list and one species count
everywhere (#85).

**Pending at the time of writing:** 0022 moves 72 records onto the names that
apply in Taiwan (石虎, 臺灣蛇蜥, a crab and a vole), tightening only; it is
applied when #88 merges.

## Changed on 29 September 2026

Verified with one query through the Management API at 16:55: the ledger holds
0001–0019 and 0021–0023 (22 rows); `reports_public` has **46,334** records;
`taxa` has **136,680** rows, 13,531 with TaiCOL's alien-status note;
`taxon_precision_floors` has 89 rows; and **no** record with a species is shown
more exactly than that species' rule allows (0 rows).

**Applied since the last entry:** 0016 (the invasive flag on
`reports_public`), 0017 (what each contributor agreed to), 0019 (the forum's
tables, switched off), 0022 (72 records moved onto the names that apply in
Taiwan, tightening only), 0023 with the TaiCOL refresh (36 more floors, so no
refreshed rating could loosen a blur), and 0018.

**0018 (#103), test reports.** `reports.is_test`, and the public rules move to
`reports_published`, which keeps tests and is granted to nobody;
`reports_public` is that minus tests. Dry run and apply: the view returned the
same 46,334 rows with the same checksum before and after, and `web_anon`,
`anon` and `authenticated` cannot read `reports_published`.

**No one in production is a moderator or an admin** (0 rows in `profiles` with
either role). /admin, the moderation queue and test reports therefore have no
user yet; `docs/owner-setup.md` step 3 is the one statement that changes it.
No report has yet come from the public (0 with `source = 'user'`).

**Now live in the code:** classification right after a report is sent (#101);
record and species pages headed by the animal (#102); species status in
sentences (#104); the photo-first report pages with a pinned send button (#105);
the team's design on every inner page (#106) and the error pages (#111); the
moderation queue readable on a phone in the moderator's language (#108); a
person can delete their own account from /me (#109); the AI's suggestions and
the stats page made readable (#110, #112).

## Changed on 30 September 2026

Verified through the Management API and over HTTP, 30 September, 22:45. The
ledger holds 28 rows, through 0029; `reports_public` has **46,336** records;
`taxon_precision_floors` has 86 rows; and, after the blur decision below,
**no** record with a species is shown more exactly than its species' rule or
its binomial's allows (0 rows), no public report without a species is exact
(0), and no record of an unrated invasive species is still blurred (0).

**The security audit and its review.** An audit of the whole site on 29
September confirmed 66 problems; a review of the fixes on 30 September
confirmed 20 more in the fixes themselves. All are fixed in #119–#130 and live,
except the ML service's (below). In the database:

- **Migrations 0024–0029 are applied**, each dry-run first, each with its
  ledger row. 0024: no function the site defines can be called through the
  REST API. 0025: a blurred record publishes no notes, and the model's
  suggestions only where every candidate's blur is no finer than the record's.
  0026: when a rating tightens, records named under the same binomial re-blur.
  0027: one report per photograph. 0028: an index on
  `binomial_of(scientific_name)` (the record page's suggestions check had
  scanned all of `taxa` 25 times per view: 1,222 ms, now 13 ms) and the
  `search_path` pins restored. 0029: the owner's blur decision, below.
- **Auth:** the sign-in code lasts 15 minutes (`mailer_otp_exp` 3600 → 900).
  The code-only email templates could not be set: Supabase refuses template
  changes on the free tier's default mailer until custom SMTP exists, so the
  sign-in email is still a link and a code. `docs/owner-setup.md` §1.5 says
  what to paste once SMTP is set up. Captcha on sign-in is still off (§1.6).
- **Accounts:** 0 users, 0 moderators. A session opened with a password is
  refused (#125).

**The owner's blur decision (0029).** The team asked that only protected
species be blurred, and no invasive ones. The owner chose: a record of an
invasive species is exact, unless the species is also protected or rated; a
record with no species stays at 10 km until named; the blur follows the
protected list and TaiCOL's sensitivity ratings, no longer Taiwan's Red List;
TaiCOL's 重度 stays 50 km and 座標不開放 stays hidden. 118 records became exact
(102 blurred only by the Red List, 16 of invasive species), and blurred
records went from 7,371 to 7,253. The three floors removed were three plants'
(鈍頭落芒草, 粗毛懸鉤子, 台灣萍蓬草) whose only reason was a Red List rating;
黃魚鴞, 黃鸝 and 熊鷹 keep their 50 km floors. The migration refuses to loosen
anything else.

**The first reports from the public**, 30 September at 08:50 and 09:27 UTC:
two, from the invasive page, anonymous, each with a photo, an email and notes
(the team testing). Each was classified within 31 seconds (band high, five
suggestions). Checked from outside: neither the record page nor
`/api/reports/{id}` carries the exact point, the notes or the email, and both
served photos are WebP with no EXIF at all. Under 0029 both are shown at their
exact spot, as an invasive species; both await a moderator's verification,
and there is no moderator yet.

**The team's feedback (#131), live from `d43fe5b`:**
- Chinese unless someone chooses English: `localeDetection: false`, so an
  English-language browser gets Chinese at an unprefixed address.
- The pages speak for the team, not one person.
- One photo picker, and the photo's GPS fills the location. The published copy
  is still stripped of its metadata.
- Every report from the form is CC0, with no credit field (consent version
  2026-09-30).
- The model suggests species as soon as a photo is added (`POST
  /api/identify`, stores nothing, capped at 1,500 a day for the site).

Checked over HTTP after the deploy:
- `/report` with `Accept-Language: en-US` answers 200 in `zh-TW`.
- `/api/identify` answers 400 to malformed bodies. It identified the site's own
  green iguana photo on the invasive page as 綠鬛蜥, 98.5%, band high, in 16 s.
  It also listed two species under 1%, which #134 stops offering.
- `/terms` states CC0, and no page names one person as running the site.

**Not deployed: the ML service's fixes (#123).** `modal deploy` stopped at
Modal's payment check. The live service is still v2 of 5 August, and it works
(it classified the two reports above, and answers `/api/identify`). Until the
owner adds a payment method (owner-setup §4), a request without the token
still starts a GPU, and the service still fetches an `imageUrl`.

**Not applied: 0030 (the forum's votes, #132).** The forum is off; 0030 is
applied once #132 merges.

**From this machine:** for some hours on 29–30 September the network's DNS
answered every `*.vercel.app` name with a local address. GitHub's deployment
records showed production healthy throughout, and it cleared by itself.

## Known outstanding, on the credential holder

- The legacy HS256 JWT signing key is `previously_used`, which still **verifies**.
  Retiring it needs the app moved to `sb_publishable_` / `sb_secret_` first.
- **A custom SMTP provider.** Unlocks public sign-in, the email-code template
  and a sane rate limit. Needs a sending domain, which needs the domain below.
- No custom domain, and the Vercel project `apps/biowatch/.vercel/project.json`
  points at does not exist — the team has exactly one project,
  `conservation-web`. So the parent site is finished code with no deployment
  target.
- Production SMTP for magic-link sign-in is not configured anywhere in the repo;
  `supabase/config.toml` covers localhost only.
