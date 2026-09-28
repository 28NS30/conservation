/**
 * Report ids of ours that an imported record may carry.
 *
 * Once TaiRON agrees to take records from this site, a record filed here will
 * reach TaiRON with our report id attached, and TaiRON's GBIF dataset, which
 * scripts/import-gbif.ts reads, will hand it back to us as a TaiRON record. The
 * map would then show one animal twice, once as a person's report and once as
 * an import, and every count would double it.
 *
 * So before a GBIF record is inserted, any report id it carries is looked up
 * among our own reports, and a match is skipped. Our ids are UUIDs, and the
 * fields a publisher uses to point back at a source record are occurrenceID,
 * catalogNumber, otherCatalogNumbers and references (a link to the record's
 * page here). A UUID in any of them that is one of our `source = 'user'`
 * report ids can only be ours: a random UUID from elsewhere does not collide.
 *
 * Nothing is sent to TaiRON today, so this skips nothing yet. It is here so the
 * first export cannot start the loop.
 */

export type BackReferences = {
  occurrenceID?: string;
  catalogNumber?: string;
  /** GBIF gives this as a string with "|" between values, or as an array. */
  otherCatalogNumbers?: string | string[];
  references?: string;
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Every UUID in the fields that can point back at a source record, lower-cased, once each. */
export function ownReportIdCandidates(o: BackReferences): string[] {
  const other = Array.isArray(o.otherCatalogNumbers)
    ? o.otherCatalogNumbers.join(" ")
    : (o.otherCatalogNumbers ?? "");
  const text = [o.occurrenceID, o.catalogNumber, other, o.references]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  return [...new Set((text.match(UUID) ?? []).map((u) => u.toLowerCase()))];
}
