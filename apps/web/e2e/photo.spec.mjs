/**
 * A phone's photograph through the report form, in a real browser, to the
 * bucket and into the database.
 *
 *   node e2e/photo.spec.mjs
 *
 * Nothing ran this before. The canvas re-encode in lib/image.ts is what keeps
 * a photo's GPS out of the bucket, and the only checks of it, of the location
 * and time read from the photo, and of the suggestions offered for it were
 * regular expressions over the form's source. So the spec adds
 * e2e/fixtures/photo-with-gps.jpg, made by scripts/photo-fixture.mjs with a
 * phone's GPS position, capture time and XMP, to the wildlife page, catches
 * the upload on its way to Storage and reads it with exifr, and files the
 * report for real:
 *
 *   - what is uploaded carries no GPS, no Exif and no XMP, and the report
 *     route agrees (lib/report/photoMetadata.ts);
 *   - the place and the time were taken from the photo, and say so;
 *   - the model was asked once for the report, not once per photo, and its
 *     suggestions appeared, without the tree or the species under 1%;
 *   - picking one sends taxonFromPhoto, and the record is filed under it;
 *   - an identification refused (403: no challenge token) leaves the form
 *     saying the model is unavailable, and the report is filed all the same;
 *   - a browser whose canvas cannot write WebP, as on every iPhone, uploads
 *     a JPEG named as one, with nothing but pixels in it;
 *   - with no signal the model is not asked at all.
 *
 * The model is test/stub-ml.mjs, which CI starts and points the server at. A
 * server pointed anywhere else would send this photo to the real GPU, so the
 * spec refuses to run against one, and fails rather than skips under CI.
 * Storage is the local stack's on a laptop and test/stub-storage.mjs in CI.
 */
import { chromium } from "playwright";
import postgres from "postgres";
import exifr from "exifr";
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { containerOf, photoMetadata } from "../lib/report/photoMetadata.ts";
import { FIXTURE_GPS } from "../scripts/photo-fixture.mjs";
import { CANDIDATES, isStubMl } from "../test/stub-ml.mjs";
import { uploadedFile } from "../test/stub-storage.mjs";

const ROOT = join(import.meta.dirname, "..", "..", "..");
if (existsSync(join(ROOT, ".env")) && !process.env.DATABASE_URL) process.loadEnvFile(join(ROOT, ".env"));
const IN_CI = /^(1|true)$/i.test(process.env.CI ?? "");
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const PHOTO = join(import.meta.dirname, "fixtures", "photo-with-gps.jpg");
const ZH = JSON.parse(readFileSync(join(import.meta.dirname, "..", "messages", "zh-TW.json"), "utf8")).report;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

if (!(await isStubMl())) {
  const why = "ML_ENDPOINT_URL is not test/stub-ml.mjs; start it and the server with it (see the header)";
  if (IN_CI) {
    console.error(`  FAIL ${why}`);
    process.exit(1);
  }
  console.log(`  skip every check — ${why}`);
  process.exit(0);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, onnotice: () => {} });
const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
}).storage.from("report-photos");
const browser = await chromium.launch();
const nonces = [];
const paths = [];

/**
 * A report page with the traffic this spec reads: every signed upload as it
 * leaves for Storage (passed on unchanged), every identification asked for,
 * and every report posted.
 */
async function openForm(context) {
  const page = await context.newPage();
  const seen = { uploads: [], identify: 0, reports: [] };
  await page.route("**/storage/v1/object/upload/sign/**", async (route) => {
    const req = route.request();
    if (req.method() === "PUT")
      seen.uploads.push({ url: req.url(), type: req.headers()["content-type"] ?? "", body: req.postDataBuffer() });
    await route.continue();
  });
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (req.url().endsWith("/api/identify")) seen.identify++;
    if (req.url().endsWith("/api/reports")) {
      const body = JSON.parse(req.postData() ?? "{}");
      seen.reports.push(body);
      if (body.clientNonce) nonces.push(body.clientNonce);
    }
  });
  await page.goto(`${BASE}/report/wildlife`, { waitUntil: "load" });
  return { page, seen };
}

const addPhoto = (page) => page.locator('input[type="file"]').first().setInputFiles(PHOTO);
const previews = (page) => page.locator("img[src^='blob:']");

/** Press send and wait for the report's answer; a report that never posts answers status 0. */
async function send(page) {
  const answer = page
    .waitForResponse((r) => r.url().endsWith("/api/reports") && r.request().method() === "POST", { timeout: 30_000 })
    .catch(() => null);
  await page.getByRole("button", { name: ZH.submit }).click();
  const res = await answer;
  if (!res) return { status: 0, body: { error: "the report was never posted: did the upload fail, and the form save it on the phone?" } };
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

try {
  // The browser's address is everyone's here: the suite's other specs, and
  // on a laptop other checkouts, send from it too.
  await sql`delete from rate_limits where key like any(array['submit-%', 'sign-%', 'identify-%'])`;

  // --- the photo, its place, its time and the model's suggestions ----------
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-TW",
      timezoneId: "Asia/Taipei",
    });
    const { page, seen } = await openForm(context);
    await addPhoto(page);
    await previews(page).first().waitFor({ timeout: 15_000 });

    const placed = await page.getByText(ZH.locationFromPhoto).waitFor({ timeout: 5_000 }).then(() => true, () => false);
    check("the place is taken from the photo, and the form says so", placed);
    const time = await page.locator("#observedAt").inputValue();
    check("the time is when the photo was taken", time === "2026-09-20T07:32", time);

    const suggested = await page.getByText(ZH.aiSuggests).waitFor({ timeout: 20_000 }).then(() => true, () => false);
    const suggestions = page.locator('[role="status"]', { hasText: ZH.aiSuggests }).getByRole("button");
    const offered = await suggestions.allInnerTexts();
    check(
      "the model's suggestions appear: the two animals, best first, with their scores",
      suggested && offered.length === 2 && offered[0].includes("布氏樹蛙") && offered[0].includes("62%") && offered[1].includes("21%"),
      JSON.stringify(offered),
    );
    check(
      "neither the tree nor the species under 1% is offered",
      !offered.some((o) => o.includes("臺灣穗花杉") || o.includes("澤蛙")),
    );

    await suggestions.filter({ hasText: "布氏樹蛙" }).click();
    // A second photo of the same animal: the model is asked about the report,
    // not about each photo.
    await addPhoto(page);
    await page.waitForFunction(() => document.querySelectorAll("img[src^='blob:']").length === 2, null, { timeout: 15_000 });
    check("the model was asked once for the report", seen.identify === 1, `${seen.identify} times`);

    const { status, body } = await send(page);
    check("the report is filed", status === 201, `${status} ${JSON.stringify(body)}`);
    const card = await page.locator('[role="status"] h2').first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
    check("and the receipt is shown", card);

    // What went to Storage.
    check("both photos were uploaded", seen.uploads.length === 2, `${seen.uploads.length}`);
    for (const [i, u] of seen.uploads.entries()) {
      const file = uploadedFile(u.type, u.body);
      const bytes = new Uint8Array(file.bytes);
      paths.push(decodeURIComponent(new URL(u.url).pathname.split("/report-photos/")[1]));
      const parsed = await exifr.parse(file.bytes, { tiff: true, exif: true, gps: true, xmp: true, iptc: true }).catch(() => undefined);
      const gps = await exifr.gps(file.bytes).catch(() => undefined);
      check(
        `photo ${i + 1} reached the bucket with no GPS, no Exif and no XMP`,
        bytes.length > 0 && !gps && (parsed === undefined || Object.keys(parsed).length === 0),
        JSON.stringify({ type: file.mimetype, bytes: bytes.length, gps, parsed }),
      );
      check(
        `photo ${i + 1} is a ${containerOf(bytes)} the report route reads as pixels only`,
        file.mimetype === `image/${containerOf(bytes)}` && photoMetadata(bytes) === null,
        `${file.mimetype}: ${photoMetadata(bytes)}`,
      );
    }
    check(
      "the original's bytes never left the page",
      seen.uploads.every((u) => !u.body.includes(Buffer.from("FormosaWatch fixture"))),
    );

    // What was posted, and what was stored.
    const posted = seen.reports.at(-1) ?? {};
    check(
      "the report carries the photo's place, and no accuracy it never had",
      Math.abs(posted.lat - FIXTURE_GPS.lat) < 1e-6 && Math.abs(posted.lng - FIXTURE_GPS.lng) < 1e-6 && posted.accuracyM === undefined,
      JSON.stringify({ lat: posted.lat, lng: posted.lng, accuracyM: posted.accuracyM }),
    );
    check("and the photo's time", String(posted.observedAt).startsWith("2026-09-19T23:32"), posted.observedAt);
    check(
      "picking a suggestion names the species, from the photo",
      posted.taxonId === CANDIDATES.native.id && posted.taxonFromPhoto === true && posted.photoPaths?.length === 2,
      JSON.stringify({ taxonId: posted.taxonId, taxonFromPhoto: posted.taxonFromPhoto, photos: posted.photoPaths?.length }),
    );
    const [row] = await sql`
      select r.taxon_id, r.taxon_source,
             r.precision_override is not distinct from binomial_precision_floor(r.taxon_id) as floored,
             (select count(*)::int from report_photos p where p.report_id = r.id) as photos
        from reports r where r.client_nonce = ${posted.clientNonce ?? null}`;
    check(
      "the record is the reporter's identification, blurred as a photo identification, with both photos",
      Number(row?.taxon_id) === CANDIDATES.native.id && row.taxon_source === "user" && row.floored && row.photos === 2,
      JSON.stringify(row),
    );
    await context.close();
  }

  // --- a refused identification is only a missing suggestion --------------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-TW" });
    const { page, seen } = await openForm(context);
    // What the route answers a request with no challenge token when Turnstile
    // is on (test/identify.test.mjs runs the route itself).
    await page.route("**/api/identify", (route) =>
      route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "challenge_failed" }) }),
    );
    await addPhoto(page);
    await previews(page).first().waitFor({ timeout: 15_000 });
    const unavailable = await page.getByText(ZH.aiUnavailable).waitFor({ timeout: 10_000 }).then(() => true, () => false);
    check("a refused identification says the model is unavailable, and nothing more", unavailable);
    const { status, body } = await send(page);
    check("and the report is filed all the same", status === 201, `${status} ${JSON.stringify(body)}`);
    const posted = seen.reports.at(-1) ?? {};
    check("unnamed, with its photo", posted.taxonId === undefined && posted.taxonFromPhoto === undefined && posted.photoPaths?.length === 1);
    for (const u of seen.uploads) paths.push(decodeURIComponent(new URL(u.url).pathname.split("/report-photos/")[1]));
    await context.close();
  }

  // --- a browser that cannot write WebP sends JPEG -------------------------
  {
    // As WebKit does, and so every browser on an iPhone: a canvas asked for
    // WebP hands back a PNG (lib/report/photoEncoding.ts).
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-TW" });
    await context.addInitScript(() => {
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        return toBlob.call(this, callback, type === "image/webp" ? "image/png" : type, quality);
      };
    });
    const { page, seen } = await openForm(context);
    await addPhoto(page);
    await previews(page).first().waitFor({ timeout: 15_000 });
    const { status, body } = await send(page);
    check("without WebP the report is filed", status === 201, `${status} ${JSON.stringify(body)}`);
    const [u] = seen.uploads;
    const file = u ? uploadedFile(u.type, u.body) : { bytes: Buffer.alloc(0), mimetype: "" };
    const bytes = new Uint8Array(file.bytes);
    const path = u ? decodeURIComponent(new URL(u.url).pathname.split("/report-photos/")[1]) : "";
    if (path) paths.push(path);
    check(
      "and its photo went as a JPEG, named as one, with nothing but pixels",
      file.mimetype === "image/jpeg" && containerOf(bytes) === "jpeg" && path.endsWith(".jpg") && photoMetadata(bytes) === null,
      JSON.stringify({ type: file.mimetype, container: containerOf(bytes), path, metadata: photoMetadata(bytes) }),
    );
    await context.close();
  }

  // --- with no signal, the model is not asked ------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-TW" });
    const { page, seen } = await openForm(context);
    await context.setOffline(true);
    await addPhoto(page);
    await previews(page).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1_500);
    const looking = await page.getByText(ZH.aiLooking).isVisible();
    check("offline, the photo is added and the model is not asked", seen.identify === 0 && !looking, `${seen.identify} asks`);
    await context.setOffline(false);
    await context.close();
  }
} finally {
  if (nonces.length) await sql`delete from reports where client_nonce = any(${nonces})`;
  if (paths.length) await storage.remove(paths).catch(() => {});
  await sql.end();
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
