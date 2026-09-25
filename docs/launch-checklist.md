# Launch checklist

Everything you need to do to get this live, in order. Written 2026-08-05.

Each step says what to do, what it costs, and what breaks if you skip it. Steps
1–7 are required. Step 8 is the go/no-go check. Steps 9–10 can follow launch.

Rough time: **2–3 hours**, most of it waiting.

---

## 1. Put the code in version control

Nothing else can happen first — Vercel deploys from a git repository, and right
now there is no `.git` directory at all. Weeks of work with no history and no way
to undo anything.

```bash
git init
git add -A
git commit -m "Taiwan conservation map"
```

Check before you commit that `data/` is ignored — it holds ~575 MB of embeddings
and cached eval images that must not go into git. `.gitignore` already covers it;
`git status` should not list anything under `data/`.

Then create an **empty private repo** on GitHub and push:

```bash
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

Private, not public, until you have decided about the API keys in step 7 — and
even then, `.env` is gitignored and must stay that way.

---

## 2. Create the Supabase project

<https://supabase.com/dashboard> → New project. Pick the **Singapore** or **Tokyo**
region — closest to Taiwan, and latency here is user-visible on every map tile.

**Then run the functions in the same place.** Production's database is Tokyo
(ap-northeast-1), and `apps/web/vercel.json` pins functions to `hnd1` to match.
Until 17 September 2026 they ran in Vercel's default, `iad1` in Virginia, so every
tile the CDN had not cached crossed the Pacific five times — about 150 ms a round
trip — before it could answer a visitor in Taiwan. If the database ever moves,
move `regions` with it.

**That file has to live in `apps/web`, not at the repo root.** The Vercel
project's Root Directory is `apps/web`, and Vercel reads `vercel.json` only from
there. The root `vercel.json` is ignored entirely — which is why the crons it
declares have never been deployed.

Save the database password it shows you; it is displayed once.

Connection strings live behind the **Connect** button in the top bar of the
project, next to the project name — *not* under Project Settings, which is where
they used to be. The modal has a tab per connection type.

You need two of them, and they are not interchangeable:

| | Host | Port | Username | Used for |
|---|---|---|---|---|
| **Direct** | `db.<ref>.supabase.co` | 5432 | `postgres` | loading the database, step 3 |
| **Transaction pooler** | `...pooler.supabase.com` | 6543 | `postgres.<ref>` | the app — `DATABASE_URL` in Vercel |

The differing username is the quickest way to tell which one you have copied.

Serverless functions exhaust a direct connection under load, which is why the app
uses the pooler. The transaction pooler in turn cannot run the multi-statement
session a data load needs, which is why step 3 does not use it.

**If the direct connection will not connect**, that is expected rather than
broken: Supabase direct connections are IPv6-only unless you have the IPv4
add-on, and most home networks are IPv4. Use the **Session pooler** (also port
5432) for step 3 instead — it holds a session the way a direct connection does.
The transaction pooler on 6543 is the one that genuinely cannot substitute.

From **Project Settings → API** collect the project URL, the `anon` key and the
`service_role` key.

---

## 3. Load the database

**Do not re-run the importers against production.** `taxa.id` is a `bigserial`,
and the embedding matrix already uploaded to Modal stores those exact ids. A fresh
TaiCOL crawl assigns ids by insertion order, so any upstream change shifts them —
and the classifier would then return **the wrong species**, confidently, with
nothing logging an error. Copy the database you already have instead. It is also
far faster: the crawls take hours, this takes minutes.

```bash
npm run db:up                      # local database must be running
./scripts/dump-for-production.sh   # -> data/export/production.sql (~48 MB)
```

### You need a `psql` client

There is none on this machine's PATH. Either install one:

```bash
brew install libpq && brew link --force libpq
```

…or use the one already inside the local Postgres container, which is version
17.6 and so exactly matches the dump. Every `psql` command below then becomes:

```bash
docker exec -i supabase_db_conservation psql "$PROD_DIRECT_URL" ...
```

with `-f -` and the file redirected in from outside, e.g.
`docker exec -i supabase_db_conservation psql "$PROD_DIRECT_URL" -v ON_ERROR_STOP=1 -f - < data/export/production.sql`.

### Check the connection before loading anything

```bash
psql "$PROD_DIRECT_URL" -c 'select version();'
```

If that hangs or reports "no route to host", it is the IPv6 issue from step 2 —
switch to the **Session pooler** string and carry on. Everything below is
unchanged.

Then, against the **direct** (or session pooler) URL, in this order:

```bash
export PROD_DIRECT_URL='postgresql://postgres:...@db.xxx.supabase.co:5432/postgres'

psql "$PROD_DIRECT_URL" -c 'create extension if not exists postgis;' \
                        -c 'create extension if not exists pg_trgm;'

for f in supabase/migrations/*.sql; do
  psql "$PROD_DIRECT_URL" -v ON_ERROR_STOP=1 -f "$f"
done

psql "$PROD_DIRECT_URL" -v ON_ERROR_STOP=1 -f data/export/production.sql

# Then record what that loop applied, so later migrations can use the runner:
DATABASE_URL="$PROD_DIRECT_URL" npm run db:migrate -- --baseline
```

**That last line is not optional.** The loop above applies the files without
writing `_migrations`, so `npm run db:migrate` would later believe nothing had
ever been applied, start at 0001 and abort against tables that already exist —
having applied nothing. That is how 0009 and 0010 sat unapplied on production
while the deployed code wrote a column and a `taxon_source` value the database
did not have, which 500s every submission and is invisible from outside.
`/api/health` reports `schemaCurrent` and names what is missing.

Order matters and each part earns its place: the extensions must exist before the
indexes that use them, the migrations create the schema *and* the `web_anon` role
and grants that a data dump cannot carry, and the dump then supplies the rows with
their ids intact. This exact sequence was rehearsed against a scratch database —
125,438 taxa and 46,402 reports load clean, and the id sequence lands correctly so
new reports do not collide.

---

## 4. Check Modal is still running

Already deployed and working — this is just a confirmation.

```bash
apps/ml/.venv/bin/modal app list      # conservation-classifier should be deployed
```

Idle cost is zero; it scales to zero between requests. If you ever change
`apps/ml/`, redeploy with `modal deploy apps/ml/modal_app.py`.

---

## 5. Get Cloudflare Turnstile keys — **do not launch publicly without this**

<https://dash.cloudflare.com> → Turnstile → Add site. Free. Enter the domain you
will use.

You get a **site key** (public) and a **secret key** (private).

Skip this and there is no bot protection on submissions at all. The endpoint is
otherwise open to the internet, and a public map that anyone can flood with junk
is a map nobody trusts.

---

## 6. The basemap needs no key

The map background comes from OpenFreeMap: free, no account, no key, and its
terms allow a public site. Place names show in Traditional Chinese on Chinese
pages and in English on `/en`, rewritten in `apps/web/lib/basemap.ts`.

It replaced CARTO in September 2026, when CARTO began stamping "API KEY
REQUIRED" across every tile served without a key. OpenFreeMap has no SLA, so if
it goes down the maps fall back to a plain dark background and the site's own
data keeps drawing. A second, keyed provider would remove that single point of
failure. CARTO's free key tier (<https://carto.com/basemaps/apikey>) is the one
whose terms clearly fit; it needs someone to request the key, and is not wired
in yet.

Do **not** set `NEXT_PUBLIC_MAPTILER_KEY`. MapTiler's free plan is limited to
"non-commercial use", which it never defines, pauses the map when its quota runs
out, and requires a logo this site does not render.

---

## 7. Deploy to Vercel and set the environment

<https://vercel.com/new> → import the GitHub repo. It is a monorepo: set **Root
Directory** to `apps/web`.

Then **Settings → Environment Variables**, for Production *and* Preview:

| Variable | Value | If you skip it |
|---|---|---|
| `DATABASE_URL` | the **pooler** string, port 6543 | nothing works |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | photo upload fails |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` key | sign-in fails |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key | photo upload and the worker fail |
| `CRON_SECRET` | `openssl rand -hex 32` | reports are never identified |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | from step 5 | no bot protection |
| `TURNSTILE_SECRET_KEY` | from step 5 | no bot protection |
| `ML_ENDPOINT_URL` | from your local `.env` | no species identification |
| `ML_ENDPOINT_TOKEN` | from your local `.env` | no species identification |
| `NEXT_PUBLIC_MAPTILER_KEY` | leave empty (see step 6) | nothing — the default basemap needs no key |

The `service_role` key bypasses every access rule in the database. It belongs in
Vercel's environment and nowhere else — never in `NEXT_PUBLIC_*`, never in git.

### The crons: two faults, and only one of them was known

Both jobs are now declared in `apps/web/vercel.json` and both routes now export
a `GET`. Before that, **two independent faults hid behind each other**, and
either alone was enough to keep the loop from ever running.

**Fault 1 — declared where Vercel does not look.** The `crons` block lived in the
repo-root `vercel.json`. The project's Root Directory is `apps/web` and
`vercel.json` is only honoured from there (step 2 says the same thing about
`regions`), so the schedules were never created. The root file has been deleted
rather than emptied: a root `vercel.json` is not merged, not warned about and not
applied, so its only effect is to persuade a reader that something is configured.

**Fault 2 — the wrong method.** Vercel Cron issues **GET**. Both routes exported
only `POST`, so every nightly invocation would have been answered **405** even
after fault 1 was fixed. This page previously said moving the block "is enough to
make it fire". That was wrong, and it was wrong in the worst possible direction:
someone following it would have moved the block, seen a green deploy, and
believed the loop was running.

Neither fault can announce itself. A schedule that was never created does not
appear anywhere to be missing, and one that 405s writes no job row, logs no
application error, and leaves reports at `pending` — indistinguishable from
"nobody has submitted anything yet". `apps/web/test/cron-reachable.test.mjs` now
fails on either half.

**The cadence is still a decision, and it is yours.** They are declared **daily**
— `0 3 * * *` and `0 4 * * *`. Daily is what Vercel's Hobby plan allows;
anything finer needs Pro. So a report now waits up to 24 hours for its species,
which is not what the receipt copy implies and makes step 8's go/no-go
impractical to run. Three ways out: accept the wait and change the copy, upgrade
to Pro, or point an external scheduler at `POST` (kept for exactly this) with the
`CRON_SECRET`.

Until that move happens — or instead of it — drive the endpoint from anything
that can make an authenticated request on a schedule:

```bash
curl -X POST https://<your-domain>/api/jobs/classify \
     -H "Authorization: Bearer $CRON_SECRET"
```

---

## 8. Verify — the go/no-go step

```bash
DATABASE_URL='<pooler url>' \
CRON_SECRET='<the one you set>' \
TURNSTILE_SECRET_KEY='<the one you set>' \
npm run preflight
```

17 checks. Every one of them corresponds to something that fails *silently* in
production rather than crashing: a privacy leak, a wrong species, a dead worker.
It must print **17/17 passed**. The one that matters most is
`web_anon CANNOT read reports` — that single grant is the entire location-privacy
boundary.

Then, by hand, on the live site:

1. Load the map. Cells appear over Taiwan.
2. Submit a report with a photo from a phone.
3. Confirm it does **not** appear on the map immediately — it is held until the
   species is known, because an unidentified animal might be a protected one.
4. Wait for the cron, then confirm it appears with a species attached.
5. Open `/api/health` — it should return `ok: true`.

If step 4 never happens, the cron is not firing. See step 7.

---

## 9. Before you tell anyone about it

- **Fill in the real contact details.** `/privacy` and `/about` are written but
  reference no actual contact. Taiwan's 個人資料保護法 applies — you collect
  location and optionally email, and people need a way to reach you to have
  their data removed.
- **Talk to 路殺社 / TBIA first.** The map is seeded with 46,402 of their
  records, properly attributed. They have a decade of expert verification. Come
  as a complement, not a competitor — and they are also the most likely source of
  the real roadkill photos in step 10.
- **Decide who moderates.** If submissions take off, expert verification is the
  bottleneck, not compute.

---

## 10. After launch

- **Real roadkill photos.** The single highest-value thing for accuracy, and the
  one thing I could not do. Every accuracy figure in the README is measured on
  well-framed iNaturalist images of live animals; real roadkill is dead, damaged
  and against asphalt. Those numbers are an optimistic upper bound for the exact
  category this project exists to serve. With a few hundred real photos, both
  confidence thresholds can be refitted and the MegaDetector question settled.
- **Publish back to GBIF.** `npm run export:dwca` is built and tested. Fill in the
  real `DATASET` homepage and contact in `scripts/export-dwca.ts`, register a
  publisher account or IPT, and upload. It exports only your own records —
  republishing the imported TaiRON data would duplicate 路殺社's occurrences
  under your name.
- **Backups.** Turn on Supabase PITR once there is user-contributed data. Seed
  data is reproducible; user submissions are not.
- **Watch the Modal bill.** It scales to zero, so this should stay near nothing,
  but set a budget alert.
