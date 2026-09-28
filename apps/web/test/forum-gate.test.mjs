/**
 * The forum ships dark, and every way in has to know it.
 *
 * FORUM_ENABLED unset means the forum does not exist: every page under
 * /community, both forum API routes and every forum server action answer 404,
 * nothing in the nav, the footer, the sitemap or robots.txt points at it, and
 * no forum query runs. Opening it waits for a legal review and a moderator
 * rota, which only the owner can arrange.
 *
 * The realistic way that breaks is not someone deleting the gate. It is
 * someone adding a page, an action or a route next year and not asking it, and
 * a server action is the easy one to miss: it is a public POST endpoint that
 * can be called from any page of the site, forum or not. So these read every
 * forum entry point and check that the gate is the FIRST thing it does, and
 * that every moderation action checks the caller's role right after.
 *
 * The runtime half asks the running server, when this test process was not
 * told the server has the forum on (FORUM_ENABLED is what e2e/forum.spec.mjs
 * and CI use to say which way a server was started).
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sql, BASE_URL } from "./helpers.mjs";
import { forumEnabled } from "../lib/forum/gate.ts";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const COMMUNITY = join(WEB, "app", "[locale]", "(site)", "community");
const read = (...p) => readFileSync(join(...p), "utf8");

function files(dir, pred) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full, pred));
    else if (pred(name)) out.push(full);
  }
  return out;
}

/** The statements of a function body, from its opening brace, as trimmed lines. */
function bodyAfter(src, marker) {
  const at = src.indexOf(marker);
  assert.notEqual(at, -1, `${marker} not found`);
  // The body's brace: the first "{" after the parameter list closes.
  let depth = 0;
  let i = src.indexOf("(", at);
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) break;
  }
  const open = src.indexOf("{", src.indexOf(")", i));
  return src
    .slice(open + 1)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"));
}

describe("the switch", () => {
  test("only exactly 1 or true turns it on", () => {
    for (const v of ["1", "true"]) assert.equal(forumEnabled({ FORUM_ENABLED: v }), true, v);
    for (const v of [undefined, "", "0", "false", "yes", "TRUE", "True", " 1", "1 ", "on", "enabled"])
      assert.equal(forumEnabled({ FORUM_ENABLED: v }), false, JSON.stringify(v));
  });

  test("off by default, in production and everywhere else", () => {
    assert.equal(forumEnabled({}), false);
    assert.equal(forumEnabled({ VERCEL_ENV: "production" }), false);
    assert.equal(forumEnabled({ VERCEL_ENV: "preview" }), false);
    assert.equal(forumEnabled({ NODE_ENV: "development" }), false);
  });
});

describe("every forum page asks first", () => {
  const pages = files(COMMUNITY, (n) => n === "page.tsx" || n === "layout.tsx");

  test("there are the pages this checks", () => {
    assert.ok(pages.length >= 8, `found ${pages.length}`);
  });

  for (const file of pages) {
    const rel = file.slice(WEB.length + 1);
    const src = readFileSync(file, "utf8");

    test(`${rel}: requireForum() is the first statement`, () => {
      const body = bodyAfter(src, "export default async function");
      assert.equal(body[0], "requireForum();", `the page must ask the gate before anything else, found: ${body[0]}`);
    });

    if (src.includes("generateMetadata")) {
      test(`${rel}: generateMetadata asks first too`, () => {
        const body = bodyAfter(src, "export async function generateMetadata");
        assert.equal(body[0], "requireForum();");
      });
    }

    test(`${rel}: is rendered per request, so the switch is read per request`, () => {
      assert.match(src, /export const dynamic = "force-dynamic"/);
    });

    if (rel.endsWith("page.tsx")) {
      test(`${rel}: sets no robots of its own (the layout's noindex must win)`, () => {
        assert.ok(!/robots\s*:/.test(src));
      });
    }
  }

  test("the layout is noindex", () => {
    assert.match(read(COMMUNITY, "layout.tsx"), /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  });

  test("there is no loading.tsx under /community", () => {
    // Beneath one, notFound() answers 200 with a skeleton instead of 404,
    // and a switched-off forum becomes a page that exists.
    assert.deepEqual(files(COMMUNITY, (n) => n.startsWith("loading.")), []);
  });
});

/** Every `export async function` in a server-action file, with its body's first lines. */
function exportedActions(src) {
  return [...src.matchAll(/export async function (\w+)\(/g)].map((m) => ({
    name: m[1],
    body: bodyAfter(src, `export async function ${m[1]}(`),
  }));
}

describe("every forum server action asks first", () => {
  const member = read(COMMUNITY, "actions.ts");
  const moderation = read(COMMUNITY, "moderation", "actions.ts");

  test("both files are server action files", () => {
    assert.match(member, /^"use server";/);
    assert.match(moderation, /^"use server";/);
  });

  for (const a of exportedActions(member)) {
    test(`member action ${a.name}: requireForum() first, then the session`, () => {
      assert.equal(a.body[0], "requireForum();");
      assert.equal(a.body[1], "const viewer = await forumViewer();", "who is asking comes from the session, never the form");
    });
  }

  const modActions = exportedActions(moderation);
  test("there are the moderation actions this checks", () => {
    assert.ok(modActions.length >= 12, `found ${modActions.length}`);
  });
  for (const a of modActions) {
    test(`moderation action ${a.name}: requireForum(), then the role, before anything else`, () => {
      assert.equal(a.body[0], "requireForum();");
      assert.match(
        a.body[1],
        /^const actor = await require(Moderator|Admin)\(\);$/,
        `${a.name} must check the caller's role second — a server action is a public endpoint`,
      );
    });
  }

  test("the role comes from the database, and a refusal throws", () => {
    const guard = moderation.slice(moderation.indexOf("async function requireModerator"));
    const body = guard.slice(0, guard.indexOf("\n}"));
    assert.match(body, /await currentRole\(\)/, "lib/auth.ts reads profiles.role for the session's user");
    assert.match(body, /isModeratorRole\(role\)/);
    assert.match(body, /throw new Error\("forbidden"\)/);
  });

  test("requireAdmin needs the admin role, not just moderator", () => {
    const guard = moderation.slice(moderation.indexOf("async function requireAdmin"));
    assert.match(guard.slice(0, guard.indexOf("\n}")), /actor\.role !== "admin"/);
  });

  test("role changes are admin-only", () => {
    const setRole = modActions.find((a) => a.name === "setMemberRole");
    assert.equal(setRole.body[1], "const actor = await requireAdmin();");
  });
});

describe("the forum's API routes ask first", () => {
  test("export: the gate before the session", () => {
    const body = bodyAfter(read(WEB, "app", "api", "forum", "export", "route.ts"), "export async function GET");
    assert.match(body[0], /^if \(!forumEnabled\(\)\) return new Response\("Not Found", \{ status: 404 \}\);$/);
  });

  test("retention job: the gate before the cron secret", () => {
    const src = read(WEB, "app", "api", "jobs", "forum-retention", "route.ts");
    const body = bodyAfter(src, "async function run");
    assert.match(body[0], /^if \(!forumEnabled\(\)\) return new Response\("Not Found", \{ status: 404 \}\);$/);
    assert.match(body[1], /authorised\(req\)/);
  });

  test("every forum route file is one of these", () => {
    const routes = files(join(WEB, "app", "api"), (n) => n === "route.ts").filter((f) => /forum/.test(f));
    assert.deepEqual(routes.map((f) => f.slice(WEB.length + 1)).sort(), [
      "app/api/forum/export/route.ts",
      "app/api/jobs/forum-retention/route.ts",
    ]);
  });
});

describe("outside /community, the forum is invisible while off", () => {
  test("the /me section asks the switch before it asks the database", () => {
    const src = read(WEB, "components", "forum", "ForumAccount.tsx");
    const body = bodyAfter(src, "export default async function ForumAccount");
    assert.equal(body[0], "if (!forumEnabled()) return null;");
  });

  test("the header, footer, sitemap and robots do not mention it", () => {
    for (const f of [
      ["components", "site", "SiteHeader.tsx"],
      ["components", "site", "SiteFooter.tsx"],
      ["app", "sitemap.ts"],
      ["app", "robots.ts"],
      ["app", "[locale]", "page.tsx"],
    ])
      assert.ok(!read(WEB, ...f).includes("/community"), f.join("/"));
  });

  test("the health check asks for the forum's tables only while it is on", () => {
    const src = read(WEB, "lib", "schemaStatus.ts");
    assert.match(src, /return forumEnabled\(env\) \? \[\.\.\.REQUIRED_SCHEMA, \.\.\.FORUM_SCHEMA\] : REQUIRED_SCHEMA;/);
    assert.match(src, /checks: SchemaCheck\[\] = requiredSchema\(\)/);
  });
});

describe("every message an action can answer with is translated", () => {
  const catalogues = ["en", "zh-TW"].map((l) => JSON.parse(read(WEB, "messages", `${l}.json`)).forum.msg);
  const keys = new Set();
  for (const f of [
    [COMMUNITY, "actions.ts"],
    [COMMUNITY, "moderation", "actions.ts"],
    [WEB, "lib", "forum", "policy.ts"],
  ]) {
    const src = read(...f);
    for (const m of src.matchAll(/\b(?:fail|ok)\("(\w+)"/g)) keys.add(m[1]);
    for (const m of src.matchAll(/\breturn "(\w+)";/g)) keys.add(m[1]);
    for (const m of src.matchAll(/error: "(\w+)"/g)) keys.add(m[1]);
    for (const m of src.matchAll(/\b(?:fail|ok)\(\w+ \? "(\w+)" : "(\w+)"/g)) {
      keys.add(m[1]);
      keys.add(m[2]);
    }
  }
  test("found the keys", () => assert.ok(keys.size > 40, `${keys.size}`));
  for (const k of keys) {
    test(`forum.msg.${k}`, () => {
      for (const c of catalogues) assert.ok(c[k], `forum.msg.${k} is missing`);
    });
  }
});

describe("the running server, with the forum off", { skip: forumEnabled(process.env) && "this run says the server has the forum on" }, () => {
  const paths = [
    "/community",
    "/community/c/sightings-id",
    "/community/t/00000000-0000-4000-8000-000000000000",
    "/community/u/blue-magpie-4821",
    "/community/join",
    "/community/guidelines",
    "/community/moderation",
  ];
  for (const p of paths)
    for (const prefix of ["", "/en"])
      test(`${prefix}${p} is a 404`, async () => {
        const res = await fetch(BASE_URL + prefix + p, { redirect: "manual" });
        assert.equal(res.status, 404);
      });

  test("the export and the retention job are 404s", async () => {
    assert.equal((await fetch(`${BASE_URL}/api/forum/export`)).status, 404);
    assert.equal((await fetch(`${BASE_URL}/api/jobs/forum-retention`)).status, 404);
  });

  test("the health check does not ask for the forum", async () => {
    const body = await (await fetch(`${BASE_URL}/api/health`)).json();
    assert.ok(!(body.schemaMissing ?? []).some((m) => m.startsWith("0019")), JSON.stringify(body.schemaMissing));
  });

  test("the sitemap does not list it", async () => {
    assert.ok(!(await (await fetch(`${BASE_URL}/sitemap.xml`)).text()).includes("/community"));
  });
});

test("no route file anywhere else imports the forum's actions", () => {
  // /me renders ForumAccount, which imports leaveForum; that is the one place
  // outside /community a forum action is reachable from, and it is gated.
  const users = files(join(WEB, "app"), (n) => /\.tsx?$/.test(n))
    .filter((f) => !f.startsWith(COMMUNITY))
    .filter((f) => /community\/(moderation\/)?actions/.test(readFileSync(f, "utf8")));
  assert.deepEqual(users, []);
  assert.ok(existsSync(join(WEB, "components", "forum", "ForumAccount.tsx")));
});
