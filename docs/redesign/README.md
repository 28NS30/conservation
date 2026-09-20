# Redesign plan

Written 18 September 2026 against `c73bb8d`. Planning only: no site code has changed.

This folder is meant to be handed out. Each brief in `briefs/` is written for one engineer or
coding agent who has none of this context and will not read the rest of the folder. The three
documents worth reading in full before anything starts are this one, [direction.md](direction.md)
and [report-flow.md](report-flow.md).

## What this is answering

Two things arrived together: the team's `docs/website-design-review.docx` (17 September, an
outside critique) and the owner's own verdict — *"the design needs by far the most work … I
honestly dont really love the 'what did you see' and think that almost everything should be
redesigned."*

Both were taken at face value and then checked. The review's 29 code-pointed claims were each
verified against the source by an independent agent and then attacked by a second one trying to
refute it: **29 confirmed, 0 refuted**, four of them worse than the review said. The evidence for
each is in [verified-claims.json](verified-claims.json). Separately, every public page was
screenshotted from production at 1440px and 390px — 15 pages, with home, map, report and species
detail also captured in English — and judged as a rendered page, because the review's author says
plainly that they could not load the site and worked from code plus one screenshot.

So the aesthetic critique and the bug list are now on the same footing: both looked at.

## Status

The trust tier is built. It was written after this plan, from these briefs, and the pull requests are
the record of what actually shipped — including the places where a brief turned out to be wrong.

| | | |
|---|---|---|
| W0e | Blur records nobody has identified | [#44](https://github.com/28NS30/conservation/pull/44) |
| W0b | Map legend describes what the map draws | [#46](https://github.com/28NS30/conservation/pull/46) |
| W0c | Stop telling visitors untrue things | [#47](https://github.com/28NS30/conservation/pull/47) |
| W0d | Stop throwing away what the reader chose | [#48](https://github.com/28NS30/conservation/pull/48) |
| W0a | Tell the reporter what the server actually said | [#49](https://github.com/28NS30/conservation/pull/49) |
| — | All five merged and verified together | [#50](https://github.com/28NS30/conservation/pull/50) |

Then, also without a design decision:

| | | |
|---|---|---|
| W0c steps 7–9 | The GBIF taxon remap, cut from #47 | [#52](https://github.com/28NS30/conservation/pull/52) |
| W13 | The QA harness | [#53](https://github.com/28NS30/conservation/pull/53) |
| W1 | The design lab: two directions, four pages | [#51](https://github.com/28NS30/conservation/pull/51) |

Four things changed against the plan. **W0c is short of its brief**: the GBIF taxon remap (its steps
7–9) was cut, because it is the largest and riskiest work in the tier and W0e already contains the
privacy consequence. The naming fault it fixes is still live — 狼 still holds 14 dog records, 鼬獾 is
still both the 11th most-reported animal and absent from the species directory — and it needs its own
change. **W0a gained two fixes a reviewer found**: an unguarded write that would have turned the new
receipt page into an oracle, and the discovery that `published` does not mean publicly visible.

**W1 is trimmed**, per this plan's own critique below: the recommended direction is built across
home, map, report and species, the runner-up on home alone. Home is the page that settles taste, and
it saved about five days on the critical path. **The remap turned out to be a privacy change, not a
naming one** — correcting a name can weaken a blur, because TaiCOL files sensitivity on the species
row and withdraws names without withdrawing the judgement behind them. It ships with the loosening
at zero rather than with a disclosure to sign off.

Everything below this line is as planned on 18 September and has not been rewritten to match.

## Before anything else: a live privacy exposure

Checking the plan turned up something that is not a design problem at all, and it should be fixed
this week regardless of what you decide about any of the rest.

**542 published records of two protected species are on the public map at their exact coordinates,
with the species name beside them.** The location-precision trigger reads a taxon's sensitivity
rating to decide how much to blur; when a record has no taxon at all, both values come back NULL and
the function falls through to `exact` (`supabase/migrations/0003_reporting.sql:43-88`). The GBIF
importer matches on current accepted names, so records carrying superseded synonyms matched nothing:
`Xenochrophis piscator` (445 records, now *Fowlea flavipunctatus*, 草花蛇, protected III) and
`Herpestes urva` (97 records, now *Urva urva*, 棕簑貓, protected III). Both are rated 輕度, so the
site's own policy is a 10 km blur.

I reproduced every figure against the imported dataset rather than taking them on trust: **7,336
published records have no taxon and all 7,336 are at `exact`.** The other 6,794 are latent risk of
the same kind — their sensitivity is simply unknown.

This is the precise thing `about.privacyBody` promises readers the site does not do. The fix is one
branch in the trigger plus a backfill, it needs no name resolution and no translation, and I proved
it locally inside a transaction: all 7,336 move to a 10 km blur, averaging 5.5 km of displacement,
with no identified record affected. It is written up as **[W0e](briefs/W0e.md)** and it depends on
nothing. Applying it to production needs your credentials.

## The verdict

**The review is right, and the owner is right, and they are describing the same thing.**

There is no design system underneath this site — only a colour palette. No type scale, no spacing
or surface tokens, no shared Button or Field or Card. Every page therefore hand-writes its own
class strings, and the result is measurable:

- **20 different text-size utilities**, with **250 uses at 14px or smaller against 8 uses of 16px**.
- **61 `rounded-full` pills** across 23 files, doing four unrelated jobs — actions, filters, status,
  navigation.
- **13 variants** of the one primary button.
- A card idiom (`paper-100` on `paper-50`) at **1.10:1** — a box you cannot see, applied to
  everything.

That is the whole complaint in numbers. Nothing on the page is allowed to be louder than anything
else, so the eye finds no hierarchy, and the only element with any personality is the badge — which
still letters a retired name (PROJECT ECOWATCH / 生態守望計畫). The statistics page and the species
directory are walls of identical beige cards. The map lives in a different visual world from the
site around it. There are no animals anywhere.

**What the review could not see.** Because its author never loaded the site, four things were found
only by rendering it: the "pick a location" hint overlaps the submit button by 4px at every width;
the footer, share card and `/about` lede still advertise the retired 環境通報 / "environmental
reports" categories; the subspecies-collapsing import fault below; and the map frames Taiwan into
the left 45% of the screen, so the clearest labels on `/map` are Japan's Sakishima islands.

Underneath the styling, the engineering is careful and should survive: contrast is computed and
documented, focus rings exist, the chrome is server-rendered with no JS, the map load path was
measured and optimised, and the privacy boundary is real. **This is a re-skin and a re-composition,
not a rewrite.**

## What is recommended

### Visual direction: "Roundel", with "Field journal" as the runner-up

Four complete directions were developed independently and scored by three judges through different
lenses. Two judges — owner-taste and design-direction — put **Roundel** first. The site wears the
badge the way a ranger service wears its patch: solid blocks of the badge's own forest, cream and
ember instead of bordered beige boxes; a filled rectangle means action, an underlined word means
filter, a glyph plus words means status; nothing is a pill; nothing is under 14px; **seven type
sizes replace seventeen**; the map's land is repainted to the badge's ring colour, so the island is
literally the inside of the emblem.

**Be told the disagreement, because it matters.** The third judge — the one weighing CJK
typography, WCAG contrast, sunlight legibility and buildability — ranked Roundel *third* and the
quieter **Field journal** *first*, on three grounds: dark blocks and a dark map are harder to read
outdoors at noon; the direction leans hardest of the four on a 512px PNG that still reads ECOWATCH;
and its type-mode map colours failed for colour-blind readers. The first two objections are
inherent trade-offs. The third was a real defect and is fixed in the spec (type is now distinguished
by *form* — solid, hollow, ring — not hue alone).

So the recommendation rests on taste and coherence over feasibility, which is exactly why the plan
does not act on it. **W1 builds both directions as working prototypes** of home, map, report and
species detail, in both languages, on real data, and the owner picks one on their own phone —
including once outdoors at midday, which is the test Roundel could fail. Both prototypes share the
same primitives, so the loser costs a theme file, not a rebuild.

### Report flow: one page, camera at the top — DECIDED

Three flows were developed and judged by a roadside reporter, a backend/privacy engineer, and the
owner's advocate, and the recommendation here was a one-question-per-screen stepper. **The owner
chose photo-first instead, and then chose against its reveal**: the camera at the top, every
question under it, all of it on screen from the first frame. The pinned button that is never dead
and always names what is missing carries over from the stepper and matters more here, not less.

The recommendation was wrong in an instructive way. It defended the reveal on the grounds that a
page showing every question at once is the form this redesign is replacing. But what makes today's
page a form is its density, its two-row header, its viewport-tall footer, and its demand that a
stranger classify an animal before saying anything about it. None of that is "the questions are
visible", so the reveal was answering a complaint nobody had made — while charging for it: you
cannot see what you are in for, you cannot answer out of order when the animal is in front of you
and the GPS has not settled, and every section that unfolds below the fold needs a scroll effect to
announce itself that moves the page under a thumb already moving it.

The stepper stays in the lab as the losing option, not as a live alternative.

The most important change: **the category is never asked.** Today the form opens with 通報類型 pills
and a 牠還活著嗎？ sub-choice. Instead the flow asks the condition (dead / hurt / alive and well) and
the species, and derives the stored category from those plus the taxon's invasive flag. The truth
table is in [report-flow.md](report-flow.md). No API or schema change is needed.

**This also settles the homepage.** The phrase you objected to, 你看到了什麼？, is the headline of the
homepage's three-door block as well as the spirit of the form. Both go. The homepage gets one plain
report action beside one map action.

## The shape of the work

Five tiers. **Only the first two are unambiguous; the rest wait on your decision at the end of W1.**

| | Workstreams | What it is | Effort | Waits on you |
|---|---|---|---|---|
| **First, today** | W0e | Protected species are on the public map at their true coordinates. | 1 day | Applying the SQL to production |
| **Now** | W0a–W0d | Bugs and untrue copy. No design decisions in them. | ~12 days | Injured-wildlife referral wording; a native zh-TW read |
| **Now, in parallel** | W1, W13 | Build both directions as prototypes; build the QA harness that verifies everything after. | ~23 days | Preview access; **then the direction + flow choice** |
| **After the choice** | W2, W3 | Tokens, type, primitives; then chrome and navigation. | ~9 days | The choice |
| **Then, parallelisable** | W4–W12 | Page by page: home, map, report, species, records, stats, supporting, moderation, BioWatch. | ~52 days | — |

**About 107 person-days in total**, of which roughly 13 are the trust and privacy fixes that need no
design decision at all. Effort figures are rough, assume agent implementation with review, and come
from the briefs themselves. They are estimates, not a schedule — and see *Known weaknesses* below
for where I would cut.

### The workstreams

| | | Effort |
|---|---|---|
| [W0e](briefs/W0e.md) | **Unblurred protected records — ships first** | 1d |
| [W0a](briefs/W0a.md) | Trust fixes: report receipts and status truth | 4d |
| [W0b](briefs/W0b.md) | Trust fixes: map legend honesty and phone navigation | 2d |
| [W0c](briefs/W0c.md) | Trust fixes: copy that claims things that are not true | 2.5d |
| [W0d](briefs/W0d.md) | Trust fixes: state that gets thrown away, and basic a11y | 3.5d |
| [W1](briefs/W1.md) | Prove the direction: prototypes of two directions on four pages | 15d |
| [W2](briefs/W2.md) | Foundation: tokens, type, primitives, guardrails | 8d |
| [W3](briefs/W3.md) | Chrome: header, navigation, footer, language switch, small mark | 6d |
| [W4](briefs/W4.md) | Home | 3d |
| [W5](briefs/W5.md) | Map | 9d |
| [W6](briefs/W6.md) | Report flow | 13d |
| [W7](briefs/W7.md) | Species directory and species detail | 8d |
| [W8](briefs/W8.md) | Records list, record detail, My reports, login | 7d |
| [W9](briefs/W9.md) | Statistics and the seasonal goal | 5.5d |
| [W10](briefs/W10.md) | Supporting and system pages, loading and error states, share images | 4.5d |
| [W11](briefs/W11.md) | Moderation console | 4d |
| [W12](briefs/W12.md) | BioWatch International site | 3d |
| [W13](briefs/W13.md) | QA harness: visual baselines, accessibility, performance, test migration | 7.5d |

### Why W0 ships before any redesign

These are not design work, and they are the reason a stranger cannot trust the site today:

- **File a report → "Published to the map" → View this report → 404.** Most reports are held for
  identification or review; the success screen links to a page that reads only the public view.
  The same screen promises identification "in a minute or two"; the classifier is a daily job that
  **has never been deployed**.
- **The homepage says records are published back to GBIF. Nothing ever has been.** That one is
  mine, shipped last week.
- **The map legend misdescribes what is drawn** in three separate states.
- **On a phone, the map has no route to Species or Statistics** — not even through the footer.
- **Switching language throws away** your search, filters and map position.
- **The importer collapses subspecies, so the site names animals wrongly.** TaiRON's
  *Canis lupus familiaris* — a dog — became 狼, the wolf: 14 public records, and because the wolf is
  protected they are being location-blurred for nothing. *Melogale moschata subaurantiaca*, the
  Taiwan ferret-badger, became the bare species, which the directory hides as non-Taiwanese: it is
  the **11th most-reported animal on the statistics page and returns "no matching species" in the
  directory**. 16 taxa, 1,150 records. The same fault runs the other way too — a protected animal
  whose name fails to match is not blurred.

## Known weaknesses in this plan

Two critics read the finished plan — one hunting for gaps and orphans, one pretending to be an agent
handed a single brief and nothing else. They checked about sixty of the briefs' line references
against the code; all but one landed, and that one is corrected. What they found that is *not*
fixed, with my recommendation:

1. **W1 sits at the head of everything and is the most expensive thing here.** W1 blocks W2, which
   blocks W3, which blocks W4–W12: about 30 person-days before one production page changes, much of
   it on lab code scheduled for deletion. *Recommendation:* build the recommended direction in full
   and the runner-up as **home only**. That is the page that decides taste, it is the page you have
   rejected twice, and it cuts roughly five days off the critical path. Take the full two-direction
   version only if you genuinely cannot choose from one page.
2. **Fifteen workstreams edit the same two message catalogues**, which CI checks for key parity, and
   every brief offers the same "rebase first" mitigation. *Recommendation:* one rule — a workstream
   only ever adds keys inside namespaces it owns, never reformats the file, and adds and deletes
   keys in the same commit as the markup. Two agents should not have `messages/*.json` open at once.
3. **Fourteen briefs gate a PR on "a native zh-TW reader", nobody owns finding one, and it is
   phrased three incompatible ways.** *Recommendation:* collect every new string — roughly 150
   across the plan — into one reviewed pass with a named person and a date, and adopt one rule:
   unread zh-TW never reaches production, the English half may merge behind its documented fallback.
4. **Four files have two or more owners with no arbiter**: `e2e/pages.spec.mjs:247-270` (W3, W5,
   W13), `season/page.tsx` (W5, W9), `MonthlyChart`/`ChartTable` (W0d, W7, W9), and
   `ci.yml` + `package.json` (five workstreams). Whoever starts each pair should agree the owner
   first; the later one silently reverting the earlier is the likeliest way this plan loses work.
5. **W1 (nine PRs) and W6 (eight) are too large to hand to one agent.** Split them at the PR
   boundaries the briefs already define.
6. **W2's final PR is orphaned.** It retires the old design system and is scheduled "after W4–W11",
   which is weeks after the agent that wrote W2 has finished. It needs its own owner.
7. **For a site with no users, some of this should simply be cut.** W11 rebuilds a moderation console
   for a queue that is provably empty and stays empty until W6 ships. W8's place-name table is a new
   migration and a data import to replace coordinates in a list nobody is reading yet. Both are real
   improvements and neither is urgent.

## What I would push back on

**The review's second phase is a whole-site visual rebuild.** That is weeks of work on a site with
no custom domain, no announcement and effectively no users. The ordering in this plan is
deliberately different: fix what is untrue now, prove a direction cheaply, and only then rebuild —
and rebuild page by page, so the site is never half-migrated for long.

**Reference photography is not a plan.** The review asks for documentary imagery; there are no
report photos, no licensed wildlife photography and no budget stated for either. Roundel is built
to look finished with zero artwork — the species name *is* the picture — and treats illustration as
an upgrade, not a dependency. If you want photography, it needs licensing and curation that only
the team can supply.

**The badge is on the critical path and is two names out of date.** Enlarging the emblem enlarges
the wrong lettering. Since the site is unannounced, shipping the big soft upscale now costs nothing
and the redraw can land later — but that is your call, and it is question 5 below.

## Decisions owed by you

Blocking, in the order they are needed:

0. **Apply W0e's migration to production**, and with it the two migrations that are already overdue
   (`0009`, `0010`). Until those land the live site cannot accept a report at all — the deployed code
   writes two columns production does not have — so W0a's receipts, W6's flow and W11's queue are all
   designed on a path that currently fails.
1. **Preview access** for W1 (Vercel previews sit behind SSO, confirmed: they 302 to a login).
   Without it the prototypes cannot be shown on your phone. On a machine with the repo they can be
   read without any of that: the lab is on `main` now, so `npm run dev` and `/lab`.
2. ~~**The flow**~~ — decided: photo-first, one page, every question visible. Built and running at
   `/lab/roundel/report/photo-first`.
3. **The visual direction.** Not Roundel and not Field journal as they stand; the owner's read is
   that the answer is somewhere between them or elsewhere, and it is going to the team. Everything
   downstream of W1 waits on this. What the lab is good for now is arguing with, not choosing from.
4. **The injured-wildlife referral**: which agency, which number, in both languages. Nobody will
   invent one. This blocks shipping the injured-animal guidance.
5. **The emblem**: enlarge today's PNG now (still reading ECOWATCH), or wait for the redraw.
6. **A native zh-TW reader** for the 69 new strings in [zh-tw-review.md](zh-tw-review.md) — every
   one extracted from the five trust-tier branches, English beside Chinese, with a blank line under
   each to write the replacement in. Every brief has a fallback that reuses live copy so work is not
   blocked, but unread copy should not reach production.

Non-blocking questions each have a recommended default recorded in the brief that raises them, so no
agent has to wait for an answer.

## The documents

- **[direction.md](direction.md)** — the recommended visual system, ready to implement: tokens with
  computed contrast, font strategy and budgets, the seven-step type scale, every primitive, page
  compositions for home / map / report / species at desktop and phone, plus the runner-up's spec and
  the test that decides between them.
- **[report-flow.md](report-flow.md)** — the recommended report flow screen by screen with copy in
  both languages, the category truth table, every state, the offline and Turnstile implications, and
  what changes in code.
- **[briefs/](briefs/)** — one delegable brief per workstream. Each has goal, evidence, scope in and
  out, dependencies, owner decisions with defaults, a design or behaviour spec, ordered
  implementation steps, checkable acceptance criteria, verification commands, traps, and a PR
  breakdown.
- **[inventory/](inventory/)** — what every area of the site is today, area by area, from the code
  and from the rendered pages: components with a keep/restyle/rebuild verdict, problems with
  evidence, what works, and the constraints a redesign must not break.
- **[alternatives/](alternatives/)** — the four visual directions and three report flows as
  proposed, including the rejected ones. Kept because the judges' grafts refer to them and because
  the runner-up may yet be chosen.
- **[zh-tw-review.md](zh-tw-review.md)** — the 69 strings the trust tier adds or rewrites, generated
  from the branches rather than typed, so a native reader can mark up the Chinese without reading any
  code. Regenerate it after more copy lands.
- **[verified-claims.json](verified-claims.json)** — the review's 29 claims with the evidence that
  confirmed each, the four corrections, and a suggested fix.
- **[tools/](tools/)** — the scripts that computed the contrast and density-ramp figures, so the
  numbers in `direction.md` can be re-checked rather than trusted.

Screenshots of the current site were taken from production at 1440×900 and 390×844@2x. They are not
committed; regenerate with `node apps/web/e2e/_shots.mjs` against a local server, or see
`e2e/lab/shots.mjs` once W1 exists.
