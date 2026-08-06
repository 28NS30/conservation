/**
 * Turn a licence URL into something a human reads.
 *
 * `reports.license` holds whatever GBIF gave us, which is a legalcode URL —
 * "http://creativecommons.org/licenses/by/4.0/legalcode". Printed raw it is a
 * wall of URL in the middle of a sentence, and on the report page that is the
 * one line legally required to be there, so it should be legible.
 *
 * Returns null for an unrecognised or missing licence, so the caller decides
 * what to say instead — /attribution has a translated "unspecified", the report
 * page just omits the link.
 */
export function licenseLabel(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /licenses\/([a-z-]+)\/([0-9.]+)/.exec(url);
  // Anything not matching the CC URL shape is returned as-is rather than
  // guessed at: a wrong licence label is worse than an ugly one.
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : url;
}
