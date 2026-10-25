# What is actually in production

The planning documents in this directory were written before the work they
describe landed, and several still present finished work as pending. That is not
a filing problem: it cost real time this week, because an audit re-raised three
things as top priorities that had been done for days, and the only way to settle
any of them was to query production.

This file exists so that stops happening. It records **verified** production
state, with the date, the method, and — where it matters — an explicit "not
known". It is not a plan and contains no intentions.

Last verified **25 September 2026, 19:40 (Asia/Taipei)**; the "Changed on" sections were each verified on their day, the latest on **25 October 2026**.

## How these were checked

Two ways, both from outside the repo:

- HTTP against `https://preservation-web-one.vercel.app` — then the live
  production alias. The repository spelled the custom domain
  `biowatchintl.org`, and that name and `formosawatch.biowatchintl.org` are
  **NXDOMAIN**, so the `vercel.app` alias was the only address checked. The
  registered domain is `biowatchitnl.org`, and the site has since moved to
  `formosawatch.biowatchitnl.org` (see "Changed on 22 October 2026").
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

## The scheduled jobs (22 October 2026)

**Declared where Vercel reads them, and callable the way it calls them.**
Until #67 they were neither: the crons sat in the repo-root `vercel.json`,
which Vercel ignores, and the routes answered only `POST` while Vercel Cron
sends `GET`. Since #67 they are in `apps/web/vercel.json`, which now declares
three, daily, in UTC:
`/api/jobs/classify` at 03:00, `/api/jobs/cleanup-orphans` at 04:00 and
`/api/jobs/forum-retention` at 04:30 (a 404 while the forum is off).
`apps/web/test/cron-reachable.test.mjs` holds both halves. Verified in the
repository, not in Vercel's dashboard.

**Whether they have ever run in production is not known.** Nothing recorded a
run, and the Hobby plan keeps function logs for about an hour. In particular,
**not verified**: that `CRON_SECRET` is set in Vercel's production
environment. Without it each job route answers 401 in production, and Vercel
Cron sends the secret only when it is set, so every run would be refused
without a trace.

**Classification does not wait for the cron.** Since #101 a report is
classified right after it is sent; the two public reports of 30 September were
classified within 31 seconds that way. The 03:00 run is the sweeper for
retries and for anything that path missed. The model service was still v2 of
5 August on 30 September (see that day's entry); not re-checked since.

**From migration 0036 on, a run leaves a record.** Each job writes a
`job_runs` row as it starts and completes it as it ends, and `/api/health`
reports, per job, the hours since its last good run (`jobs`), with the
classification queue's length and oldest wait (`queue`), whether Storage
answers (`storage`) and the database's size (`dbSizeMb`). **0036 was
applied to production on 25 October 2026**, with its ledger row, before the
code that writes the tables merged. A self-aborting dry run first showed both
tables with row-level security on, no policy, and no grant to `anon`,
`authenticated`, `web_anon` or PUBLIC. Both tables were empty afterwards.

**A run refused for want of `CRON_SECRET` still records nothing**, by design:
the secret is checked before the first write, or anyone could add rows. What
shows it is that no good run ever appears, and the hourly watch turns that
into an issue (below).

## Monitoring (22 October 2026)

What exists in the repository. None of it had run from GitHub at the time of
writing; the watch's checks were run once by hand from here
(`node scripts/production-watch.mjs --dry-run`) and passed for the custom
domain. Revised on 25 October after review; the revisions have not run from
GitHub either.

- **Every hour,** `.github/workflows/production-watch.yml` asks both addresses
  for `/api/health` (200, `ok` and `schemaCurrent` true, more than 46,000
  reports), the roadkill report page with its Turnstile site key, and one map
  tile. Two failed checks in a row open an issue labelled `production-down`,
  assigned to the repository's owner; the first green run closes it. The
  rules are in `scripts/production-watch.mjs`. The repository is public, so
  the issue carries only what any visitor could see.

  "In a row" is read from a notice annotation each run leaves on its own job
  (`production-watch state`), not from whether the run failed, so a run that
  failed for GitHub's reasons is not taken for a failed check. The run itself
  fails only when the issue is opened or commented on, or when a failed check
  could not be reported, so one blip sends no email. **Not verified:** that
  GitHub's check-run annotations API returns these notices to the workflow's
  token as expected; until a scheduled run has read one, the first runs see
  no previous state, which reads as "the previous check passed".
- **The scheduled jobs.** A job whose last good run is more than 48 hours old,
  or that the watch has seen with no good run at all for 48 hours, opens a
  separate issue labelled `jobs-stale`, closed once every job has run well
  again. This is what would notice `CRON_SECRET` missing in production. It
  starts only once 0036 is applied and health reports `jobs`.
- **After every production deploy,** the same workflow waits up to three
  minutes for the production address's `/api/health` to name the
  deployment's commit (health's `commit`, from `VERCEL_GIT_COMMIT_SHA`), then
  runs `scripts/verify-deploy.mjs` against it. Vercel's own URL for the
  deployment is behind the team's login, so the production address is what
  can be checked. **Not verified:** that Vercel exposes
  `VERCEL_GIT_COMMIT_SHA` to this project's functions at run time. If it does
  not, health's `commit` is null and the check runs after the three minutes
  with a warning, not knowing which build it checked.
- **Health asks production's ledger for every migration file** in the build
  (`lib/migrationLedger.ts`), by name, not just the highest number: numbers
  arrive out of order across branches, and each migration is applied to
  production with its ledger row before its branch merges. Verified on 25
  October with a read-only `select name from _migrations`: 31 rows, 0001–0019
  and 0021–0032, each recorded with its `.sql`; there is no 0020 file or row.
- **Server errors are counted** in `app_errors` (0036) by
  `apps/web/instrumentation.ts`: route pattern, digest, hour and count,
  nothing about the request. Kept 30 days; job runs 90. A route handler's or
  a server action's error is written before its response goes. A page's
  render error is not awaited by Next.js, so its write is handed to the
  platform's `waitUntil` to finish after the response. **Not verified in
  production:** that Vercel keeps those writes; until it has been seen, a
  page's errors may be counted less often than they happen. Locally
  (`next start`) a deliberate route error is counted, which
  `apps/web/test/monitoring.test.mjs` checks against a test build.
- `/api/health` is cached by the CDN for 30 seconds when it is a public 200,
  and never when it is not, or when the request carries an Authorization
  header. The schema checks and the Storage probe are also kept for 30
  seconds by each server instance, so a request that misses the CDN (a query
  string, an Authorization header) costs a few queries rather than thirty.

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

Verified through the Management API and over HTTP, 30 September, 22:45 (and
0030–0031 at 23:40). The ledger holds 30 rows, through 0031;
`reports_public` has **46,336** records; `taxon_precision_floors` has 86
rows; and, after the blur decision below, **no** record with a species is
shown more exactly than its species' rule or its binomial's allows (0 rows),
no public report without a species is exact (0), and no record of an unrated
invasive species is still blurred (0).

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
- A crawl of every non-species sitemap URL, 61 species pages and 36 record
  pages found no server error but the one described under 0031 below.

**Not deployed: the ML service's fixes (#123).** `modal deploy` stopped at
Modal's payment check. The live service is still v2 of 5 August, and it works
(it classified the two reports above, and answers `/api/identify`). Until the
owner adds a payment method (owner-setup §4), a request without the token
still starts a GPU, and the service still fetches an `imageUrl`.

**0030 (the forum's votes, #132) is applied**, with the forum still off.
Checked after: `forum_votes` has row-level security on and no policy, and
`anon`, `authenticated` and `web_anon` cannot read it.

**0031 (#136) is applied: the binomial index serves every session.** A crawl
of production after the deploys found the first view of the newest public
report answering 500 after 8.9 s, and both public reports' pages taking 1.8 s
warm, against 0.45 s for an imported record.
- The cause: Postgres inlines `binomial_of()` only for a role that may execute
  it, index expressions included, and caches the result for the session.
  `web_anon` may not (0024). So in a session where a public read planned a
  query on `taxa` first, 0028's index went unused, and the suggestions check
  read all of `taxa` per candidate (1,158 ms; 16 ms with the owner first).
- 0031 rebuilds the index on the expression itself. After it, both public
  reports' pages answer in 0.45–0.7 s warm; a cold first view came back in 4.2
  s, not 500.
- #136 also makes the page's optional reads unable to fail it.

**Every page now carries only the messages its browser code reads (#133)**:
the roadkill report page's HTML fell from 35 KB to 21 KB compressed.

**English names rebuilt (#137) and applied**, 30 September, after the
sources were reachable again. The import's own SQL was run through the
Management API from `resolveNames(file, overrides)`, dry-run first:
- 0 unknown taxa, 106 rows changed, and 9 retired taxa cleared;
- 2,574 taxa are named;
- no recorded species' displayed name changed;
- 7,253 blurred records before and after.

Three overrides keep names that TaiCOL's refresh would otherwise have
blanked or moved: 紅嘴黑鵯 Black Bulbul, 灰喉山椒鳥 Gray-chinned Minivet and
東方金腰燕 Striated Swallow. Vercel skipped the deploy for #137 ("not
affected"), so prerendered pages took the new alternates with the next deploy.

**From this machine:** for some hours on 29–30 September the network's DNS
answered every `*.vercel.app` name with a local address. GitHub's deployment
records showed production healthy throughout, and it cleared by itself.

## Changed on 22–25 October 2026

Verified from this machine on **25 October 2026**. The network filter let the
new domain through that day.

**The site moved to https://formosawatch.biowatchitnl.org** (#155).
- The apex and `www` answer 307 to it.
- `NEXT_PUBLIC_SITE_URL` and Supabase's `site_url` name it.
- The canonical link, `sitemap.xml` (3,596 URLs) and `robots.txt` all name the
  new host.
- **The old host redirects.** Page `GET`/`HEAD` requests to
  `https://preservation-web-one.vercel.app` answer 308 to the same path and
  query on the new host. Checked: `/`, `/species?filter=protected` and
  `/en/about`.
- These requests are let through on the old host and do not redirect:
  - anything that is not a page `GET`/`HEAD`, so a queued report still posts;
  - same-origin fetches;
  - requests carrying `x-unsent-reports: 1`. The service worker adds that
    header only while reports are waiting to be sent.
- `/api/health` on the old host still answers 200.
- **Turnstile** works on the new host now that `biowatchitnl.org` is one of the
  widget's hostnames, which also covers subdomains. Error 110200 went away by
  itself once the change propagated.
  `preservation-web-one.vercel.app` stays in the list for the queued reports
  above.
- The share image loads directly: `og:image` on `/` is a 200 `image/png`.
- `node scripts/verify-deploy.mjs https://formosawatch.biowatchitnl.org`:
  26/26.

**Two more retired-name twins floored (0032, #141)**, applied 22 October
with a ledger row:
- t0029845 韋氏水蛇 *Hypsiscopus wettsteini* is now `suppressed`;
- t0101559 科勒氏鰍鮀 is now `coarse_10km`.

TaiCOL's refresh had moved these records to a new id that had no floor. The
dry run changed 29 rows, all of them tightened and none loosened. Afterwards
the snake has 0 public rows and there are 88 floors.

**The team's two 30 September test reports are marked `is_test`**, so they
are out of every public view. The update was guarded to exactly 2 rows. They
are the only non-GBIF reports in production, and both are anonymous.

**Dependencies (#142, #156).**
- Next 16.4.3, React 19.3.1 and zod 4.6.7; `npm audit` reports 0
  vulnerabilities.
- The ML service's Python requirements are pinned. The classifier is **not
  redeployed**, so the live one is still v2 (5 August).
- Dependabot opens one weekly pull request of npm minor and patch updates and
  ignores npm majors. All the Actions updates come in one monthly pull request.
  It opens no routine pip pull requests: the classifier's thresholds were
  measured with its pinned versions, and a bump also needs a paid GPU deploy.

**Retired TaiCOL rows now carry their successor's id (0034)**, applied 25
October with a ledger row.
- `taxa.new_taicol_id` was added.
- The fill from the 29 September snapshot set it on 2,352 retired rows. A dry
  run of the fill moved no record, though `taxa_reblur_reports` fires on taxa
  updates.
- 15 plants got coarse_10km floors, so there are now 103 floors. None of the
  plants has a record, and the dry run changed 0 records.
- `npx tsx scripts/retired-twins.ts --sql`, run through the Management API
  afterwards, lists nothing. No name in use is blurred less than a retired
  row it replaced, now matched by id as well as by name.

**TaiRON's 13 hoopoe records moved to the species 戴勝 (0037, #159)**, applied
25 October with a ledger row. All 13 are still exact, and the public total did
not change.

**Counts on 25 October:**
- 46,305 public records, 0 of them from users;
- 0 accounts, so 0 moderators;
- ledger through `0032_floor_renamed_retired_twins.sql`.

## Known outstanding, on the credential holder

- The legacy HS256 JWT signing key is `previously_used`, which still **verifies**.
  Retiring it needs the app moved to `sb_publishable_` / `sb_secret_` first.
- **A custom SMTP provider.** Unlocks public sign-in, the email-code template
  and a sane rate limit. Needs a sending domain, which `biowatchitnl.org` can
  now be (docs/owner-setup.md, step 1).
- The parent site has no deployment: the Vercel project
  `apps/biowatch/.vercel/project.json` points at does not exist — the team has
  exactly one project, `conservation-web` — and `biowatchitnl.org` itself only
  redirects to FormosaWatch. So the parent site is finished code with no
  deployment target.
- Production SMTP for magic-link sign-in is not configured anywhere in the repo;
  `supabase/config.toml` covers localhost only.
