# What is actually in production

The planning documents in this directory were written before the work they
describe landed, and several still present finished work as pending. That is not
a filing problem: it cost real time this week, because an audit re-raised three
things as top priorities that had been done for days, and the only way to settle
any of them was to query production.

This file exists so that stops happening. It records **verified** production
state, with the date, the method, and — where it matters — an explicit "not
known". It is not a plan and contains no intentions.

Last verified **25 September 2026, 19:40 (Asia/Taipei)**.

## How these were checked

Two ways, both from outside the repo:

- HTTP against `https://preservation-web-one.vercel.app` — the live production
  alias. There is no custom domain: `biowatchintl.org` and
  `formosawatch.biowatchintl.org` are **NXDOMAIN**, not registered, so the
  `vercel.app` alias is the only address the site has.
- SQL through the Supabase Management API query endpoint, using the token in the
  macOS keychain. Production `DATABASE_URL` is marked Sensitive in Vercel and is
  genuinely unobtainable from here.

## Schema

**Migrations 0001–0013 are applied.** `/api/health` returns
`"schemaCurrent": true`, and that is a *data* assertion rather than a shape
check — `lib/schemaStatus.ts` verifies the rules the migrations were written to
establish, not merely that the columns exist.

**The `_migrations` ledger holds 13 rows.** It is baselined. `npm run db:migrate`
is the whole procedure for 0014 onward; it does not need `--baseline` again.

> `docs/plan-finish.md:345` still says migrations 0009 and 0010 are missing and
> that "the live site rejects every submission", and prints a `--baseline`
> command as pending work. Both are stale — that was true on 15 September.

## The GBIF taxon remap is applied

This is the one nothing recorded, and it is why an audit spent effort re-deriving
it. Verified directly:

| check | result |
|---|---|
| records still attached to 狼 (the wolf) | **0** |

The remap moved 14 dog records off the wolf, returned 鼬貛's 747 records to the
species directory, and put 草花蛇 (445) and 食蟹獴 (97) onto their corrected
protected names.

> `docs/redesign/README.md:60` still says "The naming fault it fixes is still
> live — 狼 still holds 14 dog records". It does not.

**Not known: how it reached production.** Either `scripts/taxon-remap.sql` was
run, or a post-remap dump was restored via `scripts/dump-for-production.sh`.
Nothing records which. The *outcome* is certain; the provenance is not.

Also void: the "331 loosenings needing an explicit yes/no". Commit `edd54e6`
regenerated the SQL so that correcting a name can never weaken a blur. The
loosening count is **0**. And `scripts/taxon-remap-report.csv` is not a valid
before/after record — it was regenerated after the local apply, so
`old_taicol_id` already holds the new taxon.

## The location-privacy invariants hold

Both are the whole point of the trigger ladder, and both are at zero:

| invariant | result |
|---|---|
| untaxoned reports sitting at `exact` | **0** |
| reports at `exact` on a taxon rated sensitive | **0** |

So W0e — the "live privacy exposure" the redesign README still leads with, 7,336
published records at exact coordinates including 542 of two protected species —
is fixed in production, not merely written.

> `docs/redesign/README.md:96` says "Applying it to production needs your
> credentials." It has been applied.

## The public data surface is closed

Migration 0013 revoked the table grants. The remaining hole could not be closed
in SQL, because `postgres` does not own the three PostGIS objects — so it was
closed in the dashboard instead: **PostgREST no longer exposes the `public`
schema.**

Every table now answers **404** to a valid client key — 404 rather than 401,
meaning PostgREST does not know they exist:

```
404  /rest/v1/taxa          404  /rest/v1/reports
404  /rest/v1/spatial_ref_sys   404  /rest/v1/geometry_columns
404  /rest/v1/geography_columns
200  /auth/v1/settings      ← unaffected; magic link is the only sign-in path
```

That also retired two things SQL could not reach: `anon` held DELETE and
TRUNCATE on `spatial_ref_sys` (deleting SRID 4326 breaks every geography
operation on the site), and `anon` could call 785 functions as RPC endpoints.
Nothing in this codebase calls PostgREST — there is not one `.from(` or `.rpc(`
anywhere — so closing it cost nothing.

## Corpus

From `/api/health`: **46,334 reports, 125,438 taxa, 506 species.**

Every public row is `source='gbif'`. Whether production has ever received a
**user** submission is **not directly checkable from here** — the base `reports`
table is not readable — but `/attribution` totals the same 46,334, which is
strong indirect evidence that it has not.

Note two stale numbers that are harmless because every page computes its own at
request time: the species count is **506**, not the 458 in
`api/health/route.ts:19-20` and `apps/biowatch/README.md`; and the record count
appears as 46,402 in some comments.

## The jobs have never run

Both crons were declared in the repo-root `vercel.json`, which Vercel does not
read, **and** both routes exported only `POST` while Vercel Cron issues `GET`.
Either fault alone was enough. So the submit → identify → publish loop has
executed **zero times** in production, which is indistinguishable from "nobody
has submitted anything" — see `docs/launch-checklist.md`.

The Modal classifier they point at **is** deployed and serving, so this was the
only missing link.

Both faults are fixed in [#67](https://github.com/28NS30/conservation/pull/67).
This section is therefore the shortest-lived thing in this file: once that merges
and deploys, the first `0 3 * * *` run is the first time the loop has ever
executed, and **that run is worth watching** — nothing downstream of it has been
exercised against production data.

## The design lab is reachable

`LAB_ENABLED=1` is set in Vercel production and a redeploy has picked it up.
`/lab`, `/lab/roundel`, `/lab/journal` and the Roundel deep pages all answer 200.
`/lab/journal/map` and `/lab/journal/report/stepper` 404 **by design** — only
home is built for both directions (`lib/lab/directions.ts`).

## Known outstanding, on the credential holder

- The legacy HS256 JWT signing key is `previously_used`, which still **verifies**.
  Retiring it needs the app moved to `sb_publishable_` / `sb_secret_` first.
- No custom domain, and the Vercel project `apps/biowatch/.vercel/project.json`
  points at does not exist — the team has exactly one project,
  `conservation-web`. So the parent site is finished code with no deployment
  target.
- Production SMTP for magic-link sign-in is not configured anywhere in the repo;
  `supabase/config.toml` covers localhost only.
