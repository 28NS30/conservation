/**
 * Design review helper: full-page screenshots at desktop and phone width.
 *
 * Not a test — nothing asserts, and CI does not run it. It exists because
 * reviewing layout from source is guesswork; several real bugs (a map canvas
 * escaping its container, a unit character orphaned onto a line of its own,
 * half of Taiwan off the right edge of a phone) were only ever visible in a
 * screenshot.
 *
 *   node apps/web/e2e/_shots.mjs                 # every page, desktop
 *   node apps/web/e2e/_shots.mjs home map        # named pages only
 *   node apps/web/e2e/_shots.mjs home --mobile   # 390px at 2x
 *
 * Writes to $SHOTS_DIR, or apps/web/e2e/shots (gitignored).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SP = process.env.SHOTS_DIR ?? join(import.meta.dirname, "shots");
mkdirSync(SP, { recursive: true });
// Waits are generous on every page carrying a map. MapLibre has to fetch its
// worker, build a style and pull vector tiles before anything paints, and after
// a dev-server restart the route compiles first — a 7s wait photographed a blank
// canvas and looked exactly like a layout regression. Better slow than lying.
const MAP_WAIT = 15000;
const PAGES = [
  ["/", "home", 2500],
  ["/map", "map", MAP_WAIT],
  ["/report", "report", MAP_WAIT],
  ["/species/28758-duttaphrynus-melanostictus", "detail", MAP_WAIT],
  ["/stats", "stats", 3500],
  ["/species", "species", 3000],
  ["/about", "about", 2500],
  ["/reports", "reports", 3000],
  ["/attribution", "attribution", 2000],
];

const want = process.argv.slice(2);
const mobile = want.includes("--mobile");
const names = want.filter((a) => !a.startsWith("--"));
const list = names.length ? PAGES.filter((p) => names.includes(p[1])) : PAGES;
const width = mobile ? 390 : 1180;

const browser = await chromium.launch();
const errs = [];
for (const [path, name, wait] of list) {
  const p = await browser.newPage({
    viewport: { width, height: mobile ? 844 : 900 },
    deviceScaleFactor: mobile ? 2 : 1,
  });
  p.on("pageerror", (e) => errs.push(`${name}: ${e.message.slice(0, 120)}`));
  await p.goto("http://localhost:3000" + path, { waitUntil: "load" });
  await p.waitForTimeout(wait);
  // The map page is a fixed-height app shell; a full-page shot of it is a lie.
  await p.screenshot({
    path: `${SP}/${name}${mobile ? "-m" : ""}.png`,
    fullPage: name !== "map",
  });
  await p.close();
}
await browser.close();
console.log(errs.length ? errs.join(" | ") : "no page errors");
