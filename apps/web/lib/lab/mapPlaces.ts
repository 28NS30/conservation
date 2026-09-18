/**
 * Four places to open the map at, copied from the live home page.
 *
 * Copied rather than imported because `app/[locale]/page.tsx` declares them as
 * a module constant and a page file may not export one — Next allows a page to
 * export only its default component and the handful of route segment options,
 * so `export const MAP_PLACES` there would fail the build. The list is four
 * lines and is checked by the live page's own test, so a copy is cheaper than
 * moving a live constant out of a live file, which the lab is forbidden to do.
 *
 * Each is a z11 view with public records in it, spread north, west, east and
 * south. They are not a ranking of anywhere.
 *
 * The keys are `home.places.*` in the live message catalogues, so the labels
 * are the ones the site already uses and a difference the owner sees between
 * this page and today's is a difference in the design, not in the words.
 */
export const LAB_MAP_PLACES = [
  { key: "yangmingshan", lng: 121.55, lat: 25.17 },
  { key: "taichung", lng: 120.68, lat: 24.15 },
  { key: "hualien", lng: 121.6, lat: 23.98 },
  { key: "kenting", lng: 120.8, lat: 21.95 },
] as const;

/** The zoom every place link opens at. */
export const LAB_MAP_PLACE_ZOOM = 11;

/**
 * A map URL for one of those views.
 *
 * `base` is whichever map this direction has — the lab's own once it is built,
 * today's until then — so the query is written in one place rather than at
 * every call site.
 */
export function mapPlaceHref(
  base: string,
  place: { lng: number; lat: number },
): string {
  return `${base}?lng=${place.lng}&lat=${place.lat}&z=${LAB_MAP_PLACE_ZOOM}`;
}

/** The same map, filtered to one species. */
export function mapSpeciesHref(base: string, taxonId: number): string {
  return `${base}?taxonId=${taxonId}`;
}
