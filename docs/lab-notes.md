# The design lab: what it is, what it cost, and what it cannot tell you

One page, written for the person who has to choose. The lab itself is at
`/lab`; this is the part that does not belong on screen.

Measured 18 September 2026 against the dev server on this machine, with
`e2e/lab/checks.mjs`, `e2e/lab/fonts.mjs`, `e2e/lab/budgets.mjs` and
`e2e/lab/shots.mjs`. Every figure below is reproducible by running those four.

---

## What exists

A gated, noindexed route tree at `/lab`, in two looks, in two languages, on
real records. `labEnabled()` is `VERCEL_ENV !== "production" || LAB_ENABLED === "1"`,
the outer layout `notFound()`s when that is false, and every page under it
inherits `robots: { index: false, follow: false }`.

| | Roundel | Field journal |
|---|---|---|
| Home | built | built |
| Map | built | not built |
| Report, one question at a time | built | not built |
| Report, photo first | built | not built |
| Species detail (5 cases) | built | not built |
| Component specimen | built | built |

Underneath: seventeen primitives, five pieces of chrome, three plain-CSS theme
files, two committed font families in three `unicode-range` cuts each, a
basemap repaint, a shared report-flow state machine with the category
derivation, a locale-parity copy file, 42 unit tests and five Playwright
scripts.

A direction is a CSS file and a basemap scheme, not a second codebase. The same
components render under both; swapping `roundel` for `journal` in a URL changes
the whole page. That is why the losing direction costs a file to delete rather
than a rebuild, and it is enforced: a test fails if any component in
`components/lab`, `lib/lab` or `app/[locale]/lab` contains a hex or a raw
palette name.

## What was cut, and why

**Field journal is home only.** Home is the page that has been rejected twice,
so it is the page that settles taste. The other three pages in that direction
are about five more days, and the answer to home makes them unnecessary either
way — if it wins they get built properly, if it loses they were never needed.

**There is no Field journal map.** A journal map is a light survey sheet with a
drawn coast and a mainland mask: a different basemap scheme nobody has looked
at, not this one in other colours. `/lab/journal/map` is a 404 rather than a
themeless page.

**Whole-page screenshots are desktop only, and only for three rows.** Shooting
every route at both widths as both a fold and a whole page is 146 files and
11 MB against the 5 MB this directory was allowed. A phone's whole page is
10,000px of a 780px column, and scrolling that image is strictly worse than
tapping the link beside it. `FULL=all node apps/web/e2e/lab/shots.mjs` still
takes the lot.

**Nothing is submitted, ever.** A test greps the whole lab for `POST`, `PUT`,
`PATCH` and `DELETE` and fails on any of them. These prototypes are shown on a
phone against the real database, and a proof that writes rows is a proof
somebody has to clean up after.

## The numbers

### Type and colour, measured on the rendered page

`node apps/web/e2e/lab/checks.mjs` — 16 routes × 2 locales × 4 widths.

| | |
|---|---|
| Route/width pairs checked | 128 |
| Text nodes measured | 9,710 |
| axe violations | **0** |
| Text under 14px | **0** (plus 136 status glyphs and 64 MapLibre attribution nodes, both exempt and both counted in the output) |
| Horizontal overflow at 320, 360, 390 | **none** |
| Contrast floor across the whole lab | **4.91:1** — the 12px endemic ● on paper |

Contrast is composited rather than looked up: an opaque white base, every
ancestor's background in painting order, then any inherited opacity folded into
the text colour. Colours are resolved by painting one pixel, because the lab
draws its quiet rules with `color-mix()`.

320px is not a phone anybody sells. It is what a 390px phone becomes when its
owner turns larger text on.

### Density ramps

Computed from the theme files (`test/lab.test.mjs` asserts the floors).

| | class 1 | 2 | 3 | 4 | 5 | 6 | neighbours |
|---|---|---|---|---|---|---|---|
| Roundel, on forest land | 3.36 | 4.39 | 5.80 | 7.60 | 9.92 | 13.07 | 1.31–1.32 |
| Field journal, on paper land | 3.06 | 4.24 | 5.94 | 8.20 | 11.44 | 15.91 | 1.38–1.40 |

Both clear 3:1 by fill at the lowest class and stay lightness-monotonic, so six
classes are tellable apart in order. **In direct sunlight the dark map's lowest
class falls to about 1.22:1, against about 1.7:1 on a light one.** That is the
recorded price of keeping the map dark and it is the one criterion the
recommended direction can fail.

### Font bytes

`node apps/web/e2e/lab/fonts.mjs`. Committed, not built on Vercel.

| File | Size | When |
|---|---|---|
| `sign-home.woff2` | 36.6 KB | preloaded, Roundel home only |
| `ming-home.woff2` | 51.3 KB | preloaded, Field journal home only |
| `sign-ui.woff2` | 146.0 KB | lazy |
| `ming-ui.woff2` | 202.0 KB | lazy |
| `sign-names.woff2` | 3.1 KB | lazy, species and place names |
| `ming-names.woff2` | 4.1 KB | lazy |

Both home preloads are inside direction.md's 60 KB. **Both map routes fetch
zero font files**, at both widths, in both locales, and the script fails if that
changes. A species name holding any character outside the published charset
(865 characters) is set wholly in the system face rather than mixing.

The compare page's own copy pulled 63 Hanzi into the catalogue and so into the
lazy `ui` faces — 12 KB on `sign-ui`, 17 KB on `ming-ui` — although that page is
set in the system stack and will never fetch them. The subsetter reads the whole
copy file and cannot know which strings reach a heading. Not worth fixing for a
face nobody preloads.

### Map requests

`node apps/web/e2e/lab/budgets.mjs`, first view, same dev server.

| | 1440×900 | 390×844 |
|---|---|---|
| `/lab/roundel/map` | **4** `/api/tiles` | **2** |
| `/map` (today) | 6 | 2 |

Same style URL, same sprite, same glyph endpoint, same `/api/tiles` URLs, no
new kind of request. The desktop figure is under today's because the panel is
docked and takes its 320px out of the layout, so the fit lands one zoom level
lower; today's weights its padding 42% to the right to clear a floating panel
and reaches a tile column of open sea.

**First-tile TIME has not been measured.** It needs production, `LAB_ENABLED=1`,
and a median of five runs at 390 on throttled 4G against `/map` on the same
deployment. Nothing in this document claims it is unchanged.

### Committed weight

92 screenshots, 4.57 MB (80 folds, 12 whole-page). Emblem 319 KB. Fonts 443 KB.
A test fails if the screenshots pass 5 MB.

## What the prototypes fake

- **Nothing is submitted.** Send shows the receipt the outcome table computes.
  All three endings are reachable by link (`?receipt=published|held|queued`).
- **Everything else is real.** The photo pipeline (`preparePhoto`), the
  geolocation hook, `/api/species/search`, the tiles, the records, the map and
  the picker are the live ones. Reads go through `asPublic()` / `reports_public`
  and the public tile endpoints only, so blurring is inherited, and no
  report's coordinate is printed anywhere — not in a list, not on a summary
  screen, not in a record panel. The only lat/lng in the lab is the map view a
  named place link opens at.
- **The emblem is wrong and is shown anyway.** `public/lab/emblem-1040.png` is
  the existing 512px file resampled once. It is soft at hero size and still
  letters the retired name PROJECT ECOWATCH. Shown at the size the design calls
  for, with a sentence on `/lab` saying so.
- **The injured-wildlife notice says "wording pending".** Which agency, which
  number, in whose words — that is the owner's to give and it blocks shipping.
- **All new copy is a first draft.** 277 strings per language in
  `lib/lab/copy.ts`, none of it read by a native zh-TW speaker.
- **The screenshots hide the lab's own compare strip.** It is scaffolding, it is
  deliberately unthemed, and at 390 it eats 240px of an 844px fold that no live
  page pays — so including it would charge it to two of the three columns. It is
  still there when you open the route.
- **`public/lab/shots/` is served statically**, so the screenshots are
  fetchable in production even while `/lab` itself is a 404. They contain public
  records only and no coordinates, but they are pictures of unreleased designs.

## Seven defects this found and fixed in the lab

Each one fails silently and each would have been found by the owner:

1. The live `LanguageSwitcher`'s `/` separator is `opacity-40` — 3.3:1 on the
   forest band. The lab had already raised the inactive locale's button and
   missed the punctuation beside it.
2. The compare strip was a `<div>`, so its links sat outside every landmark:
   six axe nodes on every route.
3. The derivation panel is a `<section>` with no accessible name, which is not
   a landmark. Six more, on all four report routes.
4. The receipt replaces the whole flow, `<main>` included, so the last screen a
   reporter sees had no main landmark at all.
5. The map page had no `h1`; direction.md deletes the header stats that were
   standing in for one.
6. "FormosaWatch" at the journal's 48px masthead, and *Cuora flavomarginata* at
   the withheld species page's `h1`, are each wider than a 320px screen.
7. MapLibre's cooperative-gesture overlay sits in the DOM at opacity 0 and
   reported a 1.00:1 contrast floor on every page with an embedded map.

## What only a person can answer

Four of direction.md's seven "must show" criteria were measured. Three were not,
and no amount of scripting will change that:

- **Identity.** Three zh-TW readers shown home cold, not told what it is, not
  asked a leading question. Nobody has been shown it.
- **Surfaces.** Whether forest and cream look muddy together, and whether one
  tinted band is enough hierarchy for the journal. Every pairing clears
  contrast; muddy is not a contrast problem.
- **Outdoors at midday, on your own phone.** The lowest density class on the
  dark map, at z11, in sun. This is the one that can sink the recommendation.

Also not covered by any script here: keyboard completion of both report flows
was verified before the receipt screens changed and needs re-running; CLS has
not been measured; and no prototype has been in front of a roadside tester.

## Questions the owner has to answer

**Blocking the decision**

1. **Which direction** — Roundel, Field journal, or neither, and why.
2. **Which report flow** — one question at a time, or everything down one page
   after the photo. The logic underneath is identical; only the screen differs.

**Blocking showing it to anyone else**

3. **Set `LAB_ENABLED=1` in Vercel production and redeploy.** Previews sit
   behind Vercel SSO, so cold readers and roadside testers cannot open them and
   no script can measure first-tile time. Without this, the lab is dev-only.
4. **The injured-wildlife wording**: which agency, which number, in whose words.
5. **A native zh-TW read** of `lib/lab/copy.ts` before anybody outside the team
   sees these pages.

**Consequences of choosing Field journal**

6. Its map is light, which reverses the recorded dark-map decision. Choosing it
   approves the reversal.

**Can wait, but not forever**

7. **The emblem**: ship the enlarged old-name badge now, or hold the redesign
   for the redraw. The redraw is on the critical path for the announcement and
   the custom domain either way.
8. **One report action in place of three category doors** on home, the phone tab
   bar, the map's header stats removed, and leave to rewrite the pinned tests
   (`home.test.mjs`, the `pages.spec.mjs` doors, `report-form.test.mjs` class
   pins, `map-bins.test.mjs` colours) as intent rather than as class strings.

## Running it

A dev server must be up (`npm run dev` at the repo root). Never delete
`apps/web/.next` under a running server.

```
node apps/web/e2e/lab/checks.mjs     # axe, type size, overflow, contrast — exits 1 on any failure
node apps/web/e2e/lab/fonts.mjs      # font files and bytes per route
node apps/web/e2e/lab/budgets.mjs    # tile requests and request kinds
node apps/web/e2e/lab/shots.mjs      # re-take the screenshot matrix
node --test apps/web/test/lab.test.mjs
```

Playwright sends no `Accept-Language`, so an unprefixed path renders zh-TW.
Every script lists `/en/…` explicitly. Maps are shot headless, never from an
in-app browser pane: a suspended `requestAnimationFrame` yields a healthy
basemap over a permanently empty data layer, with no error anywhere.

## Afterwards

Once a direction wins: record it in `docs/design-decision.md`, delete the
loser's theme, fonts and basemap scheme, and tag `lab-decision-<date>`. Once
W4–W7 have shipped the real pages, `git rm -r` the four lab directories, the
four `e2e/lab` scripts, `test/lab.test.mjs` and `public/lab`, and unset the
flag. Deleting the lab deletes its copy with it — which is why none of it was
ever put in `messages/*.json`.
