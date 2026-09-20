/**
 * The review gallery: every page, both locales, three widths, one HTML page.
 *
 *   npm run shots --workspace @conservation/web
 *   ONLY=home,map npm run shots --workspace @conservation/web
 *   SHOTS_DIR=/tmp/before npm run shots --workspace @conservation/web
 *   open apps/web/e2e/shots/index.html            # no server needed
 *   open 'apps/web/e2e/shots/index.html?before=../before'   # side by side
 *
 * `_shots.mjs` grown up. That file covered 9 routes at two widths in Chinese
 * only, slept 15 seconds on every page with a map, and wrote 11 PNGs a reviewer
 * had to open one at a time from a file manager. It compared nothing, and it
 * was never the artifact a design review actually used.
 *
 * What it got right is kept: screenshots are the only way several real bugs were
 * ever seen — a map canvas escaping its container, a unit character orphaned
 * onto a line of its own, half of Taiwan off the right edge of a phone — and the
 * map page is a fixed-height app shell, so a full-page shot of it is a lie.
 *
 * This is NOT a pixel-diff gate. Fonts, live tiles and a database that changes
 * under you make a pixel comparison flap, and a flapping gate is a gate people
 * turn off. It is a page a person looks at, and `?before=` puts the last set
 * beside this one so "what changed" is a question the eye can answer.
 *
 * Costs about four minutes and 40 MB, so it runs nightly and on demand, not on
 * every push — .github/workflows/gallery.yml.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE,
  LOCALES,
  SHOT_WIDTHS,
  STATES,
  pathFor,
  resolveIds,
  routesFor,
  shotName,
} from "./routes.mjs";

const OUT = process.env.SHOTS_DIR ?? join(import.meta.dirname, "shots");

/** 390 is photographed at 2x: a phone screenshot at 1x looks sharper than the phone does. */
const SCALE = (width) => (width <= 430 ? 2 : 1);

/**
 * Wait for the map to have actually painted, rather than for a number of
 * seconds to have passed.
 *
 * _shots.mjs waited a flat 15s on every map page and said why: after a dev
 * server restart the route compiles first, and a 7s wait photographed a blank
 * canvas that looked exactly like a layout regression. Better slow than lying.
 * This keeps the promise and drops most of the cost — it waits for the map
 * handle, then for MapLibre's own `idle` event, and only falls back to the flat
 * wait when there is no handle to wait on (a build without NEXT_PUBLIC_E2E=1).
 */
async function settleMap(page, fallback = 15000) {
  const handle = await page
    .waitForFunction(() => !!window.__map, null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!handle) {
    await page.waitForTimeout(fallback);
    return "flat wait (no window.__map; build without NEXT_PUBLIC_E2E=1)";
  }
  const idle = await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          const m = window.__map;
          if (!m) return resolve(false);
          const done = () => resolve(true);
          if (m.loaded && m.loaded() && m.areTilesLoaded && m.areTilesLoaded())
            return done();
          m.once("idle", done);
          setTimeout(() => resolve(false), 12000);
        }),
    )
    .catch(() => false);
  // Tiles can arrive in the same frame as `idle`; one more beat before the shutter.
  await page.waitForTimeout(1200);
  return idle ? "idle" : "idle timed out after 12s — the shot may be mid-paint";
}

/** Everything the gallery needs about one screenshot, and nothing about how it was taken. */
function entry(route, locale, width, part, state) {
  return {
    file: shotName(route, locale, width, part, state) + ".png",
    route: route.name,
    locale: locale.id,
    width,
    part,
    state: state ?? null,
  };
}

/**
 * The gallery page, as a string.
 *
 * Pure, and exported, so the self-test can assert that every screenshot taken
 * appears in it — a gallery that silently omits a page is the same failure as
 * not taking the shot, and it looks fine.
 */
export function galleryHtml(entries, meta) {
  const routes = [...new Set(entries.map((e) => e.route))];
  const rows = routes
    .map((name) => {
      const mine = entries.filter((e) => e.route === name);
      const states = [...new Set(mine.map((e) => e.state))];
      return states
        .map((state) => {
          const label = name + (state ? ` — ${state}` : "");
          const cells = LOCALES.map((loc) =>
            SHOT_WIDTHS.map((w) => {
              const shots = mine.filter(
                (e) => e.state === state && e.locale === loc.id && e.width === w,
              );
              if (!shots.length)
                return `<div class="cell empty"><span>${loc.id} ${w}</span></div>`;
              return shots
                .map(
                  (s) => `<div class="cell">
      <span>${loc.id} · ${w} · ${s.part}</span>
      <a href="${s.file}"><img loading="lazy" src="${s.file}" alt="${s.route} ${loc.id} ${w} ${s.part}"></a>
      <img class="before" loading="lazy" data-file="${s.file}" alt="">
    </div>`,
                )
                .join("\n");
            }).join("\n"),
          ).join("\n");
          return `<section id="${name}${state ? "-" + state : ""}">
  <h2>${label}</h2>
  <div class="row">
${cells}
  </div>
</section>`;
        })
        .join("\n");
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>QA gallery — ${meta.taken}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 16px; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; background: #111; color: #eee; }
  header { position: sticky; top: 0; background: #111; padding: 8px 0 12px; z-index: 2; border-bottom: 1px solid #333; }
  h1 { font-size: 15px; margin: 0 0 4px; }
  p { margin: 0; color: #999; }
  nav a { color: #9cf; margin-right: 10px; }
  section { margin: 24px 0; }
  h2 { font-size: 14px; margin: 0 0 8px; color: #ffd08a; }
  .row { display: flex; gap: 12px; align-items: flex-start; overflow-x: auto; }
  .cell { flex: 0 0 auto; max-width: 480px; }
  .cell span { display: block; color: #888; margin-bottom: 4px; }
  .cell.empty { color: #555; }
  img { max-width: 100%; border: 1px solid #333; background: #fff; display: block; }
  img.before { display: none; outline: 2px solid #c66; }
  body.compare img.before { display: block; margin-top: 6px; }
</style>
<header>
  <h1>QA gallery</h1>
  <p>${meta.taken} · ${meta.base} · ${entries.length} shots · ${routes.length} routes</p>
  <p id="cmp"></p>
  <nav>${routes.map((r) => `<a href="#${r}">${r}</a>`).join("")}</nav>
</header>
${rows}
<script>
  // ?before=../some-dir turns every cell into this build over that one. Paths
  // are relative, so the page works from file:// with no server.
  const before = new URLSearchParams(location.search).get("before");
  if (before) {
    document.body.classList.add("compare");
    for (const img of document.querySelectorAll("img.before"))
      img.src = before.replace(/\\/$/, "") + "/" + img.dataset.file;
    document.getElementById("cmp").textContent = "comparing against " + before + " (outlined below each shot)";
  } else {
    document.getElementById("cmp").textContent = "open with ?before=<dir> to lay another run underneath";
  }
</script>
</html>
`;
}

async function shoot(browser, route, locale, width, ids, out) {
  const ctx = await browser.newContext({
    viewport: { width, height: width <= 430 ? 844 : 900 },
    deviceScaleFactor: SCALE(width),
    locale: locale.locale,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
  const path = pathFor(route, locale, ids);
  await page.goto(BASE + path, { waitUntil: "load" }).catch((e) => errs.push(e.message.slice(0, 120)));
  let how = `${route.settle ?? 2500}ms`;
  if (route.map) how = await settleMap(page);
  else await page.waitForTimeout(route.settle ?? 2500);

  const taken = [];
  await page.screenshot({ path: join(out, shotName(route, locale, width, "fold") + ".png") });
  taken.push(entry(route, locale, width, "fold"));
  if (route.full !== false) {
    await page.screenshot({
      path: join(out, shotName(route, locale, width, "full") + ".png"),
      fullPage: true,
    });
    taken.push(entry(route, locale, width, "full"));
  }

  // States: a screen that exists but has no URL. Each driver is contributed by
  // the workstream that owns the page; a driver that cannot reach its state
  // says so and takes no picture, rather than photographing the page it failed
  // to leave.
  for (const state of STATES[route.name] ?? []) {
    if (state.from) {
      await page.goto(BASE + pathFor({ path: state.from }, locale, {}), { waitUntil: "load" }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    const reached = await state.drive(page, { prefix: locale.prefix, base: BASE }).catch((e) => {
      errs.push(`state ${state.id}: ${e.message.slice(0, 90)}`);
      return false;
    });
    if (reached === false) {
      errs.push(`state ${state.id} was not reached; no shot taken`);
      continue;
    }
    await page.screenshot({ path: join(out, shotName(route, locale, width, "fold", state.id) + ".png") });
    taken.push(entry(route, locale, width, "fold", state.id));
  }

  await ctx.close();
  return { taken, errs, how, path };
}

async function main() {
  const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  mkdirSync(OUT, { recursive: true });
  const { ids, notes } = await resolveIds();
  for (const n of notes) console.log(`  id   ${n}`);
  const { run, skipped } = routesFor("shots", ids);
  const routes = only.length ? run.filter((r) => only.includes(r.name)) : run;
  for (const s of skipped) console.log(`  skip ${s.name}: ${s.why}`);

  const browser = await chromium.launch();
  const entries = [];
  const problems = [];
  for (const route of routes) {
    for (const locale of LOCALES) {
      for (const width of SHOT_WIDTHS) {
        const r = await shoot(browser, route, locale, width, ids, OUT);
        entries.push(...r.taken);
        for (const e of r.errs) problems.push(`${r.path} @${width}: ${e}`);
        console.log(
          `  ${String(r.taken.length)} shot(s)  ${r.path.padEnd(42)} ${String(width).padStart(4)}  ${r.how}`,
        );
      }
    }
  }
  await browser.close();

  writeFileSync(
    join(OUT, "index.html"),
    galleryHtml(entries, { taken: new Date().toISOString(), base: BASE }),
  );
  writeFileSync(join(OUT, "shots.json"), JSON.stringify({ base: BASE, entries }, null, 2) + "\n");
  const png = readdirSync(OUT).filter((f) => f.endsWith(".png")).length;
  console.log(`\n  ${png} PNG(s) and index.html in ${OUT}`);
  if (problems.length) {
    console.log("\n  problems while shooting (the gallery was still written):");
    for (const p of problems) console.log(`    ${p}`);
  }
  // Deliberately exits 0 on a page error: this is a review aid, not a gate.
  // The gates are a11y, contrast, reflow, perf and pages.spec.mjs.
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
