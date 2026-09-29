/**
 * The moderation queue, used the way a moderator uses it: on a phone.
 *
 *   node e2e/moderation.spec.mjs         # TEST_BASE_URL, default localhost:3000
 *
 * A throwaway moderator and two held reports:
 *
 *   the reason each was held reads as a sentence, not the stored code;
 *   publishing one publishes it, and logs who did;
 *   rejecting asks why on the page, will not send without a reason,
 *   and stores the reason in the log.
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
} catch (e) {
  check("the spec ran", false, e.message);
} finally {
  await browser?.close();
  for (const id of Object.values(ids)) {
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
