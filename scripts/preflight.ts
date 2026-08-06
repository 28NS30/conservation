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

  /* ---------------- classifier / database alignment ---------------- */
  // The landmine. taxa.id is a bigserial, and the embedding matrix baked into the
  // Modal volume stores those ids. If this database was built by re-running the
  // TaiCOL import rather than restoring a dump, the ids can differ — and the
  // classifier will then confidently return the WRONG SPECIES, with no error
  // anywhere. Restore a dump; do not re-import.
  const idsPath = join(ROOT, "data", "embeddings", "taxa_ids_v1.npy");
  if (!existsSync(idsPath)) {
    check("classifier ids match this database", false,
      `${idsPath} not found — run build_embeddings.py, or run this from a machine that has it`, false);
  } else {
    // .npy: 128-byte header for v1, then little-endian int64 values.
    const buf = readFileSync(idsPath);
    const headerLen = 10 + buf.readUInt16LE(8);
    const count = (buf.length - headerLen) / 8;
    const sample: number[] = [];
    for (let i = 0; i < Math.min(400, count); i++) {
      sample.push(Number(buf.readBigInt64LE(headerLen + i * 8)));
    }
    const [m] = await sql<{ found: number; withPrompt: number }[]>`
      select count(*)::int as found,
             count(*) filter (where bioclip_prompt is not null)::int as "withPrompt"
        from taxa where id = any(${sample}::bigint[])`;
    check("classifier ids match this database", m.found === sample.length && m.withPrompt === sample.length,
      m.found === sample.length
        ? `${sample.length}/${sample.length} sampled embedding ids resolve to prompted taxa`
        : `only ${m.found}/${sample.length} resolve — the embeddings were built against a DIFFERENT database. ` +
          `Restore a dump instead of re-importing TaiCOL, or rebuild the embeddings against this one.`);

    const [total] = await sql<{ n: number }[]>`
      select count(*)::int as n from taxa where bioclip_prompt is not null`;
    check("embedding count matches prompted taxa", total.n === count,
      total.n === count ? `${count.toLocaleString()} both sides`
        : `embeddings hold ${count.toLocaleString()} rows, database has ${total.n.toLocaleString()} prompted taxa`);
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

  /* ---------------- the classifier itself ---------------- */
  if (env("ML_ENDPOINT_URL") && env("ML_ENDPOINT_TOKEN")) {
    try {
      // A deliberately bad token: proves the endpoint is up AND that it rejects
      // unauthorised callers, without paying for a GPU cold start.
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
