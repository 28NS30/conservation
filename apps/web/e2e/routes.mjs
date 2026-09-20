/**
 * Every page this site serves, written down once.
 *
 * Before this file there were five lists: `pages.spec.mjs:PAGES` (16 rows),
 * `focus.spec.mjs:PAGES` (7), `_shots.mjs:PAGES` (9), `_contrast.mjs:PAGES` (8)
 * and whatever a new check happened to copy from one of them. They disagreed:
 * `/login`, `/team`, `/season` and `/reports/[id]` were in none of them, which
 * is why `/login` shipped an input with no label and a chart with no accessible
 * name past a green CI. A page registered here is checked by every consumer of
 * this table; a page added to the app and not added here is one grep away from
 * being noticed, because `qa-harness.test.mjs` walks `app/` and fails when a
 * `page.tsx` has no row.
 *
 * Consumers: shots.mjs, a11y.spec.mjs, contrast.spec.mjs, reflow.spec.mjs,
 * perf.spec.mjs and the self-test. pages.spec.mjs and focus.spec.mjs move onto
 * it in a later PR — see docs/qa-harness.md, "Migrating pages.spec.mjs".
 *
 * A row is:
 *
 *   name      file-safe id; the screenshot filename and the gallery heading
 *   path      the zh-TW path. The English twin is "/en" + path, EXCEPT "/",
 *             whose twin is "/en" — see enPath().
 *   settle    ms to wait after `load` before measuring or photographing
 *   map       true if MapLibre paints here: fold-only screenshots, a longer
 *             settle, and the perf spec's first-tile probe
 *   dynamic   how to find a real id for a parameterised route at run time
 *   full      false to skip the full-page screenshot (see map)
 *   skipShots / skipAxe / skipContrast / skipReflow — each with a `why`
 *   states    extra screens reachable only by driving the page; each is
 *             { id, why, drive(page) }. Page workstreams add their own.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

/**
 * Both locales, with the Accept-Language each one needs.
 *
 * Playwright sends no Accept-Language at all, so an unprefixed path renders
 * zh-TW by default and an /en path renders English by the prefix. Both are
 * still set explicitly: next-intl redirects an English-preferring browser from
 * "/" to "/en", so the zh rows rest on a default that a Playwright upgrade or a
 * CI image with a locale set would flip silently.
 */
export const LOCALES = [
  { id: "zh", locale: "zh-TW", prefix: "" },
  { id: "en", locale: "en-US", prefix: "/en" },
];

/** Screenshot widths. 390 is a phone, 768 a tablet, 1440 a laptop. */
export const SHOT_WIDTHS = [390, 768, 1440];

/**
 * Reflow widths. 320 is the WCAG 1.4.10 reflow width — not a phone anybody
 * sells, but what a 390px phone becomes when its owner turns on larger text.
 */
export const REFLOW_WIDTHS = [320, 390];

/** axe runs at the two widths that are genuinely two documents. */
export const AXE_WIDTHS = [390, 1440];

const MAP_SETTLE = 9000;

/** Why the lab is measured but not photographed; see the lab rows below. */
const LAB_SHOTS =
  "The lab is a prototype for one decision, not a page of the site. Two directions across six compositions is 60-odd more screenshots per run of work that is deleted the week a direction is chosen — and the owner judges it by opening it, not by reading a gallery of it. The measuring sweeps still run: what matters here is whether these pages hold up, not what they looked like on a given commit.";

export const ROUTES = [
  {
    name: "home",
    path: "/",
    settle: 4000,
    map: true,
    full: true,
    why: "The hero runs the map component in presentation mode, so it paints WebGL but has no chrome.",
  },
  {
    name: "map",
    path: "/map",
    settle: MAP_SETTLE,
    map: true,
    full: false,
    why: "A fixed-height app shell. _shots.mjs put it plainly: a full-page shot of it is a lie.",
  },
  {
    name: "report",
    path: "/report",
    settle: MAP_SETTLE,
    map: true,
    full: true,
    why: "The location picker is a live map inside an ordinary scrolling page.",
  },
  { name: "reports", path: "/reports", settle: 3000 },
  {
    name: "report-detail",
    path: "/reports/__ID__",
    settle: 3500,
    map: true,
    dynamic: {
      // Discovered from the public list, never from the database: /reports is
      // the public view, so any id it links to is one a visitor may already
      // see. A hardcoded id would be a slice-specific id that CI does not have.
      from: "/reports",
      // The full UUID shape, not "six or more of these characters". The loose
      // pattern half-matched: the streamed RSC payload carries the same href
      // split across a chunk boundary, so the FIRST match in the document was
      // `f8bc64fc-b06d-` — a real prefix of a real id, 22 characters long, and
      // a 404. Every sweep then reported the record page as broken while it
      // was serving 200 to the whole id.
      pattern:
        /\/reports\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
      env: "QA_REPORT_ID",
    },
  },
  { name: "species", path: "/species", settle: 3000 },
  {
    name: "species-detail",
    path: "/species/28758-duttaphrynus-melanostictus",
    settle: 7000,
    map: true,
    full: true,
    why: "Duttaphrynus melanostictus: in the CI fixture and in the full dataset, with enough records to draw every band of the chart.",
  },
  { name: "stats", path: "/stats", settle: 3500 },
  { name: "season", path: "/season", settle: 2500 },
  { name: "about", path: "/about", settle: 2500 },
  {
    name: "team",
    path: "/team",
    settle: 2500,
    // 404 today, and correctly: lib/team.ts publishes the page only when the
    // roster is non-empty, and it is empty until each person has consented
    // (個資法). Recorded as the expected status rather than dropped, so that the
    // day the roster lands this check fails and says to change this line —
    // which is better than a page quietly never being swept again.
    expectStatus: 404,
  },
  { name: "attribution", path: "/attribution", settle: 2000 },
  { name: "privacy", path: "/privacy", settle: 2000 },
  { name: "login", path: "/login", settle: 2500 },
  {
    name: "me",
    path: "/me",
    settle: 2500,
    // Signed out, this page is an invitation to sign in and holds no record at
    // all. Signed in it lists one person's own reports at full precision, so
    // the harness never authenticates — see docs/qa-harness.md, "Privacy".
    signedOutOnly: true,
  },
  {
    name: "admin",
    path: "/admin",
    settle: 2500,
    signedOutOnly: true,
    skipShots:
      "The moderation queue shows exact coordinates of unpublished reports. A screenshot of it is a disclosure, and a gallery of them is a disclosure with a URL.",
  },
  // The design lab. `lib/lab/gate.ts` serves it everywhere except Vercel
  // production, so CI sees it and a visitor does not.
  //
  // Listed here for the same reason as everything else: five checks read this
  // table, and a page that is not in it is a page none of them look at. That
  // matters more for the lab than for a finished page — these are the
  // compositions an owner is about to choose between, and a direction that
  // overflows at 320px or sets 3:1 text is a direction that should lose on
  // those grounds rather than be chosen and then repaired.
  //
  // One row per app route, not per page. The species section has seven taxa
  // behind `/lab/[direction]/species/[id]`, each chosen for an edge it shows;
  // three of them (102062, 85879, 79876) are not in the CI fixture and would
  // 404 here while rendering perfectly on a full database. The two that ARE in
  // the fixture cover the shape: one page with everything filled in, one with
  // a seven-Hanzi name and a blurred-location Notice.
  {
    name: "lab-compare",
    path: "/lab",
    settle: 2500,
    why: "The decision page itself: both directions side by side, and the only lab page that is not a composition.",
    skipShots: LAB_SHOTS,
  },
  {
    name: "lab-roundel-home",
    path: "/lab/roundel",
    settle: 3000,
    why: "Roundel's home. The 520px emblem is the largest single element anywhere in either direction.",
    skipShots: LAB_SHOTS,
  },
  {
    name: "lab-journal-home",
    path: "/lab/journal",
    settle: 3000,
    why: "Field journal's home — the runner-up, and the only page built in both looks.",
    skipShots: LAB_SHOTS,
  },
  {
    name: "lab-roundel-map",
    path: "/lab/roundel/map",
    settle: MAP_SETTLE,
    map: true,
    full: false,
    why: "A fixed-height app shell like /map, and painting WebGL for the same reason.",
    skipShots: LAB_SHOTS,
  },
  {
    name: "lab-roundel-report-stepper",
    path: "/lab/roundel/report/stepper",
    settle: 3000,
    why: "The recommended report flow, first screen. One question, one large action.",
    skipShots: LAB_SHOTS,
  },
  {
    name: "lab-roundel-report-photo-first",
    path: "/lab/roundel/report/photo-first",
    settle: 3000,
    why: "The alternative flow, kept because the owner is choosing between the two.",
    skipShots: LAB_SHOTS,
  },
  {
    name: "lab-roundel-species",
    path: "/lab/roundel/species/28758",
    settle: 7000,
    map: true,
    full: true,
    why: "黑眶蟾蜍, 3,978 records — in the CI fixture, and the species page with every part filled in.",
    skipShots: LAB_SHOTS,
  },
  {
    name: "lab-roundel-species-long",
    path: "/lab/roundel/species/37689",
    settle: 6000,
    map: true,
    full: true,
    why: "斯文豪氏頸槽蛇: seven Hanzi at hero size, and the only lab species page carrying the blurred-location Notice. The long-name case is where a name-as-the-picture design breaks if it is going to.",
    skipShots: LAB_SHOTS,
  },
  {
    name: "lab-roundel-primitives",
    path: "/lab/roundel/primitives",
    settle: 2500,
    why: "Every primitive under one theme at once — the page where a token change shows up against all of them.",
    skipShots: LAB_SHOTS,
  },
  {
    name: "lab-journal-primitives",
    path: "/lab/journal/primitives",
    settle: 2500,
    why: "The same components under the runner-up's tokens, which is what makes the two comparable at all.",
    skipShots: LAB_SHOTS,
  },
  {
    name: "not-found",
    path: "/no-such-page-exists-here",
    settle: 1500,
    expectStatus: 404,
  },
];

/**
 * States that exist on a route but not at a URL.
 *
 * Kept beside the table rather than inside it so a page workstream adds its own
 * without touching a row four other checks read. Each driver is handed a page
 * already loaded at the route and returns when the state is on screen.
 *
 * The loading skeletons are the ones nothing has ever photographed: they appear
 * during a client-side navigation, live for a few hundred milliseconds, and are
 * the first thing a visitor on a slow connection sees.
 */
export const STATES = {
  stats: [
    {
      id: "loading",
      why: "app/[locale]/(site)/stats/loading.tsx — seen on every soft navigation to /stats, and by nobody reviewing the design.",
      async drive(page, { prefix }) {
        // Hold the RSC payload, then click the header link to /stats. The
        // skeleton is what fills the gap. Matching on href, not on a class or a
        // label, because href is what the page promises; see the migration
        // policy in docs/qa-harness.md.
        await page.route(/_rsc=/, async (route) => {
          await new Promise((r) => setTimeout(r, 4000));
          await route.continue();
        });
        const link = page.locator(`a[href="${prefix}/stats"]`).first();
        if ((await link.count()) === 0) return false;
        await link.click({ noWaitAfter: true }).catch(() => {});
        await page.waitForTimeout(900);
        return true;
      },
      /** Where the driver starts, since a soft navigation needs somewhere to come from. */
      from: "/",
    },
  ],
};

/** "/" has no "/en/" twin — its English path is "/en". */
export function enPath(path) {
  return path === "/" ? "/en" : "/en" + path;
}

/** The path for a route in a locale, with any dynamic id already substituted. */
export function pathFor(route, locale, ids = {}) {
  const raw = ids[route.name] ?? route.path;
  return locale.prefix ? enPath(raw) : raw;
}

/** A file-safe, stable id: "map-en-w390". Same build, same build, same names. */
export function shotName(route, locale, width, part, state) {
  return [
    route.name,
    state ? `-${state}` : "",
    locale.prefix ? "-en" : "",
    `-w${width}`,
    `-${part}`,
  ].join("");
}

/**
 * Real ids for the parameterised routes, found by reading the public page that
 * links to them.
 *
 * `/reports/[id]` cannot be hardcoded: the CI fixture is a thin slice of the
 * dataset and shares no report id with a developer's local database. Discovery
 * also keeps the harness honest about privacy — it can only ever reach a report
 * the public list already published.
 */
export async function resolveIds(base = BASE, fetchImpl = fetch) {
  const ids = {};
  const notes = [];
  for (const route of ROUTES) {
    if (!route.dynamic) continue;
    const override = process.env[route.dynamic.env];
    if (override) {
      ids[route.name] = route.path.replace("__ID__", override);
      notes.push(`${route.name}: ${route.dynamic.env}=${override}`);
      continue;
    }
    try {
      const res = await fetchImpl(base + route.dynamic.from, {
        headers: { "accept-language": "zh-TW" },
      });
      const html = await res.text();
      const m = html.match(route.dynamic.pattern);
      if (m) {
        ids[route.name] = route.path.replace("__ID__", m[1]);
        notes.push(`${route.name}: ${m[1]} (from ${route.dynamic.from})`);
      } else {
        notes.push(
          `${route.name}: no id found on ${route.dynamic.from} — the route is SKIPPED, not passed`,
        );
      }
    } catch (e) {
      notes.push(`${route.name}: ${route.dynamic.from} unreachable (${e.message})`);
    }
  }
  return { ids, notes };
}

/** The routes a given check should visit, with the skipped ones and their reasons. */
export function routesFor(check, ids = {}) {
  const key = { shots: "skipShots", axe: "skipAxe", contrast: "skipContrast", reflow: "skipReflow" }[check];
  const run = [];
  const skipped = [];
  for (const route of ROUTES) {
    if (route[key]) {
      skipped.push({ name: route.name, why: route[key] });
      continue;
    }
    if (route.dynamic && !ids[route.name]) {
      skipped.push({ name: route.name, why: "no id resolved for this parameterised route" });
      continue;
    }
    run.push(route);
  }
  return { run, skipped };
}

/**
 * Message namespaces, derived rather than listed.
 *
 * pages.spec.mjs kept a hand-written array of 22 namespaces and the catalogue
 * has 24. `team` and `statsPage` were missing, so an untranslated `team.title`
 * rendered as the literal string "team.title" on a page CI had declared clean.
 * Derived from the catalogue, that gap cannot recur.
 */
export function namespaces(dir = join(import.meta.dirname, "..", "messages")) {
  return Object.keys(JSON.parse(readFileSync(join(dir, "en.json"), "utf8")));
}

/** `namespace.someKey` — what next-intl renders instead of throwing. */
export function leakedKeyPattern(ns = namespaces()) {
  return new RegExp(`\\b(?:${ns.join("|")})\\.[a-zA-Z][a-zA-Z0-9]*\\b`, "g");
}
