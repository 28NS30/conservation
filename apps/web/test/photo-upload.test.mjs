/**
 * What it costs to put a photo in the bucket, and what the bucket and the
 * report route will take (photo-pipeline review, 26 October 2026).
 *
 *   - Signing is charged per photo, sixty a day for an address with nobody
 *     signed in, so one address cannot fill the free plan's storage.
 *   - The bucket takes nothing over 3 MB (migration 0038), and the report
 *     route holds every photo to the same MAX_UPLOAD_BYTES.
 *   - POST /api/reports reads each photo before attaching it and refuses one
 *     carrying a GPS position, or bytes that are not the type they were
 *     stored as (lib/report/photoMetadata.ts).
 *
 * Against the server and its Storage: the local stack's on a laptop, the
 * stand-in (test/stub-storage.mjs) in CI. Each test sends from an address of
 * its own (x-forwarded-for, which clientIp reads), so its budgets are its own.
 *
 *   node --test test/photo-upload.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { MAX_UPLOAD_BYTES } from "@conservation/shared";
import { sql, inRollback, BASE_URL, requireServer } from "./helpers.mjs";
import { addressKey } from "../lib/request.ts";
import { flatBlockJpeg, meadow, phonePhoto } from "../scripts/photo-fixture.mjs";

const REPO = join(import.meta.dirname, "..", "..", "..");
const MIGRATION = readFileSync(join(REPO, "supabase", "migrations", "0038_photo_bucket_limit.sql"), "utf8");

/** Uploads go where the browser sends them, with the key the browser has. */
const storage = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  }).storage.from("report-photos");
/** And are cleared up with the service key, as the cleanup job does. */
const serviceStorage = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  }).storage.from("report-photos");

/** An address of this test's own, from the range set aside for testing networks. */
const anAddress = () => `198.18.${randomInt(256)}.${randomInt(1, 255)}`;

const signedKeys = [];
const storedPaths = [];
const nonces = [];
after(async () => {
  if (signedKeys.length) await sql`delete from rate_limits where key = any(${signedKeys})`;
  if (nonces.length) await sql`delete from reports where client_nonce = any(${nonces})`;
  if (storedPaths.length) await serviceStorage().remove(storedPaths).catch(() => {});
  await sql.end();
});

async function sign(ip, count, contentType = "image/webp") {
  for (const kind of ["burst", "daily"]) signedKeys.push(`sign-${kind}:${addressKey(ip)}`);
  return fetch(`${BASE_URL}/api/uploads/sign`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ count, contentType }),
  });
}

/** What rate_limits holds for an address now, by window. */
async function charged(ip) {
  const rows = await sql`
    select key, count from rate_limits where key = any(${[`sign-burst:${addressKey(ip)}`, `sign-daily:${addressKey(ip)}`]})`;
  return Object.fromEntries(rows.map((r) => [r.key.split(":")[0], r.count]));
}

/** One photo signed and uploaded as the browser does it; the path it landed at. */
async function uploaded(bytes, contentType) {
  const res = await sign(anAddress(), 1, contentType);
  assert.equal(res.status, 200, await res.clone().text());
  const [{ path, token }] = (await res.json()).uploads;
  const { error } = await storage().uploadToSignedUrl(path, token, new Blob([bytes], { type: contentType }));
  assert.equal(error, null, error?.message);
  storedPaths.push(path);
  return path;
}

async function file(photoPaths) {
  const clientNonce = randomUUID();
  nonces.push(clientNonce);
  const res = await fetch(`${BASE_URL}/api/reports`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": anAddress() },
    body: JSON.stringify({
      category: "sighting", page: "wildlife", lng: 121.5, lat: 25.0,
      observedAt: new Date().toISOString(), photoPaths, clientNonce, taxonUnknown: true,
    }),
  });
  return { res, body: await res.json(), clientNonce };
}

describe("signing is charged per photo", () => {
  test("four photos and then one charge five, in both windows", async (t) => {
    if (!(await requireServer(t))) return;
    const ip = anAddress();
    assert.equal((await sign(ip, 4)).status, 200);
    assert.equal((await sign(ip, 1)).status, 200);
    assert.deepEqual(await charged(ip), { "sign-burst": 5, "sign-daily": 5 });
  });

  test("a malformed request is answered without spending anything", async (t) => {
    if (!(await requireServer(t))) return;
    const ip = anAddress();
    assert.equal((await sign(ip, 5)).status, 400, "five photos is more than a report holds");
    assert.equal((await sign(ip, 1, "text/html")).status, 400);
    assert.deepEqual(await charged(ip), {});
  });

  test("an address with nobody signed in has sixty photos a day", async (t) => {
    if (!(await requireServer(t))) return;
    const ip = anAddress();
    // Most of the day spent already, in the window bump_rate_limit counts in.
    await sql`
      insert into rate_limits (key, window_start, count)
      values (${`sign-daily:${addressKey(ip)}`},
              to_timestamp(floor(extract(epoch from now()) / 86400) * 86400), 57)`;
    signedKeys.push(`sign-daily:${addressKey(ip)}`);
    assert.equal((await sign(ip, 3)).status, 200, "the 58th to 60th photos were refused");
    const over = await sign(ip, 1);
    assert.equal(over.status, 429);
    assert.equal((await over.json()).error, "rate_limited");
  });
});

describe("the bucket takes nothing over 3 MB", () => {
  test("0038 lowers the limit to 3 MB, and never raises one", async () => {
    assert.equal(MAX_UPLOAD_BYTES, 3 * 1024 * 1024);
    assert.match(MIGRATION, new RegExp(`set file_size_limit = ${MAX_UPLOAD_BYTES}\\b`), "the bucket and the route disagree");
    await inRollback(async (tx) => {
      // CI's cluster has no Storage; give the migration the one table it reads.
      const [{ present }] = await tx`select to_regclass('storage.buckets') is not null as present`;
      if (!present) {
        await tx`create schema storage`;
        await tx`create table storage.buckets (id text primary key, file_size_limit bigint)`;
        await tx`insert into storage.buckets (id) values ('report-photos')`;
      }
      for (const [before, expected] of [
        [10_485_760, MAX_UPLOAD_BYTES],
        [null, MAX_UPLOAD_BYTES],
        [2_097_152, 2_097_152],
        [MAX_UPLOAD_BYTES, MAX_UPLOAD_BYTES],
      ]) {
        await tx`update storage.buckets set file_size_limit = ${before} where id = 'report-photos'`;
        await tx.unsafe(MIGRATION);
        const [row] = await tx`select file_size_limit from storage.buckets where id = 'report-photos'`;
        assert.equal(row.file_size_limit === null ? null : Number(row.file_size_limit), expected, `from ${before}`);
      }
    });
  });

  test("an upload over 3 MB is refused, and one under it lands", async (t) => {
    if (!(await requireServer(t))) return;
    const res = await sign(anAddress(), 2, "image/jpeg");
    assert.equal(res.status, 200);
    const [big, small] = (await res.json()).uploads;
    const over = await storage().uploadToSignedUrl(big.path, big.token, new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1024)], { type: "image/jpeg" }));
    storedPaths.push(big.path);
    assert.ok(over.error, "Storage took more than 3 MB");
    assert.match(over.error.message, /maximum allowed size/);
    const fits = await storage().uploadToSignedUrl(small.path, small.token, new Blob([flatBlockJpeg(64, 64, meadow)], { type: "image/jpeg" }));
    storedPaths.push(small.path);
    assert.equal(fits.error, null, fits.error?.message);
  });
});

describe("a report's photos are read before they are attached", () => {
  test("a JPEG with a GPS position in it is refused, and nothing is filed", async (t) => {
    if (!(await requireServer(t))) return;
    const path = await uploaded(phonePhoto(), "image/jpeg");
    const { res, body, clientNonce } = await file([path]);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(body, { error: "photo_has_metadata", path });
    assert.equal((await sql`select count(*)::int as n from reports where client_nonce = ${clientNonce}`)[0].n, 0);
  });

  test("bytes that are not the type they were stored as are refused", async (t) => {
    if (!(await requireServer(t))) return;
    const path = await uploaded(Buffer.from("<html><body>not a photo</body></html>"), "image/jpeg");
    const { res, body } = await file([path]);
    assert.equal(res.status, 400);
    assert.equal(body.error, "photo_bad_type");
  });

  test("the same picture with nothing but its pixels is filed with its photo", async (t) => {
    if (!(await requireServer(t))) return;
    const path = await uploaded(flatBlockJpeg(160, 120, meadow), "image/jpeg");
    const { res, body } = await file([path]);
    assert.equal(res.status, 201, JSON.stringify(body));
    const [photo] = await sql`select content_type, bytes from report_photos where storage_path = ${path}`;
    assert.equal(photo?.content_type, "image/jpeg");
  });
});
