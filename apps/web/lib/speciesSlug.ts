/**
 * A species' address, in a module of its own so that client components can
 * build one: lib/species.ts holds the database reads, and importing it from
 * the browser would pull the database client in with it.
 */

/** URL slug: `32116-prionailurus-bengalensis`. Ids stay stable; humans get a hint. */
export function speciesSlug(s: { id: number; scientificName: string }): string {
  const name = s.scientificName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return name ? `${s.id}-${name}` : String(s.id);
}

/** Accepts `32116` or `32116-anything`; anything else is not a species id. */
export function parseSpeciesId(param: string): number | null {
  const m = /^(\d+)(?:-|$)/.exec(param);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
