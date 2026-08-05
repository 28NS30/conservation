import { sql } from "@/lib/db";
import { serverSupabase } from "@/lib/supabase/server";
import { statUploadedPhoto } from "@/lib/supabase/service";
import { verifyTurnstile, withinRateLimit, screenSubmission, SUBMIT_LIMITS } from "@/lib/abuse";
import { clientIp } from "@/lib/request";
import {
  reportSubmissionSchema,
  requiresClassification,
  UNIDENTIFIED_PRECISION,
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
} from "@conservation/shared";

/**
 * Accept a citizen report.
 *
 * Writes go through here on the app's own connection rather than PostgREST, so
 * Turnstile and rate limiting cannot be bypassed by POSTing to /rest/v1/reports.
 * `anon` deliberately has no insert grant (see 0004_supabase_auth_rls.sql).
 */
export async function POST(req: Request) {
  const ip = clientIp(req);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const parsed = reportSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation_failed", issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Who, if anyone, is signed in. Reporting stays open to anonymous users —
  // friction is what kills citizen-science participation.
  const supabase = await serverSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const reporterId = auth?.user?.id ?? null;

  const subject = reporterId ? `user:${reporterId}` : `ip:${ip}`;
  const [burstOk, dailyOk] = await Promise.all([
    withinRateLimit(`submit-burst:${subject}`, SUBMIT_LIMITS.burst.windowSeconds, SUBMIT_LIMITS.burst.budget),
    withinRateLimit(`submit-daily:${subject}`, SUBMIT_LIMITS.daily.windowSeconds, SUBMIT_LIMITS.daily.budget),
  ]);
  if (!burstOk || !dailyOk) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  if (!(await verifyTurnstile(input.turnstileToken, ip))) {
    return Response.json({ error: "challenge_failed" }, { status: 403 });
  }

  // Confirm the referenced objects exist and are what they claim to be.
  const photos: { path: string; bytes: number; contentType: string }[] = [];
  for (const path of input.photoPaths) {
    const stat = await statUploadedPhoto(path);
    if (!stat) return Response.json({ error: "photo_missing", path }, { status: 400 });
    if (stat.bytes > MAX_UPLOAD_BYTES) return Response.json({ error: "photo_too_large", path }, { status: 400 });
    if (!ACCEPTED_IMAGE_TYPES.includes(stat.contentType as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
      return Response.json({ error: "photo_bad_type", path }, { status: 400 });
    }
    photos.push({ path, ...stat });
  }

  const flaggedReason = screenSubmission({
    category: input.category,
    lng: input.lng,
    lat: input.lat,
    notes: input.notes,
    photoCount: photos.length,
  });

  // The core privacy decision.
  //
  // A classifiable report has no taxon yet, so its sensitivity is unknown. If we
  // published it immediately, a 石虎 (leopard cat) would sit on the public map at
  // its exact coordinate until the classifier caught up. So: hold it as `pending`,
  // AND stamp a conservative precision override, so that even if it is published
  // by some other path it can never appear at full precision unidentified.
  const awaitingId = requiresClassification(input.category, photos.length);
  const status = awaitingId || flaggedReason ? "pending" : "published";
  const precisionOverride = awaitingId ? UNIDENTIFIED_PRECISION : null;

  try {
    const result = await sql.begin(async (tx) => {
      const inserted = await tx<{ id: string }[]>`
        insert into reports (
          category, location, location_public, observed_at, notes,
          status, source, reporter_id, contact_email, flagged_reason,
          client_nonce, precision_override
        ) values (
          ${input.category},
          st_setsrid(st_makepoint(${input.lng}, ${input.lat}), 4326)::geography,
          st_setsrid(st_makepoint(${input.lng}, ${input.lat}), 4326)::geography,
          ${input.observedAt}, ${input.notes ?? null},
          ${status}, 'user', ${reporterId}, ${input.contactEmail ?? null}, ${flaggedReason},
          ${input.clientNonce}, ${precisionOverride}
        )
        on conflict (client_nonce) where client_nonce is not null do nothing
        returning id`;

      // Same nonce already submitted — a double-tap or an offline retry.
      if (inserted.length === 0) {
        const [existing] = await tx<{ id: string; status: string }[]>`
          select id, status from reports where client_nonce = ${input.clientNonce}`;
        return { id: existing.id, status: existing.status, duplicate: true };
      }

      const reportId = inserted[0].id;

      for (const p of photos) {
        await tx`
          insert into report_photos (report_id, storage_path, bytes, content_type)
          values (${reportId}, ${p.path}, ${p.bytes}, ${p.contentType})`;
      }

      if (awaitingId) {
        await tx`insert into classification_jobs (report_id) values (${reportId})`;
      }

      return { id: reportId, status, duplicate: false };
    });

    return Response.json(
      {
        id: result.id,
        status: result.status,
        duplicate: result.duplicate,
        awaitingIdentification: awaitingId,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (err) {
    console.error("[api/reports]", err);
    return Response.json({ error: "insert_failed" }, { status: 500 });
  }
}
