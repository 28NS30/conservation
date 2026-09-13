# The collection layer

The team proposed a Pokémon-style layer on top of invasive-species reporting:
community goals for invasives found with everyone rewarded, creatures you give
cosmetics to and raise daily, each with a habitat type, two basic moves, one
special ability, strengths and weaknesses, and a friendship ability unlocked
through care — then sent out to battle other players for a second currency that
buys cosmetics and new animals but never stat boosts.

This is the assessment, and a counter-proposal that keeps the good half.

---

## The fact that reframes everything

**There are no user-submitted reports. Not few — none.**

```
/api/health                        46,334 records
/en/stats                          date range 2011–2017
/en/reports                        most recent report: 2017-12-31
/en/reports?category=invasive      "No reports yet."
```

Every record on the site is imported TaiRON/GBIF history, and **every one of
them is category `roadkill`**. The other five categories — invasive, pollution,
injured, sighting, habitat — are all empty. The public reporting form has never
received a submission from a member of the public.

So the category this proposal is built on currently contains zero records. (The
1,341 records whose *taxon* is invasive are roadkill records of invasive animals
— feral pigeons and mynas hit by cars — not invasive sightings. 16 species have
any records at all; several hundred more invasive taxa sit in the checklist with
none.)

A daily-care loop, a battle economy and a cosmetics shop are all *retention*
mechanics. They exist to keep users who already came back once. This platform
does not have an attrition problem, because it has not yet had a user. Building
retention now means tuning a funnel with nothing in it — and every design
decision would be guesswork against a drop-off curve nobody has measured.

That does not kill the idea. It settles the order.

---

## What the team got right

Three of these are better than they may realise.

**Invasives is the correct target, for a reason the proposal doesn't state.**
Invasive taxa carry no TaiCOL `sensitivity` rating and no `protected_status`, so
`precision_from_taxon()` returns `exact` for them. They are the one category
where more reports is unambiguously good *and* publishing a precise location
harms nothing. A crowd hunting invasives is not a crowd being handed a poacher's
map. Every other category would put the obscuring promise under pressure. Make
this an explicit, enforced rule rather than a happy accident: **anything
collectable may only be minted from taxa with null sensitivity and null
protected status.** It is one SQL predicate.

**A community goal beats a leaderboard, and beats it structurally.** A shared
counter needs no accounts, no per-user state, no anti-cheat and no moderation. It
works *with* the anonymous reporting path instead of against it — which matters,
because `reporter_id` is nullable by design. A count-ranked leaderboard would
also favour whoever drives a busy road daily over the person filing one careful
record a month in Taitung, whose data is worth more per record. FrogID found its
participants were uninterested in competition and more likely to disengage if
competitive features expanded.

**"Never buys stat boosts" is the right instinct, aimed one level too low.**
There is no money anywhere in this project — no payments, no IAP — so pay-to-win
is not the live threat. The live threat is reward-to-report distortion: rewards
changing what people report and where they go. Generalise the instinct into one
rule and it covers everything:

> Nothing earnable, buyable or unlockable may ever influence (a) what a person
> reports, (b) where they go to report it, or (c) what the public map says.

That sentence is auditable in code review and costs nothing to implement. It also
means two currencies are unnecessary — the constraint lives in the rule, not the
ledger.

---

## What would break

### 1. The reward is attached to the wrong verb

"Community goals for invasives **found**" is a bounty on finds, and bounties on
finds have one documented failure mode: farm the target, manufacture many claims
from one animal, import specimens from elsewhere.

The local precedent is exact. In 2017 Chiayi County's green iguana bounty was
exhausted in a single day, and 台灣動物社會研究會 reported people breeding
animals to claim it, with nobody checking whether submitted lizards were the
invasive or a misidentified native. Same island, same decade, same taxa this
proposal would target.

*(Do not argue this internally using the Delhi cobra story — it has no primary
documentation and the term comes from a 2001 economics book. Chiayi 2017 is
local, recent and real. Hanoi 1902 is the properly archival case.)*

**The fix is to reward coverage, not finds.** `lib/stats.ts` already ranks
hotspots by 5 km grid cell, so the target becomes *"reports from 40 grid cells
that had none last season"* — un-farmable, because the second report in a cell is
worth nothing, and scientifically it is the thing you actually want. Cap any
contribution at one per cell per day.

### 2. `confirmSpecies` is already a mint-your-own-reward endpoint

This is a live defect, independent of the game.

`apps/web/app/[locale]/(site)/reports/[id]/actions.ts` takes an arbitrary
`taxonId: number` and validates it only against the foreign key — i.e. any of
~125k TaiCOL rows. There is no check that the taxon appears in that report's own
`classifications` rows. The UI only offers the classifier's top five, but a
server action is a public POST endpoint, so that restriction is cosmetic. There
is no rate limit on this path at all; `SUBMIT_LIMITS` is applied only in
`app/api/reports/route.ts`.

The write sets `taxon_source = 'user'`, which `scripts/export-dwca.ts:147` maps
to the string **"Verified by reporter"**, and clears `precision_override`,
restoring exact coordinates for any non-sensitive taxon.

Today this costs only data quality, and nobody has a motive. A currency supplies
the motive. Two one-line fixes, both worth making regardless:

- constrain `taxonId` to the report's own `classifications` rows;
- change the `user` export label to "Unverified — reporter's own identification".
  "Verified by" is a claim about a second party, and on that path there is no
  second party.

### 3. A public collection re-identifies reporters

`reports_public` carries no `reporter_id`, and `reports/[id]/page.tsx` literally
selects `null::uuid as reporter_id`. The public dataset is deliberately unlinked
from contributors. A per-user "creatures collected" roster inverts that by design,
and it does so through `taxon_id`, which the obscuring stack does not gate.

Constrained to invasives it is safe by construction — which is the same predicate
as the rule above. Enforce it in SQL (a `web_anon`-granted view joining `taxa`
with `where sensitivity is null and protected_status is null and is_invasive`),
not in the view layer, matching how `species_report_stats` and the tile route
already do it.

### 4. Daily care is the one mechanic that is actively harmful

It pays for re-reporting the same immobile infestation every day. Those records
are not fraudulent — each is a real photo of a real organism at a real place — so
**no verification step can reject them**, and 365 occurrences of one clump at one
coordinate distorts the abundance and effort signal in a permanent open dataset
other people will model from.

It also sits badly with the evidence. Deci, Koestner & Ryan's 1999 meta-analysis
(128 studies) found engagement-contingent rewards undermined free-choice
intrinsic motivation at d = −0.40. TaiRON's own survey of Taiwanese roadkill
reporters (Hsu & Lin 2021, *Journal for Nature Conservation* 64: 126055, n=538)
found their motivations are learning and self-achievement — the population most
exposed to being undermined. The same meta-analysis names the escape hatch:
non-controlling *informational* feedback about competence enhances rather than
undermines, at d = +0.33.

And there is a register problem that is hard to unwind once shipped. Every point
on the map today is a dead animal — all 46,334 records are roadkill. A pet you
must keep alive, sitting on a database of animals killed by cars, is the first
thing 路殺社 and Taiwanese media would notice.

**Separate the game clock from the data clock.** A daily loop should be
satisfiable by *opening the app*, never by filing a record.

### 5. PvP costs the most and returns the least

It adds matchmaking, a battle simulator, perpetual balance, anti-cheat and — the
part that matters — the site's first social surface, therefore its first
harassment surface. Every moderation primitive in the schema today is
report-scoped: there is no ban, no suspend, no account status column, no
`subject_user_id` on `moderation_actions`, and no way to record an action against
a *person* at all. If PvP ships, that migration plus a second admin page plus an
appeals process is prerequisite work, not follow-up. It touches neither motivation
TaiRON actually measured, and it contradicts the proposal's own best instinct by
making the system competitive.

### What it would cost

28–34 engineer-weeks for an async-only version, plus 6–10 for synchronous PvP —
seven to nine calendar months of the project's entire technical capacity. Roughly
160 art deliverables (NT$300k–800k at Taiwan freelance rates) that nobody on the
project can make. Then 0.25–0.5 FTE forever, in roles the project does not have.
The codebase's own quality bar compounds it: CI runs a real-browser both-locale
render check, and the i18n test fails the build if zh-TW lags English by a single
string, so every game item is a two-language commit.

---

## What to build instead

The reframe is small and it keeps more of the team's design than cutting would
suggest: **make the collection real.**

`taxa` already holds `is_terrestrial`, `is_freshwater`, `is_brackish`,
`is_marine`, plus endemism, IUCN, red list, protected status and the full
lineage. A creature card built from those columns teaches true natural history,
costs zero art, has zero balance surface, and every one of 125k species gets a
card for free.

This is not a compromise position — it is the original published argument.
Balmford et al. (*Science*, 2002) found eight-year-olds could identify 80% of
Pokémon but under 50% of common local wildlife, and their conclusion was that
someone should build this for real species.

| The team asked for | What it becomes |
|---|---|
| A habitat type | `is_terrestrial` / `is_freshwater` / `is_brackish` / `is_marine` — real |
| Strengths and weaknesses | Real ecology: endemism, IUCN status, what actually threatens it |
| Two moves, one special ability | Clearly-labelled flavour, or dropped — fiction next to real taxonomy is what a researcher would hold against the site |
| Friendship through care | Retargeted at **identification work**, not at filing reports |
| Community goals, all rewarded | Kept — denominated in grid cells newly covered |
| Cosmetics, second currency | Collapsed to zero currencies; the rule replaces them |
| PvP battles | Cut |

~~The friendship retarget is the best move available. 84% of records are
identified, meaning ~7,400 need human eyes.~~

**WRONG, and corrected on 13 September 2026 by measurement rather than
re-reasoning.** The arithmetic held — 46,402 records, 7,336 without a taxon — but
the inference did not. `select count(*) from report_photos` returns **0**: TaiRON
publishes no images to GBIF, so there is nothing for a volunteer to look at. And
those 7,336 rows are not 7,336 judgements. They are **163 distinct name strings**,
roughly half sitting at Family or Order rank (Aves 350, Anura 340, Ranidae 275)
where no finer truth exists, and the rest species-level synonyms TaiCOL does not
use — *Ptyas major* alone is 2,004 records.

So this is not a daily loop and cannot be made into one. It is a reviewed name
mapping: a day's work with a taxonomist's sign-off, taking identification from
84% to roughly 92%. Worth doing, and worth doing as a migration rather than as a
crowd. Note that writing `taxon_id` re-fires `set_report_public_location()`, so a
correct match to a sensitive taxon will blur a point that is currently exact —
the right outcome, and a reason each binomial needs a real reviewer.

The error was deriving a number from a percentage and never asking what those
rows contain.

---

## Phasing, with real gates

**Phase 0 — the live defects (about two days).** Not part of the game. Fix
`confirmSpecies`; fix the export label; fix the offline queue, which posts no
`turnstileToken` and is therefore 403'd and permanently failed after eight
attempts in production — silently dropping exactly the mountain-road reports the
queue exists for.

**Phase 1 — the season page and the species journal (1–2 weeks).** One shared
number, a deadline, a named real-world recipient. On `/me`, your record's journey
(pending → identified at *n*% → published → exported to GBIF) and the list of real
species you have contributed records for, linking to the `/species/[id]` pages
that already exist. No accounts required for the shared counter.

> **Gate to Phase 2: at least one user-submitted invasive report exists.**
> Today the answer is zero — in that category and in every category. No retention
> mechanic can be evaluated without it.

**THE GATE IS MISSTATED, corrected 13 September 2026.** It reads as a milestone
Phase 1 might earn. It is not: Phase 1 shipped and produced zero, for reasons
that have nothing to do with the product. The domain the code names has never
been registered, the site is served from a Vercel hostname containing none of the
project's names, production told every crawler its sitemap was at
`localhost:3000` (fixed the same day), and nobody has been told the site exists.
No amount of engineering satisfies this gate. Restate it as two conditions the
project can actually own: **the 路殺社 / TBIA conversation has happened, and the
site has been put in front of a real audience once.**

One further correction: Phase 2's gate was **misapplied**. It bundled a public
species card with a per-user collection. The card renders from TaiCOL for every
Taiwan species with no user data at all — it is a content feature, and gating a
content feature on users arriving is backwards when the binding constraint is
that users do not arrive. The gate stays right for Phase 3 and for the per-user
roster on /me.

**Phase 2 — creature cards from real data.** Only once Phase 1 has users.

**Phase 3 — anything with state, care, or a currency.** Only if Phase 2 shows
retention worth building on, and only with the reward rule enforced in SQL.

---

## What shipped

Phases 0 and 1. Phases 2 and 3 remain gated, on the condition stated above.

**Phase 0 — the three live defects.**

- `confirmSpecies` now checks the chosen taxon against that report's own
  `classifications` rows before writing it, and is rate limited. Moderators stay
  unconstrained, because an expert correction exists precisely because the
  classifier's five guesses were wrong. Five tests pin the boundary.
- The Darwin Core export no longer labels a self-identification
  `"Verified by reporter"`. It says `"Unverified — reporter's own
  identification"`, and the dataset abstract now states that only the moderator
  path involves a second observer.
- The offline queue mints a Turnstile token per report at flush time, owned by
  the queue banner, which is the one thing on screen whenever something is
  waiting. Two rules fell out of a challenge being a property of the moment
  rather than of the report: no token is a *skip* and costs no attempt, and a
  403 `challenge_failed` is retryable where every other 4xx is terminal.

  Note what this means about the existing coverage: `e2e/offline.spec.mjs`
  passed 7/7 throughout the period this was broken, because local development
  has neither Turnstile key and so the two halves agreed about requiring
  nothing. `test/offline-challenge.test.mjs` pins the contract at source level
  instead — bluntly, because a regression here is silent in every environment a
  test can run in.

**Phase 1 — the season page and the species journal.**

- `/season` carries the shared goal: new 5 km squares reached this quarter,
  against a target. Anonymous reports move it exactly as much as signed-in ones,
  which is the only reading of "community goals, all rewarded" that does not
  make accounts compulsory. The page states plainly that there are no points, no
  ranking and nothing to win, and why. Linked from the footer and from `/stats`;
  deliberately **not** added to the top nav — that is a four-item bar and a
  fifth is your call, not mine.
- `/me` gained the journey and the collection. Each report shows the four states
  that genuinely exist — submitted → identified (with the classifier's
  confidence) → published → open data — where "open data" is computed from the
  same condition `export-dwca.ts` filters on, so nothing claims an upload that
  has not happened. Above it sits every species you have personally recorded,
  linking to the real `/species/[id]` pages. It stays `noindex` and private, and
  that is structural: a public roster is a per-person index over taxa, and taxa
  are not covered by the obscuring stack.

**Found while verifying, unrelated to any of the above.** `/favicon.ico` has no
static file to answer it, fell through to the `[locale]` dynamic route, and
reached `Number(...).toLocaleString("favicon.ico")` — a `RangeError`, so a 500
on a request every browser makes. The layout guards the locale, but a layout and
its page render in parallel, so the page ran anyway. Guarded in the page too.

Verified: 139 unit tests, 16/16 page renders in both locales, 7/7 offline queue,
every keyboard-focused control rings on all seven pages, map tiles clean, lint
and both typechecks clean, production build clean.

---

## Method

Six independent lenses (data integrity, ecological harm, feasibility,
legal/privacy, game design, abuse/moderation), each finding adversarially
verified by three skeptics briefed to refute it. 32 findings survived; 10 rated
high. Verification corrected several claims rather than accepting them — the
cobra anecdote was demoted, a journal citation was wrong, an art-cost estimate
was inflated by roughly a third, and one "critical" was argued down to high
because the exploit reaches only the attacker's own records and is audit-logged.

The run hit a session limit before the design and synthesis stages, so the
counter-proposal above is mine, built from the surviving analysis. The three
code defects in Phase 0 were each confirmed by reading the source directly.
