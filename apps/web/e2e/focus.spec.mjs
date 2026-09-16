import { chromium } from "playwright";

/**
 * Every control reachable by Tab must show where focus is.
 *
 * Most of the site relies on the browser's default outline, so this found very
 * little — which is the point of running it: the usual cause of an invisible
 * focus ring is someone writing `outline: none` for looks, and this fails the
 * moment that happens.
 *
 * Identity and styles are read in separate steps. Reading both at once measures
 * the instant focus arrives, and a composite control like datetime-local moves
 * focus through internal parts — it reported the report form's date field as
 * unringed while a screenshot showed a plain orange ring around it.
 */
const PAGES = [
  "/",
  "/map",
  "/species",
  "/stats",
  "/reports",
  "/report",
  "/about",
];
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

const measure = () => {
  const el = document.activeElement;
  // Next's dev-mode error overlay is a portal outside the app.
  if (!el || el === document.body || el.tagName === "NEXTJS-PORTAL")
    return null;
  /*
   * Date and time inputs are excluded, and this is a limitation of the harness
   * rather than a pass being handed out.
   *
   * They are composite controls: focus moves through internal shadow-DOM
   * segments, and reading computed styles on the host while that happens
   * returns the unfocused values no matter how long you wait for it to settle.
   * The report form's date field was reported as unringed at every delay from
   * 25ms to 180ms, under both :focus and :focus-visible rules — while a
   * screenshot taken with it focused shows a plain orange ring around it.
   *
   * Re-check these by eye if their styling changes; there is nothing here that
   * can do it for you.
   */
  if (
    el.tagName === "INPUT" &&
    /^(date|time|datetime-local|month|week)$/.test(el.type)
  )
    return null;
  const cs = getComputedStyle(el);
  return {
    ok:
      (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
      (!!cs.boxShadow && cs.boxShadow !== "none"),
    name: (
      el.getAttribute("aria-label") ||
      el.getAttribute("id") ||
      el.textContent ||
      el.tagName
    )
      .trim()
      .slice(0, 28),
  };
};

const browser = await chromium.launch();
let failures = 0;

for (const path of PAGES) {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 850 },
  });
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForTimeout(path === "/map" ? 12000 : 3500);

  // One pass. Tabbing past the last control wraps into browser chrome and
  // back, and the second lap measures states no person would see.
  const stops = await page.evaluate(
    () =>
      [
        ...document.querySelectorAll(
          'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null).length,
  );

  const bad = [];
  let seen = 0;
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
    // Second evaluate: by now focus has settled on the element itself.
    const r = await page.evaluate(measure);
    if (!r) continue;
    seen++;
    if (!r.ok && !bad.includes(r.name)) bad.push(r.name);
  }

  failures += bad.length;
  console.log(
    `  ${path.padEnd(10)} tabbed=${String(seen).padStart(3)}  no ring=${bad.length}` +
      (bad.length ? `  ${bad.slice(0, 4).join(", ")}` : ""),
  );
  await page.close();
}

await browser.close();
console.log(
  failures === 0
    ? "\n  every keyboard-focused control shows a ring"
    : `\n  ${failures} control(s) with no visible focus ring`,
);
process.exit(failures === 0 ? 0 : 1);
