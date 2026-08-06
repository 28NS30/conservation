/**
 * Post-deploy smoke test. Run it against production the moment a deploy lands.
 *
 *   node scripts/verify-deploy.mjs https://your-domain
 *   node scripts/verify-deploy.mjs            # defaults to localhost:3000
 *
 * This exists because "the deploy went green" and "the new site is live" are
 * different claims. A Vercel build can succeed while serving a stale alias, and
 * a running deployment can answer 200 on every route while its database
 * credentials are months out of date — both of which happened on this project.
 * Every check here is one someone had to run by hand to notice that.
 *
 * Exits non-zero on failure so it can gate anything that follows.
 */

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const pass = [];
const fail = [];

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
  title.includes("生態守望計畫"),
  title.includes("生態通報地圖")
    ? `STALE — title reads "${title}"`
    : title || "no <title>",
);

// The wordmark sets "Project Ecowatch" and uppercases it in CSS, so the capitals
// never appear in the HTML. Matching the rendered form finds nothing, always.
check(
  "landing page is the redesigned one",
  /project\s+ecowatch/i.test(html),
  /project\s+ecowatch/i.test(html) ? "" : "wordmark missing — old build?",
);

/* ---------------- routes ---------------- */

const ROUTES = [
  ["/map", 200],
  ["/species", 200],
  ["/stats", 200],
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
  const res = await get("/api/health");
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
} catch (e) {
  check("database reachable (/api/health)", false, e.message.slice(0, 60));
}

/* ---------------- tiles, which are the map ---------------- */

try {
  const res = await get("/api/tiles/6/53/27");
  const buf = await res.arrayBuffer();
  check(
    "vector tiles served",
    res.status === 200 && buf.byteLength > 0,
    `${res.status}, ${buf.byteLength} bytes`,
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
    if (/challenges\.cloudflare\.com|0x4AAAA/i.test(js)) {
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

/* ---------------- report ---------------- */

console.log(
  `\n  ${pass.length}/${pass.length + fail.length} passed against ${BASE}` +
    (fail.length ? `, ${fail.length} FAILURE(S)\n` : "\n"),
);
process.exit(fail.length ? 1 : 0);
