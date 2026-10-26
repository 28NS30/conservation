/**
 * Whether leaving the page now would drop a report that is being filled in.
 *
 * The report form registers itself here while it has entries, and code that
 * navigates without a link — the language switch, which calls router.replace
 * — asks before it goes. The form's own guard on links and on unloading the
 * page is in the form; this is for what it cannot see. The guard also saves
 * the draft there and then (lib/offline/drafts.ts), so what the reporter
 * typed in the last moment before leaving is not lost to a debounce.
 *
 * A module, not a context: the language switch sits in three headers that
 * share no provider with the form, and one form is on a page at a time.
 */
type Guard = () => boolean;

let current: Guard | null = null;

/** Register the page's form. Returns the way to stand it down. */
export function guardLeaving(guard: Guard): () => void {
  current = guard;
  return () => {
    if (current === guard) current = null;
  };
}

/** True when this page holds a report being filled in that has not been sent. */
export function wouldLoseEntries(): boolean {
  return current?.() ?? false;
}
