/**
 * The report form without a pointer, without a position, and by touch with
 * the crosshair over the map, in a real browser.
 *
 *   node e2e/report-keyboard.spec.mjs
 *
 * KEYBOARD. Tab and Enter only, with the browser refusing a position, which
 * is what a keyboard user on a desktop whose browser says no is left with.
 * The pin used to go down only by a click or a drag, so this person could not
 * file a report at all (WCAG 2.1.1). Here they are told the location was
 * refused and how to allow it, put the pin at the map's centre with the
 * button, aim it again by panning the focused map and pressing Enter, send,
 * and land on the receipt's heading. /api/reports is stubbed, as in
 * receipt.spec.mjs: what is under test is the form, not the route.
 *
 * TOUCH. The crosshair sits over the map a reporter taps, and must not change
 * what a tap does. A tap on the crosshair itself, and one beside it, put the
 * pin exactly where MapLibre says that pixel is; the crosshair is not what the
 * finger hits; and the pin under it can still be dragged by a finger.
 *
 * STATES. The refusal, a rough fix with its circle, the map's keyboard hint, a
 * failed send's echo in the send bar and the receipt are each run through axe
 * and the contrast audit, the same engines CI runs over these pages on load.
 * None of these states exists at load, so the route sweeps never see them.
 *
 * Playwright sends no Accept-Language, so an unprefixed path is zh-TW.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAxe } from "./a11y.spec.mjs";
import { auditContrast } from "./contrast.spec.mjs";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const messages = (locale) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "messages", `${locale}.json`), "utf8"));
const CATALOGUE = { "zh-TW": messages("zh-TW"), en: messages("en") };

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
};

/** A pending report's answer. The id is never opened, so it need not exist. */
const ANSWER = {
  duplicate: false,
  id: "00000000-0000-4000-8000-000000000000",
  status: "pending",
  awaitingIdentification: false,
};

async function stubReports(page, { status = 201, body = ANSWER } = {}) {
  await page.route("**/api/reports", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

async function open(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  await page.locator("canvas.maplibregl-canvas").first().waitFor({ timeout: 20000 });
  // MapLibre needs its style before it answers clicks or keys.
  await page.waitForFunction(() => !!window.__pickerMap, null, { timeout: 20000 });
  await page.waitForTimeout(3000);
}

/**
 * Press Tab (or Shift+Tab) until focus is on the control whose text is
 * `label`, or on what `is` picks, as a person would. Fails after `max`
 * presses rather than looping for ever.
 */
async function tabTo(page, { label, is, back = false, max = 120 }) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
    const there = await page.evaluate(
      ([label, is]) => {
        const el = document.activeElement;
        if (!el) return false;
        if (label != null) return el.textContent?.trim() === label;
        if (is === "skip") return el.getAttribute("href") === "#main-content";
        if (is === "canvas") return el.classList.contains("maplibregl-canvas");
        return false;
      },
      [label ?? null, is ?? null],
    );
    if (there) return true;
  }
  return false;
}

/** axe and the contrast audit, on the page as it is now. */
async function audit(page, label) {
  const violations = await runAxe(page).catch((e) => [{ id: "axe-failed-to-run", help: e.message, nodes: 1 }]);
  check(
    `${label}: axe finds nothing`,
    violations.length === 0,
    violations.map((v) => `${v.id}×${v.nodes} (${v.example ?? v.help})`).join("; "),
  );
  const low = await auditContrast(page);
  check(
    `${label}: every text passes AA contrast`,
    low.length === 0,
    low
      .slice(0, 3)
      .map((r) => `${r.ratio}:1 "${r.text ?? ""}" ${r.fg} on ${r.bg}`)
      .join("; "),
  );
}

/** The coordinates line under the picker, or "" before a pin. */
const coords = (page) =>
  page.evaluate(() => {
    const p = document.querySelector('[data-location-picker] + div [role="status"]');
    return (p?.textContent ?? "").trim();
  });

/** Where focus is, and whether it is on screen and clear of a pinned header. */
const focusIsVisible = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { ok: false, what: "nothing" };
    const r = el.getBoundingClientRect();
    const header = document.querySelector("[data-site-header]");
    const pinned =
      header && getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().bottom : 0;
    return {
      ok: r.top >= pinned - 1 && r.bottom <= innerHeight + 1,
      what: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} "${(el.textContent ?? "").trim().slice(0, 30)}"`,
      top: Math.round(r.top),
      pinned: Math.round(pinned),
    };
  });

const browser = await chromium.launch();
try {
  /* ---- keyboard only, location refused ---- */
  for (const [locale, path] of [
    ["zh-TW", "/report/wildlife"],
    ["en", "/en/report/wildlife"],
  ]) {
    const r = CATALOGUE[locale].report;
    // No geolocation permission: Chromium refuses at once, PERMISSION_DENIED.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await stubReports(page);
    await open(page, path);

    check(`${locale}: the skip link is the first stop`, await tabTo(page, { is: "skip", max: 1 }));
    check(
      `${locale}: Tab reaches ${JSON.stringify(r.useMyLocation)}`,
      await tabTo(page, { label: r.useMyLocation }),
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    const denied = await page.evaluate(
      (title) => [...document.querySelectorAll('[role="alert"]')].some((a) => a.textContent.includes(title)),
      r.locationDenied.title,
    );
    check(`${locale}: a refusal says it was refused, and how to allow it`, denied);
    const deniedText = await page.locator('[role="alert"]', { hasText: r.locationDenied.title }).innerText().catch(() => "");
    check(
      `${locale}: it names iPhone, Android and LINE`,
      ["iPhone", "Android", "LINE"].every((w) => deniedText.includes(w)),
      deniedText.slice(0, 120),
    );
    check(`${locale}: and not the "couldn't get it" line`, !(await page.locator(`text=${r.locationError}`).count()));
    await audit(page, `${locale} · location refused`);

    // The button, which is the whole of the fix for this reporter.
    check(
      `${locale}: Tab reaches ${JSON.stringify(r.pinAtCentre)}`,
      await tabTo(page, { label: r.pinAtCentre, max: 20 }),
    );
    check(`${locale}: no pin yet`, (await coords(page)) === "");
    // At the whole island's zoom the first press zooms in on the crosshair
    // and says so, rather than pinning a point in the Central Range.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    check(`${locale}: too far out, the button zooms in and says why`, (await coords(page)) === "" &&
      (await page.locator(`text=${r.pinZoomFirst}`).count()) === 1);
    check(`${locale}: to at least the zoom it aims at`, await page.evaluate(() => window.__pickerMap.getZoom() >= 12.9));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    const first = await coords(page);
    check(`${locale}: Enter on the button puts the pin down`, /^\d+\.\d{5}, \d+\.\d{5}/.test(first), first);
    check(
      `${locale}: the pin is at the map's centre`,
      await page.evaluate((text) => {
        const c = window.__pickerMap.getCenter();
        return text.startsWith(`${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`);
      }, first),
      first,
    );
    check(
      `${locale}: the send button is no longer blocked`,
      await page.evaluate(() => !document.querySelector("#submit-blocker")),
    );

    // Back to the map itself: pan it under the crosshair, and Enter there.
    check(`${locale}: Shift+Tab reaches the map`, await tabTo(page, { is: "canvas", back: true, max: 8 }));
    check(
      `${locale}: the map, focused, says which keys do what`,
      await page.evaluate(() => {
        const id = document.activeElement?.getAttribute("aria-describedby");
        const hint = id && document.getElementById(id);
        return !!hint && getComputedStyle(hint).display !== "none";
      }),
    );
    check(`${locale}: the focused map is named for what it is for`, await page.evaluate(
      (name) => document.activeElement?.getAttribute("aria-label") === name,
      r.pickerMap,
    ));
    await audit(page, `${locale} · map focused, keys shown`);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    const second = await coords(page);
    check(`${locale}: arrow keys move the map under the crosshair, and Enter pins it there`, second !== "" && second !== first, `${first} → ${second}`);

    // And send, by keyboard.
    check(`${locale}: Tab reaches ${JSON.stringify(r.submit)}`, await tabTo(page, { label: r.submit, max: 80 }));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    const heading = await page.evaluate(() => {
      const h = document.activeElement;
      return h?.tagName === "H2" ? h.textContent.trim() : null;
    });
    check(`${locale}: after sending, focus is on the receipt's heading`, heading === r.receipt.held, String(heading));
    const seen = await focusIsVisible(page);
    check(`${locale}: and the heading is on screen, below the header`, seen.ok, JSON.stringify(seen));
    await audit(page, `${locale} · receipt`);
    check(`${locale}: no client error`, errors.length === 0, errors[0] ?? "");
    await ctx.close();
  }

  /* ---- a failed send: to the problem, and said at the button ---- */
  {
    const r = CATALOGUE["zh-TW"].report;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-TW" });
    const page = await ctx.newPage();
    await stubReports(page, { status: 422, body: { error: "taxon_not_found" } });
    await open(page, "/report/wildlife");
    // Twice: the first press zooms in on the crosshair.
    await page.getByRole("button", { name: r.pinAtCentre }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: r.pinAtCentre }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: r.submit }).click();
    await page.waitForTimeout(1500);
    const where = await page.evaluate(() => document.activeElement?.id ?? "");
    check("a refused species: focus goes to the line beside the picker", where === "species-error", where);
    const seen = await focusIsVisible(page);
    check("a refused species: and that line is on screen", seen.ok, JSON.stringify(seen));
    const echo = await page.locator("#report-send-bar #submit-error").innerText().catch(() => "");
    check("a refused species: the send bar says it too, with a way back", echo.includes(r.errors.taxon_not_found) && echo.includes(r.errorShow), echo);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByRole("button", { name: r.errorShow }).click();
    await page.waitForTimeout(400);
    check("a refused species: the way back goes back", (await page.evaluate(() => document.activeElement?.id)) === "species-error");
    await audit(page, "zh-TW · a refused send");
    await ctx.close();
  }

  /* ---- a rough fix ---- */
  {
    const r = CATALOGUE["zh-TW"].report;
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-TW",
      permissions: ["geolocation"],
      geolocation: { latitude: 23.97, longitude: 120.97, accuracy: 800 },
    });
    const page = await ctx.newPage();
    await open(page, "/report/wildlife");
    await page.getByRole("button", { name: r.useMyLocation }).click();
    await page.waitForTimeout(1500);
    const prompt = r.roughFix.replace("{m}", "800");
    check("a rough fix: the form says so, with the radius", (await page.locator(`text=${prompt}`).count()) === 1);
    const circle = await page.evaluate(() => {
      const src = window.__pickerMap.getSource("accuracy");
      const data = src?.serialize?.().data;
      return data?.geometry?.type ?? data?.features?.length ?? null;
    });
    check("a rough fix: the circle is drawn on the map", circle === "Polygon", String(circle));
    await audit(page, "zh-TW · a rough fix");
    // Moving the pin answers the prompt: the reporter has said where it was.
    // Twice, as the circle may be framed wider than the button aims at.
    await page.getByRole("button", { name: r.pinAtCentre }).click();
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: r.pinAtCentre }).click();
    await page.waitForTimeout(600);
    check("a rough fix: placing the pin by hand clears the prompt", (await page.locator(`text=${prompt}`).count()) === 0);
    await ctx.close();
  }

  /* ---- touch, with the crosshair over the map ---- */
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-TW",
      hasTouch: true,
      isMobile: true,
    });
    const page = await ctx.newPage();
    await open(page, "/report/wildlife");
    await page.locator("[data-location-picker]").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);

    /**
     * A point on screen, what is under it, where MapLibre says it is, and how
     * far one pixel is there: a touch lands on a whole pixel, and at the
     * island's zoom one pixel is a kilometre.
     */
    const probe = (dx, dy) =>
      page.evaluate(([dx, dy]) => {
        const cross = document.querySelector("[data-crosshair]").getBoundingClientRect();
        const x = Math.round(cross.left + cross.width / 2 + dx);
        const y = Math.round(cross.top + cross.height / 2 + dy);
        const canvas = window.__pickerMap.getCanvas();
        const c = canvas.getBoundingClientRect();
        const at = (px, py) => window.__pickerMap.unproject([px - c.left, py - c.top]);
        const ll = at(x, y);
        const next = at(x + 1, y + 1);
        return {
          x,
          y,
          hit: document.elementFromPoint(x, y) === canvas,
          lat: ll.lat,
          lng: ll.lng,
          pixel: Math.max(Math.abs(next.lat - ll.lat), Math.abs(next.lng - ll.lng)),
        };
      }, [dx, dy]);
    /** Whether the coordinates line names the probed point, to within a pixel. */
    const landed = (text, p) => {
      const [lat, lng] = text.split(",").map(Number);
      return Math.abs(lat - p.lat) <= p.pixel && Math.abs(lng - p.lng) <= p.pixel;
    };

    const centre = await probe(0, 0);
    check("touch: a finger on the crosshair touches the map, not the crosshair", centre.hit);
    await page.touchscreen.tap(centre.x, centre.y);
    await page.waitForTimeout(900);
    const atCentre = await coords(page);
    check(
      "touch: a tap on the crosshair puts the pin on the pixel it was aimed at",
      landed(atCentre, centre),
      `${atCentre} vs ${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)} ± ${centre.pixel.toFixed(5)}`,
    );

    // The map has eased to the pin; a tap beside the crosshair.
    await page.waitForTimeout(800);
    const beside = await probe(70, -40);
    check("touch: so does a finger beside it", beside.hit);
    await page.touchscreen.tap(beside.x, beside.y);
    await page.waitForTimeout(900);
    const atBeside = await coords(page);
    check(
      "touch: a tap beside the crosshair lands on the pixel it was aimed at",
      landed(atBeside, beside),
      `${atBeside} vs ${beside.lat.toFixed(5)}, ${beside.lng.toFixed(5)} ± ${beside.pixel.toFixed(5)}`,
    );

    // The pin is now under the crosshair again. A finger on the pin's head is
    // on the pin, and dragging it moves it.
    await page.waitForTimeout(800);
    const pin = await page.evaluate(() => {
      const m = document.querySelector("[data-location-picker] .maplibregl-marker");
      const r = m.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height * 0.3;
      return { x, y, onPin: m.contains(document.elementFromPoint(x, y)) };
    });
    check("touch: a finger on the pin under the crosshair is on the pin", pin.onPin);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y) }],
      });
    await touch("touchStart", pin.x, pin.y);
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", pin.x + i * 8, pin.y);
      await page.waitForTimeout(16);
    }
    await touch("touchEnd", pin.x + 64, pin.y);
    await page.waitForTimeout(900);
    const dragged = await coords(page);
    const lng = (s) => Number(s.split(",")[1]);
    check("touch: the pin can still be dragged by a finger", lng(dragged) > lng(atBeside), `${atBeside} → ${dragged}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
