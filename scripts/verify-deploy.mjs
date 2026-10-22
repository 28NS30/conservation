/**
 * Post-deploy smoke test. Run it against production the moment a deploy lands.
 *
 *   node scripts/verify-deploy.mjs https://formosawatch.biowatchitnl.org
 *   node scripts/verify-deploy.mjs https://preservation-web-one.vercel.app
 *   node scripts/verify-deploy.mjs            # defaults to localhost:3000
 *
 * This exists because "the deploy went green" and "the new site is live" are
 * different claims. A Vercel build can succeed while serving a stale alias, and
 * a running deployment can answer 200 on every route while its database
 * credentials are months out of date — both of which happened on this project.
 * Every check here is one someone had to run by hand to notice that.
 *
 * Pointed at the old host it checks the move instead (see below).
 *
 * Exits non-zero on failure so it can gate anything that follows.
 */

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const pass = [];
const fail = [];

/** apps/web/lib/siteUrl.ts and apps/web/proxy.ts, which this cannot import. */
const CANONICAL = "https://formosawatch.biowatchitnl.org";
const OLD_HOST = "preservation-web-one.vercel.app";

/**
 * The origin this deployment must name in its canonical links and sitemap.
 * Locally, what lib/siteUrl.ts names off Vercel, whatever port the server is
 * on. Anywhere else, the site's own address, whatever host answered: a
 * preview's canonical names production, and so must every page however it
 * was reached.
 */
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(BASE).hostname);
const EXPECTED_ORIGIN = LOCAL
  ? new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").origin
  : CANONICAL;

function check(name, ok, detail = "") {
  (ok ? pass : fail).push({ name, detail });
  const mark = ok ? "  ok  " : " FAIL ";
  console.log(`${mark} ${name.padEnd(46)} ${detail}`);
}

async function get(path, opts = {}) {
  const res = await fetch(BASE + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    ...opts,
  });
  return res;
}

/* ---------------- the old host, which only moves ----------------
 * The site moved to CANONICAL in October 2026, and the old host answers every
 * page with a 308 to the same path and query there. Everything else still
 * answers on it, because a phone may hold reports saved under the old origin
 * that can only be sent from it, to its own /api (apps/web/proxy.ts). So
 * against the old host, check that, and nothing more: none of the checks
 * further down could pass on a host that redirects its pages. */

if (new URL(BASE).hostname === OLD_HOST) {
  try {
    for (const path of ["/", "/species?filter=protected", "/en/about"]) {
      const res = await get(path);
      const to = res.headers.get("location") ?? "";
      check(
        `GET ${path} moves to ${new URL(CANONICAL).hostname}`,
        res.status === 308 && to === `${CANONICAL}${path}`,
        `${res.status}${to ? ` -> ${to}` : ""}`,
      );
    }

    const health = await get("/api/health");
    const body = await health.json().catch(() => ({}));
    check(
      "/api/health still answers here",
      health.status === 200 && body.ok === true,
      `${health.status}`,
    );

    for (const path of ["/sw.js", "/manifest.webmanifest"]) {
      const res = await get(path);
      check(`GET ${path} still answers here`, res.status === 200, `${res.status}`);
    }

    // The way out for a phone with reports still queued under this origin:
    // its service worker asks for the page itself (apps/web/public/sw.js).
    const stay = await get("/report", { headers: { "x-unsent-reports": "1" } });
    check(
      "a phone with unsent reports keeps the page",
      stay.status === 200,
      `${stay.status}`,
    );
  } catch (e) {
    check(`reach ${BASE}`, false, e.message.slice(0, 60));
  }

  console.log(
    `\n  ${pass.length}/${pass.length + fail.length} passed against ${BASE} (the old host)` +
      (fail.length ? `, ${fail.length} FAILURE(S)\n` : "\n"),
  );
  process.exit(fail.length ? 1 : 0);
}

/* ---------------- is anything there at all ---------------- */

let home;
try {
  home = await get("/");
} catch (e) {
  console.error(`\n  cannot reach ${BASE}: ${e.message}\n`);
  process.exit(1);
}
check("home responds", home.status === 200, `${home.status}`);
const html = home.status === 200 ? await home.text() : "";

/* ---------------- is it THIS code, or a stale deployment? ----------------
 * The failure that motivated this file: production answered 200 on every route
 * for a day while serving a build from before the redesign. Status codes cannot
 * tell you that; only content can. */

// Read the <title>, not the body. The body is a false-positive machine: every
// page ships the whole next-intl message bundle inline, and about.whatBody
// legitimately contains the phrase "生態通報地圖" as prose — "a public Taiwan
// ecological reporting map". That is a description, not the old name.
const title = /<title[^>]*>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
check(
  "title carries the current name",
  title.includes("福爾摩沙守望計畫"),
  /生態守望計畫|生態通報地圖/.test(title)
    ? `STALE — title reads "${title}"`
    : title || "no <title>",
);

// The wordmark sets "Project FormosaWatch" and uppercases it in CSS, so the capitals
// never appear in the HTML. Matching the rendered form finds nothing, always.
check(
  "landing page is the redesigned one",
  /project\s+formosawatch/i.test(html),
  /project\s+formosawatch/i.test(html) ? "" : "wordmark missing — old build?",
);

/* ---------------- routes ---------------- */

const ROUTES = [
  ["/map", 200],
  ["/species", 200],
  ["/stats", 200],
  ["/season", 200],
  ["/en/season", 200],
  ["/report", 200],
  ["/reports", 200],
  ["/about", 200],
  ["/attribution", 200],
  ["/privacy", 200],
  ["/en", 200],
];
for (const [path, want] of ROUTES) {
  const res = await get(path);
  // /map is the one that 404s when the route-group restructure has not shipped.
  check(`GET ${path}`, res.status === want, `${res.status}`);
}

/* ---------------- the database is actually reachable ----------------
 * A deployment whose DATABASE_URL is wrong still serves static routes happily.
 * /api/health is the only thing that proves the credentials work. */

try {
  // The names of any missing rules come back only with the cron secret.
  const res = await get("/api/health", process.env.CRON_SECRET
    ? { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }
    : {});
  const body = await res.json();
  check(
    "database reachable (/api/health)",
    res.status === 200 && body.ok === true,
    res.status === 200
      ? `${Number(body.reports).toLocaleString()} reports, ${body.dbLatencyMs}ms`
      : `${res.status}`,
  );
  check(
    "map has data to show",
    Number(body.reports) > 0,
    `${Number(body.reports).toLocaleString()}`,
  );
  // Deploys are automatic; migrations are applied by hand. A deployment whose
  // database is behind the code renders perfectly and rejects every submission,
  // which is invisible from outside — and on a site that has not had its first
  // submission yet, invisible for a long time.
  check(
    "database schema matches the deployed code",
    body.schemaCurrent === true,
    body.schemaCurrent === true
      ? ""
      : `missing: ${(body.schemaMissing ?? ["unknown"]).join(", ")} — apply them: npm run db:migrate (it explains itself on a database with no migration history)`,
  );
} catch (e) {
  check("database reachable (/api/health)", false, e.message.slice(0, 60));
}

/* ---------------- tiles, which are the map ---------------- */

try {
  // fetch decodes content-encoding once, the way a browser does. What arrives
  // must then be a vector tile with our layer in it, not merely some bytes: a
  // tile gzipped twice — once by the route, once by a platform that started
  // compressing this type — would still be "more than zero bytes", and would
  // draw nothing.
  const res = await get("/api/tiles/6/53/27");
  const buf = new Uint8Array(await res.arrayBuffer());
  const gzippedTwice = buf[0] === 0x1f && buf[1] === 0x8b;
  let layers = [];
  try {
    const { VectorTile } = await import("@mapbox/vector-tile");
    const { PbfReader } = await import("pbf");
    layers = Object.keys(new VectorTile(new PbfReader(buf)).layers);
  } catch {
    /* unparseable: reported below */
  }
  check(
    "vector tiles served",
    res.status === 200 && !gzippedTwice && layers.includes("reports"),
    `${res.status}, ${buf.byteLength} bytes decoded` +
      (gzippedTwice ? ", STILL GZIPPED after decoding" : "") +
      (layers.length ? `, layers: ${layers.join(" ")}` : ", not a parseable tile"),
  );

  // And compressed on the wire. The platform does not compress this content
  // type itself, so the route does; losing that is a 5x regression in bytes
  // that no functional check would notice.
  const wire = await fetch(`${BASE}/api/tiles/6/53/27`, {
    headers: { "accept-encoding": "gzip" },
  });
  check(
    "vector tiles compressed on the wire",
    wire.headers.get("content-encoding") === "gzip",
    wire.headers.get("content-encoding") ?? "no content-encoding",
  );
} catch (e) {
  check("vector tiles served", false, e.message.slice(0, 60));
}

/* ---------------- the privacy boundary, from outside ----------------
 * Not a substitute for preflight's database-level check — this only proves the
 * public surface does not leak, which is the part a deploy can regress. */

const leaky = /"lat"\s*:\s*2[0-9]\.\d{5,}/.test(html);
check("no high-precision coordinates in home HTML", !leaky);

/* ---------------- anti-abuse must be live before launch ---------------- */

const reportPage = await get("/report");
const reportHtml = reportPage.status === 200 ? await reportPage.text() : "";
/*
 * Turnstile renders from an effect, so the served HTML for /report never
 * mentions it — grepping that HTML reported "no bot protection" against a
 * deployment where the challenge was demonstrably working. The site key is
 * inlined into a client chunk at build time, which is checkable without a
 * browser.
 */
let turnstileWired = false;
{
  const chunks = [...reportHtml.matchAll(/\/_next\/static\/[^"']+\.js/g)]
    .map((m) => m[0])
    .slice(0, 40);
  for (const c of chunks) {
    const js = await fetch(BASE + c)
      .then((r) => r.text())
      .catch(() => "");
    // Look for the site key itself — not the script URL, and not the render
    // call.
    //
    // The script URL was the original false positive: it is a module-level
    // constant in Turnstile.tsx and ships whether or not a key is configured,
    // so this check passed against builds with NEXT_PUBLIC_TURNSTILE_SITE_KEY
    // set to the empty string — the exact state it exists to catch.
    //
    // The render call was the second attempt, and the mirror-image mistake. The
    // minifier hoists the key into a variable, so production's bundle reads
    // `sitekey:n` and a pattern requiring a string literal after `sitekey:`
    // failed against a deployment whose challenge was demonstrably live.
    //
    // The key is inlined at build time as a literal somewhere in the chunk, so
    // match its shape: real Turnstile site keys begin 0x4AAAA, and Cloudflare's
    // documented test keys are 1x/2x/3x followed by twenty zeros.
    if (
      /["']0x4AAAA[0-9A-Za-z_-]{10,}["']|["'][123]x0{20}[A-Z]{2}["']/.test(js)
    ) {
      turnstileWired = true;
      break;
    }
  }
}

check(
  "Turnstile is wired into /report",
  turnstileWired,
  turnstileWired
    ? "site key present in the client bundle"
    : "no bot protection — do not launch publicly",
);

/* ---------------- the basemap, which is someone else's ----------------
 * September 2026: CARTO began watermarking every keyless tile with "API KEY
 * REQUIRED" while every route on this site still answered 200. Nothing about our
 * own responses can see a third party change its policy, so check the provider
 * directly, and check that the deployed code actually points at it. */

const OFM = "https://tiles.openfreemap.org";
try {
  const styleRes = await fetch(`${OFM}/styles/dark`, {
    signal: AbortSignal.timeout(20_000),
  });
  const style = styleRes.ok ? await styleRes.json() : null;
  check(
    "basemap style reachable (OpenFreeMap)",
    styleRes.ok && Array.isArray(style?.layers),
    `${styleRes.status}`,
  );
  // Tile paths are versioned per planet build, so resolve the template from the
  // TileJSON rather than hard-coding one. 12/3431/1753 is Taipei.
  const tj = await fetch(`${OFM}/planet`, {
    signal: AbortSignal.timeout(20_000),
  }).then((r) => r.json());
  const tileRes = await fetch(
    tj.tiles[0]
      .replace("{z}", "12")
      .replace("{x}", "3431")
      .replace("{y}", "1753"),
    { signal: AbortSignal.timeout(20_000) },
  );
  const type = tileRes.headers.get("content-type") ?? "";
  check(
    "basemap serves Taiwan tiles",
    tileRes.ok && /vector-tile|protobuf/.test(type),
    `${tileRes.status}, ${type}`,
  );
} catch (e) {
  check("basemap style reachable (OpenFreeMap)", false, e.message.slice(0, 60));
}

{
  const mapPage = await get("/map");
  const mapHtml = mapPage.status === 200 ? await mapPage.text() : "";
  let ofm = false;
  let carto = false;
  for (const c of [...mapHtml.matchAll(/\/_next\/static\/[^"']+\.js/g)]
    .map((m) => m[0])
    .slice(0, 40)) {
    const js = await fetch(BASE + c)
      .then((r) => r.text())
      .catch(() => "");
    if (js.includes("tiles.openfreemap.org")) ofm = true;
    if (js.includes("basemaps.cartocdn.com")) carto = true;
  }
  check(
    "deployed map uses the keyless basemap",
    ofm && !carto,
    carto
      ? "still requests CARTO — old build?"
      : ofm
        ? ""
        : "no basemap URL found",
  );
}

/* ---------------- every absolute URL has to name the site ----------------
 * Production served `Sitemap: http://localhost:3000/sitemap.xml` and a sitemap
 * whose every <loc> was a localhost URL, because NEXT_PUBLIC_SITE_URL was never
 * set and the fallback was localhost. Nothing errored and no test could see it:
 * in every environment a test runs in, localhost IS the right answer. Only a
 * check made from outside, against the host actually being served, can tell.
 *
 * Since the move the same mistake has a second shape: an address that answers,
 * but only with a redirect. The bare apex does that, and it is what Vercel's own
 * production hostname variable can hold now. So each of these must name
 * EXPECTED_ORIGIN exactly, not merely some host that responds. */

const originOf = (u) => {
  try {
    return new URL(u).origin;
  } catch {
    return "";
  }
};

const robotsTxt = await get("/robots.txt")
  .then((r) => (r.status === 200 ? r.text() : ""))
  .catch(() => "");
const sitemapLine = /^Sitemap:\s*(\S+)/m.exec(robotsTxt)?.[1] ?? "";
const sitemapOk = originOf(sitemapLine) === EXPECTED_ORIGIN;
check(
  "robots.txt points at the site's address",
  sitemapOk,
  sitemapOk ? sitemapLine : `${sitemapLine || "no Sitemap line"} (expected ${EXPECTED_ORIGIN})`,
);

const sitemapXml = await get("/sitemap.xml")
  .then((r) => (r.status === 200 ? r.text() : ""))
  .catch(() => "");
const locs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const strayLoc = locs.find((u) => originOf(u) !== EXPECTED_ORIGIN);
check(
  "sitemap URLs are absolute and on the site's address",
  locs.length > 0 && !strayLoc,
  !locs.length
    ? `no <loc> (expected ${EXPECTED_ORIGIN})`
    : strayLoc
      ? `${strayLoc} (expected ${EXPECTED_ORIGIN})`
      : `${locs.length} URLs, e.g. ${locs[0]}`,
);

for (const path of ["/", "/en", "/species"]) {
  const page = path === "/" ? html : await get(path).then((r) => (r.status === 200 ? r.text() : ""));
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(page)?.[1] ?? "";
  check(
    `canonical link on ${path} names the site's address`,
    originOf(canonical) === EXPECTED_ORIGIN,
    `${canonical || "no canonical link"}` +
      (originOf(canonical) === EXPECTED_ORIGIN ? "" : ` (expected ${EXPECTED_ORIGIN})`),
  );
}

/* ---------------- a shared link's card is an image, not a redirect ----------------
 * Every Chinese share card answered 307: Next names the card with the locale in
 * its path, /zh-TW/opengraph-image, and the locale routing dropped the prefix.
 * Asked of this host, by path, since the URL itself names the site's address. */

for (const path of ["/", "/en"]) {
  const page = path === "/" ? html : await get(path).then((r) => (r.status === 200 ? r.text() : ""));
  const og = /<meta property="og:image" content="([^"]+)"/.exec(page)?.[1] ?? "";
  let detail = "no og:image";
  let ok = false;
  if (og) {
    const u = new URL(og, BASE);
    const res = await get(u.pathname + u.search).catch(() => null);
    const type = res?.headers.get("content-type") ?? "";
    ok = res?.status === 200 && type.startsWith("image/png");
    detail = `${res?.status ?? "no answer"} ${type} ${u.pathname}`;
  }
  check(`share card for ${path} answers 200 with no redirect`, ok, detail);
}

/* ---------------- report ---------------- */

console.log(
  `\n  ${pass.length}/${pass.length + fail.length} passed against ${BASE}` +
    (fail.length ? `, ${fail.length} FAILURE(S)\n` : "\n"),
);
process.exit(fail.length ? 1 : 0);
