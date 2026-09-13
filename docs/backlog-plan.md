# The team's backlog

Five areas requested in September 2026, planned against the code, checked for
cross-area conflicts, and sequenced. **About 41 engineer-days in total.** This
file exists because the work spans many pull requests and several decisions have
already been made — losing them would mean re-litigating each one.

## Decisions taken

| Question | Answer |
|---|---|
| Home page: do the five explanatory sections survive? | **Keep them**, replace only the top |
| A reporter picks the species themselves — publish the exact location? | **Yes, trust the reporter** |
| Map dots: colour by density or by report type? | **A switch between the two** |
| Is FlamaWatch the renamed FireWatch? | **Yes, the same project** |

The species decision is the consequential one. Naming a species sets the
location precision, because `set_report_public_location()` derives the blur from
the taxon's TaiCOL sensitivity. Trusting the reporter therefore means an
anonymous submitter can publish an exact coordinate for a photograph of anything,
by naming a species that is not sensitive. Named honestly, a protected species
still blurs automatically.

One narrow safety net was offered and is **not** implemented: if the model's own
suggestions contain a protected species and the reporter picked a common one,
take the more cautious precision. It is a few lines, it preserves the decision
everywhere else, and it is worth revisiting if the site ever attracts a
determined bad actor.

That decision also dissolves a dead end the planning found: under a
blur-until-confirmed design an anonymous reporter would have been pinned at 10 km
with no way to revise, because `confirmSpecies` requires a sign-in and restricts
non-moderators to the AI's own candidates — and there is no moderator.

## Phases

| | Phase | Days |
|---|---|---|
| 1 | Housekeeping and guards | 1 |
| 2 | Shrink to four report categories | 1.5 |
| 3 | Home page: logo and introduction | 2 |
| 4 | Make offline capture reachable | 5.5 |
| 5 | Report form: three buttons, species search, taxon contract | 5 |
| 6 | Map: clickable dots and a right-hand details panel | 6 |
| 7 | Team / contact page | 2 |
| 8 | Identify the photo at submission time | 7 |
| 9 | Duplicate reports and a member-moderator role | 5 |
| 10 | Volunteer trait annotation | 6 |

Each ships on its own. Phases 1 and 3 are done; see below.

## Rules that hold across phases

These come from checking the five area plans against each other. Each is a case
where two plans would have silently broken one another.

- **One migration number each, assigned now**, in merge order: 0008 capture
  metadata, 0009 categories, 0010 photo classifications, 0011 member-moderator
  role, 0012 duplicates. Three separate plans each wanted to be `0008_`, and
  `scripts/migrate.ts` runs them in filename order.
- **One IndexedDB version bump, owned by Phase 4.** Two plans independently
  bumped `VERSION` to 2 with different schemas. The upgrade callback is now
  version-aware (shipped in Phase 1) so the bump cannot throw `ConstraintError`;
  `e2e/offline.spec.mjs` opens the database with a hardcoded version and must be
  fixed in the same commit as the bump.
- **One grouping constant.** The report form's three buttons and the map's three
  toggles are the same three buckets, and the team's two lists use different
  words for them. Define it once in `packages/shared`, generate both from it, or
  the map will filter for things the form cannot produce.
- **Exactly one change to `reports_public`,** appended, `create or replace`,
  never `drop cascade` — `species_report_stats` selects from it. Re-run
  `test/privacy.test.mjs` and `scripts/preflight.ts` afterwards. GPS accuracy
  published beside a 10 km-blurred point is a disclosure, so it must be clamped.
- **Extract the Turnstile token hook first.** After Phases 4 and 8 there are
  three consumers of single-use tokens — identify-on-upload, submit, and queue
  flush — and the rule differs per consumer: identify and submit wait for a
  token, save-on-device must never touch one.
- **Shrink `CATEGORIES` and drop the CHECK constraint in the same migration.**
  Leaving the constraint wider than the type is what crashes the moderation
  queue on a legacy row.

## Blocked on the team

- **The whole team page.** Real names in both languages as each person wants them
  written, position, one square headshot each (640px or larger), and which
  contact details each person agrees to publish. Nothing here may be invented and
  a placeholder version must not be deployed, even briefly.
- **Written consent per person, per field.** This is personal data under 個資法,
  and the project already holds its reporters to that standard.
- **FlamaWatch's current URL**, and their agreement to be listed.
- **Traditional Chinese copy** for roughly 75 new strings across Phases 4, 5, 6
  and 8. CI fails if the two catalogues disagree on a single key, so nothing
  merges half-translated. The AI-confidence wording most needs a native reader:
  "we are not sure" has to read as honest rather than broken.
- **Real roadkill photographs** before Phase 8's accept/reject thresholds can be
  promised. Every accuracy figure on record comes from 308 well-framed live-animal
  iNaturalist images, and `docs/remaining-work.md` already says that is an
  optimistic upper bound for damaged carcasses on asphalt.
- **A monthly GPU ceiling** for at-submission inference, and confirmation that
  the Vercel plan can run the fallback sweeper more often than daily.
- **What "native" means** for the species picker: strictly `alien_type='native'`,
  or everything not flagged invasive. It changes the list by about 4,700 species.
- **A trait vocabulary** before Phase 10. Engineers cannot invent the diagnostic
  features, and the wrong list makes the collected data worthless. Note also that
  no training code exists here — the classifier is zero-shot with no fine-tuning
  loop, so annotations alone will not improve it.

## Noted and not acted on

The planning recommended a week of front-page analytics before replacing the
hero, so the change could be measured. That would mean adding a third-party
analytics script — its own decision, with its own privacy-page consequence — and
waiting a week. The rewrite shipped instead. The comparison is not recoverable.
