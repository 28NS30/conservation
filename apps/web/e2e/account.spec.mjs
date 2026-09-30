/**
 * Deleting your own account, from /me, the way a person does it.
 *
 *   node e2e/account.spec.mjs            # TEST_BASE_URL, default localhost:3000
 *
 * A throwaway reporter, signed in the way the app signs people in, with one
 * report that carries a contact address:
 *
 *   pressing the button without ticking the box deletes nothing;
 *   ticking it and pressing deletes the account and sends them home;
 *   the report stays, with no reporter and no contact address;
 *   the profile is gone, and the password no longer signs in;
 *   /me no longer knows them, and no record of their own confirmations
 *   names them (security audit, 29 September 2026).
 *
 * Accounts come from the local Supabase or CI's stand-in (test/stub-gotrue.mjs),
 * as in e2e/forum.spec.mjs. Exits non-zero on any failure.
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

async function signIn(email, password) {
  const jar = new Map();
  const client = createServerClient(AUTH, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  return { error, cookies: [...jar].map(([name, value]) => ({ name, value, url: BASE })) };
}

const email = `account-e2e-${randomUUID().slice(0, 8)}@example.test`;
const password = randomBytes(18).toString("base64url");
let userId = null;
let reportId = null;
let browser = null;

try {
  const res = await fetch(`${AUTH}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`could not create the test account: ${res.status}`);
  userId = (await res.json()).id;
  await sql`insert into profiles (id, role) values (${userId}::uuid, 'user') on conflict (id) do nothing`;
  [{ id: reportId }] = await sql`
    insert into reports (category, location, location_public, observed_at, status, source,
                         reporter_id, contact_email)
    values ('roadkill',
            st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
            st_setsrid(st_makepoint(120.9, 23.8), 4326)::geography,
            now(), 'pending', 'user', ${userId}::uuid, ${email})
    returning id`;
  // Their own species confirmation, which records them as its actor.
  await sql`
    insert into moderation_actions (report_id, actor_id, action, reason)
    values (${reportId}::uuid, ${userId}::uuid, 'retaxon', 'reporter confirm')`;

  const { error, cookies } = await signIn(email, password);
  if (error) throw new Error(`could not sign the test account in: ${error.message}`);

  browser = await chromium.launch();
  const context = await browser.newContext({ locale: "en" });
  await context.addCookies(cookies);
  const page = await context.newPage();

  // Idle, not merely loaded: a click before the form has hydrated is a plain
  // form post, and the spec would be testing the browser's reload instead.
  await page.goto(`${BASE}/en/me`, { waitUntil: "networkidle" });
  check("/me offers to delete the account", await page.getByRole("heading", { name: "Delete my account" }).isVisible());

  await page.getByRole("button", { name: "Delete my account" }).click();
  const asked = page.getByText("Tick the box first.");
  await asked.waitFor({ timeout: 10000 }).catch(() => {});
  check("without the box ticked it asks for it", await asked.isVisible());
  const [still] = await sql`select count(*)::int as n from profiles where id = ${userId}::uuid`;
  check("and deletes nothing", still.n === 1);

  await page.getByLabel("I understand this cannot be undone").check();
  await Promise.all([
    page.waitForURL((u) => new URL(u).pathname.replace(/\/$/, "") === "/en" || new URL(u).pathname === "/", { timeout: 15000 }),
    page.getByRole("button", { name: "Delete my account" }).click(),
  ]).catch(() => {});
  check("ticked, it deletes and goes home", ["/en", "/"].includes(new URL(page.url()).pathname.replace(/(.)\/$/, "$1")), page.url());

  const [report] = await sql`select reporter_id, contact_email from reports where id = ${reportId}`;
  check("the report stays", Boolean(report));
  check("with no reporter", report?.reporter_id === null);
  check("and no contact address", report?.contact_email === null);
  const [linked] = await sql`
    select count(*)::int as n from moderation_actions where actor_id = ${userId}::uuid`;
  check("and no moderation record names them", linked.n === 0);
  const [profile] = await sql`select count(*)::int as n from profiles where id = ${userId}::uuid`;
  check("the profile is gone", profile.n === 0);
  check("the password no longer signs in", Boolean((await signIn(email, password)).error));

  await page.goto(`${BASE}/en/me`);
  check("/me no longer knows them", !(await page.content()).includes(email));
} catch (e) {
  check("the spec ran", false, e.message);
} finally {
  await browser?.close();
  if (reportId) await sql`delete from reports where id = ${reportId}`.catch(() => {});
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
