# The species AI: one model, three rule sets

Written 28 September 2026 with the change that introduced it (branch
`ai-that-names-the-right-animal`). The first half says what changed and why,
with the measurements; the second half is the procedure for switching
production over, in order, and for switching it back.

## The decision

The team asked (requests 4 and 5) whether to use one model per report type.
**One model, with a different rule set per report type**:

- **BioCLIP 2**, zero-shot, as before. There is nothing to train a roadkill
  model on yet: the site has had no reports from people, and TaiRON's dataset
  on GBIF carries no photographs.
- The measured problem was never the model. It was the label list it chose
  from (deleted names, subspecies and duplicates splitting one animal's
  probability) and the invasive page's closed list (every photo forced onto an
  invasive species). Both are fixed here.
- Three rule sets, not three models: which species a page may be named as, how
  sure the model must be, and what happens next.
- **Later**, once moderators have verified a few hundred roadkill photos, a small
  roadkill-specific add-on (a linear probe on the frozen BioCLIP embeddings)
  can be trained and compared against zero-shot on the held-out dead-animal
  set. That is the realistic form of "a model per category".

## What changed

### The model returns evidence; the website decides

The classifier endpoint now speaks two **contracts**, side by side:

| | Contract 1 (legacy) | Contract 2 (evidence) |
|---|---|---|
| Request | `{token, imageBase64, category}` | `{token, imageBase64, contract: 2}` |
| Scored against | the category's list (`labelsets.py`) | every accepted Taiwan taxon |
| Softmax over | that list only | all of them, then each subspecies added into its species |
| Returns | top 5 `taxa.id`, a band | top 50 `{taicol_id, score}`, no band |
| Embeddings | v1 (`taxa_ids_v1.npy`) | v2 (`taxa_keys_v2.json`) |
| Who decides | the model service | `apps/web/lib/report/classifyPolicy.ts` |

A request with no `contract` gets contract 1, exactly as before, so deploying
the new model service changes nothing for the live website. The website asks
for contract 2 only when **`ML_CONTRACT=2`** is set; otherwise it behaves
exactly as it did.

### Embeddings v2

`apps/ml/build_embeddings.py` now builds `data/embeddings/taxa_embeddings_v2.npy`
and `taxa_keys_v2.json` (built 28 September 2026 against the local copy of the
database, which is a restore of production):

- accepted rows only (64,779 species; v1 held 1,754 deleted names);
- keyed by TaiCOL id, not the `taxa.id` bigserial a re-import renumbers;
- 4,272 subspecies, varieties and forms kept as extra rows whose probability
  is added into their species;
- identical prompts embedded once (none remain among accepted rows);
- 69,051 rows, 106 MB. The v1 files are untouched.

### The three rule sets

Applied by the website to live `taxa` rows, so a species fix in the database
reaches the classifier at once:

| Rule set | Used for stored category | May be named as | Names a species by itself? |
|---|---|---|---|
| **Roadkill** | `roadkill`, `injured` | animals, except marine-only ones — but a protected animal, or one TaiRON has recorded on a road, stays whatever its habitat flags say | only above its fitted threshold, if that threshold is proven (below) |
| **Wildlife** | `sighting` | every animal | only above its fitted threshold, if proven |
| **Invasive** | `invasive` | every animal (never the invasive register alone) | **never**; "suspected <species>" only when the top answer is itself invasive, "looks native" otherwise, "needs an expert" for a species with an invasive subspecies — always a suggestion for a person |

Common to all three:

- Scores are the model's own share of every Taiwan taxon, never re-normalised
  over what a rule set keeps (re-normalising turns a 1% animal behind a plant
  into 100%).
- Crabs (Malacostraca) are never named by the model by itself unless they clear
  the same bar as everything else.
- A model version the thresholds were not fitted on names nothing.
- **No answer that says "invasive" is named by the model on any page.** A
  record's species decides whether it is in the invasive database, and on the
  live set a native 布氏樹蛙 scored 0.979 as the invasive 斑腿樹蛙 under the
  wildlife rules too.
- **No species is named by the model when a congener it also lists is blurred
  more strictly.** At the first roadkill threshold fitted, one of the two
  wrong names was 紅頭綠鳩 (protected, class II) called 綠鳩 (not), which would
  have published its location exact; the true species was on the list the
  model returned.
  This costs about 7% of the roadkill names and none of the reports: they
  become suggestions, blurred as the strictest species shown.
- Whenever a species is named, the record is blurred at least as hard as the
  strictest row sharing its binomial (`photoIdentificationOverride`), exactly as
  before. A record left unidentified is blurred at least as hard as the
  strictest species it is shown with (`suggestionOverride`).
- A record the model named says **"Identified by AI"** (由 AI 辨識) on its page.

The habitat exception matters: 凶狠圓軸蟹 *Cardisoma carnifex*, a land crab with
272 TaiRON road records, is flagged marine and not terrestrial in TaiCOL, and so
are most of the crabs TaiRON finds on roads.

## What was measured (28 September 2026)

Everything is at species level (genus and epithet), with no cropping, by
`apps/ml/evaluate.py --fit --write`; every number with an interval is a 95%
Wilson interval. The committed record is
`apps/web/lib/report/classifier-thresholds.json`.

| Set | Photographs | Species | Used for |
|---|---|---|---|
| live (iNaturalist, existing) | 308 | 77 | wildlife rule set |
| **dead** (iNaturalist, annotated Dead, Taiwan, research grade, created after 2024-06-01, CC0/BY/BY-NC, ≤10 per species) | 1,144, of which 1,032 are of animals a roadkill report can show | 349 | roadkill rule set |
| **look-alike** (same filters, not dead) | 298: 173 native, 125 invasive | 33 | invasive gate |

Built by `apps/ml/build_inat_evalset.py` at one request a second; each item
keeps the photographer's attribution, licence and observation address. For
testing only: never training, never published, never committed (`data/` is
gitignored). Four wanted species had no usable photograph: *Rattus exulans*,
*Boiga irregularis*, *Cipangopaludina chinensis*, *Threskiornis melanocephalus*.

### Contract 1 against contract 2

| | Contract 1 today | Contract 2 |
|---|---|---|
| Live, top-1 / top-5 | 76.0% / 93.5% (`sighting` list) | 76.3% / 95.1% (wildlife) |
| Live, named by the model | 34.1% of reports, 92.4% right [85.7, 96.1] | 25.7%, 79/79 right [95.4, 100] |
| Dead, top-1 / top-5 | 52.7% / 71.1% (`roadkill` list) | 60.8% / 83.4% (roadkill, the 1,032) |
| Dead, named by the model | 21.1% of reports, 85.5% right [80.5, 89.4] | 14.3%, 146/148 right [95.2, 99.6] |
| Look-alike natives called invasive | 110/173 = 63.6% in the high band (`invasive` list) | 5/173 = 2.9% [1.2, 6.6] "suspected" |

Contract 1 names more, and is wrong far more often: on dead animals, about one
name in seven. Neither contract has ever been run on a real report.

### The thresholds the website uses

| Rule set | Names a species at score ≥ | Right when it does | Share of reports named | Shows the top 5 at ≥ |
|---|---|---|---|---|
| Wildlife (`sighting`) | 0.953 | 79/79 = 100% [95.4, 100] | 25.7% | 0.378 |
| Roadkill (`roadkill`, `injured`) | 0.967 | 146/148 = 98.6% [95.2, 99.6] | 14.3% | 0.272 |
| Invasive | never | — | 0 | 0.378 (fitted on the live set) |

**"Proven right at least 95% of the time" is read strictly**: the lower end of
the interval must reach 95%, not the point estimate. A threshold is picked on
the same photographs it is measured on, and a point estimate chosen that way
sits at the target by construction. The looser reading would name more
(wildlife 0.827: 41.2% of reports at 95.3% [90.1, 97.8]; roadkill 0.887: 23.8%
at 95.1% [91.7, 97.2]), but fitted on half the species and tested on the other
half it fell to 93.0% (wildlife) and 89.4% (roadkill). **This is a team
decision** (plan question 5) and the only change needed to make it is the
criterion in `evaluate.py`; the strict reading is the default because a wrong
name can publish a protected animal at the wrong blur.

At the chosen thresholds the model named 2 dead animals wrongly (a horseshoe
bat as another horseshoe bat; a house swift as a barn swallow), neither
published less blurred than its true species needs, and no live animal.

### The invasive gate

| | Live set | Look-alike set |
|---|---|---|
| Natives called "suspected invasive" | 5/276 = 1.8% [0.8, 4.2] | 5/173 = 2.9% [1.2, 6.6] |
| Natives called "needs an expert" (a species with an invasive subspecies) | 1 more | 12 more |
| Invasives flagged "suspected" | 28/32 = 87.5% [71.9, 95.0] | 105/125 = 84.0% [76.6, 89.4] |

The natives it still calls invasive are the pairs the public confuses:
布氏樹蛙 as 斑腿樹蛙 (0.88–0.98), 澤蛙 as 海蛙, 大頭蛇 as 棕樹蛇. No threshold
separates them, which is why every invasive answer goes to a person.

### Crabs, and the rest by class

Crabs: the right species first 37 times in 123 (30.1% [22.7, 38.7]; 34/119
dead, 3/4 live), and in the top 5 about half the time on dead photographs. **The
model never names a crab by itself**; it suggests. Dead animals by class, top-1:
birds 69.1%, reptiles 63.5%, mammals 55.7%, amphibians 53.3%, crabs 28.6%, fish
14.4% (fish are outside the roadkill rule set and not in its fit).

### Not measured

- Cropping with MegaDetector, and prompts with English names or "dead"
  wording, on the dead set. Cropping stays off, as measured on live photos in
  August.
- Any real report. The dead set is iNaturalist photography: someone chose to
  photograph that animal, usually close. A phone photo from a moving scooter is
  harder, so these are upper bounds.
- The invasive gate on plants, egg masses or fire-ant mounds: the invasive
  rule set names animals only.

## Production rollout (the orchestrator or owner does this; the branch did none of it)

Nothing below was run against production by the change itself. The order
matters: each step is safe on its own, and the website is switched last.

**0. Before you start.** From the repository root, on a machine that has
`data/embeddings/` (the files are gitignored). The Modal CLI is
`apps/ml/.venv/bin/modal`, profile `neolava2`:

```bash
apps/ml/.venv/bin/modal profile activate neolava2
apps/ml/.venv/bin/modal app list            # conservation-classifier: deployed
```

**1. Check the v2 files against production's taxa.**

```bash
DATABASE_URL=<production pooler> npm run preflight --workspace @conservation/scripts
```

Expect `ok` on "v2 classifier species keys resolve to accepted taxa" (64,779 of
64,779) and "v2 classifier rows resolve to accepted taxa" (69,051 of 69,051).
If production has had a TaiCOL refresh the local copy has not, rebuild against
it first: `ML_DEVICE=mps DATABASE_URL=<production> apps/ml/.venv/bin/python
apps/ml/build_embeddings.py` (about ten minutes on Apple silicon; it only reads
the database).

**2. Upload the v2 files to the volume.** The v1 files stay; the legacy
contract still reads them.

```bash
apps/ml/.venv/bin/modal volume put conservation-embeddings data/embeddings/taxa_embeddings_v2.npy /taxa_embeddings_v2.npy
apps/ml/.venv/bin/modal volume put conservation-embeddings data/embeddings/taxa_keys_v2.json /taxa_keys_v2.json
apps/ml/.venv/bin/modal volume ls conservation-embeddings   # v1 and v2 files, side by side
```

**3. Deploy the model service.**

```bash
apps/ml/.venv/bin/modal deploy apps/ml/modal_app.py --tag evidence-contract
```

The endpoint URL does not change. The live website still sends contract 1 and
gets the same answers as before.

**4. Smoke-test both contracts** against the deployed endpoint (one cold start,
three GPU calls; the token and URL are read from the environment and not
printed):

```bash
ML_ENDPOINT_URL=<from Vercel> ML_ENDPOINT_TOKEN=<from Vercel> DATABASE_URL=<production pooler> \
  apps/ml/.venv/bin/python apps/ml/smoke.py \
    --image data/evalset/images/5938615954.jpg --expect "Duttaphrynus melanostictus"
```

Every line must say `ok`: a bad token refused in both contracts, contract 1 in
its old shape from `bioclip2-vitl14-v1`, contract 2 with 50 candidates from
`bioclip2-vitl14-v2`, and both top answers resolving to 黑眶蟾蜍 in production.
(The photograph is from the evaluation set: iNaturalist, CC BY-NC, by
gfk20160220.) If contract 2 answers 503, the v2 files are not on the volume.

**5. Merge the website PR.** Vercel deploys it with `ML_CONTRACT` unset: the
worker behaves exactly as before.

**6. Switch the website over.** In Vercel → Project → Settings → Environment
Variables, Production: add `ML_CONTRACT` = `2`. Environment changes take effect
on the next deployment, so redeploy production (Deployments → the current one →
Redeploy).

**7. Check it took.** After the next classification run:

```sql
select model_version, count(*) from classifications
 where created_at > now() - interval '1 day' group by 1;
-- bioclip2-vitl14-v2 rows: the website is on contract 2
select r.category, r.ai_band, r.taxon_source, r.flagged_reason
  from reports r
 where exists (select 1 from classifications c
                where c.report_id = r.id and c.model_version = 'bioclip2-vitl14-v2');
```

and confirm no job is stuck: `select status, count(*), max(last_error) from
classification_jobs group by 1;`.

### Rolling back

- **Website only** (the usual case): delete `ML_CONTRACT` in Vercel, or set it
  to `1`, and redeploy. The worker goes back to contract 1 at once. Nothing
  needs migrating: rows written under contract 2 use the same columns and hold
  ordinary `taxa.id`s.
- **Stop the AI naming species, keep everything else**: set every profile's
  `autoAssign` to `false` in `apps/web/lib/report/classifier-thresholds.json`
  and deploy; every answer becomes a suggestion.
- **Model service**: `apps/ml/.venv/bin/modal app rollback conservation-classifier`
  returns to the previous deployment. Only needed if step 4 failed on contract
  1; the v2 files on the volume are harmless and can stay.

If `ML_CONTRACT=2` is set while the model service is still the old one, nothing
is published under a guess: the old service answers a request without a
category with a 400, the job is retried five times, and the report is held,
blurred, as "classification unavailable".

## Re-running the measurements

```bash
apps/ml/.venv/bin/python apps/ml/build_inat_evalset.py dead        # ~20 min, 1 request/s
apps/ml/.venv/bin/python apps/ml/build_inat_evalset.py lookalike
ML_DEVICE=mps apps/ml/.venv/bin/python apps/ml/evaluate.py --fit --write
```

`--write` rewrites `classifier-thresholds.json`; commit it with the numbers it
printed. The iNaturalist photographs are for testing only: never training,
never published, never committed. Each manifest line keeps the photographer's
attribution, the licence (CC0, CC BY or CC BY-NC only) and the observation's
address.

Run the classifier locally, without Modal, with
`ML_ENDPOINT_TOKEN=<any local value> apps/ml/.venv/bin/python apps/ml/serve_local.py`
and point a local website at it with `ML_ENDPOINT_URL=http://127.0.0.1:8765` in
the environment (which wins over `apps/web/.env`, where the URL is production's).
