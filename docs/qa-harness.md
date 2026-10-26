# The QA harness

Every page of this site is about to be rebuilt. Without a net, each rebuild is
verified by somebody squinting at it, and the things that break quietly —
a contrast regression, a 320px overflow, a page that lost its heading structure,
a map that got slower — break quietly. This is the net. It went in before any
design decision landed, on purpose: a "before" you take after the change is not
a before.

It replaces five hand-copied lists of pages with one, and two useful scripts
nobody ran with checks that fail.

## What runs, and when

| Check | Command | Runs |
|---|---|---|
| The audits still find what they are for | `npm run test:selftest -w @conservation/web` | every PR |
| No page scrolls sideways at 320/390 | `npm run test:reflow -w @conservation/web` | every PR |
| The map's load path, and its JS budget | `npm run test:perf -w @conservation/web` | every PR |
| The map actually paints | `npm run test:map` | every PR (it can now fail) |
| Route table, namespaces, known-issue shape | `npm test` | every PR, and no test may skip |
| The report form submitted, and the card it leaves | `npm run test:receipt -w @conservation/web` | every PR |
| A phone photo through the form: no metadata uploaded, place and time from the photo, suggestions, filed for real | `npm run test:photo -w @conservation/web` | every PR |
| axe on `/report`, its three pages and `/map`, 390 | `ONLY=… WIDTHS=390 npm run test:a11y -w @conservation/web` | every PR |
| WCAG AA contrast on the same five, 390 | `ONLY=… WIDTHS=390 npm run test:contrast -w @conservation/web` | every PR |
| Screenshot matrix + gallery | `npm run shots` | nightly + `gh workflow run gallery.yml` |
| axe, every route, 390 and 1440 | `npm run test:a11y -w @conservation/web` | nightly, and a finding fails it |
| WCAG AA contrast, every route | `npm run test:contrast -w @conservation/web` | nightly, and a finding fails it |
| No high or critical advisory in what ships | `npm audit --omit=dev --audit-level=high` | every PR, its own job |

Everything needs a server on `TEST_BASE_URL` (default `http://localhost:3000`)
except the self-test, which serves its own fixture. Build with
`NEXT_PUBLIC_E2E=1` — see "The build these run against" below.

**The audit job is green at merge, and goes red with the next advisory.** It
reads `package-lock.json` and the registry, nothing else, so it needs no
install and does not hold up the suite beside it. On 25 October 2026, before
#142, the lock file had `next` 16.3.7 (two critical remote code executions and
a high denial of service among its advisories), `zod` 4.4.3 and
`source-map-js` 1.2.1, and the command exited 1. #142 moved main to `next`
16.4.3, `zod` 4.6.7 and `source-map-js` 1.2.2, and against main's lock file
the same command reports 0 vulnerabilities and exits 0. A pull request's CI
runs on its merge with main, so the job starts green; from then on a new high
or critical advisory in a production dependency turns every run red until it
is bumped.

**Why the gallery is not on every push.** It is about a hundred page loads,
four minutes of browser time and 40 MB of PNGs. A reviewer looks at it when a
page is rebuilt, not forty times a day, and a four-minute step on every push is
how a team learns to skip CI. Nightly keeps it honest; `workflow_dispatch` is
how you take a "before" deliberately, which is the use that matters.

**axe and contrast: five pages per PR, every page nightly.** Both ratchet
against a written list of known issues, `e2e/a11y-known.json` and
`e2e/contrast-known.json`. Both shipped empty, because the harness was written
without a server to record them from, and ran nightly with `continue-on-error`
so that a red first run of one could not stop the other recording its list.
Neither has found anything since: all 35 nightly runs from 20 September to 24
October 2026 reported no new axe violation and no contrast failure, over every
route (27, then 41), both locales, 390 and 1440. The empty files are the
baseline, so `continue-on-error` is gone and a finding fails the nightly run.

Per pull request, `ci.yml` runs both on the pages a reporter fills in with one
thumb: the `/report` chooser, `/report/roadkill`, `/report/invasive`,
`/report/wildlife` and `/map`, in both languages at 390px. Ten page loads
each, against 164 for the full sweep. `ONLY` and `WIDTHS` choose the
slice, and both are read strictly: a name in `ONLY` that matches no route, or
that the check would skip (a new `skipAxe`, a parameterised route that resolved
no id), is an error, not an empty pass, so the slice cannot go quiet when a
route is renamed or excused. `test/ci-gates.test.mjs` holds the slice `ci.yml`
names to the same rule without a browser.
`UPDATE_*` refuses a slice, because a list recorded from one would drop every
line it did not visit.

```
UPDATE_A11Y=1     npm run test:a11y     -w @conservation/web
UPDATE_CONTRAST=1 npm run test:contrast -w @conservation/web
```

A recorded line with no reason is a threshold wearing a costume; `npm test`
fails if a `known` entry has no `why`, and `UPDATE_*` writes
`RECORDED, NOT EXPLAINED` into every line it invents.

## The route table

`e2e/routes.mjs` is the one list. Sixteen page routes plus the 404, each with
the locale set, the widths, how long it needs to settle, whether MapLibre paints
on it, and — where a check skips it — the reason.

Register a new page **there**, once. `test/qa-harness.test.mjs` walks `app/` and
fails when a `page.tsx` has no row, so "we forgot to add it to the accessibility
list" cannot happen again. It happened to `/login`, which was in no list at all
and shipped an input with no label past a green CI.

`NAMESPACES` is derived from `messages/en.json` rather than typed out. The
hand-written array in `pages.spec.mjs` has 22 entries and the catalogue has 24,
so an untranslated `team.title` rendered as the literal string `team.title` on a
page the suite called clean.

Parameterised routes (`/reports/[id]`) are resolved at run time by reading the
id off the public list page. Not from the database: `/reports` is the public
view, so an id it links to is one a visitor may already see. `QA_REPORT_ID=…`
overrides it.

## Privacy

Non-negotiable, and it constrains this harness specifically:

- `/admin` is excluded from the screenshot matrix and the gallery, with the
  reason in its row. The moderation queue shows exact coordinates of reports
  that have not been published; a screenshot of it is a disclosure, and a
  gallery of them is a disclosure with a URL.
- Nothing here ever authenticates. `/me` and `/admin` are marked
  `signedOutOnly`, and signed out they hold no record at all.
- Public pages read `reports_public` through `asPublic()`, so every shot
  inherits the blurring. If a harness ever seems to need `reports`, the harness
  is wrong.
- `verify-deploy.mjs`'s 5-decimal `"lat"` scan stays exactly as it is.

## The build these run against

`window.__map` exists only under `NEXT_PUBLIC_E2E=1`. The screenshots and the
perf spec use it to wait for the map to have *painted* rather than to sleep at
it, so the build they photograph differs from production by that one guard. Say
it out loud rather than forget it: a production build deliberately exposes
nothing, and a shot taken without the guard falls back to a flat 15-second wait.

Never assert on a fixed sleep. Wait for `window.__map`, for its `idle` event,
and for a tile response. Sleeps are for screenshots.

Capture map screenshots with headless Playwright only. A hidden browser pane
suspends `requestAnimationFrame` and photographs a blank canvas that looks
exactly like a bug.

## The database CI tests against

A fresh `imresamu/postgis:17-3.5` cluster, which is not Supabase, made like it
in one respect on purpose. `supabase/ci-roles.sql` runs before the migrations
and creates `anon`, `authenticated` and `service_role`, and gives the first two
the default privileges production was created with: ALL, on whatever
`postgres` makes in `public`. 0013 and 0024 then revoke them the way they did
on production, and the tests can tell whether they did: built without those two
files, this database fails "anon is denied SELECT on reports", "no table grants
anything to anon or authenticated" and "anon and authenticated can execute none
of them". Until October 2026 those roles did not exist in CI, every migration
block guarded on them was skipped, and so were the thirty tests of what `anon`
and `authenticated` can reach: `reports` and its exact points, the public
views, the site's functions and every forum table. The `auth` schema is not
faked: the policies that call `auth.uid()` are guarded on the schema as well as
the role (0004), and stay untested here, as they always were.

Those defaults open every table made after them, so the file is for that empty
cluster and nothing else. It raises, and changes nothing, on a Supabase cluster
(the local stack, a scratch database inside it, a hosted project), on one that
already has the roles, and on one the migrations have touched. Run after the
migrations, nothing would take its grants back again. For the same reason it
grants nothing that no migration revokes: `service_role` is created and given
nothing (no migration names it and no test reads it), and USAGE on `public`
reaches the two roles through PUBLIC, as on every Postgres.

After the migrations, `supabase/ci-roles-check.sql` fails the run if any of the
three roles still holds a default, or a grant on a table, column or function in
`public`. One kind stays, and the file says why: EXECUTE on pg_trgm's functions,
because 0005 makes the extension after the defaults and 0024 leaves an
extension's own functions alone. PUBLIC can execute each of them anyway, and a
Supabase project grants the same. It also checks that USAGE still reaches the
roles, so that a test's "permission denied" is the table's and not the
schema's.

To try it on a laptop, give the migrations an empty cluster of their own:

```
docker run -d --name ci-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55432:5432 imresamu/postgis:17-3.5
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/ci-roles.sql
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/ci-roles-check.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed-test.sql
npm run import:names-en
```

To try it again, `docker rm -f ci-pg` and start over: a second run of
`ci-roles.sql` refuses. Not the local Supabase stack's database either: the
file refuses that too, and a recent Supabase CLI no longer grants the roles ALL
by default, so it could not show what 0013 had to undo.

Then the fixture, `supabase/seed-test.sql`: a slice of real TaiCOL and GBIF
rows, every blurred record at the centre of its blur cell. It also holds the
rows tests name by property: 蒼鷺, 紅耳泥龜 and 日本樹蛙, a species whose
binomial carries a stricter rule than its own (巨蚺, with its protected
subspecies), and one record GBIF could not name. The generator's `wanted` list
(`scripts/make-test-fixture.ts`) takes the same rows. They were appended to the
file rather than regenerated into it: `npm run make:fixture` against a local
database today replaces 591 of the 604 sampled records, because 0022 moved
records to Taiwan's names and the sample follows the taxa, and a fixture diff
nobody can review is not one to merge with the privacy tests resting on it.

## Skips are counted

A skipped test prints beside the passes and reads as one. Until October 2026
every CI run skipped 36: the thirty role checks above, and six that found
nothing in the fixture to test (the two heron searches, the red-eared slider,
日本樹蛙's review note, the binomial floor on a photo pick, and the heading of
a record with no species). The unit-test step in `ci.yml` now reads the
count off node's summary and fails when it is over `ALLOWED_SKIPS`, which is
**0**. Every skip condition in the suite is false in CI: the roles exist, the
Supabase Auth stand-in answers, the fixture holds every row a test names, and a
test that needs the server calls `requireServer(t)` (`test/helpers.mjs`), which
skips on a laptop with nothing listening and throws under CI.

### The stand-ins

CI has no Supabase and no GPU, so three small servers stand in for them, each
answering only what the app and the tests call, and each refusing to start for
an address that is not this machine:

- `test/stub-gotrue.mjs`, Supabase Auth, at `NEXT_PUBLIC_SUPABASE_URL`;
- `test/stub-storage.mjs`, the photo bucket, served by the Auth stand-in at
  `/storage/v1` as Supabase serves both from one address. It holds uploads to
  the limits migrations 0004 and 0038 set on the real bucket, read from
  `packages/shared`;
- `test/stub-ml.mjs`, the classifier, at `ML_ENDPOINT_URL`, with fixed
  candidates from the fixture for both of the model's contracts.

On a laptop the first two are the local Supabase stack. The third has no real
counterpart worth using: `.env` points `ML_ENDPOINT_URL` at production's GPU,
and the photo spec and the identify tests refuse to send it a photo. Start the
stand-in on a free port and give the server and the tests the same address:

```
ML_ENDPOINT_URL=http://127.0.0.1:54329/ ML_ENDPOINT_TOKEN=local-stub node apps/web/test/stub-ml.mjs &
ML_ENDPOINT_URL=http://127.0.0.1:54329/ ML_ENDPOINT_TOKEN=local-stub npx next start -p 3511   # in apps/web
ML_ENDPOINT_URL=http://127.0.0.1:54329/ TEST_BASE_URL=http://localhost:3511 node e2e/photo.spec.mjs
```

A test that has to skip in CI is listed here, with its reason, in the commit
that raises `ALLOWED_SKIPS`:

| Test | Why it may skip in CI |
|---|---|
| (none) | |

## Two things the brief had slightly wrong

- **`_shots.mjs` was not gitignored.** It was tracked; `.gitignore:32` ignored
  its *output directory*, `apps/web/e2e/shots/`, and the comment above that line
  named the script, which is probably what misread. The script is now
  `e2e/shots.mjs` and the output directory is still ignored.
- **`e2e/map-render.png` was not a baseline.** It was committed, 228 KB, and
  overwritten by `map.spec.mjs` on every single run with nothing comparing it
  to anything — six commits of binary churn in the history of a repository that
  otherwise reasons carefully about what it stores. It is now written to the
  same path, gitignored, and uploaded by the CI step that already existed. A
  screenshot nobody diffs is an artifact, not a baseline. If a real pixel
  baseline is wanted later, it belongs in the signed-off set under
  `docs/redesign/baseline/`, not in a path a script overwrites.

## Migrating `pages.spec.mjs`

`pages.spec.mjs` is the suite the page workstreams will fight, because a third
of it pins markup that is about to be replaced. The rule for every assertion in
it, in the brief's four categories:

**Keep as invariants.** These are promises to a reader, not to a composition,
and they must survive every rebuild:

- the page renders in both locales;
- no leaked i18n key, no `pageerror`, no console error, no 5xx;
- the three data layers exist on any page with a map;
- the "view as list" skip link precedes the canvas in tab order;
- every control has an accessible name;
- panning writes `lng`/`lat`/`z` by `replaceState` without growing history;
- the Chinese name is marked `lang="zh-TW"` inside an English `h1`;
- nothing scrolls sideways — now `reflow.spec.mjs`, over every route.

**Rewrite as intent.** The promise is real; the selector or the number is not:

| Today | Becomes |
|---|---|
| `main section img` is 320/272/172px wide at five viewports | the emblem is ≥70% of viewport width on a phone and ≥320px at 1440, found by hook |
| three `a[href*="/report?category="]` doors, above the fold | exactly one report action and one map action above the fold from 360px up, and home emits no `?category=` link |
| `[lang="zh-TW"] > span` halves do not wrap | the name never breaks mid-word |
| "home still requests /field.svg" | goes with the hero W4 replaces |

**Loosen, keeping the decision.** The decision was right; the mirror of it in
the test is what rots. `home.test.mjs` keeps "every linked taxon is
non-sensitive, non-protected and zh-named" and "every place link opens on a view
with public records", derived from the emitted HTML rather than from a mirrored
`MAP_PLACES` array and counts of 3 and 4. `report-form.test.mjs` reads
`aria-checked`/`aria-pressed` instead of `bg-ink-900 text-paper-50` and an `h3`
with a literal sentence in it. `coverage.test.mjs`, `species.test.mjs` and
`map-bins.test.mjs:58` assert the catalogue key and the hook, not the sentence,
the chip text or the order of an array.

**Delete.** Badge-width numbers, the `imageSizes` pin, door counts. They record
one afternoon's layout and nothing else.

The test that costs you a day is the one that fails for a reason that was never
the point. When you cannot decide, ask what a reader loses if the assertion
stops holding. If the answer is "nothing", delete it.

**This PR does not do that migration.** `pages.spec.mjs` and `focus.spec.mjs`
are edited by five other workstreams right now, and a refactor of them is a
merge conflict with every one. They move onto the route table after those land —
`checkWidths()` is already exported from `reflow.spec.mjs` for exactly that, so
the inline copy #48 added can be deleted rather than maintained twice.

## What is still owed

1. **Re-record the JavaScript budgets on main's dependencies.** The budgets
   in `e2e/perf-budget.json` were recorded on 25 October 2026 on a laptop,
   from a build made the way CI makes one (`NEXT_PUBLIC_E2E=1`, the fixture
   database, no MapTiler key, `next start`) with `UPDATE_PERF=1
   PERF_LABEL=ci`, from the tree before #142: `next` 16.3.7, `react` 19.2.8.
   `/map` and `/en/map` 1074 KB, `/` 177, `/species` 171, `/report/roadkill`
   1499. CI fails at 10% over them. #142 has since moved main to `next`
   16.4.3 and `react` 19.3.1, and main's CI on that day (run 40187309906,
   Linux) measured `/map` and `/en/map` at 1041 KB, `/` at 177 and
   `/species` at 171. So the map's gate is about 3% looser than it reads,
   allowing some 13% growth instead of 10%, until the numbers are recorded
   again from the merged tree; `/report/roadkill` has not been measured on
   main's dependencies or on Linux at all. The first CI run after merging
   prints all five. The timings recorded beside the bytes are one laptop's,
   and print without failing.
2. **Read the performance numbers off production.** Production compresses
   differently from `next start`, so its numbers are read with a plain run,
   `TEST_BASE_URL=https://… npm run test:perf -w @conservation/web`, and not
   recorded over CI's.
3. **`test:receipt` in `test:e2e`.** CI runs the receipt spec as its own step;
   the `test:e2e` script in `apps/web/package.json` does not list it yet.
4. **Decide the hooks** — `docs/test-hooks.md`. Every later workstream adopts
   them, so it wants settling before W2.
5. **`pages.spec.mjs` / `focus.spec.mjs` onto the route table**, after the open
   branches merge. `focus.spec.mjs` still covers 7 paths at one width.
6. **The `<meta name="build">` marker** in `verify-deploy.mjs`, which waits on
   W2/W3 as the brief has it.
