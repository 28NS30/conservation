/**
 * The moderation queue, used the way a moderator uses it: on a phone.
 *
 *   node e2e/moderation.spec.mjs         # TEST_BASE_URL, default localhost:3000
 *
 * A throwaway moderator, two held reports, two flagged records and an unnamed one:
 *
 *   the reason each was held reads as a sentence, not the stored code;
 *   publishing one publishes it, and logs who did;
 *   rejecting asks why on the page, will not send without a reason,
 *   and stores the reason in the log;
 *   a published record with a flag is listed below the queue, and OK
 *   clears the flag without moving the record or loosening its blur;
 *   a named record the model never answered for says it stays at 10 km,
 *   and Classify again queues its job without releasing the hold;
 *   on a published record the model could not name, a moderator can
 *   name any species, stored as an expert's, and the blur does not loosen.
 *
 * Accounts come from the local Supabase or CI's stand-in, as in
 * e2e/account.spec.mjs. Everything made here is deleted after.
 */
import { chromium } from "playwright";
import postgres from "postgres";
import { createServerClient } from "@supabase/ssr";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const ROOT = join(import.meta.dirname, "..", "..", "..");
if (existsSync(join(ROOT, ".env")) && !process.env.DATABASE_URL) process.loadEnvFile(join(ROOT, ".env"));

const BASE = (process.env.TEST_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const AUTH = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false, onnotice: () => {} });

const failures = [];
function check(name, ok, detail = "") {
  if (!ok) failures.push(name);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
}

const tag = randomUUID().slice(0, 8);
const email = `moderation-e2e-${tag}@example.test`;
const password = randomBytes(18).toString("base64url");
let userId = null;
const ids = {};
let browser = null;

/** A report's status once it stops being `pending`, or `pending` after 15s. */
async function settled(id) {
  for (let i = 0; i < 30; i++) {
    const [r] = await sql`select status from reports where id = ${id}`;
    if (r.status !== "pending") return r.status;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return "pending";
}

async function held(note) {
  const [r] = await sql`
    insert into reports (category, location, location_public, observed_at, status, source,
                         notes, flagged_reason)
    values ('roadkill',
            st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
            st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
            now(), 'pending', 'user', ${note}, 'no photo on a category that expects one')
    returning id`;
  return r.id;
}

try {
  const res = await fetch(`${AUTH}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`could not create the test account: ${res.status}`);
  userId = (await res.json()).id;
  await sql`insert into profiles (id, role) values (${userId}::uuid, 'moderator')
            on conflict (id) do update set role = 'moderator'`;
  ids.publish = await held(`publish me ${tag}`);
  ids.reject = await held(`reject me ${tag}`);

  const jar = new Map();
  const client = createServerClient(AUTH, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`could not sign the moderator in: ${error.message}`);

  browser = await chromium.launch();
  const context = await browser.newContext({ locale: "en", viewport: { width: 390, height: 844 } });
  await context.addCookies([...jar].map(([name, value]) => ({ name, value, url: BASE })));
  const page = await context.newPage();

  // Idle, so the rows have hydrated before anything is pressed.
  await page.goto(`${BASE}/en/admin`, { waitUntil: "networkidle" });

  const toPublish = page.locator("li", { hasText: `publish me ${tag}` });
  const toReject = page.locator("li", { hasText: `reject me ${tag}` });
  check("both held reports are in the queue", (await toPublish.count()) === 1 && (await toReject.count()) === 1);
  check(
    "the reason each was held reads as a sentence",
    await toPublish.getByText("No photo, on a kind of report that usually needs one.").isVisible(),
  );

  await toPublish.getByRole("button", { name: "Publish" }).click();
  // The database, not the page: a row's text is matched without regard to
  // case, and "rejected" is also in the question the reject form asks.
  const published = await settled(ids.publish);
  check("publishing publishes it", published === "published", published);
  const [pubLog] = await sql`
    select count(*)::int as n from moderation_actions
     where report_id = ${ids.publish} and actor_id = ${userId}::uuid and action = 'publish'`;
  check("and logs who did", pubLog.n === 1);

  await toReject.getByRole("button", { name: "Reject" }).click();
  const box = toReject.getByLabel("Why is it being rejected?");
  check("rejecting asks why, on the page", await box.isVisible());
  check(
    "and will not send without a reason",
    await toReject.getByRole("button", { name: "Reject it" }).isDisabled(),
  );
  await box.fill("the photo shows a toy, not an animal");
  await toReject.getByRole("button", { name: "Reject it" }).click();
  const rejected = await settled(ids.reject);
  check("rejecting rejects it", rejected === "rejected", rejected);
  const [rejLog] = await sql`
    select reason from moderation_actions
     where report_id = ${ids.reject} and actor_id = ${userId}::uuid and action = 'reject'`;
  check("and the log keeps the reason", rejLog?.reason === "the photo shows a toy, not an animal", rejLog?.reason);

  // -- A published record with a flag ------------------------------------
  // As the classifier leaves one the model disagreed with: published under
  // the reporter's species, held at the model's blur, flagged. The queue
  // lists it below the held reports; OK clears the flag and nothing else.
  const [plain] = await sql`select id from taxa where scientific_name = 'Paguma larvata' and rank = 'Species' limit 1`;
  const [cat] = await sql`select id from taxa where scientific_name = 'Prionailurus bengalensis' and rank = 'Species' limit 1`;
  const [flaggedRecord] = await sql`
    insert into reports (category, location, location_public, observed_at, status, source,
                         taxon_id, taxon_source, precision_override, ai_band, flagged_reason)
    values ('roadkill',
            st_setsrid(st_makepoint(120.95, 23.9), 4326)::geography,
            st_setsrid(st_makepoint(120.95, 23.9), 4326)::geography,
            now(), 'published', 'user', ${plain.id}, 'user', 'coarse_10km', 'high',
            'the model and the reporter name different species')
    returning id, location_precision, st_astext(location_public::geometry) as point`;
  ids.flagged = flaggedRecord.id;
  await sql`insert into classifications (report_id, taxon_id, score, rank, model_version)
            values (${ids.flagged}, ${cat.id}, 0.98, 1, 'e2e')`;
  await page.goto(`${BASE}/en/admin`, { waitUntil: "networkidle" });
  const flaggedRow = page.locator("li", { has: page.locator(`a[href$="/reports/${ids.flagged}"]`) });
  check("a published record with a flag is listed", (await flaggedRow.count()) === 1);
  check(
    "below the held reports, under its own heading",
    await page.getByRole("heading", { name: "Published, with a flag" }).isVisible(),
  );
  check(
    "its reason reads as a sentence",
    await flaggedRow.getByText("The model and the reporter name different species.").isVisible(),
  );
  check("and the model's answer is beside the reporter's", (await flaggedRow.getByText(/The model's first answer:/).count()) === 1);
  await flaggedRow.getByRole("button", { name: "OK" }).click();
  await flaggedRow.getByText("Marked OK").waitFor({ timeout: 10000 }).catch(() => {});
  const [cleared] = await sql`
    select flagged_reason, location_precision, status, st_astext(location_public::geometry) as point
      from reports where id = ${ids.flagged}`;
  check("OK clears the flag", cleared.flagged_reason === null, cleared.flagged_reason);
  check(
    "and nothing else: the record stays published, where it was, as blurred",
    cleared.status === "published" &&
      cleared.location_precision === flaggedRecord.location_precision &&
      cleared.point === flaggedRecord.point,
    `${cleared.status} ${cleared.location_precision}`,
  );
  const [okLog] = await sql`
    select reason from moderation_actions
     where report_id = ${ids.flagged} and actor_id = ${userId}::uuid and action = 'flag'`;
  check("the log keeps the reason it cleared", okLog?.reason === "cleared: the model and the reporter name different species", okLog?.reason);

  // -- A named record the model never answered for -------------------------
  // As the give-up path leaves one: published under the reporter's species,
  // still held at 10 km and off the map, flagged, its job failed for good.
  // The row says so, its OK says the blur stays, and Classify again queues
  // the job without releasing the hold.
  const [stuck] = await sql`
    insert into reports (category, location, location_public, observed_at, status, source,
                         taxon_id, taxon_source, held_for_classification, flagged_reason)
    values ('roadkill',
            st_setsrid(st_makepoint(120.95, 23.95), 4326)::geography,
            st_setsrid(st_makepoint(120.95, 23.95), 4326)::geography,
            now(), 'published', 'user', ${plain.id}, 'user', true, 'classification unavailable')
    returning id, location_precision`;
  ids.stuck = stuck.id;
  await sql`insert into classification_jobs (report_id, status, attempts, last_error)
            values (${ids.stuck}, 'failed', 5, 'the model refused the photo')`;
  check("a held record starts at 10 km", stuck.location_precision === "coarse_10km", stuck.location_precision);
  // "load" and the row itself, not "networkidle": after the OK above, the
  // header's prefetches of cached pages are left pending in the browser and
  // the network never goes quiet, though clicking those links still loads
  // them at once (checked by hand on 26 October).
  await page.goto(`${BASE}/en/admin`, { waitUntil: "load" });
  const stuckRow = page.locator("li", { has: page.locator(`a[href$="/reports/${ids.stuck}"]`) });
  await stuckRow.first().waitFor({ timeout: 15000 }).catch(() => {});
  check("a record held for good is listed", (await stuckRow.count()) === 1);
  check(
    "it says the photo could not be checked and the record stays at 10 km",
    await stuckRow.getByText(/could not check the photo[\s\S]*10 km and off the map/).isVisible(),
  );
  check("its OK says the blur stays", await stuckRow.getByRole("button", { name: "OK, leave it at 10 km" }).isVisible());
  await stuckRow.getByRole("button", { name: "Classify again" }).click();
  await stuckRow.getByText(/Back in the model's queue/).waitFor({ timeout: 10000 }).catch(() => {});
  const [requeued] = await sql`
    select r.held_for_classification as held, r.location_precision, r.flagged_reason, r.status,
           j.status as job, j.attempts, j.last_error
      from reports r join classification_jobs j on j.report_id = r.id
     where r.id = ${ids.stuck}`;
  check(
    "Classify again queues the job afresh",
    requeued?.job === "queued" && requeued?.attempts === 0 && requeued?.last_error === null,
    JSON.stringify(requeued),
  );
  check(
    "and releases nothing: still held, at 10 km, published",
    requeued?.held === true && requeued?.location_precision === "coarse_10km" && requeued?.status === "published",
  );
  const [againLog] = await sql`
    select reason from moderation_actions
     where report_id = ${ids.stuck} and actor_id = ${userId}::uuid and action = 'flag'`;
  check("the log says who had it classified again", againLog?.reason === "classify again: classification unavailable", againLog?.reason);

  // -- Naming a species the model never offered (#117) -------------------
  // An unidentified record, published, as the classifier leaves one it could
  // not name. The moderator searches, chooses, saves.
  const [unnamed] = await sql`
    insert into reports (category, location, location_public, observed_at, status, source)
    values ('roadkill',
            st_setsrid(st_makepoint(120.9, 24.3), 4326)::geography,
            st_setsrid(st_makepoint(120.9, 24.3), 4326)::geography,
            now(), 'published', 'user')
    returning id`;
  ids.unnamed = unnamed.id;
  // "load" and the search box, as for the queue above.
  await page.goto(`${BASE}/en/reports/${ids.unnamed}`, { waitUntil: "load" });
  const search = page.getByRole("searchbox", { name: /Search by Chinese/ });
  await search.waitFor({ timeout: 15000 }).catch(() => {});
  check("a moderator can search every species on a record", await search.isVisible());
  await search.fill("石虎");
  await page.getByRole("button", { name: /石虎/ }).first().click();
  await page.getByRole("button", { name: "Save species" }).click();
  await page.getByText("Saved.").waitFor({ timeout: 10000 }).catch(() => {});
  const [named] = await sql`
    select r.taxon_source, r.location_precision, t.common_name_zh
      from reports r left join taxa t on t.id = r.taxon_id
     where r.id = ${ids.unnamed}`;
  check("and naming it stores an expert's identification", named?.common_name_zh === "石虎" && named?.taxon_source === "expert", JSON.stringify(named));
  check("without loosening the blur", named?.location_precision !== "exact", named?.location_precision);
} catch (e) {
  check("the spec ran", false, e.message);
} finally {
  await browser?.close();
  for (const id of Object.values(ids)) {
    await sql`delete from classifications where report_id = ${id}`.catch(() => {});
    await sql`delete from moderation_actions where report_id = ${id}`.catch(() => {});
    await sql`delete from reports where id = ${id}`.catch(() => {});
  }
  if (userId) {
    await fetch(`${AUTH}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
    }).catch(() => {});
    await sql`delete from profiles where id = ${userId}::uuid`.catch(() => {});
  }
  await sql.end();
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
