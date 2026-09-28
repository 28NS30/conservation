/**
 * The discussion forum, end to end, in a real browser — or, switched off, the
 * proof that it is not there at all.
 *
 *   node e2e/forum.spec.mjs                       # the server runs with the forum OFF
 *   FORUM_ENABLED=1 node e2e/forum.spec.mjs       # the server runs with it ON
 *
 * FORUM_ENABLED here says which way the SERVER was started, so the spec knows
 * what to expect of it; it does not switch anything. CI runs it both ways,
 * against two servers.
 *
 * OFF: every forum page in both languages, both forum API routes, and every
 * forum server action answer 404, and nothing on the home page, the sitemap
 * or robots.txt mentions /community. A dark feature that answers anything else
 * — a redirect, a teaser, an action that still runs — is not dark.
 *
 * ON: the whole moderation loop with two real accounts.
 *   a member says under 13 and is refused, with nothing stored;
 *   a member joins with a generated name;
 *   they post a thread with coordinates in it, and it is HELD: they see it
 *     marked "awaiting review", a stranger gets a 404;
 *   a member cannot call a moderator's action;
 *   a moderator edits the location out and approves it, and only then does
 *     the stranger see it — without the coordinates, marked as edited;
 *   a reply appears; one "sensitive location" flag takes it down at once;
 *     the moderator puts it back;
 *   the moderator suspends the member, who can then read but not post, and
 *     lifts it;
 *   the member downloads their posts, deletes their forum account, and their
 *     thread then reads "deleted member".
 *
 * Accounts are made on the Supabase Auth this build points at — the local
 * stack on a laptop, the stand-in (test/stub-gotrue.mjs) in CI — and removed
 * afterwards. It refuses to run against any auth server that is not on this
 * machine. The moderation log is append-only by design, so the rows this run
 * writes there stay: that is the table doing its job.
 */
import { chromium } from "playwright";
import postgres from "postgres";
import { createServerClient } from "@supabase/ssr";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const WEB = join(import.meta.dirname, "..");
const ROOT = join(WEB, "..", "..");
if (existsSync(join(ROOT, ".env")) && !process.env.DATABASE_URL) process.loadEnvFile(join(ROOT, ".env"));

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const FORUM_ON = process.env.FORUM_ENABLED === "1" || process.env.FORUM_ENABLED === "true";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, onnotice: () => {}, max: 2 });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const msgs = (l) => JSON.parse(readFileSync(join(WEB, "messages", `${l}.json`), "utf8")).forum;
const ZH = msgs("zh-TW");

const FORUM_PATHS = [
  "/community",
  "/community/c/sightings-id",
  `/community/t/${randomUUID()}`,
  "/community/u/blue-magpie-1234",
  "/community/join",
  "/community/guidelines",
  "/community/moderation",
];

/** Every forum server action, and a page it can be posted to. */
function forumActions() {
  const manifest = JSON.parse(readFileSync(join(WEB, ".next", "server", "server-reference-manifest.json"), "utf8"));
  const out = [];
  for (const [id, entry] of Object.entries(manifest.node ?? {})) {
    if (!/\/community\//.test(entry.filename ?? "")) continue;
    const worker = Object.keys(entry.workers ?? {})[0] ?? "app/[locale]/(site)/community/page";
    const path =
      worker
        .replace(/^app/, "")
        .replace(/\/page$/, "")
        .replace("/[locale]", "")
        .replace("/(site)", "")
        .replace("[slug]", "sightings-id")
        .replace("[id]", randomUUID())
        .replace("[handle]", "blue-magpie-1234") || "/";
    out.push({ id, name: entry.exportedName, path });
  }
  return out;
}

/** Call a server action the way the browser does, with nothing in it. */
async function callAction(action, cookie = "") {
  const res = await fetch(BASE + action.path, {
    method: "POST",
    headers: {
      "Next-Action": action.id,
      Origin: new URL(BASE).origin,
      "Content-Type": "text/plain;charset=UTF-8",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: "[]",
    redirect: "manual",
  });
  return res.status;
}

/* ------------------------------------------------------------------ *
 * OFF
 * ------------------------------------------------------------------ */

async function whenOff() {
  for (const p of FORUM_PATHS) {
    for (const prefix of ["", "/en"]) {
      const res = await fetch(BASE + prefix + p, { redirect: "manual" });
      check(`${prefix}${p} is a 404`, res.status === 404, `got ${res.status}`);
    }
  }
  for (const [method, path] of [
    ["GET", "/api/forum/export"],
    ["GET", "/api/jobs/forum-retention"],
    ["POST", "/api/jobs/forum-retention"],
  ]) {
    const res = await fetch(BASE + path, {
      method,
      headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
    });
    check(`${method} ${path} is a 404, even with the cron secret`, res.status === 404, `got ${res.status}`);
  }

  const actions = forumActions();
  check("the build has the forum's server actions to try", actions.length >= 20, `${actions.length} found`);
  for (const a of actions) {
    const status = await callAction(a);
    check(`server action ${a.name} (posted to ${a.path.replace(/[0-9a-f-]{36}/, "…")}) answers 404`, status === 404, `got ${status}`);
  }
  // leaveForum is also rendered on /me, which is not a forum page.
  const leave = actions.find((a) => a.name === "leaveForum");
  if (leave) {
    const status = await callAction({ ...leave, path: "/me" });
    check("leaveForum posted to /me answers 404", status === 404, `got ${status}`);
  }

  for (const path of ["/", "/en", "/sitemap.xml", "/robots.txt", "/me", "/about"]) {
    const body = await (await fetch(BASE + path)).text();
    check(`${path} says nothing about /community`, !/\/community/.test(body));
  }
}

/* ------------------------------------------------------------------ *
 * ON
 * ------------------------------------------------------------------ */

const AUTH = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

async function createAccount(label) {
  const email = `forum-e2e-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const res = await fetch(`${AUTH}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`could not create a test account: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const user = await res.json();

  // Sign in the way the app's own client does, so the cookies are exactly
  // the ones @supabase/ssr writes, chunked or not.
  const jar = new Map();
  const client = createServerClient(AUTH, ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`could not sign the test account in: ${error.message}`);
  const cookies = [...jar].map(([name, value]) => ({ name, value, url: BASE }));
  return { id: user.id, email, cookies, header: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}

async function deleteAccount(id) {
  await fetch(`${AUTH}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
  }).catch(() => {});
  // Where profiles has no foreign key to auth.users (CI's plain Postgres),
  // deleting the account does not reach it.
  await sql`delete from profiles where id = ${id}::uuid`.catch(() => {});
}

/** Poll until `fn` is true, for up to ten seconds. */
async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timed out waiting for a condition");
}

async function joinForum(page) {
  await page.goto(`${BASE}/community/join`);
  await page.locator('input[name="ageBand"][value="18_plus"]').check();
  await page.locator('input[name="guidelines"]').check();
  await Promise.all([page.waitForURL(/\/community$/), page.getByRole("button", { name: ZH.join.submit, exact: true }).click()]);
}

async function whenOn() {
  const health = await fetch(`${AUTH}/auth/v1/health`).catch(() => null);
  const authHost = new URL(AUTH).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(authHost)) {
    check("Supabase Auth for this run is on this machine", false, `refusing to create accounts on ${authHost}`);
    return;
  }
  if (!health?.ok) {
    check("Supabase Auth answers", false, `nothing at ${AUTH}; start the local stack or test/stub-gotrue.mjs`);
    return;
  }

  const created = [];
  const threads = [];
  const browser = await chromium.launch();
  try {
    const member = await createAccount("member");
    created.push(member.id);
    const mod = await createAccount("mod");
    created.push(mod.id);
    await sql`insert into profiles (id, role) values (${mod.id}::uuid, 'moderator')
              on conflict (id) do update set role = 'moderator'`;

    const anon = await browser.newContext({ locale: "zh-TW" });
    const anonPage = await anon.newPage();

    // -- Under 13: refused, and nothing stored ------------------------------
    {
      const ctx = await browser.newContext({ locale: "zh-TW" });
      await ctx.addCookies(member.cookies);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/community/join`);
      await page.locator('input[name="ageBand"][value="under_13"]').check();
      await page.locator('input[name="guidelines"]').check();
      await page.getByRole("button", { name: ZH.join.submit, exact: true }).click();
      await page.getByText(ZH.join.tooYoungTitle).waitFor({ timeout: 10000 });
      const [row] = await sql`select 1 from forum_profiles where user_id = ${member.id}::uuid`;
      check("saying under 13 is refused, and no forum profile is stored", !row);
      await ctx.close();
    }

    // -- Joining ------------------------------------------------------------
    const memberCtx = await browser.newContext({ locale: "zh-TW" });
    await memberCtx.addCookies(member.cookies);
    const memberPage = await memberCtx.newPage();
    await joinForum(memberPage);
    const [profile] = await sql`select handle, age_band from forum_profiles where user_id = ${member.id}::uuid`;
    check("a member joins with a generated name", /^[a-z]+(-[a-z]+)*-\d{4}$/.test(profile?.handle ?? ""), profile?.handle);
    check("the name has nothing of the email in it", !profile?.handle.includes(member.email.split("@")[0]));

    // -- A post with coordinates is held -------------------------------------
    const title = `forum e2e ${randomUUID().slice(0, 8)}`;
    await memberPage.goto(`${BASE}/community/c/sightings-id`);
    await memberPage.locator("#thread-title").fill(title);
    await memberPage.locator("#thread-body").fill("今天早上在步道看到穿山甲，位置是 25.0330, 121.5654");
    await Promise.all([
      memberPage.waitForURL(/\/community\/t\/[0-9a-f-]{36}$/),
      memberPage.getByRole("button", { name: ZH.post, exact: true }).click(),
    ]);
    const threadId = memberPage.url().split("/").pop();
    threads.push(threadId);
    const [held] = await sql`select status, held_reasons from forum_posts where thread_id = ${threadId}::uuid and is_opener`;
    check("a post with coordinates is held", held?.status === "held" && held.held_reasons.includes("coordinates"), JSON.stringify(held));
    check("its author sees it marked as awaiting review", await memberPage.getByText(ZH.awaitingReviewBody).isVisible());

    const hidden = await anonPage.goto(`${BASE}/community/t/${threadId}`);
    check("a stranger gets a 404 for the held thread", hidden?.status() === 404, `got ${hidden?.status()}`);
    await anonPage.goto(`${BASE}/community/c/sightings-id`);
    check("and its title is not in the topic's list", !(await anonPage.content()).includes(title));

    // -- A member cannot call a moderator's action ---------------------------
    const approve = forumActions().find((a) => a.name === "approvePost");
    const statusCode = await callAction({ ...approve, path: "/community/moderation" }, member.header);
    const [still] = await sql`select status from forum_posts where thread_id = ${threadId}::uuid and is_opener`;
    check("a member calling approvePost is refused", statusCode >= 400 && still?.status === "held", `got ${statusCode}, post ${still?.status}`);

    // -- The moderator edits the location out and approves --------------------
    const modCtx = await browser.newContext({ locale: "zh-TW" });
    await modCtx.addCookies(mod.cookies);
    const modPage = await modCtx.newPage();
    await joinForum(modPage);
    await modPage.goto(`${BASE}/community/moderation`);
    const card = modPage.locator("section[aria-labelledby=held] > ul > li", { hasText: title }).first();
    check("the held post is in the moderator's queue", await card.isVisible());
    await card.getByText(ZH.mod.redact, { exact: true }).click();
    await card.locator('textarea[name="body"]').fill("今天早上在步道看到穿山甲。");
    await card.locator('input[id^="redact-reason-"]').fill("移除了座標");
    await card.getByRole("button", { name: ZH.mod.save, exact: true }).click();
    // Approved, the post leaves the queue: its card going is the answer.
    await card.waitFor({ state: "detached", timeout: 10000 });

    const shown = await anonPage.goto(`${BASE}/community/t/${threadId}`);
    const html = await anonPage.content();
    check("after approval a stranger can read it", shown?.status() === 200, `got ${shown?.status()}`);
    check("without the coordinates", !html.includes("121.5654") && html.includes("今天早上在步道看到穿山甲。"));
    check("marked as edited by a moderator", html.includes(ZH.editedByModerator));
    const [rev] = await sql`
      select r.body_before from forum_post_revisions r join forum_posts p on p.id = r.post_id
       where p.thread_id = ${threadId}::uuid`;
    check("the original is kept in the restricted history", rev?.body_before.includes("121.5654"));
    const audit = await sql`
      select action from forum_mod_actions where actor_id = ${mod.id}::uuid and target_type = 'post' order by id`;
    check("both steps are in the moderation log", audit.map((a) => a.action).join(",") === "redact,approve", audit.map((a) => a.action).join(","));

    // -- A reply, a flag, and putting it back --------------------------------
    await memberPage.goto(`${BASE}/community/t/${threadId}`);
    await memberPage.locator("#reply-body").fill("好可愛，希望牠平安。");
    await memberPage.getByRole("button", { name: ZH.postReply, exact: true }).click();
    await memberPage.getByText(/已發表|已送出/).first().waitFor({ timeout: 10000 });
    const [reply] = await sql`
      select id, status, held_reasons from forum_posts where thread_id = ${threadId}::uuid and not is_opener`;
    if (reply?.status === "held") {
      // Only when the database has three or more moderators, which turns on
      // first-post review (lib/forum/screen.ts firstPostsNeedReview).
      check("a held reply is held only as a first post", reply.held_reasons.join() === "first_posts", reply.held_reasons.join());
      await sql`update forum_posts set status = 'visible', held_reasons = '{}' where id = ${reply.id}::uuid`;
    } else check("a plain reply appears at once", reply?.status === "visible", reply?.status);
    await anonPage.goto(`${BASE}/community/t/${threadId}`);
    check("a stranger sees the reply", (await anonPage.content()).includes("好可愛，希望牠平安。"));

    await modPage.goto(`${BASE}/community/t/${threadId}`);
    const replyCard = modPage.locator("article", { hasText: "好可愛，希望牠平安。" });
    await replyCard.locator("summary", { hasText: ZH.flag.button }).click();
    await replyCard.locator('input[name="reason"][value="sensitive_location"]').check();
    await replyCard.getByRole("button", { name: ZH.flag.submit }).click();
    // The flag takes the post out of view, and its flag form with it.
    await until(async () => (await sql`select status from forum_posts where id = ${reply.id}::uuid`)[0]?.status === "held");
    await anonPage.goto(`${BASE}/community/t/${threadId}`);
    check("one sensitive-location flag hides the reply at once", !(await anonPage.content()).includes("好可愛，希望牠平安。"));

    await modPage.goto(`${BASE}/community/moderation`);
    const flaggedCard = modPage.locator("section[aria-labelledby=flagged] > ul > li", { hasText: "好可愛" }).first();
    await flaggedCard.getByRole("button", { name: ZH.mod.approve, exact: true }).click();
    await flaggedCard.waitFor({ state: "detached", timeout: 10000 });
    await anonPage.goto(`${BASE}/community/t/${threadId}`);
    check("a moderator's approval puts it back", (await anonPage.content()).includes("好可愛，希望牠平安。"));

    // -- Suspension -------------------------------------------------------------
    await modPage.goto(`${BASE}/community/moderation#suspensions`);
    await modPage.locator("#suspend-handle-console").fill(profile.handle);
    await modPage.locator("#suspend-days-console").fill("1");
    await modPage.locator("#suspend-reason-console").fill("e2e 測試停權");
    await modPage.locator("#suspend-reason-console").press("Enter");
    await modPage.getByText(ZH.msg.memberSuspended).waitFor({ timeout: 10000 });
    await memberPage.goto(`${BASE}/community/t/${threadId}`);
    check("a suspended member can read but has no reply box", (await memberPage.locator("#reply-body").count()) === 0);
    const tooLong = await sql`select count(*)::int as n from forum_sanctions where user_id = ${member.id}::uuid`;
    check("the suspension is recorded", tooLong[0].n === 1);
    await modPage.goto(`${BASE}/community/moderation#suspensions`);
    const lift = modPage.locator("section[aria-labelledby=suspensions] li", { hasText: "e2e 測試停權" }).first();
    await lift.getByText(ZH.mod.lift).first().click();
    await lift.locator('input[name="reason"]').fill("測試結束");
    await lift.locator("button[type=submit]").click();
    await lift.waitFor({ state: "detached", timeout: 10000 });
    await memberPage.goto(`${BASE}/community/t/${threadId}`);
    check("lifting it gives the reply box back", (await memberPage.locator("#reply-body").count()) === 1);

    // -- Export, and leaving -------------------------------------------------------
    const exp = await fetch(`${BASE}/api/forum/export`, { headers: { Cookie: member.header } });
    const data = exp.ok ? await exp.json() : null;
    check("the member can download their posts", data?.posts?.length === 2 && data.profile?.handle === profile.handle);
    check("the download is only theirs", !JSON.stringify(data).includes(mod.id) && !JSON.stringify(data).includes(member.email));

    await memberPage.goto(`${BASE}/me`);
    await memberPage.locator('input[name="confirm"]').check();
    await memberPage.getByRole("button", { name: ZH.me.leaveButton }).click();
    await memberPage.getByText(ZH.me.notJoined).waitFor({ timeout: 10000 });
    const [gone] = await sql`select 1 from forum_profiles where user_id = ${member.id}::uuid`;
    check("deleting the forum account removes the profile", !gone);
    await anonPage.goto(`${BASE}/community/t/${threadId}`);
    const after = await anonPage.content();
    check("their posts stay, as a deleted member", after.includes(ZH.deletedMember) && after.includes("好可愛，希望牠平安。"));

    for (const ctx of [anon, memberCtx, modCtx]) await ctx.close();
  } catch (e) {
    check("the forum flow ran to the end", false, e.message);
  } finally {
    await browser.close();
    for (const id of threads) await sql`delete from forum_threads where id = ${id}::uuid`.catch(() => {});
    for (const id of created) await deleteAccount(id);
  }
}

console.log(`forum e2e against ${BASE}, forum ${FORUM_ON ? "ON" : "OFF"}`);
if (FORUM_ON) await whenOn();
else await whenOff();
await sql.end();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
