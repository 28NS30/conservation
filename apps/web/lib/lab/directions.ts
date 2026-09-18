import type { Locale } from "../../i18n/routing";

/**
 * The two looks the lab exists to choose between, and the routes each one gets.
 *
 * A direction is a theme file and a basemap scheme, not a copy of the site: the
 * same primitives and the same page components render under both, so the loser
 * costs a CSS file rather than a rebuild. That is the whole reason these are
 * string keys on one route tree instead of two branches — two branches drift in
 * structure and copy, and then the comparison is no longer about the design.
 *
 * "roundel" is the recommendation (forest and cream blocks, heavy Hei, the dark
 * map repainted to the badge's ring colour). "journal" is the runner-up (paper,
 * Ming serif, 2px rules, a light map) and is built on home only — home is the
 * page the owner has rejected twice, so it is the page that settles taste.
 */
export const LAB_DIRECTIONS = ["roundel", "journal"] as const;

export type LabDirection = (typeof LAB_DIRECTIONS)[number];

export function isLabDirection(value: string): value is LabDirection {
  return (LAB_DIRECTIONS as readonly string[]).includes(value);
}

/**
 * Names shown to the owner. Nothing in the interface should say "roundel" —
 * that is the word the design review uses, not a word the person choosing
 * between two looks has any reason to know.
 *
 * zh-TW needs a native read (see the brief's decision 7); these are placeholders
 * good enough to tell two tabs apart.
 */
export const LAB_DIRECTION_LABELS = {
  roundel: { "zh-TW": "徽章版", en: "Roundel" },
  journal: { "zh-TW": "田野筆記版", en: "Field journal" },
} satisfies Record<LabDirection, Record<Locale, string>>;

/** One line each, so the index page says what it is sending you to. */
export const LAB_DIRECTION_NOTES = {
  roundel: {
    "zh-TW": "森林綠與米色色塊、粗黑體、深色地圖。",
    en: "Forest and cream blocks, heavy sans, dark map.",
  },
  journal: {
    "zh-TW": "紙張、明體、細線分隔、淺色地圖。",
    en: "Paper, Ming serif, rules instead of surfaces, light map.",
  },
} satisfies Record<LabDirection, Record<Locale, string>>;

/**
 * Where a direction's pages live, and which live page each one is a redesign of.
 *
 * `built` is the seam between the agents building this: a page owner flips their
 * own row to true in the same commit that adds the page, and the lab index stops
 * offering a link that 404s. It is a hand-maintained list on purpose — reading
 * the app directory at request time would work in dev and quietly stop working
 * on a standalone build.
 *
 * `directions` names which looks get that page. Only home is built twice; the
 * other three are Roundel alone, because a full second build is not worth five
 * days to answer a question home already answers.
 */
export type LabRoute = {
  /** Appended to `/lab/<direction>`; "" is the direction's home. */
  readonly sub: string;
  /** The live route this page is a redesign of, for side-by-side flipping. */
  readonly live: string;
  readonly directions: readonly LabDirection[];
  readonly built: boolean;
};

export const LAB_ROUTES = [
  { sub: "", live: "/", directions: LAB_DIRECTIONS, built: true },
  { sub: "/map", live: "/map", directions: ["roundel"], built: true },
  {
    sub: "/report/stepper",
    live: "/report",
    directions: ["roundel"],
    built: true,
  },
  {
    sub: "/report/photo-first",
    live: "/report",
    directions: ["roundel"],
    built: true,
  },
  // 黑眶蟾蜍, 3,978 records — the species page with everything filled in.
  {
    sub: "/species/28758",
    live: "/species/28758",
    directions: ["roundel"],
    built: true,
  },
  // 斯文豪氏頸槽蛇, seven Hanzi, 90 records, sensitivity 輕度 — the long-name case,
  // and the only one of these that carries the blurred-location Notice.
  {
    sub: "/species/37689",
    live: "/species/37689",
    directions: ["roundel"],
    built: true,
  },
  // 中國石龍子臺灣亞種: nine Hanzi and no records at all — the page that must
  // still look finished with nothing in it.
  {
    sub: "/species/102062",
    live: "/species/102062",
    directions: ["roundel"],
    built: true,
  },
  // 臺灣穿山甲 — protected and endemic, and no public records. Listed here as
  // "withheld" in the first draft of this table, which was wrong: TaiCOL rates
  // it with no sensitivity at all, so it is a second zero-record page rather
  // than a withheld one. Kept, because a zero-record page that carries two
  // status tags is a different-looking page from one that carries one.
  {
    sub: "/species/85879",
    live: "/species/85879",
    directions: ["roundel"],
    built: true,
  },
  // 食蛇龜 — protected I and rated 座標不開放, which is the case the page has to
  // handle honestly: no rows reach `reports_public`, so its count reads 0 and
  // "no reports yet" would be a lie. A Notice, no map, no count. This is the
  // real one; there are seven such taxa in the whole checklist.
  {
    sub: "/species/79876",
    live: "/species/79876",
    directions: ["roundel"],
    built: true,
  },
  // The primitives themselves, rendered under whichever theme is on. Not a page
  // of the site; it is how a page owner sees what they are building with, and
  // how a change to a theme file is checked against every component at once.
  { sub: "/primitives", live: "/", directions: LAB_DIRECTIONS, built: true },
] as const satisfies readonly LabRoute[];

/** A path inside the lab, locale-prefixed later by the i18n `Link`. */
export function labPath(direction: LabDirection, sub = ""): string {
  return `/lab/${direction}${sub}`;
}

/**
 * Where a link out of a lab page should actually go, today.
 *
 * The pages land over several weeks, so for most of that time a prototype's
 * header, tab bar and hero point at lab routes that do not exist yet. A 404 is
 * the worst possible answer: the person tapping it is the owner, on a phone,
 * deciding whether a design is any good, and a dead link reads as "the design
 * is broken" rather than "that page is next week's".
 *
 * So a link goes to the lab's own page when this direction has built it, and to
 * the live page it is a redesign of when it has not. Leaving the prototype is
 * honest — the compare strip is titled "today's page" and does the same thing —
 * and the link starts pointing inside the lab on its own the day that page's
 * `built` flag flips. Nobody has to remember to come back and change it.
 */
export function labHref(direction: LabDirection, sub: string): string {
  const route = LAB_ROUTES.find((candidate) => candidate.sub === sub);
  if (!route) return sub;
  const here = (route.directions as readonly string[]).includes(direction);
  return route.built && here ? labPath(direction, sub) : route.live;
}

/** The same page in the other direction, for the compare strip. */
export function otherDirection(direction: LabDirection): LabDirection {
  return direction === "roundel" ? "journal" : "roundel";
}
