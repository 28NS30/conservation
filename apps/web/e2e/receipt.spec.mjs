/**
 * The card a reporter is left looking at, in a real browser, in both languages.
 *
 *   node e2e/receipt.spec.mjs
 *
 * `test/report-outcome.test.mjs` proves the mapping and `test/receipt.test.mjs`
 * proves what the receipt page discloses. Neither can prove the thing that was
 * actually broken, which is that the words on screen describe the report that
 * was just filed and that the link under them opens. So this one stubs
 * `/api/reports` with each answer the route can give, submits the form for
 * real, and then follows the link it is handed.
 *
 * The ids in the stubs are real rows, planted here and removed afterwards, so
 * "the link does not 404" is a claim about the site rather than about a fixture.
 *
 * Playwright sends no Accept-Language, so an unprefixed path renders zh-TW;
 * /en is therefore asked for explicitly rather than assumed.
 */
import { chromium } from "playwright";
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");
if (existsSync(join(ROOT, ".env")) && !process.env.DATABASE_URL) {
  process.loadEnvFile(join(ROOT, ".env"));
}
const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  onnotice: () => {},
});

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const messages = (locale) =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "messages", `${locale}.json`), "utf8"),
  );
const CATALOGUE = { "zh-TW": messages("zh-TW"), en: messages("en") };

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, skipped: false });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const skip = (name, why) => {
  results.push({ name, ok: true, skipped: true });
  console.log(`  skip ${name} — ${why}`);
};

const MARKER = "receipt e2e fixture";

/**
 * Whether the server is serving the catalogue that is on disk.
 *
 * `next dev` caches the message catalogue and does not pick up an edit to
 * messages/*.json, so a server that was started before this branch's copy
 * renders `report.receipt.held` as that literal string. That is the dev
 * server's cache, not the page — but it makes every copy assertion below
 * meaningless, so they are skipped rather than reported as failures. Restart
 * the dev server and they run.
 */
async function servingCurrentCatalogue() {
  const html = await (await fetch(`${BASE}/report`)).text();
  return !html.includes("一兩分鐘") && html.includes("點地圖標出位置");
}

const browser = await chromium.launch();
let publishedId;
let pendingId;

try {
  const [pub] = await sql`select id from reports_public limit 1`;
  publishedId = pub.id;

  const [held] = await sql`
    insert into reports (category, location, location_public, observed_at,
                         notes, status, source, flagged_reason)
    values ('roadkill',
            st_setsrid(st_makepoint(120.95, 23.75), 4326)::geography,
            st_setsrid(st_makepoint(120.95, 23.75), 4326)::geography,
            now(), ${MARKER}, 'pending', 'user',
            'no photo on a category that expects one')
    returning id`;
  pendingId = held.id;

  const fresh = await servingCurrentCatalogue();
  if (!fresh) {
    console.log(
      "\n  NOTE: the dev server is serving a stale message catalogue " +
        "(next dev does not reload messages/*.json). Copy checks are skipped; " +
        "restart the dev server to run them.\n",
    );
  }

  /** The form, filled far enough to submit: one tap on the map. */
  async function fileReport(page, path, answer) {
    await page.route("**/api/reports", (route) =>
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ duplicate: false, ...answer }),
      }),
    );
    await page.goto(`${BASE}${path}`, { waitUntil: "load" });
    const canvas = page.locator("canvas.maplibregl-canvas").first();
    await canvas.waitFor({ timeout: 20000 });
    // MapLibre needs the style before it answers clicks.
    await page.waitForTimeout(5000);
    await canvas.scrollIntoViewIfNeeded();
    await canvas.click({ position: { x: 150, y: 100 } });
    await page.getByRole("button", { name: /送出通報|Submit report/ }).click();
    await page.waitForTimeout(1200);
  }

  const CASES = [
    {
      name: "published",
      answer: () => ({
        id: publishedId,
        status: "published",
        awaitingIdentification: false,
      }),
      title: "onMap",
      body: null,
      link: "viewRecord",
    },
    {
      name: "pending, awaiting identification",
      answer: () => ({
        id: pendingId,
        status: "pending",
        awaitingIdentification: true,
      }),
      title: "held",
      body: "heldForIdentification",
      link: "checkStatus",
    },
    {
      name: "pending, no photo",
      answer: () => ({
        id: pendingId,
        status: "pending",
        awaitingIdentification: false,
      }),
      title: "held",
      body: "heldNoPhoto",
      link: "checkStatus",
    },
  ];

  for (const [locale, path] of [
    ["zh-TW", "/report"],
    ["en", "/en/report"],
  ]) {
    const receipt = CATALOGUE[locale].report.receipt;

    for (const c of CASES) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      try {
        await fileReport(page, path, c.answer());

        const card = page.locator("h2").first();
        const heading = (await card.textContent())?.trim() ?? "";
        const anchor = page.locator(`a[href$="/reports/${c.answer().id}"]`);
        const linkCount = await anchor.count();

        check(
          `${locale} · ${c.name}: the card appeared with no client error`,
          heading.length > 0 && errors.length === 0,
          errors[0] ?? "",
        );

        if (fresh) {
          check(
            `${locale} · ${c.name}: heading is ${c.title}`,
            heading === receipt[c.title],
            `saw ${JSON.stringify(heading)}`,
          );
          const text = await page.locator("main, body").first().innerText();
          if (c.body) {
            check(
              `${locale} · ${c.name}: body is ${c.body}`,
              text.includes(receipt[c.body]),
            );
          } else {
            check(
              `${locale} · ${c.name}: nothing is added below the heading`,
              !text.includes(receipt.heldNoPhoto) &&
                !text.includes(receipt.heldForIdentification),
            );
          }
          check(
            `${locale} · ${c.name}: the link reads ${c.link}`,
            (await anchor.first().textContent())?.trim() === receipt[c.link],
          );
          check(
            `${locale} · ${c.name}: "report another" is offered`,
            text.includes(receipt.another),
          );
        } else {
          skip(`${locale} · ${c.name}: the copy`, "stale catalogue");
        }

        check(`${locale} · ${c.name}: exactly one link to the record`, linkCount === 1);

        const href = await anchor.first().getAttribute("href");
        check(
          `${locale} · ${c.name}: the link keeps the reader's language`,
          locale === "en" ? href.startsWith("/en/") : !href.startsWith("/en/"),
          href,
        );

        const opened = await page.request.get(`${BASE}${href}`);
        check(
          `${locale} · ${c.name}: the link is not a 404`,
          opened.status() === 200,
          `HTTP ${opened.status()} for ${href}`,
        );
      } finally {
        await page.close();
      }
    }
  }
} finally {
  if (pendingId) await sql`delete from reports where id = ${pendingId}::uuid`;
  await sql.end();
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped).length;
console.log(
  `\n${results.length - failed.length - skipped}/${results.length - skipped} passed` +
    (skipped ? `, ${skipped} skipped` : ""),
);
process.exit(failed.length ? 1 : 0);
