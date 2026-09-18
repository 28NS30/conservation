# W0c — Trust fixes: copy that claims things that are not true

Repo `/Users/neo/conservation`; paths relative to `apps/web` unless prefixed; lines at c73bb8d; evidence re-checked against the local DB, production, GBIF and TaiCOL.

**Goal**
A visitor reads nothing false: nothing says records are on GBIF, that a model identifies species, or that the site takes "environmental reports"; no "map" link opens home; BioWatch's figures carry a source and date. No species page shows a wolf, 鼬貛 is in the directory, and protected animals whose names failed to match are blurred.

**Why / evidence**
- `gbif-copy`: `home.whatBody:436`, `home.taironBody:440` (messages/*.json; `app/[locale]/page.tsx:331,333`) say records *are* published to GBIF. Nothing has been (`scripts/export-dwca.ts:45-60` holds placeholders); `home.openBody`, `attribution.ourDataBody`, `me.journeyHint` say "plan" and are right.
- Retired categories still advertised: `site.tagline:4`, `site.description:5` (metadata, OG card, footer, the /about lede: `shots/about-fold.png`), `map.regionLabel:53`, `about.whatBody:308`, hard-coded `app/manifest.ts:15-17` (`short_name` is the older name 生態守望), OG fallback `opengraph-image.tsx:77`.
- A model is said to identify species: `home.how2/how2Body:415-416`, `about.whatBody`, `attribution.modelsBody:301`, `report.speciesUnsureHint:143` (W0a defers it here). The classify cron has never run in production: Vercel reads only `apps/web/vercel.json`, which declares none. `docs/launch-checklist.md:233-238` wrongly says "every minute".
- `error-links`: `errors.backHome:281` reads 回到地圖 / "Back to map" on `<Link href="/">` (`app/[locale]/error.tsx:38`, `not-found.tsx:13`; `shots/team-fold.png`). `app/global-error.tsx:13,14,17` keep retired slate and emerald hex.
- The owner's "never say nobody has reported yet" rule is broken by `list.empty:343`, `species.noRecords/beFirst:188-189` (`(site)/species/[id]/page.tsx:189-198`) and `season.noneYet:392` (live for everyone). W0b and W0d defer these here.
- `biowatch-stats` (`apps/biowatch`): silent fallbacks `lib/projects.ts:65,69`; "2011–" `:72` (data ends 2017); FlamaWatch figures `:91-93` copied 11 Aug, undated; `live` never rendered (`components/Project.tsx:16`); model and GBIF overstated (`projects.ts:62`, `app/page.tsx:126,168`); "Use the data" is a mailto (`:203-207`); `:85-90,251-255` imply BioWatch runs FlamaWatch. The default `FORMOSAWATCH` host does not resolve, so the fallback always shows.
- Data: `scripts/import-gbif.ts:186-187` matches on GBIF's `species`, which follows GBIF's taxonomy and collapses subspecies. TaiRON's "Canis lupus familiaris" became TaiCOL 狼 (taxon 97489, 14 records, blurred as protected II); "Melogale moschata subaurantiaca" became *Melogale moschata* (747; `is_in_taiwan=false`, so `lib/species.ts:161` hides it from /species). In all 16 taxa, 1,150 records. `api.taicol.tw/v2/nameMatch` resolves both (犬 t0085383, 鼬貛 t0027888).
- **Privacy defect, same cause.** 7,336 published rows (163 names) have no taxon, so `precision_from_taxon` returns `exact`. They include "Xenochrophis piscator" 445 (TaiCOL *Fowlea flavipunctatus*, III, 輕度) and "Herpestes urva" 97 (*Urva urva*, III, 輕度): at least 542 protected records unblurred. The largest, "Ptyas major" 2,004, was published by TaiRON as *Cyclophiops major*, which TaiCOL has: GBIF's `genericName` + `specificEpithet` recover it without an API call.

**Scope**
In: the keys below, both catalogues; `manifest.ts` text; OG fallback; three hex values; the species zero-state paragraph; one docs section; BioWatch provenance and wording; import matcher, crosswalk, remap script and report.
Out: receipts, `report.identifying` (W0a); legend wording (W0b); hrefs at `species/[id]/page.tsx:189-198`, the filtered-list line (W0d); manifest icons (W3); deleting home's explainer blocks (W4 rebases on these keys, then deletes); `species.cardRecordCount` (W7); `me.empty`, empty category chips (W8); /season redesign (W9); /about rewrite, error-page and OG redesign, English `global-not-found` (W10); BioWatch layout (W12); publishing to GBIF, the classifier, production migrations 0009-0010 that `/api/health` reports missing (owner).

**Depends on / Blocks**
Depends on nothing. Shares `messages/*.json` with W0a, W0b, W0d: edit only listed keys, never reformat, rebase before merge. W4, W10, W12 inherit the strings. /species and /stats counts change after the remap, so W13 baselines them after PR 3.

**Decisions needed from the owner**
1. Is the classifier about to be switched on? Default: no; copy describes today.
2. Run the remap on production; the engineer holds no production credentials and hands over reviewed SQL. **Blocks only the production data and privacy fix.**
3. Names TaiCOL splits (*Buergeria japonica* → *B. choui* / *B. otai*). Default: keep TaiRON's name; list for a biologist.
4. `short_name` 福爾摩沙守望. Default: yes.
5. BioWatch: set `NEXT_PUBLIC_FORMOSAWATCH_URL`; may FlamaWatch's figures be shown? Default: keep, dated and attributed.
6. Native zh-TW read of the table. **Blocks merging PR 1.**

**Design spec (behaviour)**
No layout change, no new tokens; identical under either direction. All copy "needs native read". Write 臺灣 (catalogue majority; house style is W2's call).

| key | zh-TW | en |
|---|---|---|
| `site.tagline` | 臺灣 · 公開野生動物紀錄 | Taiwan · open wildlife records |
| `site.description` | 臺灣的公開野生動物紀錄地圖，資料來自路殺社（TaiRON），任何人都能通報。 | An open map of wildlife records for Taiwan, built on TaiRON roadkill data. Anyone can add a report. |
| `map.regionLabel` | 臺灣野生動物紀錄地圖 | Map of wildlife records across Taiwan |
| `about.whatBody` | 一個公開的臺灣野生動物紀錄地圖。地圖上現有的紀錄由路殺社（TaiRON）志工收集，以 CC BY 4.0 釋出。任何人都可以通報路殺、受傷動物、外來入侵種或一般目擊，不需要帳號。 | An open map of wildlife records for Taiwan. Today's records were collected by 路殺社 (TaiRON) volunteers and released under CC BY 4.0. Anyone can report roadkill, an injured animal, an invasive species or a sighting; no account is needed. |
| `home.whatBody` (tail) | …所有紀錄公開；我們計畫依 Darwin Core 標準，把在這裡通報的紀錄回饋給 GBIF。 | …every record is public. We plan to publish reports made here to GBIF as a Darwin Core Archive. |
| `home.taironBody` (tail) | …也計畫把新的通報整理成公開資料回饋出去。 | …and plans to release new reports as open data in turn. |
| `home.how2` / `how2Body` | 寫上物種，或交給我們 / 知道是什麼動物就寫上，紀錄會照你寫的公開。不確定的，由人確認物種後才公開。 | Name it, or leave it to us / If you know the animal, say so and the record is published as you gave it. If not, a person identifies it before it appears. |
| `report.speciesUnsureHint` | 這比亂猜好。我們會記為未鑑定，由人確認物種後才公開。 | Better than a guess. We record it as unidentified, and a person identifies it before it appears. |
| `attribution.modelsBody` | append 目前尚未啟用；沒有物種名稱的通報由人確認。 | append "It is not switched on yet; a person identifies unnamed reports." |
| `errors.backHome` | 回首頁 | Back to home |
| `list.empty` | 這個篩選條件下沒有紀錄。 | No records match this filter. |
| `species.beFirst` | 通報這個物種 | Report this species |
| `season.noneYet` | keep only its second sentence | same |

Delete `species.noRecords` and its `<p>`; the action stays. `manifest.ts` description repeats both new `site.description` strings. `global-error.tsx`: `#94a3b8`→`#9d9179` (parchment-400), `#475569`→`#8b8270` (parchment-500), `#10b981`→`#cf7238` (ember-500), token names in comments; surface unchanged.

BioWatch: `stats: {value,label,note}[]` replaces `live`; `formosawatchCounts` reports liveness per field. One note line under the `<dl>`, existing label style: "Live from FormosaWatch, refreshed hourly" / "Approximate: FormosaWatch could not be reached" / "As stated on FlamaWatch's site, 11 Aug 2026"; "2011–2017", "Imported from TaiRON (路殺社), CC BY 4.0". Tile: "CC BY; GBIF publication planned". Remove "published back to the global biodiversity record" and "an open model helps identify the species". "Use the data" links to `${FORMOSAWATCH}/attribution`, email second. Add "FlamaWatch is run independently by its own organisation; BioWatch links to it and does not operate it."; footer label "Partner project"; metadata "in Taiwan, with a partner project in Colombia".

Matcher order: (1) the name TaiRON published, `genericName + specificEpithet (+ infraspecificEpithet)`, exact local match preferring `is_in_taiwan`; (2) a committed crosswalk from TaiCOL `nameMatch`, published name → `taicol_id`, accepted only when one taxon returns, it is in Taiwan and `matched_name` equals the query ("Sinomicrurus macclellandi" matches a subspecies string: review); (3) today's `species` match, only if `is_in_taiwan`; (4) `verbatim_name`. TaiRON's identification stands; this only translates names.

**Implementation steps** (one commit each)
1. Catalogue edits, listed keys only; drop the `<p>` in `species/[id]/page.tsx`.
2. `app/manifest.ts` text; `opengraph-image.tsx:77` fallback "An open map of wildlife records for Taiwan".
3. `app/global-error.tsx` hex.
4. `test/copy-truth.test.mjs`: fails if a catalogue value matches `/are published back to GBIF|publishes new reports back|environmental reports|環境通報|生態通報/`, if `errors.backHome` contains "map" or 地圖, or if `manifest.ts` contains 生態守望 or 環境通報.
5. `docs/launch-checklist.md:233-238`: the crons sit in the ignored root `vercel.json`, daily, and have never run.
6. BioWatch: `Project.tsx`, `lib/projects.ts`, `app/page.tsx`, `layout.tsx`, `README.md` (`NEXT_PUBLIC_FIREWATCH_URL`→`FLAMAWATCH`).
7. `scripts/import-gbif.ts`: three new `Occurrence` fields, matcher, crosswalk loader. Correct `lib/stats.ts:144-146`: the wolves are dogs our import mis-mapped, not a TaiRON misidentification.
8. `scripts/remap-gbif-taxa.ts`, dry-run by default: re-page the TaiRON dataset (cache in `data/cache/`), resolve, write `scripts/taxon-crosswalk.json`, `taxon-remap-report.csv` (old and new taxon, n, precision before and after, unresolved names) and `taxon-remap.sql` (plain updates by `source_id`, taxon looked up by `taicol_id`). `--apply` runs it locally.
9. Apply locally; commit the three files; hand the owner the SQL.

**Acceptance criteria**
- `copy-truth` and `i18n` tests pass. `grep -c "回饋給 GBIF" messages/zh-TW.json` is 3, each with 計畫.
- 回首頁 on `/species/x`, "Back to home" on `/en/species/x`; `/opengraph-image`, `/en/opengraph-image`, `/manifest.webmanifest` carry no "environmental", 環境 or 生態守望.
- A zero-record species page shows the action and no absence sentence, both locales.
- Locally after `--apply`: no public record on taxon 97489; 鼬貛 on /species with 747; no "Herpestes urva" or "Xenochrophis piscator" row is untaxoned or `exact`; non-Taiwan-taxon records fall from 1,150 to the listed unresolved set; the report flags every change that loosens precision (dogs: `coarse_10km`→`exact`) for owner sign-off; `privacy`, `species`, `stats`, `home` tests pass.
- BioWatch builds; every stat has a note; no "published back".
- Screenshots 1440×900 and 390×844: `/about`, `/en/about`, a dead species URL in both locales, a zero-record species, BioWatch `/`. No layout change, no new client JS, /map untouched; contrast unchanged except `global-error`, whose three new pairs pass AA on bark-950.

**How to verify**
`npm run test --workspace @conservation/web`; with `npm run dev` up, `npm run test:pages`. Playwright sends no Accept-Language, so `/` renders zh-TW: load `/en/...` explicitly. Bogus JSON.parse 500s after catalogue edits: stop the server, `rm -rf apps/web/.next`, restart (never while it runs). Mass timeouts are local DB contention: re-run. `npm run build --workspace @biowatch/site` (not in CI). `npx tsx scripts/remap-gbif-taxa.ts`, read the CSV, `--apply`, check with `docker exec supabase_db_conservation psql -U postgres`.

**Risks and traps**
- The remap changes blur. The trigger fires on `update of taxon_id` (`supabase/migrations/0003_reporting.sql:91-93`): plain UPDATEs only, never write `location_public`. "Can only tighten, never loosen" describes `precision_override`, not taxon changes. Cached tiles lag.
- `data/` is gitignored (`.gitignore:14`): a crosswalk saved there is silently never committed.
- `taxa.id` is a bigserial the classifier's embeddings depend on (`scripts/dump-for-production.sh`): never re-import TaiCOL to fix this.
- `import-gbif` is idempotent ("re-runs insert nothing"): fixing the matcher repairs no existing row.
- Do not flip the three "plan" strings to present tense (`me/page.tsx:271-272`: "Nothing here claims an upload that has not happened"). Leave `privacy.thirdPartyBody`: over-disclosure is safe.
- `global-error.tsx` stays inline hex: "Deliberately dependency-free and bilingual by hand". `global-not-found.tsx` is already labelled correctly.
- OG copy stays catalogue-driven ("so the card cannot drift from the page"). `home.test.mjs` pins `home.tagline`, not `site.tagline`. BioWatch has no CI.

**Suggested PR breakdown and effort**
PR 1 web copy, manifest, OG fallback, hex, docs, guard test (steps 1-5): 0.5 day plus the native read. PR 2 BioWatch (6): 0.5 day. PR 3 matcher, crosswalk, remap, report (7-9): 1.5 days; production apply is the owner's. Total M, about 2.5 days.
