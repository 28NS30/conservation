import type { HoldReason } from "./screen";

/**
 * What every forum server action answers with.
 *
 * `message` is a key under `forum.msg` in the catalogues, never prose: the
 * action runs on the server without knowing which language the form is in,
 * and the form translates it. `reasons` travels with a held post so the
 * poster is told why it is waiting. `typed` travels with a refused post: the
 * text that was sent, by field name, for the form to put back (ActionForm
 * TypedTextarea). It only ever goes back to the person who typed it.
 */
export type ActionResult = {
  ok: boolean;
  message: string;
  reasons?: HoldReason[];
  typed?: Record<string, string>;
} | null;

export const ok = (message: string, reasons?: HoldReason[]): ActionResult => ({ ok: true, message, reasons });
export const fail = (message: string, typed?: Record<string, string>): ActionResult =>
  typed ? { ok: false, message, typed } : { ok: false, message };
