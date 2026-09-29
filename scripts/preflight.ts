/**
 * Pre-launch checks. Run against production before and after deploying.
 *
 *   npm run preflight                    # uses DATABASE_URL from .env
 *   DATABASE_URL=<prod-pooler-url> npm run preflight
 *
 * Every check here corresponds to something that fails *silently* in production —
 * a wrong answer, a leak, or a dead feature — rather than an obvious crash. That
 * is the whole point: obvious breakage announces itself, this does not.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db.ts";
import { RETIRED_TWINS_SQL } from "./taxa-overrides.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type Result = { name: string; ok: boolean; detail: string; fatal: boolean };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail: string, fatal = true) =>
  results.push({ name, ok, detail, fatal });

async function main(): Promise<void> {
  /* ---------------- schema ---------------- */
  const [tables] = await sql<{ missing: string[] }[]>`
    select coalesce(array_agg(t), '{}') as missing from unnest(array[
      'reports','taxa','report_photos','classifications','classification_jobs',
      'profiles','moderation_actions','rate_limits'
    ]) t
    where to_regclass('public.' || t) is null`;
  check("all tables exist", tables.missing.length === 0, tables.missing.length ? `missing: ${tables.missing}` : "8/8");

  const [views] = await sql<{ missing: string[] }[]>`
    select coalesce(array_agg(v), '{}') as missing from unnest(array[
      'reports_public','report_ai_suggestions','species_report_stats'
    ]) v
    where to_regclass('public.' || v) is null`;
  check("all views exist", views.missing.length === 0, views.missing.length ? `missing: ${views.missing}` : "3/3");

  const [band] = await sql<{ n: number }[]>`
    select count(*)::int as n from information_schema.columns
     where table_name = 'reports' and column_name = 'ai_band'`;
  check("migration 0006 applied (ai_band)", band.n === 1, band.n ? "present" : "reports.ai_band is missing");

  // 0007, checked as the licence condition it exists to satisfy rather than as a
  // schema fact — it adds no column, so a "does this column exist" probe cannot
  // see it. CC BY *requires* attribution by name: a record published under it
  // with no rights holder is a licence breach, not a cosmetic gap.
  const [unattributed] = await sql<{ n: number }[]>`
    select count(*)::int as n from reports
     where license like '%creativecommons.org/licenses/by%'
       and (rights_holder is null or rights_holder = '')`;
  check(
    "every CC BY record names its rights holder",
    unattributed.n === 0,
    unattributed.n === 0
      ? "all attributed"
      : `${unattributed.n} CC BY records have no rights_holder — apply migration 0007`,
  );

  /* ---------------- the privacy boundary ---------------- */
  // This is the single most important line in the system. web_anon must be able
  // to read the obscured view and must NOT be able to read true coordinates.
  const [role] = await sql<{ exists: boolean }[]>`
    select exists(select 1 from pg_roles where rolname = 'web_anon') as exists`;
  check("web_anon role exists", role.exists, role.exists ? "yes" : "the app's read path will fail");

  if (role.exists) {
    const [priv] = await sql<{ base: boolean; view: boolean }[]>`
      select has_table_privilege('web_anon','reports','select') as base,
             has_table_privilege('web_anon','reports_public','select') as view`;
    check("web_anon CANNOT read reports (true coordinates)", priv.base === false,
      priv.base ? "LEAK: web_anon can select from reports" : "denied, correct");
    check("web_anon CAN read reports_public", priv.view === true,
      priv.view ? "granted" : "the public map will be empty");
  }

  const [supp] = await sql<{ n: number }[]>`
    select count(*)::int as n from reports_public
     where location_precision = 'suppressed'`;
  check("suppressed reports are absent from the public view", supp.n === 0,
    supp.n ? `LEAK: ${supp.n} suppressed records are publicly visible` : "none, correct");

  // The loaded rows already carry their obscured coordinate from the dump, so
  // every check above passes whether or not the trigger that protects *new*
  // submissions exists. Test it functionally, inside a transaction that is rolled
  // back, because "the trigger row is present in pg_trigger" is a weaker claim
  // than "a sensitive species actually comes out obscured".
  const [trig] = await sql<{ n: number }[]>`
    select count(*)::int as n from pg_trigger
     where tgrelid = 'public.reports'::regclass and not tgisinternal`;
  check("obscuring trigger exists on reports", trig.n > 0,
    trig.n ? `${trig.n} trigger(s)` : "NEW reports would publish at their exact coordinate");

  try {
    const outcome = await sql.begin(async (tx) => {
      const [taxon] = await tx<{ id: number }[]>`
        select id from taxa where sensitivity = '座標不開放' and is_in_taiwan limit 1`;
      if (!taxon) return { skipped: true as const };
      const [r] = await tx<{ precision: string; moved: number }[]>`
        insert into reports (category, location, location_public, observed_at, taxon_id, taxon_source, status, source)
        values ('roadkill',
                st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
                st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
                now(), ${taxon.id}, 'imported', 'published', 'user')
        returning location_precision as precision,
                  st_distance(location, location_public) as moved`;
      await tx`rollback`.catch(() => {});
      return { skipped: false as const, ...r };
    }).catch((e) => ({ skipped: false as const, error: (e as Error).message }));

    if ("error" in outcome) {
      check("a sensitive species is actually obscured on insert", false, `test insert failed: ${outcome.error}`);
    } else if (outcome.skipped) {
      check("a sensitive species is actually obscured on insert", false, "no 座標不開放 taxon found to test with", false);
    } else {
      check("a sensitive species is actually obscured on insert",
        outcome.precision === "suppressed",
        outcome.precision === "suppressed"
          ? "a 座標不開放 taxon came out suppressed, as it must"
          : `LEAK: precision came back '${outcome.precision}' — new sensitive reports would publish at their true coordinate`);
    }
  } catch (e) {
    check("a sensitive species is actually obscured on insert", false, `could not test: ${(e as Error).message}`);
  }

  // A TaiCOL refresh can retire a name and leave its rating on the retired row.
  // The picker offers only the name in use, so without a floor that rating
  // blurs nothing. Fatal: the fix is a line in scripts/taxa-overrides.csv.
  try {
    const looser = await sql.unsafe<{ taicol_id: string; retired_taicol_id: string }[]>(
      `select taicol_id, retired_taicol_id from (${RETIRED_TWINS_SQL}) x where looser`,
    );
    check(
      "no name in use is blurred less than its retired twin",
      looser.length === 0,
      looser.length === 0
        ? "every rated retired twin has a floor on the name in use"
        : `${looser.length} need a floor in scripts/taxa-overrides.csv: ` +
            looser
              .slice(0, 10)
              .map((r) => `${r.taicol_id} (rated on ${r.retired_taicol_id})`)
              .join(", "),
    );
  } catch (e) {
    check(
      "no name in use is blurred less than its retired twin",
      false,
      `could not check (is migration 0014 applied?): ${(e as Error).message}`,
    );
  }

  /* ---------------- classifier / database alignment ---------------- */
  // The landmine. A v1 embedding row is a taxa.id, a bigserial, baked into the
  // Modal volume. If this database was built by re-running the TaiCOL import
  // rather than restoring a dump, the ids can differ — and the legacy contract
  // will then confidently return the WRONG SPECIES, with no error anywhere.
  // Every id is checked, not a sample: a sample of 400 from 70,805 passes a
  // database where one species in two hundred has moved.
  const idsPath = join(ROOT, "data", "embeddings", "taxa_ids_v1.npy");
  if (!existsSync(idsPath)) {
    check("v1 classifier ids match this database", false,
      `${idsPath} not found — run this from a machine that has the embeddings`, false);
  } else {
    // .npy: 128-byte header for v1, then little-endian int64 values.
    const buf = readFileSync(idsPath);
    const headerLen = 10 + buf.readUInt16LE(8);
    const count = (buf.length - headerLen) / 8;
    const ids: number[] = [];
    for (let i = 0; i < count; i++) ids.push(Number(buf.readBigInt64LE(headerLen + i * 8)));
    const [m] = await sql<{ found: number; withPrompt: number }[]>`
      select count(*)::int as found,
             count(*) filter (where bioclip_prompt is not null)::int as "withPrompt"
        from taxa where id = any(${ids}::bigint[])`;
    check("v1 classifier ids match this database", m.found === ids.length && m.withPrompt === ids.length,
      m.found === ids.length
        ? `${ids.length.toLocaleString()}/${ids.length.toLocaleString()} embedding ids resolve to prompted taxa`
        : `only ${m.found.toLocaleString()}/${ids.length.toLocaleString()} resolve — the embeddings were built against a DIFFERENT database. ` +
          `Restore a dump instead of re-importing TaiCOL, or rebuild the embeddings against this one.`);
  }

  // v2 is keyed by TaiCOL id, which a re-import keeps, so the question is no
  // longer "is this the same database" but "does every answer the model can
  // give still name an accepted taxon here". A row TaiCOL has since deleted
  // drops out of the website's candidate list silently (RESOLVE_CANDIDATES_SQL
  // takes accepted rows only), and a species key that is gone is an animal the
  // model can recognise and the website can never be told about. Warn-level
  // for a stray row, which only loses one embedding; fatal for a species key.
  const keysPath = join(ROOT, "data", "embeddings", "taxa_keys_v2.json");
  if (!existsSync(keysPath)) {
    check("v2 classifier keys resolve to accepted taxa", false,
      `${keysPath} not found — run apps/ml/build_embeddings.py, or run this from a machine that has it`, false);
  } else {
    const keys = JSON.parse(readFileSync(keysPath, "utf8")) as {
      taicol_ids: string[];
      species_taicol_ids: string[];
    };
    const rowIds = keys.taicol_ids;
    const speciesIds = [...new Set(keys.species_taicol_ids)];
    const status = await sql<{ taicol_id: string; taxon_status: string | null }[]>`
      select taicol_id, taxon_status from taxa where taicol_id = any(${rowIds}::text[])`;
    const accepted = new Set(status.filter((r) => r.taxon_status === "accepted").map((r) => r.taicol_id));
    const known = new Set(status.map((r) => r.taicol_id));
    const lostSpecies = speciesIds.filter((t) => !accepted.has(t));
    const lostRows = rowIds.filter((t) => !accepted.has(t));
    const example = (xs: string[]) =>
      xs.slice(0, 8).map((t) => `${t} (${known.has(t) ? "no longer accepted" : "not in this database"})`).join(", ");
    check("v2 classifier species keys resolve to accepted taxa", lostSpecies.length === 0,
      lostSpecies.length === 0
        ? `${speciesIds.length.toLocaleString()}/${speciesIds.length.toLocaleString()} species keys accepted here`
        : `${lostSpecies.length} species the model can name are not accepted here: ${example(lostSpecies)}. ` +
          `Rebuild the v2 embeddings against this database (apps/ml/build_embeddings.py).`);
    check("v2 classifier rows resolve to accepted taxa", lostRows.length === 0,
      lostRows.length === 0
        ? `${rowIds.length.toLocaleString()}/${rowIds.length.toLocaleString()} embedding rows accepted here`
        : `${lostRows.length} embedding rows no longer accepted here: ${example(lostRows)}`,
      false);

    // The other direction: a species TaiCOL added after the build is one the
    // model cannot name at all. Not wrong, only incomplete, so a warning.
    const [{ unseen }] = await sql<{ unseen: number }[]>`
      select count(*)::int as unseen from taxa
       where bioclip_prompt is not null and is_in_taiwan and taxon_status = 'accepted'
         and not (taicol_id = any(${rowIds}::text[]))`;
    check("v2 classifier covers every accepted Taiwan taxon", unseen === 0,
      unseen === 0
        ? "no accepted, prompted taxon is missing from the embeddings"
        : `${unseen} accepted taxa were added after the embeddings were built; rebuild them to let the model name these`,
      false);
  }

  /* ---------------- data ---------------- */
  const [counts] = await sql<{ taxa: number; reports: number; published: number }[]>`
    select (select count(*) from taxa)::int as taxa,
           (select count(*) from reports)::int as reports,
           (select count(*) from reports_public)::int as published`;
  check("species checklist loaded", counts.taxa > 100_000, `${counts.taxa.toLocaleString()} taxa`);
  check("map has data to show", counts.published > 0, `${counts.published.toLocaleString()} published reports`, false);

  /* ---------------- environment ---------------- */
  const env = (k: string) => (process.env[k] ?? "").trim();
  check("SUPABASE_SERVICE_ROLE_KEY set", !!env("SUPABASE_SERVICE_ROLE_KEY"), env("SUPABASE_SERVICE_ROLE_KEY") ? "set" : "photo upload and the worker will fail");
  check("NEXT_PUBLIC_SUPABASE_URL set", !!env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_URL") ? "set" : "missing");
  check("CRON_SECRET set", !!env("CRON_SECRET"),
    env("CRON_SECRET") ? "set" : "the classifier worker will 401 in production and reports stay unidentified");
  check("TURNSTILE_SECRET_KEY set", !!env("TURNSTILE_SECRET_KEY"),
    env("TURNSTILE_SECRET_KEY") ? "set" : "submissions have NO bot protection — do not launch publicly without this");
  check("ML_ENDPOINT_URL / TOKEN set", !!env("ML_ENDPOINT_URL") && !!env("ML_ENDPOINT_TOKEN"),
    env("ML_ENDPOINT_URL") ? "set" : "no species identification");
  // Informational: which contract the worker will ask for. "2" before the
  // model service answers it holds every new report as "classification
  // unavailable" (docs/ai-rollout.md).
  check("ML_CONTRACT", true,
    env("ML_CONTRACT") === "2" ? "2 — the website applies the rules (evidence contract)"
      : "unset — the legacy contract; see docs/ai-rollout.md before setting it to 2", false);

  /* ---------------- the classifier itself ---------------- */
  if (env("ML_ENDPOINT_URL") && env("ML_ENDPOINT_TOKEN")) {
    try {
      // A deliberately bad token: proves the endpoint is up AND that it rejects
      // unauthorised callers. The token is checked in a small CPU function in
      // front of the GPU (apps/ml/modal_app.py), so this starts no GPU.
      const res = await fetch(env("ML_ENDPOINT_URL"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "preflight-invalid", category: "roadkill" }),
        signal: AbortSignal.timeout(90_000),
      });
      check("classifier endpoint is up and rejects a bad token", res.status === 401,
        res.status === 401 ? "401 as expected" : `expected 401, got ${res.status}`);
    } catch (e) {
      check("classifier endpoint is up and rejects a bad token", false, `unreachable: ${(e as Error).message}`);
    }
  }

  /* ---------------- report ---------------- */
  const pad = Math.max(...results.map((r) => r.name.length));
  console.log();
  for (const r of results) {
    const mark = r.ok ? "  ok  " : r.fatal ? " FAIL " : " warn ";
    console.log(`${mark} ${r.name.padEnd(pad)}  ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok && r.fatal);
  const warned = results.filter((r) => !r.ok && !r.fatal);
  console.log(
    `\n${results.filter((r) => r.ok).length}/${results.length} passed` +
      (warned.length ? `, ${warned.length} warning(s)` : "") +
      (failed.length ? `, ${failed.length} FAILURE(S)` : ""),
  );
  await sql.end();
  if (failed.length) process.exit(1);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await sql.end();
  process.exit(1);
});
