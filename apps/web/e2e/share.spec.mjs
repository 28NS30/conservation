/**
 * The share button, in a real browser, on the pages that carry it.
 *
 *   node e2e/share.spec.mjs
 *
 * Students share by LINE, and often read the site inside LINE's own browser,
 * which has no navigator.share. So every check here runs twice: once with the
 * share sheet deleted, as LINE's browser has it, where the button must open
 * the LINE link and the copy button and copying must say it worked; and once
 * with a share sheet, which must be handed this page's address and nothing
 * else. Both languages, at a phone's width, with each control at least 44px
 * tall and axe run over the page with the choices open.
 *
 * The report receipt's button is checked in receipt.spec.mjs, after a real
 * submit, which is the only way to reach that card.
 */
import { chromium } from "playwright";
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runAxe } from "./a11y.spec.mjs";

const ROOT = join(import.meta.dirname, "..", "..", "..");
if (existsSync(join(ROOT, ".env")) && !process.env.DATABASE_URL) process.loadEnvFile(join(ROOT, ".env"));
const sql = postgres(process.env.DATABASE_URL, { prepare: false, onnotice: () => {} });

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const catalogue = (l) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "messages", `${l}.json`), "utf8")).share;
const SHARE = { "zh-TW": catalogue("zh-TW"), en: catalogue("en") };

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** As LINE's in-app browser has it: no share sheet at all. */
const NO_SHARE_SHEET = () => {
  delete Navigator.prototype.share;
  delete Navigator.prototype.canShare;
};
/** A share sheet that records what it was handed. */
const SHARE_SHEET = () => {
  Navigator.prototype.share = function (data) {
    window.__shared = data;
    return Promise.resolve();
  };
};

const browser = await chromium.launch();
try {
  const [record] = await sql`select id from reports_public order by id limit 1`;
  const [species] = await sql`
    select t.id from taxa t join species_report_stats s on s.taxon_id = t.id
     order by s.report_count desc, t.id limit 1`;

  const PAGES = [
    { name: "record", path: `/reports/${record.id}`, what: "record" },
    // The species page redirects to its slug, and shares the slug.
    { name: "species", path: `/species/${species.id}`, what: "species" },
    { name: "season", path: "/season", what: "page" },
  ];

  for (const [locale, prefix] of [["zh-TW", ""], ["en", "/en"]]) {
    const words = SHARE[locale];
    for (const p of PAGES) {
      const label = `${locale} · ${p.name}`;

      // Without a share sheet.
      {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.addInitScript(NO_SHARE_SHEET);
        const res = await page.goto(`${BASE}${prefix}${p.path}`, { waitUntil: "load" });
        check(`${label}: the page answers`, res?.status() === 200, `HTTP ${res?.status()}`);
        const here = new URL(page.url());
        const want = `${here.origin}${here.pathname}`;

        const button = page.getByRole("button", { name: words[p.what], exact: true });
        check(`${label}: one share button, named ${JSON.stringify(words[p.what])}`, (await button.count()) === 1);
        const box = await button.boundingBox();
        check(`${label}: the button is at least 44px tall`, (box?.height ?? 0) >= 44, `${box?.height}px`);
        check(`${label}: it says it is collapsed`, (await button.getAttribute("aria-expanded")) === "false");

        await button.click();
        const line = page.getByRole("link", { name: new RegExp(words.line) });
        await line.waitFor({ timeout: 5000 }).catch(() => {});
        check(`${label}: with no share sheet, it offers LINE`, (await line.count()) === 1);
        const href = await line.getAttribute("href").catch(() => null);
        check(
          `${label}: the LINE link carries this page's address`,
          href === `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(want)}`,
          href ?? "none",
        );
        check(`${label}: and opens it in a new tab`, (await line.getAttribute("target").catch(() => null)) === "_blank");
        check(`${label}: it says it is expanded`, (await button.getAttribute("aria-expanded")) === "true");
        const lineBox = await line.boundingBox().catch(() => null);
        check(`${label}: the LINE link is at least 44px tall`, (lineBox?.height ?? 0) >= 44, `${lineBox?.height}px`);

        const copy = page.getByRole("button", { name: words.copy, exact: true });
        await copy.click();
        const status = page.getByRole("status").filter({ hasText: words.copied });
        await status.waitFor({ timeout: 3000 }).catch(() => {});
        check(`${label}: copying says that it worked`, (await status.count()) === 1);
        const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
        check(`${label}: and the clipboard holds this page's address`, copied === want, copied ?? "unreadable");

        const violations = await runAxe(page);
        check(
          `${label}: axe finds nothing with the choices open`,
          violations.length === 0,
          violations.map((v) => `${v.id}: ${v.example}`).join("; "),
        );
        check(`${label}: no client error`, errors.length === 0, errors[0] ?? "");
        await context.close();
      }

      // With a share sheet.
      {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.addInitScript(SHARE_SHEET);
        await page.goto(`${BASE}${prefix}${p.path}`, { waitUntil: "load" });
        const here = new URL(page.url());
        const button = page.getByRole("button", { name: words[p.what], exact: true });
        await button.click();
        await page.waitForTimeout(300);
        const shared = await page.evaluate(() => window.__shared ?? null);
        check(
          `${label}: with a share sheet, it is handed this page's address`,
          shared?.url === `${here.origin}${here.pathname}`,
          JSON.stringify(shared),
        );
        check(
          `${label}: and the page opens no choices of its own`,
          (await page.getByRole("link", { name: new RegExp(words.line) }).count()) === 0,
        );
        check(`${label}: nor calls itself a disclosure`, (await button.getAttribute("aria-expanded")) === null);
        await page.close();
      }
    }
  }
} finally {
  await sql.end();
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
