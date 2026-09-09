/**
 * Whether a Turnstile challenge is in play, for code that needs to know without
 * rendering one.
 *
 * Lives here rather than in the component because the offline queue depends on
 * it: `flush.ts` must decide whether a missing token means "hold this report
 * back" or "this deployment has no challenge and never did". Importing that
 * answer from a `"use client"` component to make it would drag the widget into
 * the queue's module graph for the sake of one boolean.
 *
 * Mirrors the server: lib/abuse.ts short-circuits `verifyTurnstile` to true when
 * TURNSTILE_SECRET_KEY is unset, so local development works with no Cloudflare
 * account and both halves stay switched off together.
 */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/** True when a challenge will actually be rendered, so callers can require one. */
export const turnstileEnabled = !!TURNSTILE_SITE_KEY;
