/**
 * A public page is the same page for everybody, so the CDN may serve it.
 *
 * Until October 2026 none was. The header asked Supabase who was signed in, on
 * every page, and reading the request's cookies made the whole site render per
 * request: production answered every page `private, no-store` with
 * x-vercel-cache MISS, the prerendered species pages and every `revalidate`
 * went unused, and each view ran the site-wide counts again (the species count
 * alone, 10,505 calls at 241 ms). next-intl added a Set-Cookie for NEXT_LOCALE
 * on top, which no shared cache will store.
 *
 * So: the header decides its account link in the browser
 * (components/auth/AccountLink.tsx); no public page reaches a module that
 * reads the request; and the pages that are somebody's own (/me, /admin,
 * /login, a report's receipt, the forum) still render per request.
 *
 *   node --test test/public-pages-cache.test.mjs      # TEST_BASE_URL for the live half
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { sql, BASE_URL } from "./helpers.mjs";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");
const up = async () => Boolean(await fetch(BASE_URL).catch(() => null));

/** Modules that read the request, and so make whatever renders them per request. */
const READS_REQUEST = new Set(["lib/supabase/server.ts", "lib/auth.ts", "lib/forum/server.ts"]);

/** Route files that belong to one person, or that ask who is looking. */
const PER_USER = [
  /^app\/\[locale\]\/\(site\)\/me\//,
  /^app\/\[locale\]\/\(site\)\/admin\//,
  /^app\/\[locale\]\/\(site\)\/login\//,
  /^app\/\[locale\]\/\(site\)\/reports\/\[id\]\//,
  /^app\/\[locale\]\/\(site\)\/community\//,
];

/** The specifiers a module imports, statically or not. Comments are skipped. */
function specifiers(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out = [];
  for (const m of code.matchAll(/(?:^|\n)\s*(?:import|export)\b[^"'`;]*?from\s*["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of code.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

/** A specifier as a file under apps/web, or null for a package. */
function resolve(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(WEB, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")])
    if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/**
 * Every module `entry` reaches that reads the request, with the path to it.
 * A "use server" module is not followed: importing a Server Action hands the
 * page a reference to call later, and the action's own reads happen then, on
 * its own request.
 */
function requestReaders(entry) {
  const found = [];
  const seen = new Set();
  const walk = (file, trail) => {
    if (seen.has(file)) return;
    seen.add(file);
    const rel = relative(WEB, file);
    const src = readFileSync(file, "utf8");
    if (file !== entry && /^\s*["']use server["']/.test(src)) return;
    if (READS_REQUEST.has(rel)) return void found.push([...trail, rel].join(" -> "));
    for (const spec of specifiers(src)) {
      if (spec === "next/headers") found.push([...trail, rel, spec].join(" -> "));
      const next = resolve(file, spec);
      if (next) walk(next, [...trail, rel]);
    }
  };
  walk(entry, []);
  return found;
}

function routeFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (/^(page|layout|loading|not-found|error|opengraph-image)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("nothing on a public page asks who is looking", () => {
  test("the header does not import the server's Supabase client", () => {
    const header = read("components", "site", "SiteHeader.tsx");
    assert.doesNotMatch(header, /@\/lib\/supabase\/server|next\/headers|@\/lib\/auth\b/);
    assert.deepEqual(requestReaders(join(WEB, "components", "site", "SiteHeader.tsx")), []);
  });

  test("…and its account link reads only the cookie, in the browser", () => {
    const link = read("components", "auth", "AccountLink.tsx");
    assert.match(link, /^"use client";/);
    assert.match(link, /storedSessionUserId\(document\.cookie, url\)/);
    // The server's answer, and so the first render's, is "signed out": the
    // page is the same for everyone and hydrates without a mismatch.
    assert.match(link, /useSyncExternalStore\(subscribe, signedInHere, \(\) => false\)/);
  });

  test("no public route reaches a module that reads the request", () => {
    const routes = routeFiles(join(WEB, "app", "[locale]"))
      .map((f) => relative(WEB, f))
      .filter((f) => !f.includes("/lab/") && !PER_USER.some((re) => re.test(f)));
    assert.ok(routes.length > 20, `only ${routes.length} routes found; is the walk broken?`);
    const offenders = routes.flatMap((r) => requestReaders(join(WEB, r)));
    assert.deepEqual(offenders, []);
  });

  test("the walk does see a page that reads the request", () => {
    // The control: /me asks who is signed in, and the walk must say so.
    const me = requestReaders(join(WEB, "app", "[locale]", "(site)", "me", "page.tsx"));
    assert.ok(me.length > 0, "the walk found nothing on /me, so it would find nothing anywhere");
  });

  test("next-intl sets no cookie and no Link header", () => {
    const routing = read("i18n", "routing.ts");
    assert.match(routing, /localeCookie: false/);
    assert.match(routing, /alternateLinks: false/);
  });
});

describe("served from the cache", () => {
  async function aSpecies(offset) {
    const [s] = await sql`
      select t.id, t.scientific_name from taxa t join species_report_stats s on s.taxon_id = t.id
       order by s.report_count desc, t.id limit 1 offset ${offset}`;
    return `/en/species/${s.id}-${s.scientific_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  }

  test("the public pages are shared, and set no cookie", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    // One species built with the site, and one far down the list, which is
    // rendered on its first visit and cached from then on.
    const paths = ["/", "/en", "/about", "/en/stats", "/season", "/roadkill", await aSpecies(0), await aSpecies(200)];
    for (const path of paths) {
      const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
      assert.equal(res.status, 200, path);
      const cc = res.headers.get("cache-control") ?? "";
      assert.match(cc, /s-maxage=\d+/, `${path}: ${cc}`);
      assert.doesNotMatch(cc, /private|no-store/, `${path}: ${cc}`);
      assert.deepEqual(res.headers.getSetCookie(), [], path);
      assert.doesNotMatch(res.headers.get("link") ?? "", /rel="?alternate/, path);
    }
  });

  test("somebody's own pages are not", async (t) => {
    if (!(await up())) return t.skip(`no server at ${BASE_URL}`);
    const [r] = await sql`select id from reports_public limit 1`;
    for (const path of ["/en/me", "/en/login", "/en/admin", `/en/reports/${r.id}`]) {
      const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
      assert.match(res.headers.get("cache-control") ?? "", /no-store/, path);
    }
  });
});
