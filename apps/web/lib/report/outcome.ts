/**
 * What the server's answer means for the person who just pressed send.
 *
 * `POST /api/reports` already returns `{ id, status, duplicate,
 * awaitingIdentification }`, and the form used to throw all of it away except
 * the id: it said "已發布至地圖" to everyone, and offered every reporter a link
 * to `/reports/{id}`. Most submissions are held — a report with no photo is
 * `pending` by design — so most reporters were told their report was on the map
 * when it was not, and then handed a link that 404'd, because that page reads
 * `reports_public` and a pending report is not in it.
 *
 * Deciding what to say is therefore a function of the server's answer and
 * nothing else, which is why it lives here rather than inside the form: the
 * queue banner and `/me` have to reach the same conclusion from the same
 * fields, and a rule that is written three times is a rule that will disagree
 * with itself.
 *
 * No duration appears anywhere in the outcomes. The old copy promised
 * identification "通常一兩分鐘 / usually a minute or two"; identification is a
 * daily cron that has never been deployed, so the honest answer about timing is
 * that there is no timetable, and the honest answer about who does it is a
 * person.
 */

/**
 * The link the reporter is offered, or `null` for no link at all.
 *
 * - `viewRecord` — the record is public; `/reports/{id}` renders it.
 * - `checkStatus` — the record is held; `/reports/{id}` renders the receipt.
 *
 * Both resolve to a real page, which is the whole point of the type: there is
 * no third case where we know an id and offer it without knowing that opening
 * it works.
 */
export type ReceiptLink = "viewRecord" | "checkStatus";

export type ReportOutcome = {
  /** Key under `report.receipt` for the heading. */
  title: "onMap" | "held";
  /** Key under `report.receipt` for the sentence below it, when there is one. */
  body: "heldForIdentification" | "heldNoPhoto" | "heldForReview" | null;
  link: ReceiptLink | null;
};

/**
 * Which receipt a stored status can be opened with.
 *
 * `published` rows are in `reports_public`, so the record page renders them.
 * `pending` rows are served the receipt state by `lib/receipt.ts`, which is
 * reachable for exactly that status and no other. Anything else — `rejected`, a
 * status this build has never heard of — gets no link, because there is nothing
 * behind it but a 404, and a 404 is what this whole module exists to stop
 * handing people.
 */
export function receiptLinkFor(status: string | undefined | null): ReceiptLink | null {
  if (status === "published") return "viewRecord";
  if (status === "pending") return "checkStatus";
  return null;
}

/**
 * `duplicate: true` needs no branch of its own: a repeat submission carries the
 * status of the row that already exists, which is the truth about where that
 * report stands, and saying "you already sent this" instead would be answering
 * a question nobody asked.
 */
export function outcomeOf(
  status: string | undefined | null,
  awaitingIdentification: boolean | undefined,
  photoCount: number,
): ReportOutcome {
  const link = receiptLinkFor(status);

  if (status === "published") return { title: "onMap", body: null, link };

  // Why it is held, in the reporter's terms. The two specific reasons are the
  // two the API itself can produce; the third covers a screening flag, whose
  // reason is deliberately not disclosed to the person who tripped it.
  const body = awaitingIdentification
    ? "heldForIdentification"
    : photoCount === 0
      ? "heldNoPhoto"
      : "heldForReview";

  return { title: "held", body, link };
}
