# W0e — Unblurred protected records

Repo `/Users/neo/conservation`; paths relative to `apps/web` unless they start with `supabase/` or
`packages/`. Read at `c73bb8d`. **Ships before everything else in this plan, including the other W0
workstreams.** It has no copy dependency, no design dependency and no native-read gate.

**Goal**
No published record sits at its true coordinates because nobody knew what species it was. The
location-precision trigger treats "no taxon" as "unknown sensitivity" — which it is — instead of as
"not sensitive", and the records already published under the old behaviour are re-blurred.

**Why / evidence** (every figure below was reproduced against the imported dataset, not estimated)

`set_report_public_location()` (`supabase/migrations/0003_reporting.sql:63-88`) only reads
`sensitivity` and `protected_status` when `new.taxon_id is not null`. When it is null both stay
NULL, and `precision_from_taxon(null, null)` falls through its `case` to `'exact'`
(`0003_reporting.sql:43-52`). So an unidentified record is published at its real location.

```
select count(*) from reports where status='published' and taxon_id is null;              -- 7336
select count(*) from reports where status='published' and taxon_id is null
  and location_precision='exact';                                                        -- 7336
```

Every one of the 7,336. And `reports_public` exposes `verbatim_name`
(`supabase/migrations/0010_capture_accuracy.sql`), so the species name is public beside the true
coordinate.

**542 of them are protected species.** The GBIF importer matches on the current accepted name
(`scripts/import-gbif.ts:186-187`), and these rows carry superseded synonyms, so nothing matched:

| `verbatim_name` (as imported) | Accepted name in `taxa` | Common name | Protected | Sensitivity | Rows |
|---|---|---|---|---|---|
| `Xenochrophis piscator` | *Fowlea flavipunctatus* | 草花蛇 | III | 輕度 | 445 |
| `Herpestes urva` | *Urva urva* | 棕簑貓 | III | 輕度 | 97 |

Both are rated 輕度, so the site's own policy is `coarse_10km`. They are published at `exact`
instead. The remaining 6,794 untaxoned records are latent risk of the same kind: their sensitivity
is unknown, so the site cannot claim they are safe to publish precisely.

This is the exact failure the privacy design exists to prevent — `about.privacyBody` tells readers
that publishing precise coordinates of protected species is "a map for poachers" and that the site
does not do it. Today, for these records, it does.

**Scope** — In / Out
In: the trigger's null-taxon branch; a backfill of already-published rows; a regression test; a
`REQUIRED_SCHEMA` entry; the hand-off SQL for production.
Out: resolving the synonyms to real taxa so these records get their *correct* policy rather than the
conservative fallback — that is **W0c** steps 7-9, which should follow this; it is the durable fix,
this is the stop-loss. The submission-path equivalent (`route.ts:109` applies
`UNIDENTIFIED_PRECISION` only when `awaitingId`, so a no-photo unnamed report a moderator publishes
is exact) is **W6** step 2 — if W6 is far off, fold that one line in here, since this trigger change
already covers it at the database level. Moderator publication is **W11** PR1.

**Depends on / Blocks**
Depends on nothing. **Blocked by an unrelated prerequisite**: production is still missing migrations
`0009` and `0010` (`/api/health` reports `schemaCurrent: false`), so any migration hand-off must
apply those first or the numbering diverges. Blocks nothing in code, but W0c's remap should land
after it so the two SQL hand-offs are sequenced.

**Decisions needed from the owner**
1. **Apply the SQL to production.** Truly blocking; the engineer holds no production credentials.
   This is the whole point of the workstream. Default: apply the same day it is reviewed.
2. Blur radius for unknown species: `coarse_10km`, matching `UNIDENTIFIED_PRECISION`
   (`packages/shared/src/index.ts:297`) and what the submission path already does. Default yes. The
   alternative, `coarse_50km`, is more conservative and makes the map visibly coarser for 16% of
   records.
3. Accept that 7,336 dots move on the public map (5.5 km on average, measured). Default yes — the
   positions were never trustworthy. Not blocking.

**Behaviour spec**

In `set_report_public_location()`, derive the taxon policy in both branches:

```sql
if new.taxon_id is not null then
  select sensitivity, protected_status into sens, prot from public.taxa where id = new.taxon_id;
  p_taxon := precision_from_taxon(sens, prot);
else
  -- No taxon means the sensitivity is unknown, which is not the same as "not sensitive".
  -- Anything unidentified is blurred until something identifies it. This matches
  -- UNIDENTIFIED_PRECISION on the submission path (packages/shared/src/index.ts:297).
  p_taxon := 'coarse_10km';
end if;
```

Everything else in the function is unchanged, including the "most conservative of taxon policy and
explicit override wins" rule, which still holds: an override can only tighten.

Backfill, in the same migration, after the function is replaced:

```sql
update reports set location = location where taxon_id is null;
```

The trigger is `before insert or update of location, taxon_id, precision_override`, so assigning
`location` to itself re-fires it and recomputes `location_public` and `location_precision`. Measured
locally: `UPDATE 7336`, all of them land on `coarse_10km`, and no record with a taxon changes.

**Implementation steps** (one commit each)
1. `supabase/migrations/0011_blur_unknown_taxa.sql`: the `create or replace function` above plus the
   backfill, with a comment naming the two synonym pairs as the reason. Number it 0011 unless W8's
   `0011_admin_areas.sql` has already taken the number.
2. `apps/web/lib/schemaStatus.ts`: add a `REQUIRED_SCHEMA` entry that fails when the old behaviour is
   present — e.g. a query asserting no `published` row has `taxon_id is null and
   location_precision = 'exact'`. The file's own comment asks for one per behaviour the app relies
   on.
3. `apps/web/test/privacy.test.mjs`: extend it. Insert a published report with `taxon_id = null` and
   assert `location_precision = 'coarse_10km'`, that `location_public` differs from `location`, and
   that `reports_public` never returns a row that is both `taxon_id is null` and
   `location_precision = 'exact'`. Add the same assertion over the whole fixture, so a future import
   cannot reintroduce it.
4. `docs/launch-checklist.md`: record the hand-off — apply `0009`, `0010`, then this one, then
   `npm run db:migrate -- --baseline`.

**Acceptance criteria**
- Locally, after the migration: `select count(*) from reports where status='published' and taxon_id
  is null and location_precision='exact'` returns **0** (was 7,336), and the 542 rows named
  `Xenochrophis piscator` or `Herpestes urva` are all `coarse_10km`.
- `select count(*) from reports where taxon_id is not null and location_precision='exact'` is
  unchanged — identified records must not move.
- `npm test --workspace apps/web` passes, including `privacy.test.mjs`, `stats.test.mjs`,
  `tiles.test.mjs` and `map-bins.test.mjs` (tile bin counts shift as dots merge into cells; update
  the fixture expectations only, never the privacy assertions).
- `/api/health` on production returns `schemaCurrent: true` after the owner applies it.
- A tile probe at z14 over a known 草花蛇 location returns no point at the original coordinate.

**How to verify**
```bash
psql "$DATABASE_URL" -f supabase/migrations/0011_blur_unknown_taxa.sql
psql "$DATABASE_URL" -c "select location_precision, count(*) from reports where taxon_id is null group by 1"
npm test --workspace apps/web
```
Never delete `apps/web/.next` while the dev server runs (stop it, remove, restart). Mass test
timeouts are local DB contention — re-run before diagnosing.

**Risks and traps**
- The trigger is load-bearing and its `set search_path = public` is deliberate: `pg_dump` emits an
  empty `search_path` before `COPY`, so an unqualified `taxa` reference breaks any restore. Keep the
  clause when replacing the function.
- `obscure_point(location, id, cell)` is deterministic per record id, so re-running the backfill is
  idempotent and a record does not wander between runs.
- The backfill rewrites 7,336 rows and their `geom_3857`; take the usual care on production and
  expect the tile cache to serve stale tiles until it expires.
- Do **not** "fix" this inside `precision_from_taxon()`. That function cannot tell a null taxon from
  a taxon with no protection, and changing it would blur every unprotected identified species too.
- This lowers precision, so it can only ever hide records. It cannot expose one. The *reverse* is
  true of W0c's remap, which will move some of these records back to `exact` once their real taxon is
  known — that direction needs the owner's sign-off, which W0c already calls for.
