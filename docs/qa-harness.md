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
| The map's load path | `npm run test:perf -w @conservation/web` | every PR |
| The map actually paints | `npm run test:map` | every PR (it can now fail) |
| Route table, namespaces, known-issue shape | `npm test` | every PR |
| Screenshot matrix + gallery | `npm run shots` | nightly + `gh workflow run gallery.yml` |
| axe | `npm run test:a11y -w @conservation/web` | nightly, until its baseline is recorded |
| WCAG AA contrast | `npm run test:contrast -w @conservation/web` | nightly, until its baseline is recorded |

Everything needs a server on `TEST_BASE_URL` (default `http://localhost:3000`)
except the self-test, which serves its own fixture. Build with
`NEXT_PUBLIC_E2E=1` — see "The build these run against" below.

**Why the gallery is not on every push.** It is about a hundred page loads,
four minutes of browser time and 40 MB of PNGs. A reviewer looks at it when a
page is rebuilt, not forty times a day, and a four-minute step on every push is
how a team learns to skip CI. Nightly keeps it honest; `workflow_dispatch` is
how you take a "before" deliberately, which is the use that matters.

**Why axe and contrast are nightly for now.** Both ratchet against a written
list of today's known issues — `e2e/a11y-known.json`, `e2e/contrast-known.json`
— and **neither list has ever been recorded**, because this harness was written
without a running server to record one from. They ship empty, which means the
first real run reports everything it finds as new. That is the correct first
run: it prints the list. Somebody then fixes what should be fixed, records the
rest with a reason, and moves the two steps from `gallery.yml` into `ci.yml`.
They are written to be moved, not rewritten.

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

1. **Record the two baselines.** One run each, against a server. Until then axe
   and contrast are nightly and red.
2. **Record the performance budget.** `e2e/perf-budget.json` ships every byte
   count and every millisecond as `null`, which prints and does not fail. A
   budget invented at a desk gets enforced for years as though somebody meant
   it. `UPDATE_PERF=1 PERF_LABEL=production TEST_BASE_URL=https://… npm run
   test:perf -w @conservation/web` is the number that matters; CI's is a
   broken-load-path detector.
3. **Decide the hooks** — `docs/test-hooks.md`. Every later workstream adopts
   them, so it wants settling before W2.
4. **`pages.spec.mjs` / `focus.spec.mjs` onto the route table**, after the open
   branches merge. `focus.spec.mjs` still covers 7 paths at one width.
5. **The `<meta name="build">` marker** in `verify-deploy.mjs`, which waits on
   W2/W3 as the brief has it.
