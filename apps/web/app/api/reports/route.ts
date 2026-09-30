import { after } from "next/server";
import { sql } from "@/lib/db";
import { classifyQueued } from "@/lib/report/classifyWorker";
import { serverSupabase } from "@/lib/supabase/server";
import { statUploadedPhoto, StorageUnavailable } from "@/lib/supabase/service";
import {
  verifyTurnstile,
  screenSubmission,
  SIGNED_IN_ADDRESS_FACTOR,
  SUBMIT_LIMITS,
  withinBudgets,
  creditToPublish,
  type Budget,
} from "@/lib/abuse";
import { addressKey, clientIp } from "@/lib/request";
import { OFFERED, inPageScope } from "@/lib/species";
import {
  reportSubmissionSchema,
  requiresClassification,
  pageAllows,
  pageOf,
  REPORT_PAGES,
  UNIDENTIFIED_PRECISION,
  UNVERIFIED_INVASIVE_PRECISION,
  CONTRIBUTOR_LICENSES,
  CONSENT_VERSION,
  PARTNER_SHARING_PAGES,
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
/**
 * `on conflict do nothing` fired, but the conflicting row could not be read
 * back. Its own class so the catch can tell it apart from a genuine insert
 * failure, which is the difference between "we already have this" and "your
 * report did not send".
 */
class ReportConflictUnresolved extends Error {
  constructor() {
    super("duplicate_unresolved");
    this.name = "ReportConflictUnresolved";
  }
}

/**
 * Long enough for the after() below: a cold Modal container takes ~26s before
 * the model answers. 60 is the Hobby ceiling; the reporter's response does not
 * wait for any of it.
 */
export const maxDuration = 60;

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

  // The page it was filed on, and what that page can produce.
  //
  // Every form since the three pages sends `page`. A report queued offline by
  // an older build does not, and is held to the page its category belongs to,
  // which is where that build's form would have put it. What a page cannot
  // produce is refused rather than refiled: the category is the one thing on
  // the page the reporter chose deliberately, and silently changing it — a live
  // sighting stored as roadkill — is the failure the pages were split to end.
  const page = input.page ?? pageOf(input.category);
  if (!pageAllows(page, input.category)) {
    return Response.json({ error: "category_not_on_page" }, { status: 400 });
  }

  // Who, if anyone, is signed in. Reporting stays open to anonymous users —
  // friction is what kills citizen-science participation.
  const supabase = await serverSupabase();
  const { data: auth } = await supabase.auth.getUser();
  const signedIn = auth?.user?.id ?? null;

  // A report saved on a phone says who made it. The queue is per device, not
  // per account, so without this a report saved by one person was filed under
  // whoever was signed in when it finally sent: their email and notes on
  // someone else's /me, editable by them (security audit, 29 September 2026).
  // Saved signed out, it is filed signed out. Saved under an account, it waits
  // for that account: the queue keeps it, at no cost, and says why.
  if (input.filedBy && input.filedBy !== "anonymous" && input.filedBy !== signedIn) {
    return Response.json({ error: "signed_in_as_someone_else" }, { status: 409 });
  }
  const reporterId = input.filedBy === "anonymous" ? null : signedIn;

  // A test report (0018): a moderator trying the whole path without it being
  // shown. The role comes from `profiles`, never from the request, and anyone
  // else who asks for a test is refused. Filing it as a real report instead
  // would publish something its sender meant nobody to see.
  const isTest = input.test === true;
  if (isTest) {
    const [profile] = reporterId
      ? await sql<{ role: string }[]>`
          select role from profiles where id = ${reporterId}::uuid`
      : [];
    if (profile?.role !== "moderator" && profile?.role !== "admin")
      return Response.json({ error: "test_not_allowed" }, { status: 403 });
  }

  // The challenge first, so a request that has not passed it spends nobody's
  // budget. Charged the other way round, tokenless requests from a shared
  // address used the day's budget of everyone behind it (review of the
  // security fixes, 30 September 2026).
  if (!(await verifyTurnstile(input.turnstileToken, ip))) {
    return Response.json({ error: "challenge_failed" }, { status: 403 });
  }

  // Every sender is counted by address; a signed-in one by their account as
  // well, and their address is given more room, since a school or a phone
  // network puts many people behind one. Counted by account alone, as before,
  // one address with N throwaway accounts had N budgets. Short windows first
  // (withinBudgets): a burst refused is not counted against the day.
  const address = `ip:${addressKey(ip)}`;
  const factor = reporterId ? SIGNED_IN_ADDRESS_FACTOR : 1;
  const account = reporterId ? `user:${reporterId}` : null;
  const budgets: Budget[] = [
    { key: `submit-burst:${address}`, windowSeconds: SUBMIT_LIMITS.burst.windowSeconds, budget: SUBMIT_LIMITS.burst.budget * factor },
    ...(account
      ? [{ key: `submit-burst:${account}`, windowSeconds: SUBMIT_LIMITS.burst.windowSeconds, budget: SUBMIT_LIMITS.burst.budget }]
      : []),
    { key: `submit-daily:${address}`, windowSeconds: SUBMIT_LIMITS.daily.windowSeconds, budget: SUBMIT_LIMITS.daily.budget * factor },
    ...(account
      ? [{ key: `submit-daily:${account}`, windowSeconds: SUBMIT_LIMITS.daily.windowSeconds, budget: SUBMIT_LIMITS.daily.budget }]
      : []),
  ];
  if (!(await withinBudgets(budgets))) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  // Confirm the referenced objects exist and are what they claim to be.
  const photos: { path: string; bytes: number; contentType: string }[] = [];
  for (const path of input.photoPaths) {
    let stat;
    try {
      stat = await statUploadedPhoto(path);
    } catch (e) {
      // Storage could not be asked: a 503 the queue retries, not a verdict
      // on the photo.
      if (e instanceof StorageUnavailable) {
        console.error("[reports] storage unavailable:", e.message);
        return Response.json({ error: "storage_unavailable" }, { status: 503 });
      }
      throw e;
    }
    if (!stat) return Response.json({ error: "photo_missing", path }, { status: 400 });
    if (stat.bytes > MAX_UPLOAD_BYTES) return Response.json({ error: "photo_too_large", path }, { status: 400 });
    if (!ACCEPTED_IMAGE_TYPES.includes(stat.contentType as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
      return Response.json({ error: "photo_bad_type", path }, { status: 400 });
    }
    photos.push({ path, ...stat });
  }
  // One report per photograph. A path is only a name, and nothing tied one to
  // the sign call that issued it, so another report's photo could be named
  // here and attached again (migration 0027 makes it a constraint too). A
  // retry of the same report is answered further down, by its nonce, before
  // anything is inserted.
  if (photos.length) {
    const [taken] = await sql<{ path: string }[]>`
      select p.storage_path as path
        from report_photos p join reports r on r.id = p.report_id
       where p.storage_path = any(${photos.map((p) => p.path)})
         and r.client_nonce is distinct from ${input.clientNonce}
       limit 1`;
    if (taken) return Response.json({ error: "photo_in_use", path: taken.path }, { status: 400 });
  }

  const flaggedReason = screenSubmission({
    category: input.category,
    lng: input.lng,
    lat: input.lat,
    notes: input.notes,
    photoCount: photos.length,
  });

  // A named species must exist. The foreign key would catch it, but as a 500
  // rather than as an answer, and the client can do nothing with a 500.
  //
  // And it should be one the picker could have offered: a name TaiCOL still
  // accepts, for an animal recorded in Taiwan (OFFERED, lib/species.ts). The id
  // arrives from the client, and a report saved offline before a name was
  // retired, an old link, or a hand-built request can still carry another.
  // Retired names are where TaiCOL's duplicates live, and a duplicate need not
  // carry its twin's rating — the deleted 'Dopasia formosensis' row was
  // unrated beside the one the law protects — so such a name is never
  // recorded as the species.
  //
  // Nor is it a reason to lose the report. Refusing it did: the offline queue
  // treats any 4xx as final and has no way to choose the species again. The
  // report is filed unidentified instead — classified, if it has a photo, and
  // open to a moderator — and blurred at least as hard as the name it gave
  // would have been, so a retired name rated 縣市 does not come out at the
  // unidentified 10 km.
  //
  // A name we do offer, but not on this page, is a different case, and it IS
  // refused: a native animal posted to the invasive page, or a plant to any
  // page. That is not a name that went stale between the reporter choosing it
  // and the report arriving — the page's picker never offered it (inPageScope,
  // lib/species.ts) — so it is a request built by hand, or a client that asks
  // the picker for a wider list than its page. Filing it unidentified would
  // put a report the reporter said was one animal into the invasive
  // collection as something else; the answer is a code the form shows beside
  // the picker, where they can choose again.
  let taxonId = input.taxonId ?? null;
  let heldAt: string | null = null;
  if (input.taxonId) {
    const [taxon] = await sql<
      { offered: boolean; in_scope: boolean; unidentified: string }[]
    >`
      select ${sql.unsafe(OFFERED)} as offered,
             ${sql.unsafe(inPageScope(REPORT_PAGES[page].species))} as in_scope,
             stricter_precision(${UNIDENTIFIED_PRECISION}::text,
                                report_precision(t.id, null)) as unidentified
        from taxa t where t.id = ${input.taxonId}`;
    if (!taxon) return Response.json({ error: "taxon_not_found" }, { status: 400 });
    if (!taxon.offered) {
      taxonId = null;
      heldAt = taxon.unidentified;
    } else if (!taxon.in_scope) {
      return Response.json({ error: "taxon_out_of_scope" }, { status: 400 });
    }
  }

  // Who says so. 'user' is the reporter's own word, which is the same claim as
  // confirming the classifier's guess later; 'unknown' is the reporter saying
  // they looked and could not name it. See 0009_reporter_identification.sql.
  const taxonSource = taxonId ? "user" : input.taxonUnknown ? "unknown" : null;

  // The core privacy decision.
  //
  // An unidentified report has no taxon, so its sensitivity is unknown. If we
  // published it immediately, a 石虎 (leopard cat) would sit on the public map at
  // its exact coordinate until the classifier caught up. So: hold it as `pending`,
  // AND stamp a conservative precision override, so that even if it is published
  // by some other path it can never appear at full precision unidentified.
  //
  // A reporter who names the species removes the unknown. The trigger derives
  // the blur from that taxon's own sensitivity rating on insert, so a protected
  // species is blurred before the row is visible to anything — there is nothing
  // left to wait for, and holding it back would only mean that naming the animal
  // made the report slower to appear.
  const identified = Boolean(taxonId);
  const classifiable = requiresClassification(input.category, photos.length);
  const awaitingId = classifiable && !identified;
  const status = awaitingId || flaggedReason ? "pending" : "published";
  // Keyed on whether the animal has been NAMED, not on whether it can be
  // classified. Those differ by exactly one thing — a photograph — and the
  // comment above describes the first while the code used to do the second.
  //
  // `requiresClassification` is `photoCount > 0` in practice, so a report with
  // no photo and no species reached this line as `awaitingId = false` and was
  // stamped with nothing. What kept it off the map at full precision was not
  // this decision at all: it was the abuse screen's separate "no photo on a
  // category that expects one" flag holding it as `pending`, and, since 0011,
  // the trigger's own else-branch. Two backstops for a guard that was not
  // guarding, and neither of them is this comment's promise.
  //
  // A report from the invasive page is held at UNVERIFIED_INVASIVE_PRECISION
  // even when it is named, because there naming is the doubtful part: a
  // protected native is exactly what gets mistaken for its invasive
  // look-alike, and the name the reporter gives is what would set the blur.
  // It is stamped here, as a decision rather than as the "not known yet" stamp,
  // so every later naming keeps it (lib/report/precision.ts). Nothing lifts it
  // on a moderator's confirmation yet; when that may happen is the owner's call.
  const pageHold = page === "invasive" ? UNVERIFIED_INVASIVE_PRECISION : null;
  const precisionOverride = identified
    ? pageHold
    : (heldAt ?? UNIDENTIFIED_PRECISION);

  // The contributor terms (/terms, migration 0017). Stored only when the form
  // answered them: a report queued offline before the terms existed carries no
  // licence, and nothing exports it under one. The partner box is honoured on
  // the pages that show it and nowhere else, whatever a request says.
  const license = input.license ? CONTRIBUTOR_LICENSES[input.license] : null;
  const rightsHolder = input.license ? creditToPublish(input.creditName) : null;
  const sharePartners =
    Boolean(input.sharePartners) && PARTNER_SHARING_PAGES.includes(page);
  // The version the form showed, which is not always the one live now: a
  // report saved on a phone offline may be sent after the terms change.
  const consentVersion = input.license
    ? (input.consentVersion ?? CONSENT_VERSION)
    : null;

  try {
    const result = await sql.begin(async (tx) => {
      const inserted = await tx<{ id: string; location_precision: string }[]>`
        insert into reports (
          category, location, location_public, observed_at, notes,
          status, source, reporter_id, contact_email, flagged_reason,
          client_nonce, precision_override, taxon_id, taxon_source,
          location_accuracy_m, license, rights_holder, share_partners,
          consent_version, consent_at, is_test
        ) values (
          ${input.category},
          st_setsrid(st_makepoint(${input.lng}, ${input.lat}), 4326)::geography,
          st_setsrid(st_makepoint(${input.lng}, ${input.lat}), 4326)::geography,
          ${input.observedAt}, ${input.notes ?? null},
          ${status}, 'user', ${reporterId}, ${input.contactEmail ?? null}, ${flaggedReason},
          ${input.clientNonce}, ${precisionOverride},
          ${taxonId}, ${taxonSource},
          ${input.accuracyM ?? null}, ${license}, ${rightsHolder}, ${sharePartners},
          ${consentVersion}, ${consentVersion ? tx`now()` : null}, ${isTest}
        )
        on conflict (client_nonce) where client_nonce is not null do nothing
        returning id, location_precision`;

      // Same nonce already submitted — a double-tap or an offline retry.
      if (inserted.length === 0) {
        const [existing] = await tx<
          {
            id: string;
            status: string;
            location_precision: string;
            awaiting: boolean;
            is_test: boolean;
          }[]
        >`
          select r.id, r.status, r.location_precision, r.is_test,
                 -- What the receipt needs to know about THIS row, computed from
                 -- the row. The same three facts the insert branch decides from,
                 -- read back rather than recomputed: a retry of a report that
                 -- has since been classified is not awaiting identification any
                 -- more, whatever this request happened to arrive with.
                 (r.status = 'pending'
                  and r.taxon_id is null
                  and exists (select 1 from report_photos p
                               where p.report_id = r.id)) as awaiting
            from reports r
           where r.client_nonce = ${input.clientNonce}`;

        // `on conflict do nothing` said a row exists, so not finding it here
        // means it is not visible to this transaction. Falling through would
        // read `.id` off undefined, and the catch below would answer the
        // reporter "insert_failed" — telling them their report did not send,
        // about the one case where we know for certain that it did.
        if (!existing) throw new ReportConflictUnresolved();

        return {
          id: existing.id,
          status: existing.status,
          precision: existing.location_precision,
          awaiting: existing.awaiting,
          test: existing.is_test,
          duplicate: true,
        };
      }

      const reportId = inserted[0].id;

      for (const p of photos) {
        await tx`
          insert into report_photos (report_id, storage_path, bytes, content_type)
          values (${reportId}, ${p.path}, ${p.bytes}, ${p.contentType})`;
      }

      // Queued even when the reporter named the species: the model's opinion is
      // worth recording next to theirs, and the job no longer overwrites a human
      // identification. It is also what puts candidate rows in `classifications`,
      // which is the set confirmSpecies is constrained to.
      if (classifiable) {
        await tx`insert into classification_jobs (report_id) values (${reportId})`;
      }

      return {
        queued: classifiable,
        id: reportId,
        status,
        precision: inserted[0].location_precision,
        awaiting: awaitingId,
        test: isTest,
        duplicate: false,
      };
    });

    // Identify the photo now, after the reporter has their answer, rather than
    // at 03:00 tomorrow: the daily cron was the only thing that ran the model,
    // three reports a night. The job is committed above, so if this is cut
    // short (the function's own time limit, a deploy) it is still queued and
    // the cron sweeps it up; claims skip locked rows, so the two never race.
    // A failure here is the worker's to record on the job, never the reporter's.
    //
    // Not in a test build (NEXT_PUBLIC_E2E=1): the suites file reports with
    // photos by the dozen, and a laptop's .env points ML_ENDPOINT_URL at the
    // production model service. The cron route still classifies there.
    if ("queued" in result && result.queued && process.env.NEXT_PUBLIC_E2E !== "1") {
      const id = result.id;
      after(async () => {
        try {
          await classifyQueued({ reportId: id });
        } catch (e) {
          console.error(`[reports] classify after submit ${id}:`, (e as Error).message);
        }
      });
    }

    return Response.json(
      {
        id: result.id,
        status: result.status,
        duplicate: result.duplicate,
        // From the row for a retry, from this request for a new one — see the
        // duplicate branch. Recomputing it here would answer a retry with facts
        // about a submission that is no longer the one in the database.
        awaitingIdentification: result.awaiting,
        // `published` is not the same as visible. `reports_public` also drops
        // anything whose taxon TaiCOL rates 座標不開放, and the trigger stamps
        // that precision from the taxon the reporter chose — so a report can be
        // published, correct, and absent from the map, the list and every
        // statistic. Telling its reporter "it's on the map" and linking them to
        // a page that 404s is the exact failure the receipt work exists to end,
        // so the answer carries what the trigger decided rather than leaving the
        // client to assume.
        visible: result.precision !== "suppressed",
        // A test is never in reports_public, whatever `visible` says about
        // where the blur put it; the receipt says so (lib/report/outcome.ts).
        test: result.test,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (err) {
    console.error("[api/reports]", err);
    if (err instanceof ReportConflictUnresolved)
      // 409, not 500: something is wrong here, but it is not that the report
      // failed to send. The client's error table has no sentence for this code
      // and falls back to the generic one, which is the right amount to say to
      // someone whose report is already stored.
      return Response.json({ error: "duplicate_unresolved" }, { status: 409 });
    return Response.json({ error: "insert_failed" }, { status: 500 });
  }
}
