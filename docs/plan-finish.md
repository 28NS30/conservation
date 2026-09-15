# Finishing the list

Everything the team has asked for since August 2026, in one place: the Taiwan
website issues list, the gamification proposal, and the defects an audit of our
own work turned up. Each item says what it is, where it stands, and — if it is
not done — what it costs and what it is waiting on.

Nothing here is a wish. Every line is either shipped, scheduled, or blocked on a
decision only the team can make, and the blocked ones say whose decision it is.

## Where it stands

**Everything unblocked is done**, in eight pull requests between 14 and 15
September 2026. What remains is in G, and none of it is waiting on engineering.

|     | Area                             | Items | Done              | Left               |
| --- | -------------------------------- | ----- | ----------------- | ------------------ |
| A   | Wording and stale copy           | 5     | 5                 | —                  |
| B   | The report form                  | 6     | 6                 | —                  |
| C   | The map                          | 5     | 5                 | —                  |
| D   | The fun part                     | 3     | 2                 | 1 (no subject yet) |
| E   | Offline capture                  | 3     | 3                 | —                  |
| F   | Team and contact                 | 1     | 1 (the code half) | the roster         |
| G   | The ones with real prerequisites | 3     | —                 | 3                  |

| PR  | What                                                          |
| --- | ------------------------------------------------------------- |
| #24 | Three choices at the top of the form, not four                |
| #25 | This plan, and the copy that outlived what it described       |
| #26 | The reporter names the species, or says they cannot           |
| #27 | Map: three toggles, colour by type, the record beside the map |
| #28 | Every species gets a card                                     |
| #29 | Capture accuracy, and a receipt when a queued report lands    |
| #30 | The team page, empty until there are people to put on it      |
| #31 | A deploy that is ahead of its database now says so            |
| #32 | Three things the receipt change left behind                   |
| #33 | One migration command that works on the database we have      |

Estimated at roughly 23 engineer-days. The estimate was for a team; what it
actually cost is not a useful number to carry forward, so it is not recorded
here as one.

The ordering rule is that anything a visitor sees in their first thirty seconds
comes before anything they see after signing up. We have no signed-up visitors,
so work aimed at retention would be measured against nothing.

---

## A. Wording and stale copy

Small, and first, because they are the cheapest credibility we will ever buy.

**A1. "Spreading invasives" → "invasive species". Done, by deletion.** The phrase
lived in FireWatch's copy, and FireWatch is gone (PR #15). A repo-wide search for
`Spreading` and for `Habitats` now returns nothing, so both of the team's minor
issues are closed — though not in the way the note intended, which is worth saying
plainly rather than ticking a box.

**A2. The bare "Invasive" chips.** `apps/web/messages/en.json` labels three
different things `"Invasive"` — a species-page status badge, a directory filter,
and a stats heading. The team's objection was to the noun standing alone, and it
stands alone in all three. English only; the Chinese already reads 外來入侵種.
_Half a day._

**A3. The README still describes a site we no longer run.** It is titled 生態通報
地圖, and its first paragraph offers "pollution … or habitat destruction", both
retired in PR #17. Line 195 still explains their publication rules. This is the
first thing a prospective collaborator reads. _Half a day._

**A4. `apps/biowatch/lib/projects.ts`.** Line 58 advertises FormosaWatch as
watching "habitat loss", which it does not. Line 66 reads
`habitat && habitat.taxa ? "458" : "458"` — a ternary that returns the same
literal on both branches, so the species count is hardcoded and the live number is
computed and discarded. The variable is still named `habitat`, from before the
rename. _Half a day._

**A5. The stale `apps/firewatch` directory.** Untracked by git since PR #15 but
still on disk, so a grep for old copy finds ghosts and a build could in principle
pick it up. Delete it locally; nothing to merge. _Minutes._

---

## B. The report form

**B1. Three choices at the top. Done — [#24].** Invasive species, native wildlife
sighting, roadkill or injured. The last covers two stored categories, because an
injured animal implies someone should respond and a dead one does not; choosing it
reveals a dead/alive sub-choice. The grouping is `REPORT_GROUPS` in
`packages/shared`, and both the form and the front page generate from it, so they
cannot drift.

**B2. Pollution and habitat destruction removed. Done — PR #17.** Neither had ever
held a report, so nothing was migrated or lost.

**B3. One page. Done, and it always was.** `/report` is a single scrolling form:
type, photos, location, time, notes, submit. No steps, no wizard.

**B4. A place for notes. Done, and it always was.** Free text, capped at
`MAX_NOTES`, stored on the report and shown on its public page.

**B5. A species search at the top of the form, scoped by report type. Done —
#26.** The largest unblocked item on the list and the one that changes the data
most. Three defects surfaced while building it: the classifier silently
overwrote a human's identification on its next run (taking the published
precision with it), searching 石虎 ranked a scorpionfish above the species of
that name, and alternate names matched only in full — so 綠鬣蜥 found the green
iguana and 綠鬣 found nothing.

Today a reporter cannot name the animal at all: identification is entirely
post-hoc, by the classifier, over a queue. The search itself already exists —
`/api/species/search` backs the map's filter and the species directory — so this is
a form control and a taxon contract, not a new search.

The team asked for a different database per report type. Implemented as scope with
a visible escape, not as a wall:

- **Invasive** searches the invasive register — 274 flagged taxa, 273 of them with
  Chinese names, including all three the front page advertises.
- **Sighting and roadkill** search everything, ranking `alien_type = 'native'`
  first.
- Every scope carries _"Not what you saw? Search all species"_, because a roadkill
  victim is often an invasive — feral pigeons and mynas are 1,341 of our records —
  and a picker that hides the animal in front of the reporter teaches them the site
  is wrong about reality.

This answers the "what does native mean" question that has been blocking the item
without inventing a policy: we rank by it, we never exclude by it. The decision is
reversible in one predicate if the team wants a hard scope.

Two things to get right. First, a reporter-named species sets the published
location precision, because `set_report_public_location()` derives the blur from
the taxon's TaiCOL sensitivity — that is the standing "trust the reporter"
decision, and naming a protected species still blurs automatically. Second, search
must tolerate the 鬣/鬛 split: our own front page says 綠鬣蜥 and the taxon is
stored as 綠鬛蜥, so a reporter typing the common form finds nothing today.

**B6. Submit as uncertain. Done — #26.** `taxon_source` gained `'unknown'`, so a
report nobody could identify is distinguishable from one nobody has examined.
The team's own words: "if the AI is unable
to identify it, submit it as uncertain, especially roadkill." A reporter who cannot
name a flattened carcass needs a way through the form that is not a wrong guess.
An explicit "I don't know" that records the uncertainty rather than leaving the
field empty, so the classifier queue and a future reviewer can tell _unknown_ from
_not yet looked at_.

---

## C. The map

**C1. Easy to find, on its own page. Done.** `/map` is in the top nav on every
page, and the front page no longer buries it in a hero — that was the team's
complaint and the redesign's starting point.

**C2. A species search showing only that species' reports. Done.** In the map's
filter panel, debounced, with a live region announcing the result count.

**C3. Toggles for the three report types. Done — #27.** The filter offered the four
stored categories and now offers the three the form does, generated from
`REPORT_GROUPS` — which is why that constant lives in `shared` rather than in the
form. The parameter is `?group=`, and `?category=` is refused rather than
ignored: zod would have stripped the old name as an unknown key and returned an
unfiltered tile, which is a filter that looks applied and is not. The reports
list moved with it, being the map's accessible equivalent.

**C4. Dots coloured by report type, with a switch. Done — #27.** A switch between
density and type, not one or the other: density answers "where is this
happening", type answers "what is happening here", and the map is asked both.
Aggregated cells carry which type dominates and by how much, and a cell under a
two-thirds majority draws neutral — a cell that is half roadkill and half
sightings has no colour that is honest. Both properties ride in the tile beside
`weight`, so switching is a repaint rather than a refetch. Today every dot is
one colour, which is what 46,334 imported roadkill records look like.

**C5. Click a dot, get the image and the details beside it. Done — #27.** A click
opened a popup carrying a category and a date; it now opens a panel with the
photograph and the details underneath — a popup is a label, a panel is a reading
surface. On the right on a desktop, and as a sheet on a phone, where "the right"
is the bottom. The obscured badge moved with it, because a blurred point that
stops saying so reads as a precise one.

Three things turned up while verifying it: the aggregated cells stay drawn past
the handoff zoom, so one click opened both the panel and a "zoom in for
individual records" popup at a zoom where the individual records were already on
screen; that popup said "about 0 km per cell" below a kilometre; and on a phone
the panel covered MapLibre's attribution control, which OpenFreeMap and
OpenStreetMap both require to stay visible.

---

## D. The fun part

The team asked to revisit gamification, then said the real ask was smaller: _"we
just wanted to push for the fun part a little."_

The assessment in `docs/plan-game-layer.md` stands and is not relitigated here —
daily care pays people to re-report the same immobile infestation, PvP buys the
project its first harassment surface, and the whole build is seven to nine months
of total capacity plus art nobody here can make. What survives is the half that
was always the strongest, and one correction the doc makes against itself: the
species card is a **content** feature. It renders from TaiCOL for all 125,438
Taiwan species with no user data whatsoever, so gating it on users arriving was
backwards when the binding constraint is that users do not arrive.

**D1. Creature cards from real data. Done — #28.** Every card the team described,
built from columns we already hold. A habitat type is `is_terrestrial` /
`is_freshwater` / `is_brackish` / `is_marine`. Strengths and weaknesses are real
ecology: endemism, IUCN, red list, protected status, what actually threatens it.
Zero art, zero balance surface, and it is the original published argument —
Balmford's 2002 finding that children identified 80% of Pokémon and under half of
local wildlife ended with the suggestion that someone build this for real species.

**D2. Make the card worth pulling up. Done — #28.** A card nobody can reach is a
schema, so it went to all three places it earns: the species page, the map panel
from C5, and the report's own page once it is identified — the moment a reporter
is most curious about what they just found. On the report page it replaced the
line of text rather than sitting under it.

**D3. The one rule, enforced rather than written down.** _Not done, and it has no
subject: nothing in the product is earnable, buyable or unlockable, so there is
nothing for the predicate to constrain. It stays written down here and in
`docs/plan-game-layer.md`, and becomes a SQL grant the day anything is
collected._ The rule: nothing earnable, buyable or unlockable may ever influence
what a person reports, where they go to report it, or what the public map says. Anything collectable may only
be minted from taxa with null sensitivity and null protected status — one SQL
predicate, in the grant, not in the view layer, matching how
`species_report_stats` and the tile route already do it. A collection keyed by
taxon is a per-person index over species, and taxa are not covered by the
obscuring stack.

---

## E. Offline capture

The team's field list: photo file, latitude, longitude, accuracy, timestamp,
report type, species, notes, status.

**E1. The queue itself. Done.** IndexedDB via `idb`, holding the inputs rather
than a prepared request, because submission is three network steps and the first
one is what being offline breaks. Photo blob, lat, lng, timestamp, type and notes
are all stored; a banner shows what is waiting.

**E2. Retry that actually works. Done — PR #11 and the Turnstile fix.** Queued
reports carried no challenge token, so production 403'd every one and gave up
after eight attempts: precisely the mountain-road reports the queue exists for,
silently discarded. Local development has no Turnstile keys, so the offline e2e
spec passed 7/7 throughout.

**E3. The three missing fields. Done — #26 and #29.** `accuracy` was available at
capture and thrown away, and it is the difference between a 20 m fix and a 2 km
one; it is carried only when the device set the coordinate, and published only
beside an exact one, because "±12 m" printed next to a 50 km-blurred point makes
a statement about the location that the blur exists to avoid making. `species`
arrived with B5. `status` gained the confirming state: a sent report used to be
deleted outright, so the banner it sat in simply vanished, and it now leaves a
receipt that links to the published record.

**The version bump this reserved was not needed.** IndexedDB stores structured
clones and enforces no per-field schema, so adding fields to the stored object
needs no upgrade — only a new store or index would, and there is neither. The
spec still opens version 1, and now distinguishes "nothing is waiting" from "the
store is empty", which stopped being the same thing when a sent report began
leaving a receipt.

---

## F. Team and contact

**F1. The page. Half done — #30.** The route, the layout and the data contract
are in; the roster is empty, the page 404s and nothing links to it until real
content arrives. Four tests hold that line, two at source level, because
`lib/team.ts` is exactly where a plausible placeholder gets added to see what the
layout looks like. The layout is the one the team asked for: leadership, then
FormosaWatch with the Taiwan people, then FlamaWatch with the Colombia people;
each person a headshot, a name, a position, and contact details.

The code was never the obstacle. What is missing is every person's real name as they
want it written in both languages, their position, a square headshot each, which
contact details each person agrees to publish, and **written consent per person
per field** — this is personal data under 個資法, and we hold our reporters to
exactly that standard. Also FlamaWatch's current URL and their agreement to be
listed at all.

So the page ships in two halves: the route, the layout and the data contract now,
rendering nothing and linked from nowhere while the roster is empty; the roster
when the team sends it. No placeholder people, not even briefly — a fake
headshot on a conservation project's team page is the kind of thing that gets
screenshotted.

---

## G. The ones with real prerequisites

Not deferred for convenience. Each is waiting on something that cannot be written.

**G1. Identify the photo at submission.** _Seven days._ The team wants scanning to
start the moment an image is attached, a single best answer above a certainty
threshold, yes/no from the reporter, and a colour-coded shortlist below it.

Two prerequisites. **A monthly GPU ceiling**, because this moves inference from a
batch job onto the submission path, where cost scales with attempts rather than
with reports. And **real roadkill photographs**, because every accuracy figure we
have comes from 308 well-framed live-animal iNaturalist images, and our own
`docs/remaining-work.md` already calls that an optimistic upper bound for damaged
carcasses on asphalt. Promising a threshold we measured on the wrong images is how
a reporter learns to distrust the whole form.

B6 — submit as uncertain — is the part of this that needs neither, which is why it
is in B.

**G2. Duplicate reports, and member moderators.** _Twelve days._ Two people
photographing the same carcass from two angles is a data-quality problem and a
real one. The team's instinct — general members as moderators — is right and is
also the larger half of the work: there is no way to record an action against a
_person_ in the schema today. No ban, no suspend, no account status, no
`subject_user_id` on `moderation_actions`. That migration, an admin surface and an
appeals path are prerequisites, not follow-ups.

**G3. Volunteer trait annotation for the hard roadkill.** _Six days, and it should
not start._ Corrected by measurement on 13 September: `report_photos` has **zero
rows**. TaiRON publishes no images to GBIF, so there is nothing for a volunteer to
look at. The 7,336 unidentified records are not 7,336 judgements either — they are
163 distinct name strings, half at Family or Order rank where no finer truth
exists. That is a reviewed name mapping, a day's work with a taxonomist's
sign-off, taking identification from 84% to about 92% — not a crowd task. Note
that writing `taxon_id` re-fires `set_report_public_location()`, so a correct match
to a sensitive taxon will blur a point that is exact today. That is the right
outcome and the reason each binomial needs a real reviewer.

---

## What the team owes us, in one list

- Real names in both languages, positions, headshots, contact details, and written
  consent per person per field. FlamaWatch's URL and their agreement.
- A monthly GPU ceiling for at-submission inference.
- Real roadkill photographs, enough to measure a threshold on.
- **A native reader for about 40 new Traditional Chinese strings**, already
  written and shipped rather than pending: the catalogues cannot disagree on a
  key without failing CI, so nothing could merge half-translated and the Chinese
  went in with the English. It has not been read by a native speaker. The one
  that most needs it is 「我不確定那是什麼」 and its note — "we are not sure" has
  to read as honest rather than broken.
- Whether to keep ranking by native or switch to a hard scope (B5).
- **Migrations 0009 and 0010 applied to production.** Confirmed missing on 15
  September, which means the live site rejects every submission. Deploys are
  automatic and migrations are not; `/api/health` now reports `schemaCurrent`
  and `verify-deploy` fails on it (#31). Production has no migration history —
  it was built by the checklist's psql loop — so the two files are applied
  directly and then recorded:

  ```
  psql "$PROD_DIRECT_URL" -v ON_ERROR_STOP=1 \
    -f supabase/migrations/0009_reporter_identification.sql \
    -f supabase/migrations/0010_capture_accuracy.sql
  DATABASE_URL="$PROD_DIRECT_URL" npm run db:migrate -- --baseline
  ```

  Both files are safe to re-run. After that, `npm run db:migrate` is the whole
  procedure forever (#33).

And the one that is not a deliverable: **the domain, and the 路殺社 / TBIA
conversation.** The site is served from a Vercel hostname containing none of the
project's names, and nobody has been told it exists. Nothing above changes that,
and it is still the only thing standing between this work and a first user.

## Rules that hold across all of it

Carried forward from `docs/backlog-plan.md`, where each is a case where two plans
would have silently broken one another.

- **One migration number each**, in merge order. Taken: 0008 categories, 0009
  reporter identification, 0010 capture accuracy. Reserved: 0011
  member-moderator role, 0012 duplicates. `scripts/migrate.ts` runs them in
  filename order.
- ~~**One IndexedDB version bump**, owned by E3.~~ Not needed; see E3.
- **One grouping constant** — `REPORT_GROUPS`, now shipped.
- **Exactly one change to `reports_public`**, appended, `create or replace`, never
  `drop cascade`: `species_report_stats` selects from it. Spent by 0010, which
  appended `location_accuracy_m` — nulled wherever the point is not exact,
  because accuracy published beside a blurred point is a disclosure.
- **Shrink `CATEGORIES` and the CHECK constraint in the same migration.** A
  constraint wider than the type is what crashes the moderation queue on a legacy
  row.
