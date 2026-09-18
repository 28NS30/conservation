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
  { sub: "", live: "/", directions: LAB_DIRECTIONS, built: false },
  { sub: "/map", live: "/map", directions: ["roundel"], built: false },
  {
    sub: "/report/stepper",
    live: "/report",
    directions: ["roundel"],
    built: false,
  },
  {
    sub: "/report/photo-first",
    live: "/report",
    directions: ["roundel"],
    built: false,
  },
  // 黑眶蟾蜍, 3,978 records — the species page with everything filled in.
  {
    sub: "/species/28758",
    live: "/species/28758",
    directions: ["roundel"],
    built: false,
  },
  // 斯文豪氏頸槽蛇, seven Hanzi, 90 records — the long-name case.
  {
    sub: "/species/37689",
    live: "/species/37689",
    directions: ["roundel"],
    built: false,
  },
  // Nine Hanzi and no records at all — the page that must still look finished.
  {
    sub: "/species/102062",
    live: "/species/102062",
    directions: ["roundel"],
    built: false,
  },
  // 臺灣穿山甲 — protected, withheld: a notice, no map, no count.
  {
    sub: "/species/85879",
    live: "/species/85879",
    directions: ["roundel"],
    built: false,
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

/** The same page in the other direction, for the compare strip. */
export function otherDirection(direction: LabDirection): LabDirection {
  return direction === "roundel" ? "journal" : "roundel";
}
