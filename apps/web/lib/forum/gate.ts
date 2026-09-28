/**
 * Is the discussion forum switched on for this server?
 *
 * The forum ships dark. Opening it needs two things only the owner can
 * arrange — a legal review of the age policy and the terms, and a rota of
 * moderators who can clear the review queue every day — so everything under
 * /community, the forum's API routes, its retention job and every one of its
 * server actions asks this first and answers 404 when it says no. Not a
 * redirect and not a "coming soon" teaser: the honest answer to "does the
 * forum exist on production" is that it does not, and a teaser is a page that
 * search engines index and people link to.
 *
 * Off unless FORUM_ENABLED is exactly "1" or "true". Anything else — unset,
 * empty, "0", "yes", " 1", "TRUE" — is off, because the dangerous mistake is a
 * typo that opens it, not one that keeps it shut.
 *
 * Unlike the design lab's gate, this does NOT default on outside production.
 * The lab is a prototype nobody can post to; the forum takes writes from the
 * public and would have to be moderated from the moment it answered, so every
 * environment — a preview, a laptop, CI — turns it on deliberately.
 *
 * Reads the environment through an argument so the rule can be tested without
 * touching `process.env`. Server-side only: in a client bundle Next replaces
 * `process.env` with the NEXT_PUBLIC_ keys it inlines, and this would always
 * answer false there — which is the safe direction, but still not an answer.
 */
export type ForumEnv = {
  FORUM_ENABLED?: string;
  // An index signature so `process.env` is accepted as the default argument;
  // see lib/lab/gate.ts for why TypeScript needs it.
  [key: string]: string | undefined;
};

export function forumEnabled(env: ForumEnv = process.env): boolean {
  const v = env.FORUM_ENABLED;
  return v === "1" || v === "true";
}
