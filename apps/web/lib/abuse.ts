import { sql } from "@/lib/db";
import { LOCATION_REASONS, screenText } from "@/lib/forum/screen";
import { isInTaiwanBounds, CATEGORIES, type Category } from "@conservation/shared";

/* ------------------------------------------------------------------ *
 * Turnstile
 * ------------------------------------------------------------------ */

const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Cloudflare Turnstile token server-side. Client-side success is not
 * evidence of anything — the token must be redeemed here.
 *
 * When TURNSTILE_SECRET_KEY is unset this passes, so the form works locally and
 * in CI without a Cloudflare account. **Outside production only.** In production
 * a missing key now closes the door rather than opening it: this function is the
 * single gate in front of an anonymous endpoint that writes to a database of
 * protected-species locations, and "the environment variable went missing" is a
 * mistake nobody would see — submissions would keep succeeding, the graphs would
 * look normal, and the gate would simply not be there.
 *
 * Verified before changing it, rather than assumed: production answers
 * `403 challenge_failed` to a tokenless submission today, so the key is set and
 * this branch is unreachable there. It closes a way to fail, not a way in.
 *
 * The OTHER fail-open below — a Cloudflare outage — is left exactly as it was.
 * That one is a deliberate availability trade and changing it is the team's call,
 * not a safe unilateral hardening: see `docs/app-and-site.md`.
 */
export async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.VERCEL_ENV === "production") {
      console.error(
        "[turnstile] TURNSTILE_SECRET_KEY is not set in production; refusing the submission",
      );
      return false;
    }
    return true;
  }
  if (!token) return false;

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);

  try {
    const res = await fetch(TURNSTILE_VERIFY, { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // A Cloudflare outage should not take submissions down with it.
    console.error("[turnstile] verification request failed; allowing submission");
    return true;
  }
}

/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */

/** Returns true when the caller is still within budget. Backed by bump_rate_limit(). */
export async function withinRateLimit(
  key: string,
  windowSeconds: number,
  budget: number,
): Promise<boolean> {
  const [row] = await sql<{ ok: boolean }[]>`
    select bump_rate_limit(${key}, ${windowSeconds}, ${budget}) as ok`;
  return row.ok;
}

/** One budget: a key, its window and how many it allows. */
export type Budget = { key: string; windowSeconds: number; budget: number };

/**
 * Whether a request is within every budget, charging them in order and
 * stopping at the first that refuses.
 *
 * Charging them all at once meant a flood the two-minute budget refused still
 * counted in full against the daily one, so a script behind a school's or a
 * carrier's shared address could spend a whole day's budget in a second and
 * lock everyone there out until midnight UTC (review of the security fixes,
 * 30 September 2026). Put the short windows first: a request they refuse is
 * not counted against the longer ones.
 */
export async function withinBudgets(budgets: Budget[]): Promise<boolean> {
  for (const b of budgets) {
    if (!(await withinRateLimit(b.key, b.windowSeconds, b.budget))) return false;
  }
  return true;
}

/**
 * Photo upload URLs, per address. One report is one signing call for up to four
 * photos, so these sit just above SUBMIT_LIMITS: a sender cannot sign far more
 * uploads than they could ever attach. They were 40 calls per 5 minutes, which
 * let one address fill the bucket with about 460 GB a day that no report used.
 */
export const SIGN_LIMITS = {
  burst: { windowSeconds: 120, budget: 8 },
  daily: { windowSeconds: 86_400, budget: 150 },
} as const;

/**
 * How much more a signed-in sender's address may send than one person: a
 * school or a phone network puts many people behind one address, and each of
 * them also has their own per-account budget.
 */
export const SIGNED_IN_ADDRESS_FACTOR = 5;

/**
 * Identifying a photo in the report form (app/api/identify). Each one is a
 * call to the GPU the project pays for, and it needs no challenge, so it is
 * held tighter than signing: a reporter adds at most four photos to a report,
 * and the form asks about the first. The whole site's day is capped too, so a
 * flood from many addresses costs a known amount at most.
 */
export const IDENTIFY_LIMITS = {
  burst: { windowSeconds: 120, budget: 6 },
  daily: { windowSeconds: 86_400, budget: 40 },
  siteDaily: { windowSeconds: 86_400, budget: 1_500 },
} as const;

export const SUBMIT_LIMITS = {
  /** Bursts: a handful of reports in a couple of minutes is normal fieldwork. */
  burst: { windowSeconds: 120, budget: 6 },
  /** Sustained: well above any genuine single-person contribution rate. */
  daily: { windowSeconds: 86_400, budget: 120 },
} as const;

/* ------------------------------------------------------------------ *
 * Submission heuristics
 * ------------------------------------------------------------------ */

/**
 * Reasons to hold a report for review instead of auto-publishing.
 *
 * Deliberately narrow: auto-publish is the default because an empty-looking map
 * kills participation, which is the failure mode that matters most for a
 * citizen-science project.
 */
/**
 * The credit name to publish, or null to credit the record to the default
 * contributor.
 *
 * A credit that gives a place, a map link or a way to reach someone is not a
 * name, and it would be published beside the record whatever its blur. It
 * used to hold the whole report for a moderator instead, but the queue never
 * showed the credit, so the moderator could only publish it unseen (review of
 * the security fixes, 30 September 2026). Such a credit is simply not kept.
 */
export function creditToPublish(creditName: string | undefined): string | null {
  const credit = creditName?.trim();
  if (!credit) return null;
  const { reasons } = screenText(credit, { watchedWords: [], newAccount: false });
  if (reasons.some((r) => LOCATION_REASONS.includes(r) || r === "contact")) return null;
  if (/https?:\/\/|www\.|\bt\.me\b/i.test(credit)) return null;
  return credit;
}

export function screenSubmission(input: {
  category: Category;
  lng: number;
  lat: number;
  notes?: string;
  photoCount: number;
}): string | null {
  if (!isInTaiwanBounds(input.lng, input.lat)) return "coordinates outside Taiwan";

  // Before the photo rule, so a moderator is told the reason that matters
  // most: words that say where the animal is get past the coordinate blur,
  // which is the one promise this site makes. The forum's own screen reads
  // them (lib/forum/screen.ts), so the two agree on what a location looks
  // like; the notes are also hidden on every blurred record (0025). The credit
  // name is dealt with on its own (creditToPublish).
  const text = input.notes ?? "";
  if (text) {
    const { reasons } = screenText(text, { watchedWords: [], newAccount: false });
    if (reasons.some((r) => LOCATION_REASONS.includes(r)))
      return "a location in the notes or credit";
    if (reasons.includes("contact")) return "contact details in the notes or credit";
  }

  if (CATEGORIES[input.category].classifiable && input.photoCount === 0) {
    return "no photo on a category that expects one";
  }

  if (text) {
    if (/https?:\/\/|www\.|\bt\.me\b|@[a-z0-9_]{4,}/i.test(text)) {
      return "links or handles in notes";
    }
  }

  return null;
}
