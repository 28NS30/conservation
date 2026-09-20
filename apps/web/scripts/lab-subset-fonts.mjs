#!/usr/bin/env node
/**
 * Cut the lab's two display faces down to the characters the lab actually sets.
 *
 *   npm run lab:fonts --workspace @conservation/web
 *
 * WHY THIS EXISTS. The site loads no web font today, and the map must keep
 * loading none. But each direction's whole voice is a typeface — Roundel is the
 * badge's heavy Hei, the field journal is a Ming serif — so a prototype set in
 * the system stack is a prototype nobody can judge. Noto Sans TC Black is 6 MB
 * and Noto Serif TC Bold is 8 MB because they carry twenty thousand glyphs; the
 * lab sets about eight hundred. So: subset, locally, and commit the result.
 *
 * COMMITTED, NOT BUILT. The outputs go into `public/lab/fonts/` and are checked
 * in. Vercel must not run this: it downloads 14 MB of upstream OTF and shells
 * a WASM subsetter, which is a build step nobody would miss until it failed on
 * a deploy at the wrong moment. The lab is throwaway code and its fonts are
 * throwaway artefacts; a binary in git is the cheaper mistake.
 *
 * THREE FACES PER FAMILY, SPLIT BY `unicode-range`. Not one file, because the
 * home hero must preload under 60 KB and the catalogue is 610 Hanzi. Not a font
 * stack of three families either: with `unicode-range` the browser reads the
 * CSS and knows, without fetching anything, which file holds a given character.
 * So a glyph that fell outside the preloaded face costs ONE EXTRA FETCH and is
 * still drawn in the same face — never the mixed-font result you get when a
 * heading falls back to the system Hanzi for two characters in the middle.
 *
 *   <prefix>-home   Basic Latin, digits, and the Hanzi of the chrome and the
 *                   home page. Preloaded, on the lab home only.
 *   <prefix>-ui     Everything else in both message catalogues and in the lab's
 *                   own copy file. Fetched when a page needs it.
 *   <prefix>-names  The species and place names the lab's own routes render.
 *
 * Their union is the charset, published as `charset.json` and read back by
 * `lib/lab/fonts.ts`: a title holding any character outside it is set WHOLLY in
 * the system face rather than mixing per glyph (direction.md §2.2).
 *
 * `--no-layout-closure` is the difference between a 53 KB preload and a 79 KB
 * one. Without it HarfBuzz keeps every glyph reachable from the requested ones
 * through GSUB — for Latin that is the full-width, half-width and alternate
 * forms Noto CJK carries for each letter, none of which this site can reach.
 * GPOS survives either way, which is what matters: `palt` is what opens up CJK
 * punctuation at display sizes, and the type scale asks for it above 20px.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import subsetFont from "subset-font";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(WEB, "public/lab/fonts");
const THEMES = join(WEB, "app/[locale]/lab/themes");
const CACHE = join(WEB, "../../node_modules/.cache/lab-fonts");

/**
 * Upstream, pinned to a commit rather than to `main`.
 *
 * `SubsetOTF/TC` is Noto CJK's own Traditional Chinese cut: the same outlines
 * as the 17 MB pan-CJK file with the Japanese, Korean and Simplified-only
 * glyphs already gone, which makes the download a third of the size and changes
 * nothing about what comes out of the subsetter.
 *
 * Both are SIL Open Font License 1.1. The licence travels with the subsets: see
 * `public/lab/fonts/OFL.txt`.
 */
const NOTO_COMMIT = "f8d157532fbfaeda587e826d4cd5b21a49186f7c";

const FAMILIES = [
  {
    prefix: "sign",
    /** The name the CSS declares. Roundel's face, matching the badge. */
    family: "FW Sign",
    weight: 900,
    upstream: "Noto Sans TC Black",
    path: "Sans/SubsetOTF/TC/NotoSansTC-Black.otf",
    sha256: "3280b221ab7b011c6ae48d38388a0e8c72ddf479992bce62ff589ae932819ce4",
  },
  {
    prefix: "ming",
    /** The field journal's face. */
    family: "FW Ming",
    weight: 700,
    upstream: "Noto Serif TC Bold",
    path: "Serif/SubsetOTF/TC/NotoSerifTC-Bold.otf",
    sha256: "3ca2b3294ec84b795d0a45695e78e3612a44dce50f9fc776cd40206340a5768d",
  },
];

/**
 * The names the lab's own routes put in an h1, which is the only place a name
 * is set in the display face.
 *
 * A static list on purpose. Reading them from the database would make the
 * committed bytes depend on which import the machine running this happens to
 * have, and the whole point of committing them is that everyone gets the same
 * file. Every other name — the anniversary ledger, a search result — falls
 * outside the charset and is handled by `labFaceClass`, which is the mechanism
 * this list exists to keep rare rather than to remove.
 */
const LAB_SPECIES_NAMES = [
  "黑眶蟾蜍", // 28758, 3,978 records
  "斯文豪氏頸槽蛇", // 37689, seven Hanzi
  "中國石龍子臺灣亞種", // 102062, nine Hanzi, no records
  "臺灣穿山甲", // 85879, protected, withheld
];

/**
 * The keys from the live `home` namespace that the lab's home page renders.
 *
 * Reused rather than reinvented on purpose: a difference the owner sees between
 * a prototype and today's page should be a difference in the design, not in the
 * words. `HomeHero`, `HomeWaysIn` and `HomeLedger` are where these are read.
 */
const HOME_LIVE_KEYS = [
  "tagline",
  "ctaReport",
  "ctaMap",
  "ledgerTitle",
  "mapPlacesLabel",
  "mapSpeciesLabel",
];

/** U+0020 to U+007E: every printable ASCII character, per direction.md §2.2. */
const BASIC_LATIN = Array.from({ length: 0x5f }, (_, i) =>
  String.fromCharCode(0x20 + i),
).join("");

const json = async (path) => JSON.parse(await readFile(join(WEB, path), "utf8"));

/** Everything in `value` that the system stack would not already cover. */
function nonAscii(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return [...text].filter((c) => c.codePointAt(0) > 0x7e);
}

/**
 * Which characters belong to which face.
 *
 * Read from the catalogues and the copy file rather than typed out, so that a
 * string added to either is covered the next time this runs — and so that the
 * test in `test/lab.test.mjs` comparing the catalogue against the charset is
 * checking something real.
 */
async function buildGroups() {
  const zh = await json("messages/zh-TW.json");
  const en = await json("messages/en.json");
  const { LAB_COPY } = await import(join(WEB, "lib/lab/copy.ts"));

  // The home page, the forest band, the tab bar and the footer — the strings
  // the owner sees before anything is fetched. direction.md §4 names exactly
  // these: the project name, the tagline, one report sign, one map sign, the
  // nav, and the footer.
  const home = [
    ...nonAscii([zh.site, en.site]),
    ...nonAscii([zh.nav, en.nav]),
    ...nonAscii([zh.footer, en.footer]),
    // The live `home` keys the lab home reuses, listed one by one rather than
    // taken wholesale: the namespace also holds the how-it-works, blurring and
    // open-data prose, which direction.md §4 moves to /about, and those 217
    // extra Hanzi are 52 KB on a face with a 60 KB budget. If a home block
    // starts reading a key that is not here, `e2e/lab/fonts.mjs` says so — the
    // home page fetches a second face and its budget of one is broken.
    ...HOME_LIVE_KEYS.flatMap((key) => nonAscii([zh.home[key], en.home[key]])),
    // The lab's own home strings, and the two small sections that can appear
    // beside a heading anywhere. NOT `copy.lab` or `copy.seam`: that is the
    // scaffolding — the compare strip, the index, the specimen sheet — none of
    // which belongs to either design, and all of which renders in the system
    // face because it sits outside a `[data-direction]` wrapper. Spending the
    // home page's preloaded bytes on it would be spending them on furniture.
    ...Object.values(LAB_COPY).flatMap((copy) =>
      nonAscii([copy.home, copy.common, copy.status]),
    ),
    ...BASIC_LATIN,
  ];

  // Both catalogues whole, not just the namespaces the lab reads. The lab's
  // pages reuse live keys on purpose — a difference the owner sees should be a
  // difference in the design, not in the words — and which keys they reuse is
  // still being decided by four other agents.
  const { LAB_DIRECTION_LABELS, LAB_DIRECTION_NOTES } = await import(
    join(WEB, "lib/lab/directions.ts")
  );
  const ui = [
    ...nonAscii([zh, en]),
    ...nonAscii(LAB_COPY),
    ...nonAscii([LAB_DIRECTION_LABELS, LAB_DIRECTION_NOTES]),
  ];

  const names = [
    ...nonAscii(LAB_SPECIES_NAMES.join("")),
    ...nonAscii([zh.home.places, en.home.places]),
  ];

  const homeSet = new Set(home);
  const uiSet = new Set(ui.filter((c) => !homeSet.has(c)));
  const namesSet = new Set(
    names.filter((c) => !homeSet.has(c) && !uiSet.has(c)),
  );
  return { home: homeSet, ui: uiSet, names: namesSet };
}

/** Sorted by code point, so the same inputs always produce the same bytes. */
const ordered = (set) =>
  [...set].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));

/** `U+4e00-4e03, U+4e07` — contiguous runs merged, as Google's own CSS does. */
function unicodeRange(chars) {
  const points = chars.map((c) => c.codePointAt(0));
  const parts = [];
  for (let i = 0; i < points.length; i += 1) {
    const start = points[i];
    while (i + 1 < points.length && points[i + 1] === points[i] + 1) i += 1;
    const end = points[i];
    const hex = (n) => n.toString(16);
    parts.push(start === end ? `U+${hex(start)}` : `U+${hex(start)}-${hex(end)}`);
  }
  return parts.join(", ");
}

/** The upstream OTF, cached outside the repo. Never committed: 14 MB of it. */
async function source({ path, sha256, upstream }) {
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, path.split("/").pop());
  try {
    const cached = await readFile(file);
    if (createHash("sha256").update(cached).digest("hex") === sha256)
      return cached;
  } catch {
    // Not cached yet, or truncated by an interrupted run. Fetch it.
  }
  const url = `https://raw.githubusercontent.com/notofonts/noto-cjk/${NOTO_COMMIT}/${path}`;
  process.stdout.write(`  fetching ${upstream}\n`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const got = createHash("sha256").update(buffer).digest("hex");
  if (got !== sha256)
    throw new Error(`${upstream} is not the pinned file: sha256 ${got}`);
  await writeFile(file, buffer);
  return buffer;
}

/**
 * The `@font-face` block for one face.
 *
 * Written by this script rather than by hand because the `unicode-range` and
 * the file it names have to agree exactly: a range that claims a character the
 * file does not contain is a blank rectangle, and one that omits a character
 * the file does contain is a face nobody ever fetches. Both are silent.
 *
 * The URL is absolute from the site root. `basePath` is inert here (see
 * `lib/basePath.ts`) and CSS has no way to call `withBase`, so if a prefix is
 * ever switched on this file is one of the hand-written paths that moves with
 * it — the same trap the service worker carries.
 */
function faceRule({ family, weight }, face) {
  return [
    "@font-face {",
    `  font-family: "${family}";`,
    "  font-style: normal;",
    `  font-weight: ${weight};`,
    // swap, not optional: outdoors on a slow connection the owner should read
    // the page in the system face and watch it change, not read a prototype
    // that silently never applied its own typeface.
    "  font-display: swap;",
    `  src: url("/lab/fonts/${face.file}") format("woff2");`,
    `  unicode-range: ${face.unicodeRange};`,
    "}",
  ].join("\n");
}

const FACES_HEADER = `/*
 * GENERATED by scripts/lab-subset-fonts.mjs. Do not edit; re-run it.
 *
 * Six faces, two families, split by \`unicode-range\`: see the script's header
 * for why that is three files each rather than one. Nothing here selects a
 * face — declaring one costs no bytes until something on the page is set in it.
 * The wiring, and the rule that keeps it off the map, is in fonts.css.
 */
`;

async function main() {
  const groups = await buildGroups();
  await mkdir(OUT, { recursive: true });

  const covered = ordered(
    new Set([...groups.home, ...groups.ui, ...groups.names]),
  );
  const manifest = {
    note: "Generated by scripts/lab-subset-fonts.mjs. Do not edit by hand.",
    licence: "SIL Open Font License 1.1 — see OFL.txt",
    upstream: `notofonts/noto-cjk@${NOTO_COMMIT.slice(0, 12)}`,
    families: {},
    /** Every character any lab face can draw; `lib/lab/fonts.ts` reads this. */
    covered: unicodeRange(covered),
    coveredCount: covered.length,
  };

  for (const font of FAMILIES) {
    const otf = await source(font);
    const faces = [];
    for (const group of ["home", "ui", "names"]) {
      const chars = ordered(groups[group]);
      const bytes = await subsetFont(otf, chars.join(""), {
        targetFormat: "woff2",
        // See the header: this is a 33% preload saving and costs nothing the
        // lab can reach.
        noLayoutClosure: true,
      });
      const file = `${font.prefix}-${group}.woff2`;
      await writeFile(join(OUT, file), bytes);
      faces.push({
        id: `${font.prefix}-${group}`,
        file,
        chars: chars.length,
        bytes: bytes.length,
        unicodeRange: unicodeRange(chars),
      });
      process.stdout.write(
        `  ${file.padEnd(18)} ${String(chars.length).padStart(4)} chars` +
          `  ${(bytes.length / 1024).toFixed(1).padStart(6)} KB\n`,
      );
    }
    manifest.families[font.prefix] = {
      family: font.family,
      weight: font.weight,
      upstream: font.upstream,
      faces,
    };
  }

  const css = [FACES_HEADER];
  for (const font of FAMILIES)
    for (const face of manifest.families[font.prefix].faces)
      css.push(faceRule(font, face));
  await writeFile(join(THEMES, "faces.css"), `${css.join("\n\n")}\n`);

  // The licence travels with the bytes. Both families are under the same OFL
  // 1.1; the Sans copy carries the wording for all of Noto CJK.
  const licence = await fetch(
    `https://raw.githubusercontent.com/notofonts/noto-cjk/${NOTO_COMMIT}/Sans/LICENSE`,
  );
  if (!licence.ok) throw new Error(`OFL: HTTP ${licence.status}`);
  await writeFile(join(OUT, "OFL.txt"), await licence.text());

  await writeFile(
    join(OUT, "charset.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(
    `  charset.json       ${String(covered.length).padStart(4)} characters\n`,
  );
}

await main();
