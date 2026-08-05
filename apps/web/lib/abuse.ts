import { sql } from "@/lib/db";
import { isInTaiwanBounds, CATEGORIES, type Category } from "@conservation/shared";

/* ------------------------------------------------------------------ *
 * Turnstile
 * ------------------------------------------------------------------ */

const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Cloudflare Turnstile token server-side. Client-side success is not
 * evidence of anything — the token must be redeemed here.
 *
 * When TURNSTILE_SECRET_KEY is unset (local dev) this passes, so the form works
 * without a Cloudflare account. Production sets the key.
 */
export async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
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
export function screenSubmission(input: {
  category: Category;
  lng: number;
  lat: number;
  notes?: string;
  photoCount: number;
}): string | null {
  if (!isInTaiwanBounds(input.lng, input.lat)) return "coordinates outside Taiwan";

  if (CATEGORIES[input.category].classifiable && input.photoCount === 0) {
    return "no photo on a category that expects one";
  }

  if (input.notes) {
    if (/https?:\/\/|www\.|\bt\.me\b|@[a-z0-9_]{4,}/i.test(input.notes)) {
      return "links or handles in notes";
    }
  }

  return null;
}
