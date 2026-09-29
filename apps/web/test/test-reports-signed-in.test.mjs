/**
 * Test reports, signed in: a moderator sends one and sees it, a member is
 * refused, and nobody else can open it. Migration 0018.
 *
 * test/test-reports.test.mjs covers the rules one at a time: the views, the
 * grants, the signed-out refusal, the source. What only a session shows is
 * whether they add up: that the role the route reads is the one the page
 * reads, that a moderator's test really is on a page for them and on no page
 * for anyone else, and that /admin is the way back to it.
 *
 * Accounts are made the way e2e/forum.spec.mjs makes them: the admin API of
 * the local Supabase, or of CI's stand-in (test/stub-gotrue.mjs), and a
 * password sign-in through @supabase/ssr, so the cookies are the ones the app
 * itself writes. Everything made here is deleted after.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { sql, BASE_URL } from "./helpers.mjs";

const AUTH = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const accounts = [];
const nonces = [];

async function reachable(url) {
  return (await fetch(url).catch(() => null))?.ok ?? false;
}

async function createAccount(label) {
  const email = `test-report-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const res = await fetch(`${AUTH}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`could not create a test account: ${res.status}`);
  const user = await res.json();
  accounts.push(user.id);

  const jar = new Map();
  const client = createServerClient(AUTH, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`could not sign the test account in: ${error.message}`);
  return { id: user.id, cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}

async function submit(cookie, extra = {}) {
  await sql`delete from rate_limits where key like 'submit-%'`;
  const clientNonce = randomUUID();
  nonces.push(clientNonce);
  const res = await fetch(`${BASE_URL}/api/reports`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({
      category: "roadkill",
      page: "roadkill",
      lng: 120.9,
      lat: 23.8,
      observedAt: new Date().toISOString(),
      photoPaths: [],
      clientNonce,
      test: true,
      ...extra,
    }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})), clientNonce };
}

const page = (path, cookie) =>
  fetch(`${BASE_URL}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });

let moderator = null;
let member = null;
let skip = null;

before(async () => {
  if (!(await reachable(BASE_URL))) return void (skip = `no server at ${BASE_URL}`);
  if (!(await reachable(`${AUTH}/auth/v1/health`))) return void (skip = `no auth at ${AUTH}`);
  if (!SERVICE || !ANON_KEY) return void (skip = "no Supabase keys in the environment");
  moderator = await createAccount("moderator");
  member = await createAccount("member");
  await sql`insert into profiles (id, role) values (${moderator.id}::uuid, 'moderator')
            on conflict (id) do update set role = 'moderator'`;
});

after(async () => {
  await sql`delete from reports where client_nonce = any(${nonces})`;
  for (const id of accounts) {
    await fetch(`${AUTH}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
    }).catch(() => {});
    // Where profiles has no foreign key to auth.users (CI's plain Postgres),
    // deleting the account does not reach it.
    await sql`delete from profiles where id = ${id}::uuid`.catch(() => {});
  }
  await sql.end();
});

describe("a test report, signed in", () => {
  test("a member who asks for one is refused, and nothing is stored", async (t) => {
    if (skip) return t.skip(skip);
    const { status, body, clientNonce } = await submit(member.cookie);
    assert.equal(status, 403);
    assert.equal(body.error, "test_not_allowed");
    const [row] = await sql`select count(*)::int as n from reports where client_nonce = ${clientNonce}`;
    assert.equal(row.n, 0);
  });

  let testId = null;

  test("a moderator's is stored as a test, and answered as one", async (t) => {
    if (skip) return t.skip(skip);
    const { status, body, clientNonce } = await submit(moderator.cookie);
    assert.equal(status, 201);
    assert.equal(body.test, true);
    const [row] = await sql`
      select id, is_test, reporter_id from reports where client_nonce = ${clientNonce}`;
    assert.equal(row.is_test, true);
    assert.equal(row.reporter_id, moderator.id);
    testId = row.id;
  });

  test("published, it is on a page for moderators and on none for anyone else", async (t) => {
    if (skip || !testId) return t.skip(skip ?? "no test report was stored");
    // As a moderator's approval would (admin/actions.ts publishReport).
    await sql`update reports set status = 'published' where id = ${testId}`;

    const [pub] = await sql`select count(*)::int as n from reports_public where id = ${testId}`;
    assert.equal(pub.n, 0, "a test report reached reports_public");

    const mod = await page(`/en/reports/${testId}`, moderator.cookie);
    assert.equal(mod.status, 200);
    const html = await mod.text();
    // The rendered note, not the phrase: the catalogue inlined in every page
    // holds the words whatever was rendered.
    assert.match(html, /role="note"[^>]*>Test report\. Only moderators can see this page/);
    assert.match(html, /<title>Test report/);

    for (const [who, cookie] of [["a member", member.cookie], ["a stranger", ""]]) {
      const res = await page(`/en/reports/${testId}`, cookie);
      assert.equal(res.status, 404, `${who} was shown a test report`);
    }
  });

  test("/admin is the way back to it", async (t) => {
    if (skip || !testId) return t.skip(skip ?? "no test report was stored");
    const res = await page("/en/admin", moderator.cookie);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(`/en/reports/${testId}`), "the recent tests list does not link it");
    assert.ok(html.includes('href="/en/report/roadkill?test=1"'), "no link to start a test");
  });
});
