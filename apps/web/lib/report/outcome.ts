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
  title: "onMap" | "held" | "withheld";
  /** Key under `report.receipt` for the sentence below it, when there is one. */
  body:
    | "heldForIdentification"
    | "heldNoPhoto"
    | "heldForReview"
    | "withheldSpecies"
    | null;
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
export function receiptLinkFor(
  status: string | undefined | null,
  visible = true,
): ReceiptLink | null {
  // A published-but-withheld record has no page of either kind: it is absent
  // from `reports_public`, so the record page 404s, and `lib/receipt.ts`
  // answers for `pending` alone, so the receipt does not cover it either. That
  // is deliberate — see `withheld` below — and it means no link.
  if (status === "published") return visible ? "viewRecord" : null;
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
  /**
   * Whether the row actually reached `reports_public`. False for a report whose
   * species TaiCOL rates 座標不開放: the trigger stamps `suppressed` from the
   * taxon the reporter themselves chose, the view drops it, and the record is
   * then absent from the map, the list and every statistic while its stored
   * status still reads `published`. The API sends this rather than letting the
   * client infer it from a status that does not carry the fact.
   */
  visible = true,
): ReportOutcome {
  const link = receiptLinkFor(status, visible);

  if (status === "published") {
    // Published and shown.
    if (visible) return { title: "onMap", body: null, link };
    // Published and deliberately not shown. Saying "it's on the map" here would
    // be false, and saying "not public yet" would be worse — it implies a wait
    // that never ends. The reporter did nothing wrong and nothing is pending;
    // the animal they named is one whose coordinates this project never
    // publishes, which is a rule they can be told plainly.
    return { title: "withheld", body: "withheldSpecies", link };
  }

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
