# What to improve next

Written after the rename to HabitatWatch (since renamed again, to
FormosaWatch), then worked through. Ordered by what
it costs the project to leave alone.

**Status: Tier 1 and most of Tiers 2 and 3 are done.** What remains needs a
person, not a commit — see "Still open" at the bottom.

Two items were guesses that measurement disproved, and both are recorded here
rather than quietly dropped, because the guesses were the kind worth not making
again:

- *"Keyboard access is probably poor"*, inferred from five focus declarations in
  the codebase. Wrong. Nothing had ever written `outline: none` for looks, so
  the browser default was doing the work — 388 focusable controls across seven
  pages, and exactly two problems. There is a check for it now.
- *"The badge ships on every page at 60 KB"*. Wrong. `next/image` already
  serves 2.6 KB of WebP for the 32px header badge and 20.8 KB for the 112px one.
  The 60 KB is the source file, which no browser ever receives.

---

## Tier 1 — things that lose reports

The site exists to collect observations. These are the places a person who
wanted to file one doesn't.

### 1.1 There are no loading states anywhere

**DONE.**

**Verified: zero `loading.tsx` files in the app.**

Every navigation to a database-backed page shows the previous page, frozen,
until the server responds. On the map that is measured in seconds — the e2e spec
waits 6 000 ms for a paint, and the page spec waits 9 000. On a phone on
mountain 4G, which is the actual context this project is used in, a frozen
screen is indistinguishable from a broken one, and the person taps back.

Add `loading.tsx` for `/map`, `/species`, `/species/[id]`, `/stats` and
`/reports`. Skeletons that match the real layout, not spinners.

**Effort:** small. **Impact:** high, and it compounds on bad connections.

### 1.2 The submission form has not been reviewed since the theme changed

**DONE.** It was hiding a selected chip set in black on near-black, ratio 1.06, and a submit button that gave no reason for being disabled.

`/report` is the one page whose job is the whole point, and it was last looked
at properly under the dark theme. It has since been through a palette migration,
a light-theme conversion, a warning-colour retint and the Turnstile widget being
added below the submit button.

Render it at 390 px and 1180 px and go through it as a person would, one-handed.
Specifically check: the category chips wrap sanely, the map picker is reachable
without scrolling past it, the Turnstile challenge does not push the submit
button below the fold, and every error message is legible on paper.

**Effort:** small. **Impact:** high — this is the funnel.

### 1.3 Nobody can see their own reports

**DONE.** `/me`.

**Verified: there is no per-user view.** You can sign in, and signing in does
nothing you can see.

For citizen science this is the strongest retention mechanic there is: people
contribute again when they can watch their own contributions accumulate and get
identified. A `/me` page listing your reports with their status — pending,
identified, published — and the AI's guess where there is one.

**Effort:** medium. **Impact:** high, and it is the difference between a
one-time reporter and a regular one.

---

## Tier 2 — things that lose trust

### 2.1 The contact details are still placeholders

`/privacy` and `/about` name no one. Taiwan's 個資法 gives people the right to
have their data removed, and location plus optional email is personal data. A
removal right with no route to exercise it is not a right.

This has been an open launch blocker for a while. It needs an address, not code.

**Effort:** none, for anyone but me. **Impact:** legal.

### 2.2 The reports list is the least persuasive view of the data

**DONE**, conditionally — the column only appears when a visible row has a photograph, which today is none of them.

**Verified: it renders no photographs** — the detail page shows them, the list
does not. It is a table of dates, category words and coordinates.

Every row is someone who stopped at a roadside and photographed a dead animal.
Presented as a spreadsheet, that reads as a database export; presented with
thumbnails it reads as evidence. This is the page most likely to convince a
stranger the project is real.

**Effort:** medium — photos are in private storage and need signed URLs, and
sensitive-species rows must stay coarse. **Impact:** high on credibility.

### 2.3 The badge disagrees with the name

The artwork letters PROJECT ECOWATCH around its ring. Every piece of text now
says FormosaWatch. Shipped deliberately, but it is the first thing a careful
visitor notices, and it undercuts a project whose whole pitch is carefulness.

Needs re-lettering by whoever drew it. When the new art lands it goes in five
places: `public/brand-badge.png`, `app/icon.png`, `app/apple-icon.png`, and both
Open Graph routes read the first of those.

**Effort:** none, for me. **Impact:** medium, and rising the longer it sits.

---

## Tier 3 — quality

### 3.1 Keyboard access is probably poor

**DONE, and the premise was wrong.** See the note at the top. `npm run test:focus`, in CI.

**Verified: five `focus-visible` / `focus:` declarations in the entire app.**

There is a contrast audit that runs on every change and passes at both widths.
There is no equivalent for keyboard navigation, so nothing would catch a focus
ring that vanished. The map is a canvas and is already unusable with a screen
reader — the reports list is its stated alternative, which raises rather than
lowers the bar for that page working without a mouse.

Add a spec that tabs through each page and asserts every interactive element
takes focus with a visible ring.

**Effort:** medium. **Impact:** correctness, and it is the kind of thing that is
much cheaper to fix now than after a redesign.

### 3.2 The badge ships on every page at 60 KB

**NOT A PROBLEM.** Measured: 2.6 KB served for the header badge.

Small, but it is in the header of every route, and this audience is on mobile
data. A 32 px `srcSet` variant would cut it by most of that. Measure before
bothering — it may already be cached effectively.

### 3.3 Thin species pages

**DONE.** 124,980 pages with no records are `noindex, follow`, still reachable.

400 are prerendered by record count; roughly 65 850 taxa have no records at all.
The directory sensibly defaults to "recorded", but the pages still exist and are
indexable, and a search engine that finds several thousand near-empty pages
forms a view about the site as a whole. Consider `noindex` below a record
threshold.

### 3.4 The statistics are honest but fixed

`/stats` presents totals, seasonality, top species and hotspots, with no way to
slice by year or county. The tile endpoint already supports date filtering, so
the data layer is there.

---

## Suspected — now checked

All rendered and reviewed once the database came back.

- `/species/[id]`, a filtered reports list and an empty species search: all fine.
- Four inner pages at 390px: no horizontal overflow, correctly proportioned.
- **One real find:** the 404. `app/[locale]/not-found.tsx` only covers paths that
  already resolved into the locale segment, so a mistyped top-level URL — which
  is most real 404s — fell through to Next's built-in page: unstyled, unbranded,
  English, on a site whose audience is Taiwanese. Fixed with
  `app/global-not-found.tsx`, the case the Next docs name for a root layout
  under a dynamic segment.

## Still open — these need a person

- ~~**Contact details.**~~ **DONE** — neolava2@gmail.com on `/privacy`,
  `/about` and in the footer. Still worth replacing with a project address
  rather than a personal one: it is published on a public page and will be
  scraped, and it ties the project's data-controller contact to one individual's
  inbox.
- **The badge.** Its ring still letters PROJECT ECOWATCH. Every piece of text on
  the site says FormosaWatch. It needs re-lettering by whoever drew it; when the
  art lands it goes into `public/brand-badge.png`, `app/icon.png` and
  `app/apple-icon.png`, and both Open Graph routes pick it up from the first.
- ~~**The Chinese name.**~~ **DONE** — 福爾摩沙守望計畫, after the second rename.
  福爾摩沙 is the island's old name, naturalised in Taiwan; 守望 carries over from
  both earlier names and from the badge lettering, so the two halves stay
  parallel. A place name also cannot drift out of step with the scope the way
  生態 and 棲地 both did.
- **3.4, statistics slicing** — no way to filter by year or county. The tile
  endpoint already supports date ranges, so the data layer exists. Worth doing
  once there is more than one year of user-contributed data to slice.

---

## The team's backlog

Five areas requested in September 2026 — home page, report form, at-submission
AI, offline capture, map and team page — are planned in
[backlog-plan.md](backlog-plan.md), together with the decisions already taken and
what is still blocked on the group.

---

## The game-layer proposal

Assessed separately in [plan-game-layer.md](plan-game-layer.md), which also
records the three live defects that audit turned up and that are now fixed.
Phases 2 and 3 there are gated on the site having at least one user-submitted
report; today it has none, in any category.

---

## Deliberately not proposed

- **A redesign.** The structure works and was arrived at by iteration; the gaps
  above are specific and cheap. Another pass over the landing page would be
  motion, not progress.
- **More map modes.** Three is already at the limit of what a toggle should
  carry.
- **Anything about FireWatch or the parent site.** Separate deployments, and now
  someone else's remit.
