import "server-only";

import { sql } from "@/lib/db";

/**
 * Whether a held report exists under this id, and nothing else about it.
 *
 * `/reports/{id}` reads `reports_public` as `web_anon`, which is the privacy
 * boundary for the whole site and stays exactly where it is. A held report is
 * absent from that view by design, so the page 404'd for every reporter whose
 * submission had not been published — which is most of them, and which made the
 * receipt they were handed a dead end.
 *
 * This is the one narrow read of the base table on a public route. It is here,
 * in a module of its own, so that the read is a single reviewable thing, and it
 * returns an enum rather than a row so that nothing downstream can render a
 * field nobody decided to disclose.
 *
 * WHAT A HOLDER OF AN ID LEARNS, AND WHY THAT IS SAFE
 *
 * Only that a report with that id exists and is not public. Never when it was
 * seen, where, what it was, who filed it, what they wrote or what they
 * photographed.
 *
 * The identifiers are random v4 UUIDs — 122 bits — so nobody guesses one, and
 * the only person handed one is the reporter, at the moment they submit.
 *
 * The state that matters is `pending`, and the reason it is safe to confirm is
 * an invariant of how a row reaches it. `pending` is only ever set at insert
 * (app/api/reports/route.ts), and the moderation actions move rows OUT of it
 * and never back in (admin/actions.ts publishes or rejects). A row that is
 * pending now has therefore been pending since it was written, and has never
 * appeared in `reports_public`, so its id has never been public either: there
 * is no one holding it but the person who filed it.
 *
 * That invariant is also why no other state answers. A record that was public
 * and is not any more — rejected by a moderator, or re-identified as a species
 * whose coordinates are never shown — has an id that anyone could have scraped
 * off the map while it was up. Confirming "this exists but is not public" for
 * such an id would tell a scraper that a specific record had been withdrawn,
 * which for the second case is a statement about the animal at a place they
 * already have. So those are indistinguishable from a UUID that was never
 * issued: both are absent here, and the page 404s for both.
 *
 * `rejected` is disclosed only to the reporter themselves, for the same reason
 * — anyone else asking gets the 404 a stranger gets for anything that is not
 * held.
 *
 * `source = 'user'` keeps the imported records out of it. There are 46,334 of
 * them and their ids travel with the open data; a receipt for one would answer
 * questions about someone else's dataset.
 */
export type ReceiptState =
  /** Received, never published, waiting on a person. */
  | "held"
  /** Decided against. Only ever returned to the reporter who filed it. */
  | "rejected";

export async function receiptState(
  id: string,
  viewerId: string | null,
): Promise<ReceiptState | null> {
  // Two columns, named. Not a row, not a star, and nothing that describes the
  // animal, the place or the person.
  const [row] = await sql<{ status: string; reporter_id: string | null }[]>`
    select status, reporter_id
      from reports
     where id = ${id}::uuid
       and source = 'user'`;

  if (!row) return null;
  if (row.status === "pending") return "held";
  if (row.status === "rejected" && viewerId && row.reporter_id === viewerId)
    return "rejected";
  return null;
}
