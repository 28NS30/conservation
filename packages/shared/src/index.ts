import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Report categories
 * ------------------------------------------------------------------ */

/**
 * Report categories.
 *
 * Domain data only — no display text. Labels live in apps/web/messages/*.json
 * keyed by these same names, so adding a locale never means touching this file.
 */
export const CATEGORIES = {
  /** `classifiable`: whether a photo of this category is sent to the species classifier. */
  roadkill: { classifiable: true, color: "#e11d48" },
  invasive: { classifiable: true, color: "#f59e0b" },
  injured: { classifiable: true, color: "#fb923c" },
  sighting: { classifiable: true, color: "#10b981" },
} as const;

/*
 * `pollution` and `habitat` were retired in September 2026 at the team's
 * request. Neither category ever held a single report, so nothing was migrated
 * or lost. The four that remain are what is STORED; what a reporter is offered
 * is the three groups below.
 *
 * They were also the only two non-classifiable categories, which is why
 * requiresClassification() below now turns entirely on whether a photo was
 * attached.
 */

/**
 * Which animals a report page's species picker offers, as data rather than SQL.
 *
 * Both the picker's search and `POST /api/reports` read it, and they have to
 * agree: a picker that offered a species the server then refused would strand
 * a reporter at the roadside, and a server that accepted one the picker never
 * offered would let a hand-built request file a native animal as an invasive
 * one — which is how request 6 was being violated before the pages were split
 * (a "search all species" button on the invasive list, and nothing checking
 * what came back). `apps/web/lib/species.ts` turns this into a WHERE clause.
 *
 * Animals only, on every page. TaiCOL also tags 55 plants invasive, and whether
 * the invasive page should take them is the team's question (Q1); until they
 * answer, a plant is not something any of the three pages is for.
 */
export type SpeciesScope = {
  kingdom: "Animalia";
  /** Only taxa TaiCOL tags invasive (`taxa.is_invasive`). */
  invasiveOnly: boolean;
};

/**
 * The three report pages, what each may store, and which species each offers.
 *
 * The team asked for three separate pages rather than one form that opens by
 * asking which of three kinds of report this is (requests 3 and 9). The page
 * is therefore the report's kind, and it decides the stored category: the
 * invasive page files `invasive`, the wildlife page files `sighting`, and the
 * roadkill page files `roadkill` or `injured` by the one question it asks —
 * dead, or alive and hurt — because an injured animal implies someone should
 * respond and a dead one does not, a distinction worth keeping in the data.
 *
 * `sighting` keeps its stored name although the page is called "wildlife":
 * renaming a stored value means migrating the CHECK constraint (0008), the
 * classifier's label sets and every map colour for no change in meaning.
 *
 * The server holds each submission to its page (`app/api/reports/route.ts`):
 * a category the page cannot produce and a species the page does not offer
 * are both refused, so a request built by hand cannot file what the page
 * would not have let a person file.
 */
export const REPORT_PAGES = {
  roadkill: {
    categories: ["roadkill", "injured"],
    species: { kingdom: "Animalia", invasiveOnly: false },
  },
  invasive: {
    categories: ["invasive"],
    species: { kingdom: "Animalia", invasiveOnly: true },
  },
  wildlife: {
    categories: ["sighting"],
    species: { kingdom: "Animalia", invasiveOnly: false },
  },
} as const satisfies Record<
  string,
  { categories: readonly Category[]; species: SpeciesScope }
>;

export type ReportPage = keyof typeof REPORT_PAGES;

/**
 * In the team's order, which is the home page's and the header menu's:
 * roadkill, invasive, wildlife. Spelled out rather than taken from
 * Object.keys so that reordering the object above cannot reorder the site.
 */
export const REPORT_PAGE_KEYS = [
  "roadkill",
  "invasive",
  "wildlife",
] as const satisfies readonly ReportPage[];

export function isReportPage(v: unknown): v is ReportPage {
  return (
    typeof v === "string" && (REPORT_PAGE_KEYS as readonly string[]).includes(v)
  );
}

/** Whether a page can produce a stored category. */
export function pageAllows(page: ReportPage, category: Category): boolean {
  return (REPORT_PAGES[page].categories as readonly Category[]).includes(
    category,
  );
}

/**
 * The page a stored category is filed from.
 *
 * Every category belongs to exactly one page, which the shared test asserts.
 * This is how a submission that does not say which page it came from — a
 * report queued offline by a build from before the pages were split, or a
 * client that has not caught up — is held to the right page's rules.
 */
export function pageOf(category: Category): ReportPage {
  const found = REPORT_PAGE_KEYS.find((p) => pageAllows(p, category));
  // Unreachable while REPORT_PAGES covers CATEGORY_KEYS. Roadkill is the page
  // with the fewest consequences for a wrong guess: it offers every animal,
  // and it blurs nothing less than any other page would.
  return found ?? "roadkill";
}

/**
 * Where an old `/report?category=` link now goes, or `null` for a value that
 * never named a category.
 *
 * `?category=injured` goes to the roadkill page and pre-answers nothing: the
 * dead-or-hurt question has no default, because a silent default on
 * condition is how injured animals were filed as dead ones.
 */
export function legacyReportPage(
  category: string | null | undefined,
): ReportPage | null {
  if (!category || !(CATEGORY_KEYS as readonly string[]).includes(category))
    return null;
  return pageOf(category as Category);
}

/**
 * The map's three buckets, which are the three pages under their older names.
 *
 * Kept, and derived rather than written out again: the map, the list and the
 * tile endpoint filter by these (`?group=`), and if the buckets and the pages
 * could drift apart the map would filter for something no page can produce.
 * The keys keep their order, which is the order the map's toggles are drawn
 * in, and `sighting` keeps its name because it is in URLs people have shared.
 */
export const REPORT_GROUPS = {
  invasive: { categories: REPORT_PAGES.invasive.categories },
  sighting: { categories: REPORT_PAGES.wildlife.categories },
  roadkill: { categories: REPORT_PAGES.roadkill.categories },
} as const satisfies Record<string, { categories: readonly Category[] }>;

export type ReportGroup = keyof typeof REPORT_GROUPS;
export const REPORT_GROUP_KEYS = Object.keys(REPORT_GROUPS) as ReportGroup[];

/** The stored categories a group covers. */
export function categoriesIn(group: ReportGroup): readonly Category[] {
  return REPORT_GROUPS[group].categories;
}

/** The group a stored category belongs to. */
export function groupOf(category: Category): ReportGroup {
  const found = REPORT_GROUP_KEYS.find((g) =>
    (REPORT_GROUPS[g].categories as readonly Category[]).includes(category),
  );
  // Unreachable while REPORT_GROUPS covers CATEGORY_KEYS, which the shared
  // test asserts — but a category added without a group would otherwise
  // silently vanish from the form.
  return found ?? "roadkill";
}

export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];
export const CLASSIFIABLE_CATEGORIES = CATEGORY_KEYS.filter(
  (c) => CATEGORIES[c].classifiable,
);

/* ------------------------------------------------------------------ *
 * Geography
 * ------------------------------------------------------------------ */

/**
 * Bounds covering Taiwan *including* the outlying islands. Kinmen and Matsu sit
 * far west near Fujian (down to ~118.1E, up to ~26.4N), well outside the main
 * island's envelope — a map clipped to the main island alone cuts them off.
 */
export const TAIWAN_BOUNDS: [[number, number], [number, number]] = [
  [118.0, 21.5],
  [122.5, 26.5],
];

/**
 * The main island alone, for FRAMING a map — never for validating a coordinate.
 *
 * TAIWAN_BOUNDS reaches to 118.0E to include Kinmen and Matsu, which sit against
 * the Fujian coast. Framing to that envelope therefore always puts a large piece
 * of mainland China on screen, which is not what this map is about. Fitting to
 * the main island instead pushes the mainland out of frame at every viewport
 * size, and the outlying islands remain reachable by panning.
 */
export const TAIWAN_MAIN_BOUNDS: [[number, number], [number, number]] = [
  [119.9, 21.7],
  [122.2, 25.4],
];

/**
 * Where report tiles can have anything in them, as [west, south, east, north].
 *
 * Handed to MapLibre as a vector source's `bounds`, so it never requests a tile
 * that cannot contain a report. At the default desktop view a third of the
 * first tiles requested were open sea or Fujian: empty answers, each a function
 * call on a cold CDN.
 *
 * TAIWAN_BOUNDS padded by 0.5°, which is the largest obscuring cell — a record
 * of a 重度/縣市 species is published up to half a degree from where it was
 * recorded, so its public point can sit outside the island's own envelope. This
 * margin must never shrink below the largest cell precision_cell_deg() returns;
 * a test checks every published point falls inside it.
 */
export const TILE_SOURCE_BOUNDS: [number, number, number, number] = [
  TAIWAN_BOUNDS[0][0] - 0.5,
  TAIWAN_BOUNDS[0][1] - 0.5,
  TAIWAN_BOUNDS[1][0] + 0.5,
  TAIWAN_BOUNDS[1][1] + 0.5,
];

/** Main island centre, a sensible default view. */
export const TAIWAN_CENTER: [number, number] = [120.98, 23.7];

export function isInTaiwanBounds(lng: number, lat: number): boolean {
  const [[w, s], [e, n]] = TAIWAN_BOUNDS;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

/* ------------------------------------------------------------------ *
 * Taxa
 * ------------------------------------------------------------------ */

/**
 * Which of the four habitat flags are KNOWN, as distinct from known-false.
 *
 * 3,338 Taiwan species have all four columns NULL, and filtering on
 * truthiness made "we have no habitat data" and "it lives in none of these"
 * render identically. They are different claims and only one is worth printing.
 *
 * Lives here rather than in the web app's `lib/species.ts` because the map's
 * report panel is a client component: importing it from there pulled `lib/db`,
 * and so the Postgres driver, into the browser bundle, and the map page stopped
 * building.
 */
export function habitatKnown(s: {
  isTerrestrial: boolean | null;
  isFreshwater: boolean | null;
  isBrackish: boolean | null;
  isMarine: boolean | null;
}): boolean {
  return [s.isTerrestrial, s.isFreshwater, s.isBrackish, s.isMarine].some(
    (v) => v !== null,
  );
}

/* ------------------------------------------------------------------ *
 * Location disclosure
 * ------------------------------------------------------------------ */

/**
 * Mirrors reports.location_precision. Driven by TaiCOL's per-taxon sensitivity
 * rating (敏感度); see sensitivity_cell_deg() in 0001_init.sql.
 */
export const LOCATION_PRECISION = {
  exact: { approxKm: 0 },
  coarse_10km: { approxKm: 10 },
  coarse_50km: { approxKm: 50 },
  suppressed: { approxKm: Infinity },
} as const;

export type LocationPrecision = keyof typeof LOCATION_PRECISION;

/* ------------------------------------------------------------------ *
 * Collections — the three "databases" a visitor browses
 * ------------------------------------------------------------------ */

/**
 * Roadkill, wildlife sightings and invasive species: the three databases the
 * team asked for, as three filters over the one table of records.
 *
 * They overlap, and have to. The team's wildlife database holds every animal
 * "with the invasive ones marked", and its invasive database holds only species
 * tagged invasive — so a live 綠鬣蜥 belongs to both, and a road-killed myna to
 * roadkill and invasive at once. Three stores would mean writing such a record
 * two or three times and keeping a copy of the location-blur rules beside each.
 *
 * Each collection is two conditions, both of which must hold:
 *
 *  - `categories`: which stored categories it draws from, or `null` for any.
 *    The category is the page the report was filed on, fixed at submission —
 *    dead or injured on the roadkill page, alive on the other two.
 *  - `invasiveOnly`: whether the record must be in the invasive collection as
 *    `reports_public.is_invasive` defines it (0016): the species is an animal
 *    TaiCOL tags invasive, or nobody named the species and it was filed as
 *    invasive. Read from the species at query time, never typed by the
 *    reporter and never stored on the report.
 *
 * So `wildlife` takes `invasive` as well as `sighting`: a report filed on the
 * invasive page is still a live animal. And `invasive` takes any category: a
 * dead invasive animal is still an invasive record (the team's default for Q3),
 * which is why it offers the alive/dead split below.
 *
 * The order is the team's, as on the home page and in the header.
 */
export type CollectionDef = {
  categories: readonly Category[] | null;
  invasiveOnly: boolean;
};

export const COLLECTIONS = {
  roadkill: { categories: ["roadkill", "injured"], invasiveOnly: false },
  invasive: { categories: null, invasiveOnly: true },
  wildlife: { categories: ["sighting", "invasive"], invasiveOnly: false },
} as const satisfies Record<string, CollectionDef>;

export type Collection = keyof typeof COLLECTIONS;
export const COLLECTION_KEYS = Object.keys(COLLECTIONS) as Collection[];

/**
 * Seen alive, or found dead or injured: the split the invasive collection
 * offers, because it is the one collection holding both.
 *
 * Read off the category, the page a report was filed on. `dead` covers the
 * roadkill page's two categories, so it means "dead or injured" and is labelled
 * that way; an injured animal is alive, but it is not a sighting.
 */
export const RECORD_CONDITIONS = {
  alive: { categories: ["sighting", "invasive"] },
  dead: { categories: ["roadkill", "injured"] },
} as const satisfies Record<string, { categories: readonly Category[] }>;

export type RecordCondition = keyof typeof RECORD_CONDITIONS;
export const RECORD_CONDITION_KEYS = Object.keys(
  RECORD_CONDITIONS,
) as RecordCondition[];

/** What a query must match for a collection, narrowed by a condition. */
export type Selection = {
  /** Stored categories to accept, or null for every one. */
  categories: Category[] | null;
  /** Accept only records whose `is_invasive` is true. */
  invasiveOnly: boolean;
};

/**
 * The one reading of a collection filter, for every query that applies one.
 *
 * The tiles, the list, the hub pages and /stats all ask this rather than
 * spelling a collection out in SQL of their own, so the map and the list
 * cannot disagree about what "wildlife" contains. Each query applies it as
 *
 *   (categories is null or category = any(categories))
 *   and (not invasiveOnly or is_invasive)
 */
export function selectionFor(f: {
  collection?: Collection;
  condition?: RecordCondition;
}): Selection {
  const def: CollectionDef | null = f.collection
    ? COLLECTIONS[f.collection]
    : null;
  let categories: Category[] | null = def?.categories
    ? [...def.categories]
    : null;
  if (f.condition) {
    const want: readonly Category[] = RECORD_CONDITIONS[f.condition].categories;
    categories = categories
      ? categories.filter((c) => want.includes(c))
      : [...want];
  }
  return { categories, invasiveOnly: def?.invasiveOnly ?? false };
}

/**
 * The colour a record takes on the map when it is coloured by type.
 *
 * Not the collections, which overlap: a colour needs every record in exactly
 * one class. Condition first, as it always was — dead or injured is `roadkill`
 * whatever the species — and then the species decides between the two live
 * classes, so a live invasive animal is marked as invasive whichever page it
 * was filed on. Filed as `sighting` it used to be drawn as a native sighting.
 *
 * The colours are the categories' own, so a cell and the points it breaks into
 * agree about what orange means.
 */
export const MAP_TYPES = {
  roadkill: { color: CATEGORIES.roadkill.color },
  invasive: { color: CATEGORIES.invasive.color },
  wildlife: { color: CATEGORIES.sighting.color },
} as const;

export type MapType = keyof typeof MAP_TYPES;
export const MAP_TYPE_KEYS = Object.keys(MAP_TYPES) as MapType[];

/**
 * What an old `group=` link meant, as a collection.
 *
 * `group` took the report form's three buttons and matched stored categories
 * only. Links carrying it are out in the world — shared maps, bookmarks — so
 * the pages still read it; the tile endpoint refuses it (see the tile route
 * for why). `sighting` is the wildlife collection's old name.
 */
export const LEGACY_GROUP_COLLECTION: Record<ReportGroup, Collection> = {
  roadkill: "roadkill",
  sighting: "wildlife",
  invasive: "invasive",
};

/* ------------------------------------------------------------------ *
 * Map filters — the shape shared by the UI and the tile endpoint
 * ------------------------------------------------------------------ */

export const mapFilterSchema = z
  .object({
    /** One of the three collections above, or absent for every record. */
    collection: z
      .enum(COLLECTION_KEYS as [Collection, ...Collection[]])
      .optional(),
    /**
     * Alive, or dead or injured — offered only within the invasive
     * collection. The other two are one condition each by definition, so a
     * condition there is either redundant or always empty, and every
     * redundant spelling of one filter is another CDN key for the same tiles.
     */
    condition: z
      .enum(RECORD_CONDITION_KEYS as [RecordCondition, ...RecordCondition[]])
      .optional(),
    taxonId: z.coerce.number().int().positive().optional(),
    // Years Postgres can read and the data could hold: z.iso.date() accepts
    // 0000-01-01, which Postgres rejects, so every tile and the list 500'd.
    from: z.iso.date().refine((d) => d >= "1900-01-01" && d <= "2100-12-31").optional(),
    to: z.iso.date().refine((d) => d >= "1900-01-01" && d <= "2100-12-31").optional(),
  })
  .refine((f) => !f.condition || f.collection === "invasive", {
    message: "condition applies only to the invasive collection",
    path: ["condition"],
  });

export type MapFilter = z.infer<typeof mapFilterSchema>;

/** Serialise filters into a query string. This doubles as the CDN cache key. */
export function filterToQuery(f: MapFilter): string {
  const p = new URLSearchParams();
  if (f.collection) p.set("collection", f.collection);
  if (f.condition) p.set("condition", f.condition);
  if (f.taxonId) p.set("taxonId", String(f.taxonId));
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  return p.toString();
}

/**
 * A page's filter from its query string, reading old `group=` links too.
 *
 * For /map and /reports only, never for tiles. A link that says `group=` and
 * not `collection=` is read as the collection it meant; a link carrying both
 * is read by `collection`, the newer word. Anything malformed gives no filter,
 * as it always has: a mistyped link opens the whole map, not an error.
 */
export function pageFilter(
  sp: Record<string, string | string[] | undefined>,
): MapFilter {
  const raw: Record<string, unknown> = { ...sp };
  const group = raw.group;
  delete raw.group;
  if (
    raw.collection === undefined &&
    typeof group === "string" &&
    Object.hasOwn(LEGACY_GROUP_COLLECTION, group)
  ) {
    raw.collection = LEGACY_GROUP_COLLECTION[group as ReportGroup];
  }
  // A condition outside the invasive collection is dropped rather than
  // taking the whole filter down with it: the collection a link named is
  // still what the reader asked to see.
  if (raw.collection !== "invasive") delete raw.condition;
  const parsed = mapFilterSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/* ------------------------------------------------------------------ *
 * Report submission
 * ------------------------------------------------------------------ */

export const MAX_PHOTOS = 4;
export const MAX_NOTES = 1000;
/** Post-downscale ceiling. Phone originals are 3–8 MB; we send ~250 KB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = [
  "image/webp",
  "image/jpeg",
  "image/png",
] as const;

export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/**
 * The file extension a stored photo should carry, from what it actually is.
 *
 * `/api/uploads/sign` used to end every key `.webp` because the web client
 * always re-encodes to WebP through a canvas, so the name and the bytes
 * agreed. They stop agreeing the moment anything else uploads: on iOS,
 * `expo-image-manipulator` cannot write WebP at all — it is Android-only —
 * so an iOS photo would arrive as JPEG bytes at a `.webp` key.
 *
 * Nothing serves from the extension today; Supabase returns the content type
 * recorded at upload, and `/api/reports` validates that against
 * ACCEPTED_IMAGE_TYPES rather than trusting the name. So the mismatch would
 * not have broken a page. It would have made every object in the bucket lie
 * about its contents, to the export, to a backup, and to whoever opens one.
 */
export function imageExtension(contentType: string): string {
  const known: Record<string, string> = {
    "image/webp": "webp",
    "image/jpeg": "jpg",
    "image/png": "png",
  };
  return known[contentType] ?? "bin";
}

/** Whether a string is one of the image types this project accepts. */
export function isAcceptedImageType(v: unknown): v is AcceptedImageType {
  return (
    typeof v === "string" &&
    (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(v)
  );
}

/** Longest edge after client-side downscale, before upload. */
export const IMAGE_MAX_EDGE = 2048;
export const IMAGE_WEBP_QUALITY = 0.82;

/* ------------------------------------------------------------------ *
 * Contributor terms
 * ------------------------------------------------------------------ */

/**
 * The version of /terms a report is filed under, stored with it. A change to
 * the terms applies to reports filed after it, never to ones filed before, so
 * each report has to say which it agreed to.
 */
export const CONSENT_VERSION = "2026-09-29";

/**
 * The licences a reporter may choose, and the legalcode URL stored for each in
 * `reports.license` (the shape GBIF's imports already use, which
 * apps/web/lib/license.ts turns into a label). CC BY 4.0 is the form's default;
 * CC0 gives up the credit. Nothing else: a licence we cannot export to GBIF
 * is one the record cannot travel under.
 */
export const CONTRIBUTOR_LICENSES = {
  "cc-by-4.0": "https://creativecommons.org/licenses/by/4.0/legalcode",
  "cc0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/legalcode",
} as const;
export type ContributorLicense = keyof typeof CONTRIBUTOR_LICENSES;
export const CONTRIBUTOR_LICENSE_KEYS = Object.keys(CONTRIBUTOR_LICENSES) as ContributorLicense[];

/** How long the name a reporter is credited by may be. */
export const MAX_CREDIT_NAME = 60;

/**
 * Which pages offer to share a record with research partners. TaiRON records
 * deaths on and near roads; a live sighting or an invasive report is outside
 * what it takes, so only the roadkill page asks.
 */
export const PARTNER_SHARING_PAGES: readonly ReportPage[] = ["roadkill"];

/**
 * The rules on fields a person types, shared by the form and the server.
 *
 * The form used to check none of them, so a slip the server refused — an
 * address with no domain ending, a handle beginning with @, a time in the
 * future — came back online as one generic sentence at the bottom of the form,
 * and a report saved on the phone failed in the queue, where it cannot be
 * edited (security audit, 29 September 2026). Checked on both sides from one
 * definition, they cannot disagree.
 */
export const contactEmailSchema = z.email();
export const creditNameSchema = z
  .string()
  .trim()
  .max(MAX_CREDIT_NAME)
  .refine((v) => !v.includes("@"), { message: "a credit name is not an email address" });
/** Clock drift allowed on observedAt, and the earliest date it may name. */
export const OBSERVED_AT_SLACK_MS = 5 * 60_000;
export const OBSERVED_AT_EARLIEST = "1990-01-01";
/** Beyond this the device's accuracy says nothing a null does not (CHECK in 0010). */
export const MAX_ACCURACY_M = 100_000;

export const reportSubmissionSchema = z
  .object({
    category: z.enum(CATEGORY_KEYS as [Category, ...Category[]]),
    /**
     * The page the report was filed on. Optional so that a report queued
     * offline by an older build still sends; the server then takes the page
     * the category belongs to (`pageOf`). When it is given, the category and
     * the species are both held to it.
     */
    page: z.enum(REPORT_PAGE_KEYS).optional(),
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    observedAt: z.iso.datetime(),
    /**
     * The radius the device claimed for its fix, in metres.
     *
     * Only ever sent when the coordinate came from `navigator.geolocation`. The
     * upper bound matches the CHECK in 0010: beyond it the number says nothing a
     * null does not.
     */
    accuracyM: z.coerce.number().int().min(0).max(MAX_ACCURACY_M).optional(),
    /**
     * What the reporter says it is. Consequential: naming a species is what
     * sets the published location precision, because the trigger derives the
     * blur from that taxon's TaiCOL sensitivity rating. That is the standing
     * decision — trust the reporter — and a protected species named honestly
     * still blurs automatically.
     */
    taxonId: z.coerce.number().int().positive().optional(),
    /**
     * The reporter looked and could not name it. Recorded as a judgement rather
     * than as an absence, which is what separates it from a report nobody has
     * examined yet. Mutually exclusive with `taxonId`.
     */
    taxonUnknown: z.boolean().optional(),
    notes: z.string().trim().max(MAX_NOTES).optional(),
    /** Optional, so we can follow up on an interesting record. Never displayed. */
    contactEmail: contactEmailSchema.optional(),
    /** Storage paths returned by /api/uploads/sign, already uploaded by the client. */
    photoPaths: z
      .array(z.string().min(1))
      .max(MAX_PHOTOS)
      .refine((paths) => new Set(paths).size === paths.length, { message: "a photo is named twice" })
      .default([]),
    /** Client-generated, so a double-tap or offline retry cannot duplicate a report. */
    clientNonce: z.uuid(),
    turnstileToken: z.string().min(1).optional(),
    /**
     * The contributor terms, answered per report (/terms). Optional so that a
     * report queued offline by a build from before the terms still sends; it
     * is then stored with no licence, and nothing exports it under one.
     */
    license: z.enum(CONTRIBUTOR_LICENSE_KEYS as [ContributorLicense, ...ContributorLicense[]]).optional(),
    /** The name to credit, a nickname by preference. Never an email address. */
    creditName: creditNameSchema.optional(),
    /** Share with research partners (TaiRON), exact location included. Starts unticked. */
    sharePartners: z.boolean().optional(),
    consentVersion: z.string().max(20).optional(),
    /**
     * A moderator trying the whole path (migration 0018). The report takes
     * every step a real one takes and is never shown publicly. The server
     * reads the sender's role from the database and refuses anyone else.
     */
    test: z.boolean().optional(),
    /**
     * Who was signed in when a report was saved on the phone: an account id,
     * or "anonymous". The server files it under that and nobody else. Absent
     * from a report sent straight from the form, which is filed under the
     * session that sends it.
     */
    filedBy: z.union([z.uuid(), z.literal("anonymous")]).optional(),
  })
  .refine((r) => !(r.taxonId && r.taxonUnknown), {
    message: "a report cannot both name a species and be unidentifiable",
    path: ["taxonUnknown"],
  })
  .refine((r) => new Date(r.observedAt) <= new Date(Date.now() + OBSERVED_AT_SLACK_MS), {
    message: "observedAt cannot be in the future",
    path: ["observedAt"],
  })
  .refine((r) => new Date(r.observedAt) >= new Date(OBSERVED_AT_EARLIEST), {
    message: "observedAt is implausibly old",
    path: ["observedAt"],
  });

export type ReportSubmission = z.infer<typeof reportSubmissionSchema>;

/**
 * Whether a submission should be held back from the public map until the
 * classifier has run.
 *
 * A classifiable report has no taxon at submission time, so its sensitivity is
 * unknown — publishing immediately would expose a protected species' exact
 * coordinate until classification caught up. See 0003_reporting.sql.
 */
export function requiresClassification(
  category: Category,
  photoCount: number,
): boolean {
  return CATEGORIES[category].classifiable && photoCount > 0;
}

/**
 * Precision applied to a report whose species is not yet known. Deliberately
 * conservative: it is the same protection a 輕度-rated taxon receives, and the
 * trigger will tighten it further if classification reveals something rarer.
 */
export const UNIDENTIFIED_PRECISION: LocationPrecision = "coarse_10km";


/* ------------------------------------------------------------------ *
 * Tile strategy
 * ------------------------------------------------------------------ */

/**
 * At or below this zoom the tile endpoint returns grid-aggregated cells carrying
 * a `weight`; above it, individual points. Shipping ~50k raw points at country
 * zoom is what makes naive density maps collapse.
 *
 * Set to 13. The handover was once at 10, and the measurement that fixed it
 * there is kept because it still describes the shape of the problem: on the
 * densest z10 tile, 4,984 reports collapse to 2,067 cells, and serving those
 * 4,984 as raw points instead put them roughly 7px apart in a 512px tile —
 * which at a 2.5px radius renders as one solid mass rather than points you can
 * pick out. Every further level quarters the ground one tile covers, so by 13
 * the same reports are spread over sixty-odd tiles and individual records are
 * separable.
 *
 * Nothing should repeat the number. The point layer's minzoom, the point
 * source's minzoom, the zoom hint and the legend's regime are all derived from
 * this constant, because a hardcoded copy agrees with it right up until the day
 * it does not, and the disagreement is invisible: the map simply describes the
 * regime it is not in.
 */
export const TILE_AGGREGATION_MAX_ZOOM = 13;

/**
 * Class breaks for the binned density map.
 *
 * The map draws aggregation cells as discrete filled squares, not as a heatmap.
 * That was a deliberate replacement: MapLibre's `heatmap` layer is a kernel
 * density estimate — every point becomes a Gaussian blob and the blobs are
 * summed — so blur is inherent to the layer type, not a setting. No combination
 * of radius and weight makes it sharp.
 *
 * Discrete classes also end a maintenance problem. A continuous kernel sum has
 * to be re-fitted whenever the dataset grows, because the density at a pixel
 * depends on how many neighbouring kernels overlap it. An absolute per-cell
 * count does not: "this cell holds 30–99 reports" means the same thing at 46k
 * records as at 460k.
 *
 * Breaks are round numbers on a roughly logarithmic scale, chosen against the
 * measured distribution (median cell 3 reports, p90 20, p99 129, max 1,321) so
 * every class is populated and the legend is readable by a non-specialist.
 *
 * Both the paint expression and the legend are generated from this one array, so
 * they cannot drift apart.
 */
export const DENSITY_CLASSES = [
  // The lowest class is deliberately dark and low-contrast. Most cells in the
  // country hold one or two reports, so a bright colour here turns the map into
  // blue noise and buries the structure — compared side by side, dimming this
  // one class is what lets the road corridors and the empty mountain spine read.
  { min: 1, color: "#1e3a5f" },
  { min: 3, color: "#1d4ed8" },
  { min: 10, color: "#0891b2" },
  { min: 30, color: "#10b981" },
  { min: 100, color: "#f59e0b" },
  { min: 300, color: "#dc2626" },
] as const;

/**
 * Breaks for a single-species map.
 *
 * A species map needs its own scale. Even the most-reported species holds a few
 * thousand records against the corpus's 46k, so most of its cells contain one or
 * two — run through DENSITY_CLASSES nearly every cell would fall into the lowest,
 * deliberately-dim class and the map would read as empty. These breaks are
 * compressed accordingly, and the lowest class is bright rather than dim, because
 * here a single record is a signal rather than background.
 */
export const SPECIES_DENSITY_CLASSES = [
  { min: 1, color: "#1d4ed8" },
  { min: 2, color: "#0891b2" },
  { min: 5, color: "#10b981" },
  { min: 15, color: "#eab308" },
  // #dc2626 rather than the orange this used to be. Simulated for dichromacy,
  // yellow-vs-orange was the one pair in either ramp that came close to
  // collapsing: ΔE 13.2 under deuteranopia, against a ~12 legibility floor, on
  // the two classes that mean "common here" and "hotspot". Red separates them at
  // 33.7, and matches the top class of DENSITY_CLASSES, so both maps agree on
  // what the most intense colour means.
  { min: 40, color: "#dc2626" },
] as const;

/** Inclusive upper bound of a class, or null for the open-ended top class. */
export function densityClassMax(
  i: number,
  classes: readonly { min: number }[] = DENSITY_CLASSES,
): number | null {
  const next = classes[i + 1];
  return next ? next.min - 1 : null;
}

/** Build a MapLibre `step` expression from a class array. */
export function densityStepExpression(
  classes: readonly { min: number; color: string }[],
): unknown[] {
  return [
    "step",
    ["coalesce", ["get", "weight"], 1],
    classes[0].color,
    ...classes.slice(1).flatMap((c) => [c.min, c.color]),
  ];
}

/**
 * Grid cell size in Web Mercator metres for aggregated tiles.
 *
 * 128 cells across a tile. Since MapLibre renders vector tiles at 512 CSS px,
 * this is the one number that decides how big a cell looks on screen — 512/128 =
 * **4 px, at every zoom**, because the cell size scales with the zoom level.
 *
 * That figure is chosen for legibility, not for blending. The previous value of
 * 256 dates from when these cells were fed through a heatmap kernel, where small
 * cells were desirable because they had to melt into each other. Drawn as
 * discrete squares they must instead be individually visible, and 2 px is at the
 * limit of what reads as a shape; compared side by side, 4 px is legible and 2 px
 * is noise.
 *
 * Still a large reduction: a z6 tile over Taiwan carries ~1,600 cells rather than
 * ~46,000 raw points.
 */
export const AGGREGATION_CELLS_PER_TILE = 128;

export function aggregationCellMeters(zoom: number): number {
  // Web Mercator world is ~40,075,016m across; a tile at zoom z spans
  // 40075016 / 2^z metres.
  return 40075016.686 / Math.pow(2, zoom) / AGGREGATION_CELLS_PER_TILE;
}

/**
 * The stored category, computed from two answers a person can actually give.
 *
 * This function is the whole argument for the redesign, so it lives in
 * `shared` rather than inside a form: the submission path, the offline queue,
 * the confirm actions and the lab prototype all have to agree about what a
 * record is, and an agreement kept in four places is not one.
 *
 * Today the form opens by asking which of three report types this is, and the
 * answer decides `category` directly. That question cannot be answered well: a
 * reporter standing over a dead animal has to work out whether the site files
 * it under "roadkill or injured" or "invasive species", and the form has a
 * silent default that files anything unanswered as roadkill — which is how
 * injured animals end up in the dataset as dead ones. `category` is a
 * database column pretending to be a question.
 *
 * So the flow stops asking. It asks what a person at the roadside knows: what
 * condition the animal was in, and what animal it was. Category falls out.
 * Condition wins over species, always — a dead invasive is roadkill, because
 * "something was killed on this road" is what the record is for and an
 * invasive count that includes corpses is a different measurement.
 *
 * The truth table is report-flow.md's, transcribed row for row; the test walks
 * it. Pure, and deliberately so: the same function serves the direct
 * submission and the offline queue. It decides the category once, at
 * submission; nothing re-derives it when a species is confirmed later, because
 * whether the animal is invasive is read from the species at display time
 * (see COLLECTIONS).
 */
export type Condition = "dead" | "hurt" | "well";

/**
 * What the flow knows about the species, in the only three shapes step 4 can
 * produce: a name the reporter chose, an admission that they do not know, or a
 * search that never answered.
 */
export type SpeciesAnswer =
  | {
      kind: "named";
      id: number;
      scientificName: string;
      commonNameZh: string | null;
      /** TaiCOL's flag. `null` is a real answer: the register does not say. */
      isInvasive: boolean | null;
    }
  /** "Not sure", optionally with "but I think it's introduced". */
  | { kind: "unsure"; introduced: boolean }
  /** The search was offline or slow and the reporter moved on. */
  | { kind: "skipped" };

export type Derivation = {
  /** TaiCOL's invasive flag for a named taxon; `null` when nobody named one. */
  taxonIsInvasive: boolean | null;
  /** The reporter said "introduced", or arrived on an `?category=invasive` link. */
  saysIntroduced: boolean;
};

export function deriveCategory(
  condition: Condition,
  { taxonIsInvasive, saysIntroduced }: Derivation,
): Category {
  // Condition first, and it is final. Both of these ignore the species
  // entirely: a dead animal is a roadkill record whatever it was, and a hurt
  // one is an injured record whatever it was.
  if (condition === "dead") return "roadkill";
  if (condition === "hurt") return "injured";

  // Alive and well. Now the species decides, and a named taxon outranks what
  // the reporter believes about it — including the belief carried in by an
  // `?category=invasive` link, which is why a named native is a `sighting`
  // even when the reporter arrived through the invasive-species door.
  if (taxonIsInvasive === true) return "invasive";
  if (taxonIsInvasive === false) return "sighting";

  // Nobody named a taxon, or the register has no opinion about the one that
  // was named. The reporter's own "I think it's introduced" is all there is.
  return saysIntroduced ? "invasive" : "sighting";
}

/** What `deriveCategory` needs, read off a species answer. */
export function derivationFor(
  species: SpeciesAnswer | null,
  arrivedAsInvasive = false,
): Derivation {
  if (species?.kind === "named")
    return {
      taxonIsInvasive: species.isInvasive,
      saysIntroduced: arrivedAsInvasive,
    };
  return {
    taxonIsInvasive: null,
    saysIntroduced:
      arrivedAsInvasive || (species?.kind === "unsure" && species.introduced),
  };
}

/**
 * Where the stored taxon came from, which is not the same question as which
 * category it produced.
 *
 * `null` for a skipped search is meaningful: "the reporter was never able to
 * answer" is a different record from "the reporter said they did not know",
 * and only the second is evidence that identification is hard.
 */
export function taxonSource(
  species: SpeciesAnswer | null,
): "user" | "unknown" | null {
  if (species?.kind === "named") return "user";
  if (species?.kind === "unsure") return "unknown";
  return null;
}

/**
 * The condition a stored category implies: the inverse of `deriveCategory`'s
 * first argument.
 *
 * Condition is the half of a record that never changes. Nobody revises whether
 * the animal was dead after the fact, and a moderator naming the species is not
 * telling us it got up. The Darwin Core export reads a record's vitality from
 * it (scripts/dwc-occurrences.ts): `dead` is dead, and `hurt` is alive.
 */
export function conditionOf(category: Category): Condition {
  if (category === "roadkill") return "dead";
  if (category === "injured") return "hurt";
  return "well";
}

/*
 * There used to be a `recategorise` here: the category a record should carry
 * once its species was known, which the two confirm actions wrote back into
 * `category` so that a `sighting` confirmed to be an invasive species would
 * appear under the map's invasive filter.
 *
 * It is gone because the copy it made could not stay true. Only two of the
 * four paths that set a species ran it — the classifier's auto-assign never
 * did, and a TaiCOL refresh that changes a species' invasive tag re-derives
 * nothing — so the stored category drifted from the species it described.
 * Whether a record is invasive is now read from its species every time it is
 * shown (`reports_public.is_invasive`, 0016, and COLLECTIONS above), and
 * `category` means one thing only: the page the report was filed on, fixed at
 * submission. test/report-category.test.mjs keeps it from coming back.
 */
