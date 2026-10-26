import { TAIWAN_BOUNDS } from "@conservation/shared";
import { SITE_URL } from "@/lib/siteUrl";
import { routing } from "@/i18n/routing";

/**
 * What the site tells a search engine about itself, as schema.org.
 *
 * A search for the project's own name found nothing: no page said what the
 * site is called, who runs it, or that its records are a dataset at all. So
 * the home page states the site and the team (WebSite and Organization), the
 * attribution page states the data (Dataset, which is what Google's Dataset
 * Search reads), and each species page states its taxon (schema.org's Taxon,
 * as Bioschemas profiles it).
 *
 * Every value is something the page it is on already says to a reader, in
 * the page's language. Nothing here is a coordinate.
 */

const SCHEMA = "https://schema.org";

/** One node for the team, referred to by @id wherever it is the creator. */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

/** The page's address in its language: "/about" or "/en/about". */
export function localeUrl(locale: string, path: string): string {
  return locale === routing.defaultLocale
    ? `${SITE_URL}${path || "/"}`
    : `${SITE_URL}/${locale}${path}`;
}

/** schema.org's language codes are BCP 47, as the pages' lang attributes are. */
const inLanguage = (locale: string) => (locale === "en" ? "en" : "zh-Hant-TW");

/**
 * The team, as the site names it: the project's name in both languages. It is
 * a nonprofit team of high-school students (/about) and is credited as the
 * project, which is how every page credits it; no person is named, because
 * the team page names nobody yet (lib/team.ts).
 */
export function organizationLd(o: { name: string; alternateName: string }) {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: o.name,
    alternateName: o.alternateName,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/brand-badge.png`,
  };
}

/** The site itself, for the name a search result shows above its pages. */
export function websiteLd(o: {
  locale: string;
  name: string;
  alternateName: string;
  description: string;
}) {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: o.name,
    alternateName: o.alternateName,
    description: o.description,
    url: localeUrl(o.locale, ""),
    inLanguage: inLanguage(o.locale),
    publisher: { "@id": ORGANIZATION_ID },
  };
}

/** The home page's graph: the site and the team who publish it. */
export function homeGraph(o: Parameters<typeof websiteLd>[0]) {
  return {
    "@context": SCHEMA,
    "@graph": [
      organizationLd({ name: o.name, alternateName: o.alternateName }),
      websiteLd(o),
    ],
  };
}

/** Where /attribution's own links send a reader for TaiRON's records. */
export const TAIRON_GBIF_DATASET = "https://www.gbif.org/dataset/db09684b-0fd1-431e-b5fa-4c1532fbdb14";
const CC_BY_4 = "https://creativecommons.org/licenses/by/4.0/";
/**
 * The dedication the report form stores (CONTRIBUTOR_LICENSES in
 * packages/shared), without its /legalcode suffix, which is how schema.org's
 * examples name a licence. test/structured-data.test.mjs holds the two equal.
 */
const CC0 = "https://creativecommons.org/publicdomain/zero/1.0/";

/**
 * The records on the map, as one dataset, for /attribution.
 *
 * WHICH LICENCE, AND WHY TWO. The records are two collections under two
 * licences, and /attribution exists to keep them apart. The reports filed
 * here are CC0 (/terms, and CONTRIBUTOR_LICENSES, whose CC0 entry is the
 * same dedication) and are a part of their own. The imported records are
 * TaiRON's, under CC BY 4.0, which requires the credit; the dataset is based
 * on theirs and says so. The whole is CC BY 4.0 because it contains CC BY
 * records: labelling it CC0 would tell a reuser that TaiRON's records need no
 * credit, when /attribution says that credit is a condition of the licence.
 * On 26 October 2026 every one of the 46,305 public records was TaiRON's.
 *
 * `temporalCoverage` is the first and last day a public record was seen, on
 * Taiwan's calendar, from the same view /stats counts. Spatial coverage is
 * the box the site accepts reports in (TAIWAN_BOUNDS), Kinmen and Matsu
 * included, which is a fact about the site and not about any record.
 *
 * There is no `distribution`: nothing is offered for download yet
 * (/attribution's "Data produced here"), and a download link that does not
 * exist would be worse than none.
 */
export function datasetLd(o: {
  locale: string;
  name: string;
  description: string;
  ownPartName: string;
  ownPartDescription: string;
  taironName: string;
  taironCreator: string;
  siteName: string;
  siteAlternateName: string;
  place: string;
  firstDay: string | null;
  lastDay: string | null;
}) {
  const [[west, south], [east, north]] = TAIWAN_BOUNDS;
  const creator = {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: o.siteName,
    alternateName: o.siteAlternateName,
    url: `${SITE_URL}/`,
  };
  return {
    "@context": SCHEMA,
    "@type": "Dataset",
    name: o.name,
    description: o.description,
    url: localeUrl(o.locale, "/attribution"),
    inLanguage: inLanguage(o.locale),
    isAccessibleForFree: true,
    license: CC_BY_4,
    creator,
    publisher: { "@id": ORGANIZATION_ID },
    keywords: [
      "Taiwan",
      "roadkill",
      "invasive species",
      "wildlife",
      "biodiversity",
      "citizen science",
      "路殺",
      "外來入侵種",
      "野生動物",
    ],
    spatialCoverage: {
      "@type": "Place",
      name: o.place,
      geo: { "@type": "GeoShape", box: `${south} ${west} ${north} ${east}` },
    },
    ...(o.firstDay && o.lastDay ? { temporalCoverage: `${o.firstDay}/${o.lastDay}` } : {}),
    hasPart: {
      "@type": "Dataset",
      name: o.ownPartName,
      description: o.ownPartDescription,
      license: CC0,
      creator,
      isAccessibleForFree: true,
    },
    isBasedOn: {
      "@type": "Dataset",
      name: o.taironName,
      url: TAIRON_GBIF_DATASET,
      license: CC_BY_4,
      creator: { "@type": "Organization", name: o.taironCreator, url: "https://roadkill.tw" },
    },
  };
}

/**
 * A species, as schema.org's Taxon in the Bioschemas profile, for the
 * species page. TaiCOL is the source of every field and is linked as the
 * same thing; the Chinese and English names are the page's own.
 */
export function taxonLd(o: {
  url: string;
  scientificName: string;
  nameAuthor: string | null;
  rank: string | null;
  names: string[];
  genus: string | null;
  taicolId: string;
}) {
  const rank = o.rank?.toLowerCase() ?? null;
  // The rank directly above: a subspecies' species is the first two words of
  // its name, and a species' genus is TaiCOL's, or, where that column is
  // empty, the binomial's first word, which is the genus by definition.
  const parent =
    rank === "subspecies"
      ? { name: o.scientificName.split(/\s+/).slice(0, 2).join(" "), taxonRank: "species" }
      : rank === "species"
        ? { name: o.genus || o.scientificName.split(/\s+/)[0], taxonRank: "genus" }
        : null;
  return {
    "@context": SCHEMA,
    "@type": "Taxon",
    "http://purl.org/dc/terms/conformsTo": {
      "@id": "https://bioschemas.org/profiles/Taxon/1.0-RELEASE",
    },
    "@id": o.url,
    url: o.url,
    name: o.scientificName,
    ...(rank ? { taxonRank: rank } : {}),
    scientificName: {
      "@type": "TaxonName",
      name: o.scientificName,
      ...(o.nameAuthor ? { author: o.nameAuthor } : {}),
      ...(rank ? { taxonRank: rank } : {}),
    },
    ...(o.names.length ? { alternateName: o.names } : {}),
    ...(parent ? { parentTaxon: { "@type": "Taxon", ...parent } } : {}),
    sameAs: `https://taicol.tw/zh-hant/taxon/${o.taicolId}`,
  };
}
