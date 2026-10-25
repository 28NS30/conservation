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
 * And a page cached for everybody must not go on showing a record after the
 * record has moved: a sparse species lists its records with their points, and
 * one re-identified as a blurred species, or blurred where it stands, leaves
 * the cached page when the reports' tag is dropped (lib/siteFigures.ts). How
 * long a page may be served stale at all is bounded too (`expireTime`,
 * next.config.ts), for a blur no writer announces.
 *
 *   node --test test/public-pages-cache.test.mjs      # TEST_BASE_URL for the live half
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { sql, BASE_URL, requireServer } from "./helpers.mjs";

after(() => sql.end());

const WEB = join(import.meta.dirname, "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");

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

/**
 * Whether `entry`, or a server module it reaches, asks next-intl for
 * translations. A client component's translations come from the provider,
 * not the request, so the walk stops at "use client".
 */
function translatesOnServer(entry) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return false;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    if (/^\s*["']use (client|server)["']/.test(src)) return false;
    return specifiers(src).some((spec) => {
      if (spec === "next-intl/server") return true;
      const next = resolve(file, spec);
      return next ? walk(next) : false;
    });
  };
  return walk(entry);
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

  test("every layout that translates on the server tells next-intl the locale", () => {
    // Asked for a translation before anything has set the locale, next-intl
    // reads it from the request's headers, and that alone makes the page
    // render per request. Next renders a layout apart from its page, so the
    // page setting it is not enough: the (site) layout's header and footer,
    // which translate, kept every page under it private, no-store until the
    // layout set it too.
    const layouts = routeFiles(join(WEB, "app", "[locale]"))
      .filter((f) => f.endsWith("layout.tsx"))
      .map((f) => relative(WEB, f))
      .filter((f) => !PER_USER.some((re) => re.test(f)));
    assert.ok(layouts.length >= 3, `only ${layouts.length} layouts found`);
    const unset = layouts.filter((f) => translatesOnServer(join(WEB, f)) && !/setRequestLocale\(locale\)/.test(read(f)));
    assert.deepEqual(unset, []);
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

describe("nothing cached outlasts the bound", () => {
  // A blur tightened in the database reaches a cached page only when the page
  // is rebuilt, so every lifetime that can carry a record's point is short:
  // a page is served for ten minutes at most (expireTime), and nothing it is
  // made from lasts more than five. Next caches a page for the shortest
  // lifetime among its own `revalidate` and the cached reads it makes, so one
  // longer read anywhere a page reaches is a longer page; and a page whose
  // lifetime exceeds expireTime loses its stale-while-revalidate, so a CDN
  // keeps it for the whole of it.
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const EXPIRE = Number(/^\s*expireTime:\s*(\d+),/m.exec(code(read("next.config.ts")))?.[1]);

  function sources(dir) {
    const out = [];
    for (const name of readdirSync(join(WEB, dir))) {
      const rel = join(dir, name);
      if (statSync(join(WEB, rel)).isDirectory()) out.push(...sources(rel));
      else if (/\.tsx?$/.test(name)) out.push(rel);
    }
    return out;
  }

  /** Every cache lifetime written in app/ and lib/, in seconds, with where. */
  function lifetimes() {
    const found = [];
    for (const file of [...sources("app"), ...sources("lib")]) {
      const src = code(read(file));
      const constant = (name) => Number(new RegExp(`\\bconst ${name} = (\\d+);`).exec(src)?.[1]);
      for (const m of src.matchAll(/export const revalidate = (\d+);/g))
        found.push({ where: `${file}: export const revalidate`, seconds: Number(m[1]) });
      // unstable_cache's options, and a fetch's `next: { revalidate }`.
      for (const m of src.matchAll(/\brevalidate:\s*([A-Za-z_$][\w$]*|\d+)/g))
        found.push({ where: `${file}: revalidate: ${m[1]}`, seconds: /^\d+$/.test(m[1]) ? Number(m[1]) : constant(m[1]) });
    }
    return found;
  }

  test("a page is served for ten minutes at most", () => {
    assert.equal(EXPIRE, 600);
  });

  test("and nothing a page is made from, nor the page itself, lasts more than five", () => {
    const all = lifetimes();
    // The control: the walk sees the figures' lifetime, through its constant,
    // the footer's read and the pages' own.
    assert.ok(all.some((l) => l.where === "lib/siteFigures.ts: revalidate: FIVE_MINUTES" && l.seconds === 300), "the walk missed siteFigure");
    assert.ok(all.some((l) => l.where.startsWith("lib/coverage.ts: revalidate:")), "the walk missed seasonOpen");
    assert.ok(all.filter((l) => l.where.endsWith("export const revalidate")).length >= 10, "the walk missed the pages");
    const over = all.filter((l) => !(l.seconds > 0 && l.seconds <= EXPIRE / 2));
    assert.deepEqual(over, []);
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
    if (!(await requireServer(t))) return;
    // One species built with the site, and one far down the list, which is
    // rendered on its first visit and cached from then on.
    const paths = [
      "/", "/en", "/about", "/en/privacy", "/attribution", "/en/stats", "/season", "/roadkill", "/wildlife",
      await aSpecies(0), await aSpecies(200),
    ];
    for (const path of paths) {
      const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
      assert.equal(res.status, 200, path);
      const cc = res.headers.get("cache-control") ?? "";
      assert.match(cc, /s-maxage=\d+/, `${path}: ${cc}`);
      assert.doesNotMatch(cc, /private|no-store/, `${path}: ${cc}`);
      // Served for ten minutes at most from when it was made, stale for the
      // second five, not Next's default year: that is the bound on a blur no
      // writer announces. A page with no stale-while-revalidate at all is one
      // whose cached reads outlast expireTime, and the CDN keeps it for them.
      const age = Number(/s-maxage=(\d+)/.exec(cc)?.[1]);
      const stale = Number(/stale-while-revalidate=(\d+)/.exec(cc)?.[1]);
      assert.ok(stale > 0 && age + stale <= 600, `${path}: ${cc}`);
      assert.deepEqual(res.headers.getSetCookie(), [], path);
      assert.doesNotMatch(res.headers.get("link") ?? "", /rel="?alternate/, path);
    }
  });

  test("a bare species id redirects with one Location, even on its first visit", async (t) => {
    // A cached page that redirects sends Location twice on the render that
    // fills its cache, and fetch follows "a, a" to a 404. So a bare id is
    // redirected per request, by species/by-id. Each run asks for ids nobody
    // has asked for yet on this server, which is the case that broke.
    if (!(await requireServer(t))) return;
    const rows = await sql`
      select t.id from taxa t join species_report_stats s on s.taxon_id = t.id
       order by s.report_count desc, t.id
       offset ${100 + Math.floor(Math.random() * 200)} limit 2`;
    for (const [prefix, r] of [["", rows[0]], ["/en", rows[1]]]) {
      const res = await fetch(`${BASE_URL}${prefix}/species/${r.id}`, { redirect: "manual" });
      assert.equal(res.status, 307, `${prefix}/species/${r.id}`);
      const location = res.headers.get("location") ?? "";
      assert.match(location, new RegExp(`^${prefix}/species/${r.id}-[a-z0-9-]+$`), location);
      const followed = await fetch(`${BASE_URL}${prefix}/species/${r.id}`);
      assert.equal(followed.status, 200, followed.url);
    }
  });

  test("a slug that is not the taxon's own shows the page, with the right canonical", async (t) => {
    if (!(await requireServer(t))) return;
    const path = await aSpecies(0);
    const id = /\/species\/(\d+)-/.exec(path)[1];
    const res = await fetch(`${BASE_URL}/en/species/${id}-an-old-name`, { redirect: "manual" });
    assert.equal(res.status, 200);
    const html = await res.text();
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? "";
    assert.ok(canonical.endsWith(path), `canonical is ${canonical}, not ${path}`);
  });

  test("somebody's own pages are not", async (t) => {
    if (!(await requireServer(t))) return;
    const [r] = await sql`select id from reports_public limit 1`;
    for (const path of ["/en/me", "/en/login", "/en/admin", `/en/reports/${r.id}`]) {
      const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
      assert.match(res.headers.get("cache-control") ?? "", /no-store/, path);
    }
  });
});

describe("…and dropped when a record on it moves", () => {
  const AUTH = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const MANIFEST = join(WEB, ".next", "server", "server-reference-manifest.json");
  const made = { reports: [], accounts: [] };
  let moderator = null;
  let skip = null;

  /** An account with a session, the way test/test-reports-signed-in.test.mjs makes one. */
  async function createModerator() {
    const email = `cache-moderator-${randomUUID().slice(0, 8)}@example.test`;
    const password = randomBytes(18).toString("base64url");
    const res = await fetch(`${AUTH}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!res.ok) throw new Error(`could not create a test account: ${res.status}`);
    const user = await res.json();
    made.accounts.push(user.id);
    await sql`insert into profiles (id, role) values (${user.id}::uuid, 'moderator')
              on conflict (id) do update set role = 'moderator'`;
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

  /** A server action called the way the browser calls it, from the page that renders it. */
  async function act(name, path, args) {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    const id = Object.entries(manifest.node ?? {}).find(([, e]) => e.exportedName === name)?.[0];
    assert.ok(id, `the build lists no server action ${name}`);
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Next-Action": id,
        Origin: new URL(BASE_URL).origin,
        "Content-Type": "text/plain;charset=UTF-8",
        Cookie: moderator.cookie,
      },
      body: JSON.stringify(args),
      redirect: "manual",
    });
    await res.arrayBuffer();
    assert.equal(res.status, 200, `${name} answered ${res.status}`);
  }

  const slug = (r) => `${r.id}-${r.scientific_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

  /**
   * A species nobody has recorded, so its page has never been asked for on
   * this server, that is published to the metre; and one record of it, at a
   * point of its own.
   *
   * The record is committed, so the server can see it, and other suites read
   * the same database meanwhile. So the species is outside the directory
   * where there is one (not on Taiwan's list, or not an accepted name), or a
   * suite walking it would meet a species that comes and goes; and the
   * record is an import's, because a public record a person filed opens the
   * season goal (test/season-gate.test.mjs).
   */
  async function aSparseSpecies() {
    // From a few hundred rows after a random id, by the primary key: a scan
    // of all of taxa would also move where the other suites' unordered
    // `limit 1` lookups start reading it.
    const [{ top }] = await sql`select max(id) as top from taxa`;
    const pick = (from) => sql`
      with near as (
        select t.id, t.scientific_name, t.is_in_taiwan, t.taxon_status from taxa t
         where t.id >= ${from} and t.rank = 'Species' and t.kingdom = 'Animalia'
         order by t.id limit 400)
      select id, scientific_name from near
       where not exists (select 1 from reports r where r.taxon_id = near.id)
         and taxon_precision(near.id) = 'exact'
       order by (is_in_taiwan and taxon_status = 'accepted'), random() limit 1`;
    let [taxon] = await pick(Math.floor(Math.random() * top));
    // Too near the end to find one: from the start instead.
    if (!taxon) [taxon] = await pick(0);
    assert.ok(taxon, "no unrecorded species published to the metre");
    const lng = 120.6 + Math.random() * 0.6;
    const lat = 23.2 + Math.random() * 0.8;
    const [record] = await sql`
      insert into reports (category, location, location_public, observed_at, taxon_id,
                           taxon_source, status, source)
      values ('roadkill', st_setsrid(st_makepoint(${lng}, ${lat}), 4326)::geography,
              st_setsrid(st_makepoint(${lng}, ${lat}), 4326)::geography,
              now() - interval '1 day', ${taxon.id}, 'imported', 'published', 'gbif')
      returning id::text`;
    made.reports.push(record.id);
    return { path: `/en/species/${slug(taxon)}`, taxonId: taxon.id, record: record.id, point: await shownPoint(record.id) };
  }

  /** A record's point as its species page prints it, from the public view. */
  async function shownPoint(id) {
    const [p] = await sql`
      select st_y(location_public::geometry) as lat, st_x(location_public::geometry) as lng
        from reports_public where id = ${id}::uuid`;
    assert.ok(p, `record ${id} is not public`);
    return `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`;
  }

  /** The page's HTML, without the markers React puts between text nodes. */
  async function page(path) {
    const res = await fetch(`${BASE_URL}${path}`);
    assert.equal(res.status, 200, path);
    return { cache: res.headers.get("x-nextjs-cache"), html: (await res.text()).replaceAll("<!-- -->", "") };
  }

  /** Asked until the cache answers, so what is checked next is the cached copy. */
  async function cached(path) {
    for (let i = 0; i < 4; i++) {
      const got = await page(path);
      if (got.cache === "HIT") return got;
    }
    assert.fail(`${path} was never served from the cache`);
  }

  before(async () => {
    if (!(await requireServer())) return void (skip = `no server at ${BASE_URL}`);
    if (!(await fetch(`${AUTH}/auth/v1/health`).catch(() => null))?.ok) return void (skip = `no auth at ${AUTH}`);
    if (!SERVICE || !ANON_KEY) return void (skip = "no Supabase keys in the environment");
    if (!existsSync(MANIFEST)) return void (skip = "no build to read the server actions from");
    moderator = await createModerator();
  });

  after(async () => {
    await tidy();
    for (const id of made.accounts) {
      await fetch(`${AUTH}/auth/v1/admin/users/${id}`, {
        method: "DELETE",
        headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
      }).catch(() => {});
      await sql`delete from profiles where id = ${id}::uuid`.catch(() => {});
    }
  });

  /** This test's records, deleted as soon as it ends rather than with the file. */
  async function tidy() {
    await sql`delete from reports where id = any(${made.reports.splice(0)}::uuid[])`;
  }

  test("a record a moderator names as a blurred species leaves its old species page at once", async (t) => {
    if (skip) return t.skip(skip);
    t.after(tidy);
    const s = await aSparseSpecies();
    const before = await cached(s.path);
    assert.ok(before.html.includes(`/reports/${s.record}`), "the page does not list the record");
    assert.ok(before.html.includes(s.point), `the page does not show ${s.point}`);

    // Named as a species published to 10 km at best, as a moderator does it
    // from the record's page.
    const [blurred] = await sql`
      select t.id from taxa t
       where t.rank = 'Species' and t.taxon_status is not distinct from 'accepted' and t.is_in_taiwan
         and taxon_precision(t.id) in ('coarse_10km', 'coarse_50km')
       order by t.id limit 1`;
    await act("confirmSpecies", `/en/reports/${s.record}`, [s.record, blurred.id]);
    const [row] = await sql`select taxon_id from reports where id = ${s.record}::uuid`;
    assert.equal(row.taxon_id, blurred.id, "the action did not rename the record");

    const after = await page(s.path);
    assert.ok(!after.html.includes(`/reports/${s.record}`), "the old species page still lists the record");
    assert.ok(!after.html.includes(s.point), `the old species page still shows ${s.point}`);
  });

  test("a record blurred in the database leaves the cached page once the tag is dropped", async (t) => {
    if (skip) return t.skip(skip);
    t.after(tidy);
    const s = await aSparseSpecies();
    await cached(s.path);

    // As a migration or a floor would: in the database, with no writer of the
    // app's to say so.
    await sql`update reports set precision_override = 'coarse_10km' where id = ${s.record}::uuid`;
    const blurred = await shownPoint(s.record);
    assert.notEqual(blurred, s.point, "the blur did not move the record");

    // The control: until something drops the tag, the cached copy still has
    // the old point. That window is what `expireTime` bounds. Unless another
    // suite's writer dropped the tag meanwhile, which only makes it shorter.
    const still = await page(s.path);
    if (still.cache === "HIT") assert.ok(still.html.includes(s.point), "the cached copy changed with nothing dropping it");
    else t.diagnostic(`the page was rebuilt before the tag was dropped here (${still.cache})`);

    // Any writer that changes the reports drops it: here a moderator
    // publishing a held report (an import's, for the season goal's sake).
    const [held] = await sql`
      insert into reports (category, location, location_public, observed_at, status, source)
      values ('roadkill', st_setsrid(st_makepoint(121.0, 24.0), 4326)::geography,
              st_setsrid(st_makepoint(121.0, 24.0), 4326)::geography, now(), 'pending', 'gbif')
      returning id::text`;
    made.reports.push(held.id);
    await act("publishReport", "/en/admin", [held.id]);
    const [row] = await sql`select status from reports where id = ${held.id}::uuid`;
    assert.equal(row.status, "published", "the action did not publish the report");

    const after = await page(s.path);
    assert.ok(!after.html.includes(s.point), `the page still shows the record at ${s.point}`);
    assert.ok(after.html.includes(blurred), `the page does not show the record blurred, at ${blurred}`);
  });
});
