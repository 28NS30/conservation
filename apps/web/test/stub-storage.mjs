/**
 * A stand-in for Supabase Storage, so CI can run the photo path end to end.
 *
 * CI's Supabase is test/stub-gotrue.mjs on 127.0.0.1:54321, and until this
 * existed nothing there answered /storage/v1: signing an upload failed, so no
 * test could send a report with a photo, and nothing showed that what reached
 * the bucket had no GPS in it, or that POST /api/reports reads a photo before
 * attaching it. The GoTrue stand-in hands /storage/v1 to this, on the same
 * port, as Supabase does. Locally the tests run against the real Storage in
 * the local stack instead, which is where these answers were checked.
 *
 * It answers what the app and the tests call, the way Storage v1 does, and
 * nothing else: the bucket, signing an upload and the upload itself (a token
 * is good for its one path, which is never written twice), listing a folder,
 * downloading an object and deleting objects. Refusals are 400s that carry
 * the real status in the body, as Storage's are. One bucket, `report-photos`, held to the limits migrations
 * 0004 and 0038 set on the real one: MAX_UPLOAD_BYTES and the three accepted
 * types, read from packages/shared so the two cannot drift apart. In memory;
 * it checks that a key is sent, not which, and exists only where there is
 * nothing to protect.
 */
import { randomUUID } from "node:crypto";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@conservation/shared";

export const STORAGE_BUCKET = "report-photos";

/** The most a request body may be before the stand-in stops reading it. */
const READ_CEILING = 4 * MAX_UPLOAD_BYTES;

export function storageHandler() {
  /** path → { bytes, mimetype, created } */
  const objects = new Map();
  /** token → the one path it may write */
  const tokens = new Map();
  const created = new Date().toISOString();

  const bucket = {
    id: STORAGE_BUCKET,
    name: STORAGE_BUCKET,
    owner: "",
    public: false,
    file_size_limit: MAX_UPLOAD_BYTES,
    allowed_mime_types: [...ACCEPTED_IMAGE_TYPES],
    created_at: created,
    updated_at: created,
  };

  const entry = (name, o) => ({
    name,
    id: o ? randomUUID() : null,
    updated_at: o?.created ?? null,
    created_at: o?.created ?? null,
    last_accessed_at: o?.created ?? null,
    metadata: o
      ? {
          size: o.bytes.length,
          mimetype: o.mimetype,
          cacheControl: "max-age=3600",
          lastModified: o.created,
          contentLength: o.bytes.length,
          httpStatusCode: 200,
        }
      : null,
  });

  /** Handles a request under /storage/v1; false when it is not one. */
  return async function handle(req, res) {
    if (!new URL(req.url, "http://stub").pathname.startsWith("/storage/v1/")) return false;
    // The browser uploads from the site's own origin, as it does to Supabase,
    // which answers any origin; without these the upload never leaves it.
    res.setHeader("access-control-allow-origin", "*");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] ?? "*");
      res.setHeader("access-control-max-age", "600");
      res.end();
      return true;
    }
    await answer(req, res);
    return true;
  };

  async function answer(req, res) {
    const url = new URL(req.url, "http://stub");
    const path = url.pathname.slice("/storage/v1".length);
    const keyed = /^Bearer .+/.test(req.headers.authorization ?? "") || Boolean(req.headers.apikey);

    const fail = (status, statusCode, error, message) =>
      send(res, status, { statusCode: String(statusCode), error, message });
    const objectPath = (rest) => decodeURIComponent(rest);

    // The signed upload: the one call that needs no key, only its token.
    const upload = /^\/object\/upload\/sign\/([^/]+)\/(.+)$/.exec(path);
    if (upload && req.method === "PUT") {
      const [, b, rest] = upload;
      const key = objectPath(rest);
      const token = url.searchParams.get("token");
      if (b !== STORAGE_BUCKET || !token || tokens.get(token) !== key)
        return fail(400, 403, "Unauthorized", "invalid signature");
      const body = await read(req);
      if (body === null) return fail(400, 413, "Payload too large", "The object exceeded the maximum allowed size");
      const file = fileOf(req.headers["content-type"] ?? "", body);
      if (file.bytes.length > MAX_UPLOAD_BYTES)
        return fail(400, 413, "Payload too large", "The object exceeded the maximum allowed size");
      if (!ACCEPTED_IMAGE_TYPES.includes(file.mimetype))
        return fail(400, 415, "invalid_mime_type", `mime type ${file.mimetype} is not supported`);
      if (objects.has(key)) return fail(400, 409, "Duplicate", "The resource already exists");
      objects.set(key, { ...file, created: new Date().toISOString() });
      return send(res, 200, { Key: `${STORAGE_BUCKET}/${key}` });
    }

    if (!keyed) return fail(400, 403, "Unauthorized", "headers must have required property 'authorization'");

    if (req.method === "GET" && path === `/bucket/${STORAGE_BUCKET}`) return send(res, 200, bucket);
    if (req.method === "GET" && path.startsWith("/bucket/")) return fail(400, 404, "Bucket not found", "Bucket not found");

    if (upload && req.method === "POST") {
      const [, b, rest] = upload;
      if (b !== STORAGE_BUCKET) return fail(400, 404, "Bucket not found", "Bucket not found");
      await read(req);
      const token = randomUUID();
      tokens.set(token, objectPath(rest));
      return send(res, 200, { url: `/object/upload/sign/${STORAGE_BUCKET}/${rest}?token=${token}` });
    }

    if (req.method === "POST" && path === `/object/list/${STORAGE_BUCKET}`) {
      const body = JSON.parse((await read(req))?.toString("utf8") || "{}");
      const prefix = String(body.prefix ?? "").replace(/^\/+|\/+$/g, "");
      const under = prefix ? `${prefix}/` : "";
      const names = new Map();
      for (const [key, o] of objects) {
        if (!key.startsWith(under)) continue;
        const [first, ...more] = key.slice(under.length).split("/");
        names.set(first, more.length ? null : o);
      }
      const search = String(body.search ?? "");
      const offset = Number(body.offset) || 0;
      const limit = Number(body.limit) || 100;
      const list = [...names]
        .filter(([name]) => name.startsWith(search))
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(offset, offset + limit)
        .map(([name, o]) => entry(name, o));
      return send(res, 200, list);
    }

    const object = /^\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/.exec(path);
    if (object && req.method === "GET") {
      const o = objects.get(objectPath(object[2]));
      if (object[1] !== STORAGE_BUCKET || !o) return fail(400, 404, "not_found", "Object not found");
      res.statusCode = 200;
      res.setHeader("content-type", o.mimetype);
      res.setHeader("content-length", o.bytes.length);
      res.end(o.bytes);
      return;
    }

    if (req.method === "DELETE" && path === `/object/${STORAGE_BUCKET}`) {
      const body = JSON.parse((await read(req))?.toString("utf8") || "{}");
      const gone = [];
      for (const key of body.prefixes ?? [])
        if (objects.delete(key)) gone.push({ ...entry(key.split("/").at(-1), null), bucket_id: STORAGE_BUCKET, name: key });
      return send(res, 200, gone);
    }

    return fail(400, 404, "not_found", `The stand-in does not answer ${req.method} ${path}`);
  }
}

/** The request body, or null once it passes READ_CEILING. */
async function read(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > READ_CEILING) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * The file in an upload. supabase-js sends a Blob as multipart form data,
 * with the photo as the part that has a filename and its own content type;
 * anything else arrives as the raw bytes under the request's content type.
 */
function fileOf(contentType, body) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!/^multipart\/form-data/i.test(contentType) || !boundary)
    return { bytes: body, mimetype: contentType.split(";")[0].trim() };
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let at = body.indexOf(marker);
  while (at !== -1) {
    const start = at + marker.length + 2; // past the CRLF
    const next = body.indexOf(marker, start);
    if (next === -1) break;
    const part = body.subarray(start, next - 2); // and before the CRLF ahead of the next marker
    const split = part.indexOf("\r\n\r\n");
    const head = part.subarray(0, split).toString("utf8");
    if (/filename=/i.test(head)) {
      const type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim() ?? "application/octet-stream";
      return { bytes: Buffer.from(part.subarray(split + 4)), mimetype: type };
    }
    at = next;
  }
  return { bytes: Buffer.alloc(0), mimetype: "application/octet-stream" };
}

export { fileOf as uploadedFile };

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
