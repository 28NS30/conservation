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
 *   votes: a stranger sees scores and no arrows, the author has no arrows on
 *     their own posts, the moderator votes the thread up, down and back, and
 *     votes a reply up in a browser with JavaScript off;
 *   replies to replies nest; a reply to a reply refused as too fast comes
 *     back open, saying why, with its text, with JavaScript off and on;
 *     hiding the middle one leaves "[removed]" in its place with the answers
 *     still under it; Best and New order the replies, with scores chosen so
 *     that neither order could pass for the other;
 *   a second thread: New and Top order the community's feed, Top of today
 *     leaves out an older thread, a pin leads in every order, and the front
 *     page lists both with their community and no pin;
 *   the moderator suspends the member, who can then read but not post, and
 *     lifts it;
 *   the member downloads their posts and votes, deletes their forum account,
 *     their votes go with it, and their thread then reads "deleted member"
 *     and offers nobody arrows.
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

  // As many as the two action files export: an action the build does not list
  // would be one this loop never tries.
  const exported = ["actions.ts", join("moderation", "actions.ts")]
    .map((f) => readFileSync(join(WEB, "app", "[locale]", "(site)", "community", f), "utf8"))
    .reduce((n, src) => n + [...src.matchAll(/^export async function /gm)].length, 0);
  const actions = forumActions();
  check(
    "the build lists every forum server action",
    actions.length === exported && exported > 0,
    `${actions.length} in the manifest, ${exported} exported`,
  );
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

    // -- Votes ------------------------------------------------------------------
    const [{ id: openerId }] = await sql`select id from forum_posts where thread_id = ${threadId}::uuid and is_opener`;
    const score = async (id) => (await sql`select score from forum_posts where id = ${id}::uuid`)[0]?.score;
    const modVote = async (id) =>
      (await sql`select value from forum_votes where post_id = ${id}::uuid and voter_id = ${mod.id}::uuid`)[0]?.value ?? 0;
    const arrow = (page, postId, which, pressed) =>
      page.locator(`#post-${postId}`).getByRole("button", {
        name: which === "up" ? ZH.vote.up : ZH.vote.down,
        exact: true,
        ...(pressed === undefined ? {} : { pressed }),
      });
    /** Press an arrow and wait for the score; if it never comes, say what the page said instead. */
    const press = async (page, postId, which, expected) => {
      await arrow(page, postId, which).click();
      try {
        await until(async () => (await score(postId)) === expected);
      } catch {
        const said = await page.locator(`#post-${postId} [role=alert]`).allInnerTexts().catch(() => []);
        throw new Error(`the score of ${postId} did not reach ${expected} (it is ${await score(postId)}); the page said: ${said.join(" / ") || "nothing"}`);
      }
    };

    await anonPage.goto(`${BASE}/community/t/${threadId}`);
    check(
      "a stranger sees the scores and no vote buttons",
      (await anonPage.locator("button[aria-pressed]").count()) === 0 && (await anonPage.content()).includes("0 分"),
    );
    await memberPage.goto(`${BASE}/community/t/${threadId}`);
    check("nobody gets arrows on their own posts", (await memberPage.locator("button[aria-pressed]").count()) === 0);

    await modPage.goto(`${BASE}/community/t/${threadId}`);
    await press(modPage, openerId, "up", 1);
    await arrow(modPage, openerId, "up", true).waitFor({ timeout: 10000 });
    check("voting the thread up counts it, and the arrow says so", (await modVote(openerId)) === 1);
    await press(modPage, openerId, "down", -1);
    await arrow(modPage, openerId, "down", true).waitFor({ timeout: 10000 });
    check("changing to down is one vote, not two", (await modVote(openerId)) === -1);
    await press(modPage, openerId, "down", 0);
    await arrow(modPage, openerId, "down", false).waitFor({ timeout: 10000 });
    check("pressing it again takes the vote back", (await modVote(openerId)) === 0);
    await press(modPage, openerId, "up", 1);

    // Without JavaScript: the arrows are a form, and a form posts.
    {
      const ctx = await browser.newContext({ locale: "zh-TW", javaScriptEnabled: false });
      await ctx.addCookies(mod.cookies);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/community/t/${threadId}`);
      await press(page, reply.id, "up", 1);
      await page.goto(`${BASE}/community/t/${threadId}`);
      check(
        "a vote works with JavaScript off",
        (await modVote(reply.id)) === 1 && (await arrow(page, reply.id, "up", true).count()) === 1,
      );
      await ctx.close();
    }

    // -- Replies to replies -------------------------------------------------------
    // Both accounts are a few minutes old, and a new account may post twice a
    // minute (lib/forum/policy.ts postingLimits) — replies to replies
    // included, which is how the first version of this step found out. A
    // person does not post this fast; this run does, so it starts each of its
    // own posts on a fresh minute.
    const freshMinute = (who) => sql`delete from rate_limits where key = ${`forum:burst:${who.id}`}`;
    /** Reply to a post from its own "Reply", and return the new post. */
    const answer = async (page, who, parentId, body) => {
      await freshMinute(who);
      await page.goto(`${BASE}/community/t/${threadId}`);
      const card = page.locator(`#post-${parentId}`);
      await card.locator("summary", { hasText: ZH.replyToThis }).click();
      await card.locator(`#reply-body-${parentId}`).fill(body);
      await card.getByRole("button", { name: ZH.postReply, exact: true }).click();
      try {
        await until(async () => (await sql`select 1 from forum_posts where body = ${body}`).length === 1);
      } catch {
        const said = await card.locator("[role=alert]").allInnerTexts().catch(() => []);
        throw new Error(`the reply to ${parentId} was not posted; the page said: ${said.join(" / ") || "nothing"}`);
      }
      const [row] = await sql`select id, parent_id, path, status, held_reasons from forum_posts where body = ${body}`;
      // Held only as a first post when the database has three moderators (see above).
      if (row.status === "held") await sql`update forum_posts set status = 'visible', held_reasons = '{}' where id = ${row.id}::uuid`;
      return row;
    };
    const m2 = await answer(modPage, mod, reply.id, "應該是穿山甲，看尾巴就知道。");
    check("a reply to a reply records whom it answers", m2.parent_id === reply.id && m2.path.join() === reply.id, JSON.stringify(m2));
    await modPage.goto(`${BASE}/community/t/${threadId}`);
    check("and is shown under it", (await modPage.locator(`li:has(> #post-${reply.id}) #post-${m2.id}`).count()) === 1);

    await memberPage.goto(`${BASE}/community/t/${threadId}`);
    await press(memberPage, m2.id, "up", 1);
    const r3 = await answer(memberPage, member, m2.id, "謝謝版主，我下次會拍尾巴。");
    check("a third level nests under the second", r3.path.join() === `${reply.id},${m2.id}`, r3.path.join());

    // A refused reply to a reply comes back open, saying why, with the text
    // still in the box: without JavaScript the page is drawn anew, and with
    // it React empties a form once its action has run. "Too fast" is the
    // refusal a person meets most, so this spends the member's minute (the
    // current one and the next, in case the run crosses it).
    const spentMinute = (who) => sql`
      insert into rate_limits (key, window_start, count)
      select ${`forum:burst:${who.id}`},
             to_timestamp(floor(extract(epoch from now()) / 60) * 60) + n * interval '1 minute', 1000
        from generate_series(0, 1) n
      on conflict (key, window_start) do update set count = 1000`;
    const refusedText = "這一則會被拒絕，但打好的字要留著。";
    for (const js of [false, true]) {
      await spentMinute(member);
      const ctx = await browser.newContext({ locale: "zh-TW", javaScriptEnabled: js });
      await ctx.addCookies(member.cookies);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/community/t/${threadId}`);
      const card = page.locator(`#post-${m2.id}`);
      await card.locator("summary", { hasText: ZH.replyToThis }).click();
      await card.locator(`#reply-body-${m2.id}`).fill(refusedText);
      await card.getByRole("button", { name: ZH.postReply, exact: true }).click();
      const alert = card.locator("[role=alert]");
      await alert.waitFor({ state: "attached", timeout: 10000 });
      const said = await alert.innerText().catch(() => "");
      const kept = await card.locator(`#reply-body-${m2.id}`).inputValue();
      check(
        `a refused reply to a reply is shown open, with why and the text (JavaScript ${js ? "on" : "off"})`,
        (await alert.isVisible()) && said.includes(ZH.msg.tooFast) && kept === refusedText,
        `alert ${(await alert.isVisible()) ? "visible" : "not visible"}: "${said}"; box: "${kept}"`,
      );
      await ctx.close();
    }
    await freshMinute(member);
    check("and was not posted", (await sql`select 1 from forum_posts where body = ${refusedText}`).length === 0);

    // Hide the first reply: the answers under it keep their place.
    await modPage.goto(`${BASE}/community/t/${threadId}`);
    const hideCard = modPage.locator(`#post-${reply.id}`);
    await hideCard.locator("summary", { hasText: ZH.mod.hide }).click();
    await hideCard.locator(`#hide-reason-${reply.id}`).fill("e2e 測試隱藏");
    await hideCard.locator(`form:has(#hide-reason-${reply.id}) button[type=submit]`).click();
    await until(async () => (await sql`select status from forum_posts where id = ${reply.id}::uuid`)[0].status === "hidden");
    await anonPage.goto(`${BASE}/community/t/${threadId}`);
    const removed = anonPage.locator("li", { has: anonPage.getByText(ZH.removedPlace, { exact: true }) });
    const hiddenHtml = await anonPage.content();
    check(
      "a hidden reply leaves [removed] in its place, with the answers still under it",
      !hiddenHtml.includes("好可愛，希望牠平安。") &&
        (await removed.count()) >= 1 &&
        (await removed.first().locator(`#post-${m2.id}`).count()) === 1 &&
        (await removed.first().locator(`#post-${r3.id}`).count()) === 1,
    );
    await modPage.goto(`${BASE}/community/t/${threadId}`);
    await modPage.locator(`#post-${reply.id}`).getByRole("button", { name: ZH.mod.approve, exact: true }).click();
    await until(async () => (await sql`select status from forum_posts where id = ${reply.id}::uuid`)[0].status === "visible");

    // Best and New. The older top-level reply has the higher score (the
    // moderator's vote above), so New, newest first, is not Best...
    await freshMinute(mod);
    await modPage.goto(`${BASE}/community/t/${threadId}`);
    await modPage.locator("#reply-body").fill("另一個想法：也可能是鼬獾。");
    await modPage.getByRole("button", { name: ZH.postReply, exact: true }).click();
    await until(async () => (await sql`select 1 from forum_posts where body = '另一個想法：也可能是鼬獾。'`).length === 1);
    const [late] = await sql`select id, status from forum_posts where body = '另一個想法：也可能是鼬獾。'`;
    if (late.status === "held") await sql`update forum_posts set status = 'visible', held_reasons = '{}' where id = ${late.id}::uuid`;
    const topLevel = async (query) => {
      await anonPage.goto(`${BASE}/community/t/${threadId}${query}`);
      return anonPage.locator("#replies > ol > li > article").evaluateAll((els) => els.map((e) => e.id.replace(/^post-/, "")));
    };
    let best = await topLevel("");
    const newest = await topLevel("?sort=new");
    check("New puts the newest first, whatever the scores", newest[0] === late.id && newest[1] === reply.id, newest.join());
    check("Best puts the higher score first", best[0] === reply.id && best[1] === late.id, best.join());
    // ...and then the newer one overtakes it, so Best is not simply the older
    // first either (that is only how a tie is broken).
    await modPage.goto(`${BASE}/community/t/${threadId}`);
    await press(modPage, reply.id, "up", 0);
    await memberPage.goto(`${BASE}/community/t/${threadId}`);
    await press(memberPage, late.id, "up", 1);
    best = await topLevel("");
    check("Best puts a newer reply with more votes above an older one", best[0] === late.id && best[1] === reply.id, best.join());

    // -- Feeds: New, Top, a pin, and the front page ----------------------------
    const title2 = `forum e2e newer ${randomUUID().slice(0, 8)}`;
    await freshMinute(mod);
    await modPage.goto(`${BASE}/community/c/sightings-id`);
    await modPage.locator("#thread-title").fill(title2);
    await modPage.locator("#thread-body").fill("第二個話題，用來測排序。");
    await Promise.all([
      modPage.waitForURL(/\/community\/t\/[0-9a-f-]{36}$/),
      modPage.getByRole("button", { name: ZH.post, exact: true }).click(),
    ]);
    const thread2 = modPage.url().split("/").pop();
    threads.push(thread2);
    await sql`update forum_posts set status = 'visible', held_reasons = '{}' where thread_id = ${thread2}::uuid and status = 'held'`;
    await sql`update forum_threads set status = 'visible' where id = ${thread2}::uuid and status = 'held'`;

    const order = async (path) => {
      await anonPage.goto(`${BASE}${path}`);
      const html = await anonPage.content();
      return { first: html.indexOf(title), second: html.indexOf(title2) };
    };
    let o = await order("/community/c/sightings-id?sort=new");
    check("New: the newer thread first", o.first > 0 && o.second > 0 && o.second < o.first, JSON.stringify(o));
    o = await order("/community/c/sightings-id?sort=top");
    check("Top: the higher score first", o.first > 0 && o.second > 0 && o.first < o.second, JSON.stringify(o));
    o = await order("/community?sort=new");
    check("the front page lists threads from the communities", o.first > 0 && o.second > 0 && o.second < o.first, JSON.stringify(o));
    // In the feed's own items, not the list of communities beside it.
    check("each with its community", (await anonPage.locator('#feed-title ~ ul article a[href$="/community/c/sightings-id"]').count()) >= 2);

    // A pin, in every order. The first thread is moved back three days, so
    // that without its pin it would be second in Hot and New, and not in Top
    // of today at all; only the pin can put it first in each. (All time, it
    // leads Top on its score anyway, which is checked above.)
    await sql`update forum_threads set created_at = now() - interval '3 days' where id = ${threadId}::uuid`;
    o = await order("/community/c/sightings-id?sort=top&t=day");
    check("Top of today leaves out an older thread", o.first === -1 && o.second > 0, JSON.stringify(o));
    o = await order("/community/c/sightings-id");
    check("Hot puts the newer thread first", o.second > 0 && (o.first === -1 || o.second < o.first), JSON.stringify(o));

    await modPage.goto(`${BASE}/community/t/${threadId}`);
    await modPage.getByRole("button", { name: ZH.mod.pin, exact: true }).click();
    await until(async () => (await sql`select pinned_at from forum_threads where id = ${threadId}::uuid`)[0].pinned_at !== null);
    for (const [name, query] of [
      ["Hot", ""],
      ["New", "?sort=new"],
      ["Top", "?sort=top"],
      ["Top of today", "?sort=top&t=day"],
    ]) {
      o = await order(`/community/c/sightings-id${query}`);
      check(`a pinned thread leads its community's feed: ${name}`, o.first > 0 && o.first < o.second, JSON.stringify(o));
    }
    o = await order("/community?sort=new");
    check("but not the front page's", o.second > 0 && o.second < o.first, JSON.stringify(o));

    // A missing message renders as its key ("forum.rulesLink") and the page
    // still answers 200, so look for keys in the text of every kind of page.
    // In contexts of their own: visiting /en leaves the browser preferring
    // English, and the steps below read the Chinese.
    {
      const readers = [
        ["stranger", await browser.newContext({ locale: "zh-TW" })],
        ["moderator", await browser.newContext({ locale: "zh-TW" })],
      ];
      await readers[1][1].addCookies(mod.cookies);
      for (const [who, ctx] of readers) {
        const page = await ctx.newPage();
        for (const prefix of ["", "/en"])
          for (const path of [
            "/community",
            "/community?sort=top&t=week",
            "/community/c/sightings-id",
            `/community/t/${threadId}`,
            `/community/t/${threadId}?sort=new`,
            "/community/guidelines",
          ]) {
            await page.goto(`${BASE}${prefix}${path}`);
            const keys = (await page.locator("body").innerText()).match(/\bforum\.[a-z]\w*(\.\w+)*/g);
            check(`${prefix}${path.replace(threadId, "…")} (${who}) shows no message keys`, !keys, keys?.join(", "));
          }
        await ctx.close();
      }
    }

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
    check(
      "the member can download their posts and votes",
      data?.posts?.length === 3 && data.votes?.length === 2 && data.profile?.handle === profile.handle,
      `${data?.posts?.length} posts, ${data?.votes?.length} votes`,
    );
    check("the download is only theirs", !JSON.stringify(data).includes(mod.id) && !JSON.stringify(data).includes(member.email));

    await memberPage.goto(`${BASE}/me`);
    await memberPage.locator('input[name="confirm"]').check();
    await memberPage.getByRole("button", { name: ZH.me.leaveButton }).click();
    await memberPage.getByText(ZH.me.notJoined).waitFor({ timeout: 10000 });
    const [gone] = await sql`select 1 from forum_profiles where user_id = ${member.id}::uuid`;
    check("deleting the forum account removes the profile", !gone);
    const [{ n: votesLeft }] = await sql`select count(*)::int as n from forum_votes where voter_id = ${member.id}::uuid`;
    check(
      "and their votes, and the scores they were in",
      votesLeft === 0 && (await score(m2.id)) === 0 && (await score(late.id)) === 0,
    );
    await anonPage.goto(`${BASE}/community/t/${threadId}`);
    const after = await anonPage.content();
    check("their posts stay, as a deleted member", after.includes(ZH.deletedMember) && after.includes("好可愛，希望牠平安。"));
    // Nothing can tell any more whether a voter wrote them (policy.ts
    // voteRefusal), so they keep the score they have: the thread's is the
    // moderator's vote.
    await modPage.goto(`${BASE}/community/t/${threadId}`);
    const theirs = [openerId, reply.id, r3.id].map((id) => `#post-${id} button[aria-pressed]`).join(", ");
    check(
      "and take no new votes: nobody is offered arrows on them",
      (await modPage.locator(theirs).count()) === 0 && (await score(openerId)) === 1,
      `${await modPage.locator(theirs).count()} arrows, thread score ${await score(openerId)}`,
    );

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
