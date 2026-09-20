/**
 * Is the design lab reachable on this deployment?
 *
 * The lab is throwaway code that lives on a branch of the real app: four new
 * directories, no live file touched. That only stays safe if the routes cannot
 * be stumbled into by a visitor or a crawler, so every lab layout asks this
 * first and calls `notFound()` when it answers false.
 *
 * On by default everywhere that is not production — dev, CI and Vercel preview
 * deployments — because that is where the thing is built and checked. Off in
 * production until someone sets `LAB_ENABLED=1` there, which is the owner's
 * decision to make: previews sit behind Vercel SSO, so cold readers and
 * roadside testers cannot open them, and a production URL is the only way the
 * owner can hand their phone to someone.
 *
 * Reads the environment through an argument so the rule itself can be tested
 * without mutating `process.env` in a test process. Server-side only: in a
 * client bundle Next replaces `process.env` with the handful of NEXT_PUBLIC_
 * keys it inlines, and this would answer true everywhere.
 */
export type LabEnv = {
  VERCEL_ENV?: string;
  LAB_ENABLED?: string;
  // An index signature so `process.env` — typed as a dictionary — is accepted
  // as the default argument. Without it TypeScript's weak-type check rejects
  // the call: a dictionary and a bag of optional keys have no property in
  // common, which is exactly the mistake that check exists to catch.
  [key: string]: string | undefined;
};

export function labEnabled(env: LabEnv = process.env): boolean {
  return env.VERCEL_ENV !== "production" || env.LAB_ENABLED === "1";
}
