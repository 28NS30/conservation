import { notFound, redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getSpecies, speciesSlug } from "@/lib/species";

/**
 * `/species/32116`, sent on to `/species/32116-prionailurus-bengalensis`.
 *
 * A bare id reaches this page, not the species page, by a rewrite in
 * next.config.ts. The species page is cached (it has `revalidate`), and a
 * cached page that redirects is answered, on the render that fills the
 * cache, with its Location header twice: Next sets it while rendering and
 * then appends the cache entry's copy of it (Next 16.3 and 16.4). A browser
 * may forgive two identical Locations; fetch joins them into one address,
 * "/species/32116-…, /species/32116-…", and lands on a 404. A redirect
 * rendered per request has one, so the redirect is made here, per request,
 * and the cache holds only the pages themselves.
 *
 * Per request costs one indexed read of one taxon, for an address that only
 * old links, hand-typed ids and the tests still use.
 */
export const dynamic = "force-dynamic";

export default async function SpeciesById({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const taxonId = /^\d{1,15}$/.test(id) ? Number(id) : null;
  if (!taxonId) notFound();
  const s = await getSpecies(taxonId);
  if (!s) notFound();
  redirect(`/${locale}/species/${speciesSlug(s)}`.replace("/zh-TW/", "/"));
}
