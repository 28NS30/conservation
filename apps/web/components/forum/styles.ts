/**
 * The forum's controls, in the site's palette (app/globals.css).
 *
 * Written once so fifteen forms agree. The pairings are the ones the redesign
 * measured: white on leaf-600 (4.94:1) for the main action, forest and ink on
 * ivory for everything else, ember only as a fill with dark text on it — never
 * orange text on ivory, which is 3.2:1. Every control is at least 44px tall,
 * and inputs are 16px so a phone does not zoom the page when one is focused.
 */
export const btnPrimary =
  "inline-flex min-h-11 items-center justify-center gap-2 bg-leaf-600 px-5 font-display text-[17px] font-semibold uppercase tracking-[0.04em] text-white transition hover:bg-leaf-700 disabled:bg-paper-200 disabled:text-ink-600";

export const btnSecondary =
  "inline-flex min-h-11 items-center justify-center gap-2 border border-ink-900/25 bg-paper-50 px-4 text-[15px] text-ink-800 transition hover:border-ink-900/50 hover:bg-paper-100 disabled:text-ink-500";

export const btnQuiet =
  "inline-flex min-h-11 items-center gap-1.5 px-2 text-[14px] text-ink-700 underline decoration-ink-900/30 underline-offset-4 transition hover:text-ink-900 hover:decoration-ink-900";

/** A <details> summary that opens a panel of its own: a button, without the triangle. */
export const summaryButton =
  "inline-flex min-h-11 cursor-pointer list-none items-center gap-2 border border-ink-900/25 bg-paper-50 px-4 text-[15px] text-ink-800 transition hover:border-ink-900/50 hover:bg-paper-100 [&::-webkit-details-marker]:hidden";

export const btnDanger =
  "inline-flex min-h-11 items-center justify-center gap-2 border border-ember-700/50 bg-paper-50 px-4 text-[15px] text-ember-700 transition hover:bg-ember-500/10";

export const input =
  "min-h-11 w-full border border-ink-900/25 bg-white px-3 text-[16px] text-ink-900 placeholder:text-ink-500";

export const textarea =
  "w-full border border-ink-900/25 bg-white px-3 py-2.5 text-[16px] leading-relaxed text-ink-900 placeholder:text-ink-500";

export const label = "block text-[15px] font-semibold text-ink-900";

export const hint = "mt-1 text-[14px] leading-relaxed text-ink-600";

export const link = "text-leaf-700 underline underline-offset-2 hover:text-leaf-600";

export const card = "border border-ink-900/12 bg-white/60";

export const badge =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[14px] font-medium leading-6";
