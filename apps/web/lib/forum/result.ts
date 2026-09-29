import type { HoldReason } from "./screen";

/**
 * What every forum server action answers with.
 *
 * `message` is a key under `forum.msg` in the catalogues, never prose: the
 * action runs on the server without knowing which language the form is in,
 * and the form translates it. `reasons` travels with a held post so the
 * poster is told why it is waiting.
 */
export type ActionResult = {
  ok: boolean;
  message: string;
  reasons?: HoldReason[];
} | null;

export const ok = (message: string, reasons?: HoldReason[]): ActionResult => ({ ok: true, message, reasons });
export const fail = (message: string): ActionResult => ({ ok: false, message });
