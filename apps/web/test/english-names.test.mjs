/**
 * English common names: what the build may call an animal, and what the import
 * does with what it is given.
 *
 * TaiCOL has no English names, so they come from outside it — AviList for
 * birds, MDD for mammals, iNaturalist for the rest, the Catalogue of Life when
 * it offers exactly one — through a committed file, scripts/english-names.json,
 * and the team's overrides on top. The research that chose those sources found
 * the ways the rejected ones go wrong: a dog called a "gray wolf", Taiwan's
 * ferret-badger named after the Chinese one because a synonym was followed
 * across a species boundary, Chinese tagged as English, several names in one
 * field, a crab called by a pinyin transliteration. Each is pinned here,
 * against the rules and against the committed file itself.
 *
 * One kind is pinned only case by case. A name in another language written in
 * the Latin alphabet (GBIF's Portuguese "Mocassim chinês", the pinyin "Da
 * Xiong Mao" that MDD lists among the giant panda's English names) has
 * nothing in its letters to give it away, so no rule refuses it: nameProblem()
 * refuses the ones a reader has found and listed, and this file checks that
 * none of those is in english-names.json.
 *
 * The rules are pure and need nothing. The file checks need only the file. The
 * import checks run inside a rolled-back transaction, against whatever `taxa`
 * holds: the full checklist on a laptop, the fixture slice in CI.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sql, inRollback } from "./helpers.mjs";
import {
  NAMES_PATH,
  SOURCE_PATTERN,
  applyEnglishNames,
  capitalise,
  chineseNamesAgree,
  cleanAlts,
  displayName,
  epithetStem,
  inheritsSpeciesName,
  loadNamesFile,
  loadOverrides,
  nameProblem,
  parseOverrides,
  resolveNames,
  sameAuthority,
  serializeNamesFile,
  spellingVariants,
  synonymCandidates,
} from "../../../scripts/english-names.ts";

after(() => sql.end());

const FILE = loadNamesFile();
const OVERRIDES = loadOverrides();
const entries = Object.entries(FILE.names);

const LEOPARD_CAT = "t0032116"; // Prionailurus bengalensis 豹貓, alt name 石虎
const SHIHU = "t0105762"; // Prionailurus bengalensis euptilurus 石虎, a subspecies
const DOG = "t0085383"; // Canis familiaris 犬
const FERRET_BADGER = "t0027888"; // Melogale subaurantiaca 鼬貛, 747 records
const CATTLE_EGRET = "t0029968"; // Ardea coromanda (was Bubulcus ibis coromandus) 黃頭鷺, 27 records
const FORMOSAN_SALMON = "t0031284"; // Oncorhynchus masou formosanus 臺灣櫻花鉤吻鮭
const BULBUL_KURODA = "t0123707"; // Microscelis amaurotis harterti Kuroda, 1922
const PACIFIC_SWALLOW_SSP = "t0085756"; // Hirundo javanica namiyei (was H. tahitica namiyei) 洋燕, 49 records
const TAIWAN_GLASS_LIZARD = "t0028707"; // Dopasia formosensis 臺灣蛇蜥
const HARTS_GLASS_LIZARD = "t0124472"; // Dopasia harti 哈特氏蛇蜥, 30 records
const BANANA_WILT = "t0086534"; // Fusarium oxysporum fo. cubense 香蕉分化型尖鐮孢菌
const RED_EARED_SLIDER = "t0033457"; // Trachemys scripta elegans 紅耳泥龜, 25 records
const HARP_FROG = "t0106675"; // Nidirana okinavana 豎琴蛙
const LARGEMOUTH_BASS = "t0028011"; // Micropterus salmoides 大口黑鱸
const TAIWAN_PANGOLIN = "t0085879"; // Manis pentadactyla pentadactyla 臺灣穿山甲, 27 records
const TAIWAN_CLOUDED_LEOPARD = "t0085962"; // Neofelis nebulosa brachyura 臺灣雲豹
const TAIWAN_HARE = "t0085835"; // Lepus sinensis formosus 臺灣野兔, 71 records
const DOMESTIC_GOOSE = "t0057686"; // Anser anser domesticus 家鵝
const BULBUL_STRESEMANN = "t0104373"; // Hypsipetes amaurotis harterti, with the wrong authority

/** A names file built by hand, so an assertion is about one rule only. */
function file(names) {
  const full = {};
  for (const [id, e] of Object.entries(names)) {
    full[id] = {
      scientific_name: "Testus testus",
      common_name_zh: null,
      name: null,
      alts: [],
      source: null,
      via: null,
      ...e,
    };
  }
  return { generated_by: "test", generated_at: "2026-01-01", scope: "", sources: {}, names: full };
}

describe("following a synonym", () => {
  test("never crosses into another species (the ferret-badger case)", () => {
    // TaiCOL lists Melogale moschata among the ferret-badger's synonyms, because
    // Taiwan's animal was once its subspecies. GBIF followed that and named 747
    // Taiwanese records after the Chinese ferret-badger.
    const c = synonymCandidates("Melogale subaurantiaca", [
      "Melogale moschata subaurantiaca",
      "Helictis subaurantica",
      "Melogale moschata",
    ]);
    assert.ok(!c.some((n) => /moschata/.test(n)), `followed into Melogale moschata: ${c}`);
    assert.deepEqual(c, []);
  });

  test("the other six different-species synonyms the research found are refused too", () => {
    for (const [accepted, wrong] of [
      ["Rhabdophis formosanus", "Rhabdophis tigrinus"],
      ["Petaurista grandis", "Petaurista petaurista"],
      ["Mus formosanus", "Mus caroli"],
      ["Saxicola stejnegeri", "Saxicola maurus"],
      ["Crocidura tadae", "Crocidura rapax"],
      ["Petaurista lena", "Petaurista alborufus"],
    ]) {
      assert.deepEqual(synonymCandidates(accepted, [wrong]), [], `${accepted} followed ${wrong}`);
    }
  });

  test("follows a genus move, whatever the gender ending", () => {
    assert.deepEqual(synonymCandidates("Ixobrychus sinensis", ["Botaurus sinensis"]), ["Botaurus sinensis"]);
    assert.deepEqual(
      synonymCandidates("Lithobates catesbeianus", ["Aquarana catesbeiana", "Rana catesbeiana"]),
      ["Aquarana catesbeiana", "Rana catesbeiana"],
    );
    assert.deepEqual(synonymCandidates("Fowlea flavipunctata", ["Fowlea flavipunctatus"]), ["Fowlea flavipunctatus"]);
    assert.equal(epithetStem("niger"), epithetStem("nigra"));
    assert.equal(epithetStem("sinensis"), epithetStem("sinense"));
  });

  test("follows a subspecies that was raised to a species", () => {
    assert.deepEqual(
      synonymCandidates("Cnephaeus pachyomus", ["Eptesicus serotinus pachyomus", "Eptesicus serotinus"]),
      ["Eptesicus pachyomus"],
    );
  });

  test("nothing in the committed file was reached through a refused synonym", () => {
    const refused = /\b(?:Melogale moschata|Rhabdophis tigrinus|Petaurista petaurista|Mus caroli|Saxicola maurus|Crocidura rapax|Petaurista alborufus)\b/;
    const bad = entries.filter(([, e]) => e.via && refused.test(e.via));
    assert.deepEqual(bad.map(([id, e]) => `${id} via ${e.via}`), []);
  });
});

describe("a subspecies raised to a species", () => {
  test("gets the raised species' name, not the one its old species kept", () => {
    // TaiCOL kept Taiwan's cattle egret as Bubulcus ibis coromandus. Clements
    // v2025 made it Ardea coromanda, Eastern Cattle-Egret, and calls what is
    // left of ibis the Western Cattle-Egret, a bird Taiwan does not have.
    // Inheriting would have put that name on 27 Taiwanese records. The build
    // reached Ardea coromanda through the synonym; since TaiCOL's refresh of
    // 29 September 2026 that is TaiCOL's own name for it.
    const egret = FILE.names[CATTLE_EGRET];
    assert.equal(egret.name, "Eastern Cattle-Egret");
    assert.equal(egret.inherited_from, undefined);
    assert.ok(egret.scientific_name === "Ardea coromanda" || egret.via === "Ardea coromanda", "not reached as Ardea coromanda");
    // Taiwan's own salmon is not the Cherry Salmon of Japan.
    assert.equal(FILE.names[FORMOSAN_SALMON].name, "Formosan Landlocked Salmon");
  });

  test("is told from an unrelated species that shares its epithet by its authority", () => {
    // Merging bulbul genera put the Banggai golden bulbul, Hypsipetes harterti
    // (Stresemann, 1912), in the same genus as Taiwan's brown-eared bulbul
    // subspecies harterti Kuroda, 1922. Same letters, different names.
    assert.equal(sameAuthority("Kuroda, 1922", "(Stresemann, EFT, 1912)"), false);
    assert.equal(sameAuthority("(Boddaert, 1783)", "(Boddaert, P, 1783)"), true);
    assert.equal(sameAuthority("Olsen, 1913", "Ø. Olsen, 1912"), true, "checklists differ by a year");
    assert.equal(sameAuthority("Palmén, 1887", "Palmen, JA, 1887"), true);
    assert.equal(sameAuthority(null, "Linnaeus, 1758"), null);
    const kuroda = FILE.names[BULBUL_KURODA];
    assert.doesNotMatch(kuroda.name ?? "", /Golden-Bulbul/);
    assert.equal(kuroda.inherited_from, "t0097351");
  });
});

describe("inheriting the species' name", () => {
  test("is for subspecies, varieties and a botanist's or zoologist's forms", () => {
    assert.equal(inheritsSpeciesName("Subspecies", "Animalia"), true);
    assert.equal(inheritsSpeciesName("Variety", "Plantae"), true);
    assert.equal(inheritsSpeciesName("Form", "Plantae"), true);
    assert.equal(inheritsSpeciesName("Form", "Animalia"), true);
  });

  test("is not for a pathogen's host form, whatever rank TaiCOL files it under", () => {
    // TaiCOL files the banana wilt fungus as rank "Form", "fo. cubense"; its
    // species is iNaturalist's "Cucumber Fusarium".
    assert.equal(inheritsSpeciesName("Form", "Fungi"), false);
    assert.equal(inheritsSpeciesName("Special Form", "Fungi"), false);
    assert.equal(inheritsSpeciesName("Form", "Bacteria"), false);
    const wilt = FILE.names[BANANA_WILT];
    assert.equal(wilt.name, null, `香蕉分化型尖鐮孢菌 is "${wilt.name}"`);
    assert.equal(wilt.inherited_from, undefined);
    assert.match(wilt.why, /host form/);
  });
});

describe("the Catalogue of Life", () => {
  test("is not trusted when its Chinese name for a taxon is not TaiCOL's", () => {
    // COL's Dopasia formosensis carries D. harti's names: 脆蛇蜥 and "Hart's
    // Glass Lizard". TaiCOL calls it 臺灣蛇蜥.
    assert.equal(chineseNamesAgree(["脆蛇蜥"], ["臺灣蛇蜥", "哈特氏蛇蜥", "蛇蜥"]), false);
    assert.equal(chineseNamesAgree(["台灣蛇蜥"], ["臺灣蛇蜥"]), true, "台 and 臺 are one character to TaiCOL");
    assert.equal(chineseNamesAgree([], ["臺灣蛇蜥"]), null, "no Chinese name is not evidence either way");
    const lizard = FILE.names[TAIWAN_GLASS_LIZARD];
    assert.equal(lizard.name, null, `臺灣蛇蜥 is "${lizard.name}"`);
    assert.match(lizard.why, /Chinese name/);
    // So the two lizards no longer show one English name between them.
    assert.equal(FILE.names[HARTS_GLASS_LIZARD].name, "Hart's Glass Lizard");
  });
});

describe("what counts as an English name", () => {
  test("the defects found in the rejected sources are refused", () => {
    // Every one of these came back from GBIF, COL XR or Wikidata, labelled English.
    assert.equal(nameProblem("铅色水蛇", "Hypsiscopus plumbea"), "chinese-or-other-cjk");
    assert.equal(
      nameProblem("Asian Grass Frog/Common Pond Frog/Field Frog", "Fejervarya limnocharis"),
      "not-a-single-english-name",
    );
    assert.equal(
      nameProblem("Braminy Bling Snake, Flower Pot Snake", "Indotyphlops braminus"),
      "not-a-single-english-name",
    );
    assert.equal(
      nameProblem("Beauty Snake (friesei: Taiwan Beauty Snake)", "Elaphe taeniura"),
      "not-a-single-english-name",
    );
    assert.equal(
      nameProblem("Protobothrops mucrosquamatus", "Protobothrops mucrosquamatus"),
      "is-the-scientific-name",
    );
    assert.equal(nameProblem("brown rat", "Rattus norvegicus"), "all-lowercase");
    assert.equal(nameProblem("Unknown", "Rattus norvegicus"), "placeholder");
    assert.equal(nameProblem("Species 1", "Rattus norvegicus"), "not-a-single-english-name");
    // And two iNaturalist lists as English for species on this site.
    assert.equal(nameProblem("DECR", "Anthropoides virgo"), "code-or-acronym");
    assert.equal(nameProblem("Braziliensis", "Geophagus brasiliensis"), "latin-word");
  });

  test("names in other languages that a reader has found are refused, spelt any way", () => {
    // Each came from iNaturalist or MDD as an English alternate.
    for (const [name, sci] of [
      ["Da Xiong Mao", "Ailuropoda melanoleuca"],
      ["Tofu sa", "Rhincodon typus"],
      ["Chanchito Blanca De La Piña", "Dysmicoccus brevipes"],
      ["Kura-kura Pipi-putih", "Siebenrockiella crassicollis"],
      ["Kura kura Pipi putih", "Siebenrockiella crassicollis"],
      ["Tu Mama E Maraka", "Ophiophagus hannah"],
      ["Amboa Laolo", "Eupleres goudotii"],
      ["Tombokatosody", "Fossa fossana"],
      ["Swartwitpens", "Hippotragus niger"],
    ]) {
      assert.equal(nameProblem(name, sci), "not-english", name);
    }
    // The rule is a list, not a guess: the Cui-ui's English name is also every
    // word a pinyin syllable.
    assert.equal(nameProblem("Cui-ui", "Chasmistes cujus"), null);
  });

  test("real names pass, including one that shares a word with its genus", () => {
    assert.equal(nameProblem("Green Iguana", "Iguana iguana"), null);
    assert.equal(nameProblem("Swinhoe's White-eye", "Zosterops simplex"), null);
    assert.equal(nameProblem("Père David's Deer", "Elaphurus davidianus"), null);
    assert.equal(nameProblem("Black-crowned Night-Heron", "Nycticorax nycticorax"), null);
    assert.equal(nameProblem("Torre de Guatel Arboreal Alligator Lizard", "Abronia meledona"), null);
  });

  test("every name is title-cased, raising letters and never lowering one", () => {
    // iNaturalist writes plant and insect names in lower case, and some reptile
    // names in sentence case: 龜殼花 was "Brown spotted pitviper".
    assert.equal(capitalise("common water hyacinth"), "Common Water Hyacinth");
    assert.equal(capitalise("tree of heaven"), "Tree of Heaven");
    assert.equal(capitalise("Brown spotted pitviper"), "Brown Spotted Pitviper");
    // The lower-case half of a compound, particles, and a source's own capitals stay.
    assert.equal(capitalise("mile-a-minute"), "Mile-a-minute");
    assert.equal(capitalise("Black-crowned Night-Heron"), "Black-crowned Night-Heron");
    assert.equal(capitalise("Torre de Guatel Arboreal Alligator Lizard"), "Torre de Guatel Arboreal Alligator Lizard");
    assert.equal(capitalise("McCord's Box Turtle"), "McCord's Box Turtle");
    assert.equal(nameProblem("Brown spotted pitviper", "Protobothrops mucrosquamatus"), "not-title-case");
  });

  test("the apostrophe is the one a reader types", () => {
    // An ilike search for "Wettstein's" does not find "Wettstein’s".
    assert.equal(displayName("Wettstein’s  Mud Snake"), "Wettstein's Mud Snake");
    assert.equal(nameProblem("Wettstein’s Mud Snake", "Hypsiscopus wettsteini"), "curly-apostrophe");
    assert.deepEqual(cleanAlts(["Stejneger’s Bamboo pitviper"], "Chinese Green Tree Viper", "Trimeresurus stejnegeri"), [
      "Stejneger's Bamboo Pitviper",
    ]);
  });

  test("alternates are spellings a reader might type, never a new name", () => {
    assert.deepEqual(spellingVariants("Grey Heron"), ["Gray Heron"]);
    assert.deepEqual(spellingVariants("Red Collared-Dove"), ["Red Collared Dove"]);
    assert.deepEqual(spellingVariants("Mile-a-minute"), ["Mile a minute"]);
    assert.deepEqual(cleanAlts(["Rock Dove", "rock dove", "Rock Pigeon", "鴿"], "Rock Pigeon", "Columba livia"), [
      "Rock Dove",
    ]);
  });
});

describe("english-names.json", () => {
  test("is exactly what the build writes: sorted, one taxon a line, not hand-edited", () => {
    // Hand edits belong in english-names-overrides.csv, where they carry a
    // reviewer and survive the next build. An edit here is lost on the next run.
    assert.equal(readFileSync(NAMES_PATH, "utf8"), serializeNamesFile(FILE));
  });

  test("pins every source it names", () => {
    assert.match(FILE.sources.avilist.sha256, /^[0-9a-f]{64}$/);
    assert.match(FILE.sources.avilist.url, /AviList-v2025b/);
    assert.match(FILE.sources.mdd.md5, /^[0-9a-f]{32}$/);
    assert.match(FILE.sources.mdd.doi, /zenodo\.21654811/);
    assert.match(FILE.sources.col.url, /dataset\/316321$/);
  });

  test("is well-formed, and every entry says where its name came from", () => {
    assert.ok(entries.length > 500, `only ${entries.length} taxa`);
    for (const [id, e] of entries) {
      assert.match(id, /^t\d{7}$/, `key ${id}`);
      assert.equal(typeof e.scientific_name, "string", id);
      assert.ok(Array.isArray(e.alts), `${id} alts`);
      assert.ok(e.alts.every((a) => typeof a === "string"), `${id} alts`);
      if (e.name === null) {
        assert.equal(e.source, null, `${id}: no name, but a source`);
        assert.equal(e.alts.length, 0, `${id}: no name, but alternates`);
        assert.equal(typeof e.why, "string", `${id}: no name and no reason`);
      } else {
        assert.equal(typeof e.name, "string", id);
        assert.match(e.source, SOURCE_PATTERN, `${id} source ${e.source}`);
        assert.notEqual(e.source, "curated", `${id}: curated names live in the overrides file`);
      }
    }
  });

  test("holds no machine-made, placeholder or wrong-script name", () => {
    const bad = [];
    for (const [id, e] of entries) {
      for (const n of [e.name, ...e.alts].filter(Boolean)) {
        const p = nameProblem(n, e.scientific_name);
        if (p) bad.push(`${id} ${e.scientific_name}: "${n}" ${p}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test("none of the wrong names the research caught came back", () => {
    const named = (id) => FILE.names[id]?.name ?? "";
    const dog = FILE.names[DOG];
    assert.ok(![dog.name, ...dog.alts].some((n) => /wolf/i.test(n)), "the dog is not a wolf");
    assert.doesNotMatch(named(FERRET_BADGER), /chinese/i, "Taiwan's ferret-badger is not the Chinese one");
    // Found in COL's extended release: a pinyin transliteration of 黃灰澤蟹,
    // and "Blue Crab", which is Callinectes sapidus, on a Taiwanese land crab.
    const everywhere = new Set(entries.flatMap(([, e]) => [e.name, ...e.alts].filter(Boolean)));
    assert.ok(!everywhere.has("Huang Ze Gray Crab"));
    assert.notEqual(named("t0061812"), "Blue Crab", "Discoplax hirtipes");
    // Two more that were offered as the display name of a crab. "Viola" does
    // survive as a search alternate of the Viola Land Hermit Crab, which is
    // where iNaturalist has it, and is harmless there.
    const displayed = new Set(entries.map(([, e]) => e.name));
    for (const junk of ["She Crab", "Viola"]) assert.ok(!displayed.has(junk), `"${junk}" is a display name`);
  });

  test("a subspecies shows exactly its species' name, and says so", () => {
    const inherited = entries.filter(([, e]) => e.inherited_from);
    assert.ok(inherited.length > 100, `only ${inherited.length} inherited`);
    for (const [id, e] of inherited) {
      const parent = FILE.names[e.inherited_from];
      assert.ok(parent, `${id} inherits from ${e.inherited_from}, which is not in the file`);
      assert.equal(parent.inherited_from, undefined, `${id} inherits from a taxon that itself inherits`);
      assert.equal(e.name, parent.name, `${id} does not show its species' name`);
    }
  });

  test("is keyed by the taxa it names", async () => {
    const ids = entries.map(([id]) => id);
    const rows = await sql`
      select taicol_id, scientific_name from taxa where taicol_id = any(${ids}::text[])`;
    for (const r of rows) {
      assert.equal(FILE.names[r.taicol_id].scientific_name, r.scientific_name, r.taicol_id);
    }
    const [{ n }] = await sql`select count(*)::int as n from taxa`;
    if (n > 100_000) {
      // The full checklist: every key must be a real taxon.
      assert.equal(rows.length, ids.length, "keys that are not TaiCOL taxa");
    } else {
      // CI's fixture slice holds a few dozen of them.
      assert.ok(rows.length >= 10, `only ${rows.length} keys found in the fixture`);
    }
  });
});

describe("overrides", () => {
  const base = file({
    t0000001: { scientific_name: "Prionailurus bengalensis", name: "Mainland Leopard Cat", alts: ["Leopard Cat"], source: "mdd-v2.5" },
    t0000002: { scientific_name: "Prionailurus bengalensis euptilurus", name: "Mainland Leopard Cat", alts: ["Leopard Cat"], source: "mdd-v2.5", inherited_from: "t0000001" },
    t0000003: { scientific_name: "Discoplax hirtipes", name: "Blue Crab", source: "col-2026-09-11" },
    t0000004: { scientific_name: "Geothelphusa albogilva", why: "no source" },
  });

  test("win over every source, and keep the name they replaced searchable", () => {
    const final = resolveNames(base, parseOverrides("taicol_id,common_name_en,note,reviewer\nt0000001,Leopard Cat,team default,team\n"));
    assert.deepEqual(final.get("t0000001"), {
      name: "Leopard Cat",
      alts: ["Mainland Leopard Cat"],
      source: "curated",
      inherited: false,
    });
  });

  test("on a species reach the subspecies that inherit from it", () => {
    const final = resolveNames(base, parseOverrides("taicol_id,common_name_en,note,reviewer\nt0000001,Leopard Cat,,team\n"));
    assert.equal(final.get("t0000002").name, "Leopard Cat");
    assert.equal(final.get("t0000002").inherited, true);
  });

  test("a blank one removes a wrong name and everything that came with it", () => {
    const final = resolveNames(base, parseOverrides("taicol_id,common_name_en,note,reviewer\nt0000003,,Blue Crab is Callinectes sapidus,team\n"));
    assert.deepEqual(final.get("t0000003"), { name: null, alts: null, source: "curated", inherited: false });
  });

  test("can name what no source does", () => {
    const final = resolveNames(base, parseOverrides('taicol_id,common_name_en,note,reviewer\nt0000004,"Yellow-grey Freshwater Crab",,team\n'));
    assert.equal(final.get("t0000004").name, "Yellow-grey Freshwater Crab");
  });

  test("with alternates of their own, drop the replaced name: it was another animal's", () => {
    // iNaturalist's "Ryukyu Brown Frog" is Rana ulma. Kept as an alternate, a
    // search for that frog would find the harp frog it was wrongly given to.
    const frog = file({
      t0000005: {
        scientific_name: "Nidirana okinavana",
        name: "Ryukyu Brown Frog",
        alts: ["Kampira Falls frog", "Yaeyama harpist frog"],
        source: "inat-2026-09",
      },
    });
    const head = "taicol_id,common_name_en,note,reviewer,alts\n";
    const replaced = resolveNames(frog, parseOverrides(`${head}t0000005,Kampira Falls Frog,,team,Yaeyama Harpist Frog\n`));
    assert.deepEqual(replaced.get("t0000005").alts, ["Yaeyama Harpist Frog"]);
    const none = resolveNames(frog, parseOverrides(`${head}t0000005,Kampira Falls Frog,,team,-\n`));
    assert.equal(none.get("t0000005").alts, null);
    // With the column empty, the replaced name stays searchable, as for the leopard cat.
    const kept = resolveNames(frog, parseOverrides(`${head}t0000005,Kampira Falls Frog,,team,\n`));
    assert.ok(kept.get("t0000005").alts.includes("Ryukyu Brown Frog"));
    assert.throws(() => parseOverrides(`${head}t0000005,,,team,Some Frog\n`), /alternates but no name/);
  });

  test("a subspecies with no name of its own shows its species' name", () => {
    const final = resolveNames(base, []);
    assert.deepEqual(final.get("t0000002"), {
      name: "Mainland Leopard Cat",
      alts: ["Leopard Cat"],
      source: "mdd-v2.5",
      inherited: true,
    });
    assert.equal(final.get("t0000004").name, null);
  });

  test("every committed override says why and who decided", () => {
    // An override silently replaces what a source says, so it has to carry its
    // reason: the next person to doubt "Leopard Cat" should find the argument
    // beside it, not have to reconstruct it.
    assert.ok(OVERRIDES.length > 0);
    for (const o of OVERRIDES) {
      assert.ok(o.reviewer.trim(), `${o.taicol_id} has no reviewer`);
      assert.ok(o.note.trim(), `${o.taicol_id} has no note`);
      const sci = FILE.names[o.taicol_id]?.scientific_name ?? "";
      if (o.common_name_en) assert.equal(nameProblem(o.common_name_en, sci), null, o.taicol_id);
    }
  });

  test("Taiwan's swallows are Pacific Swallows, whatever TaiCOL's species is called elsewhere", () => {
    // TaiCOL's 洋燕 was Hirundo tahitica, and Clements's Hirundo tahitica is
    // the Tahiti Swallow of the Society Islands, so the build called Taiwan's
    // swallow that until the overrides file said otherwise. TaiCOL now files
    // it as Hirundo javanica and the build finds Pacific Swallow by itself
    // (rebuilt 30 September 2026); the override stays, so a TaiCOL that lumps
    // them again cannot bring the Tahiti Swallow back.
    const final = resolveNames(FILE, OVERRIDES);
    assert.notEqual(FILE.names[PACIFIC_SWALLOW_SSP].name, "Tahiti Swallow");
    assert.ok(OVERRIDES.some((o) => o.common_name_en === "Pacific Swallow"), "the override is gone");
    assert.equal(final.get(PACIFIC_SWALLOW_SSP)?.name, "Pacific Swallow");
    assert.equal(final.get(PACIFIC_SWALLOW_SSP)?.inherited, true);
  });

  test("no name from the review of this file contradicts the animal it is on", () => {
    // Each was the build's answer, and each was wrong for the animal beside its
    // Chinese name: a subspecies inheriting its species' name, a source's name
    // that now belongs to another animal, or a species name from a source that
    // split Taiwan's population off.
    const final = resolveNames(FILE, OVERRIDES);
    const name = (id) => final.get(id)?.name ?? null;
    const alts = (id) => final.get(id)?.alts ?? [];
    for (const [id, was, is] of [
      [RED_EARED_SLIDER, "Pond Slider", "Red-eared Slider"],
      ["t0086368", "Pond Slider", "Yellow-bellied Slider"], // 黃耳龜, T. s. scripta
      [HARP_FROG, "Ryukyu Brown Frog", "Kampira Falls Frog"],
      [LARGEMOUTH_BASS, "Florida Bass", "Largemouth Bass"],
      ["t0096009", "European Herring Gull", "Herring Gull"], // 銀鷗
      ["t0076154", "Eden's Whale", "Bryde's Whale"], // 布氏鯨
      ["t0098168", "Red Mountain Ratsnake", "Taiwanese Bamboo Ratsnake"], // 紅竹蛇
      ["t0096534", "Mainland Clouded Leopard", "Clouded Leopard"], // 雲豹
      [TAIWAN_CLOUDED_LEOPARD, "Mainland Clouded Leopard", "Formosan Clouded Leopard"],
      [TAIWAN_PANGOLIN, "Short-tailed Pangolin", "Taiwan Pangolin"],
      [TAIWAN_HARE, "Chinese Hare", "Taiwan Hare"],
      [DOMESTIC_GOOSE, "Graylag Goose", "Domestic Goose"],
    ]) {
      assert.equal(FILE.names[id].name, was, `${id}: the build's answer changed; review this row`);
      assert.equal(name(id), is, id);
    }
    // No Taiwanese animal reads Mainland, however it came by the name.
    for (const [id, f] of final) {
      if (/^Mainland\b/.test(f.name ?? "")) assert.fail(`${id} ${FILE.names[id]?.common_name_zh}: "${f.name}"`);
    }
    // Another animal's name must not find these in a search either.
    assert.ok(!alts(HARP_FROG).includes("Ryukyu Brown Frog"), "the harp frog is found by Rana ulma's name");
    assert.ok(!alts(LARGEMOUTH_BASS).some((n) => /Florida/.test(n)), "the largemouth is found by the Florida bass's names");
    assert.ok(!alts(BULBUL_STRESEMANN).some((n) => /Banggai/.test(n)), "the bulbul is found by the golden bulbul's name");
  });

  test("the team's 石虎 decision reaches 豹貓 and the subspecies 石虎", () => {
    const final = resolveNames(FILE, OVERRIDES);
    assert.equal(final.get(LEOPARD_CAT)?.name, "Leopard Cat");
    assert.equal(final.get(LEOPARD_CAT)?.source, "curated");
    assert.ok(final.get(LEOPARD_CAT)?.alts?.includes("Mainland Leopard Cat"), "MDD's name is still searchable");
    assert.equal(final.get(SHIHU)?.name, "Leopard Cat");
    assert.equal(final.get(SHIHU)?.inherited, true);
  });
});

describe("the import", () => {
  const final = resolveNames(FILE, OVERRIDES);

  test("is idempotent: a second run changes nothing", async () => {
    await inRollback(async (tx) => {
      await applyEnglishNames(tx, final);
      assert.ok((await countNamed(tx)) > 0, "nothing was named, so this proves nothing");
      const second = await applyEnglishNames(tx, final);
      assert.equal(second.changed, 0, "second run rewrote rows");
      assert.equal(second.cleared, 0, "second run cleared rows");
    });
  });

  test("writes what the files say, overrides included", async () => {
    await inRollback(async (tx) => {
      await applyEnglishNames(tx, final);
      const [cat] = await tx`
        select common_name_en, alt_names_en, common_name_en_source, common_name_en_inherited
          from taxa where taicol_id = ${LEOPARD_CAT}`;
      if (!cat) return; // not in this database
      assert.equal(cat.common_name_en, "Leopard Cat");
      assert.equal(cat.common_name_en_source, "curated");
      assert.equal(cat.common_name_en_inherited, false);
      assert.ok(cat.alt_names_en.includes("Mainland Leopard Cat"));
    });
  });

  test("clears a name the files no longer give", async () => {
    await inRollback(async (tx) => {
      const [t] = await tx`
        insert into taxa (taicol_id, scientific_name, rank, common_name_en, common_name_en_source)
        values ('t9999999', 'Testus stalus', 'Species', 'Stale Name', 'inat-2020-01')
        returning id`;
      const r = await applyEnglishNames(tx, final);
      assert.ok(r.cleared >= 1);
      const [row] = await tx`select common_name_en, common_name_en_source from taxa where id = ${t.id}`;
      assert.deepEqual(row, { common_name_en: null, common_name_en_source: null });
    });
  });

  // Each of the next two tests blanks the English columns first. On a database
  // the import has already been run against, applyEnglishNames finds nothing
  // to change and updates no row, so no trigger fires and no digest moves
  // whatever its SET list says: both tests passed with sensitivity = null
  // written into it. Blanking makes it write every named row, as it does on
  // a fresh database.
  test("sets the four English columns and names no other, so no rating trigger fires", async () => {
    // taxa_reblur_reports (0012) fires on UPDATE OF sensitivity or
    // protected_status (other branches add columns to that list), and fires
    // whether or not the value changes. It only moves records when a rating
    // got STRICTER, so a check on the reports alone would pass an update that
    // wrote a rating unchanged, or wrote it looser, or null. What must hold is
    // that the update names no column but its own four. A trigger that throws
    // on UPDATE OF every other column says exactly that, whatever the reblur
    // trigger listens to today; it is created and dropped inside the rollback.
    await inRollback(async (tx) => {
      const cols = await tx`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'taxa'
           and column_name not in ${tx(ENGLISH_COLUMNS)}
         order by ordinal_position`;
      await blankEnglishNames(tx);
      await tx.unsafe(`
        create function english_names_sentinel() returns trigger language plpgsql as $$
        begin
          raise exception 'applyEnglishNames named a column that is not one of the four English ones';
        end $$`);
      await tx.unsafe(`
        create trigger english_names_sentinel before update of ${cols.map((c) => `"${c.column_name}"`).join(", ")}
          on taxa for each row execute function english_names_sentinel()`);
      const r = await applyEnglishNames(tx, final);
      assert.ok(r.changed > 0, "no row was written, so this proves nothing");
    });
  });

  test("changes nothing in taxa but the English columns, and touches no report", async () => {
    // The values, as a second line: every other column of every row is the
    // same afterwards, ratings included, and so is every report's blur.
    await inRollback(async (tx) => {
      await blankEnglishNames(tx);
      const taxaBefore = await taxaDigest(tx);
      const reportsBefore = await reportsDigest(tx);
      const r = await applyEnglishNames(tx, final);
      assert.ok(r.changed > 0, "no row was written, so this proves nothing");
      assert.equal(await taxaDigest(tx), taxaBefore, "a column other than the English ones changed");
      assert.equal(await reportsDigest(tx), reportsBefore, "a report moved");
    });
  });

  test("counts and names public records only, in the build and the import alike", () => {
    // A taxon rated 座標不開放 must not be revealed as recorded. The build's
    // scope is committed to a public repository, and the import prints the
    // most-recorded unnamed taxa by name and runs against production, where its
    // output gets pasted into pull requests. `reports` holds the suppressed
    // records; reports_public does not.
    for (const f of ["build-english-names.ts", "import-english-names.ts"]) {
      const src = readFileSync(new URL(`../../../scripts/${f}`, import.meta.url), "utf8");
      assert.doesNotMatch(src, /\b(?:from|join)\s+reports\b(?!_public)/i, `${f} reads reports`);
      assert.match(src, /\breports_public\b/, f);
    }
  });

  test("the public role reads the new columns, as it reads the Chinese ones", async () => {
    await inRollback(async (tx) => {
      await applyEnglishNames(tx, final);
      await tx`set local role web_anon`;
      const rows = await tx`
        select common_name_en, alt_names_en, common_name_en_source, common_name_en_inherited
          from taxa where common_name_en is not null limit 1`;
      assert.equal(rows.length, 1);
    });
  });
});

const ENGLISH_COLUMNS = ["common_name_en", "alt_names_en", "common_name_en_source", "common_name_en_inherited"];

/**
 * Every column of every taxon except the four English ones. Hashed a row at a
 * time and then together, so 125k rows cost 4 MB of hashes, not a 100 MB string.
 */
async function taxaDigest(tx) {
  const [{ d }] = await tx`
    select md5(coalesce(string_agg(md5((to_jsonb(t) - ${ENGLISH_COLUMNS}::text[])::text), '' order by t.id), '')) as d
      from taxa t`;
  return d;
}

/** Every English column empty, as before the first import. Names no other column. */
async function blankEnglishNames(tx) {
  await tx`
    update taxa
       set common_name_en = null, alt_names_en = null,
           common_name_en_source = null, common_name_en_inherited = false
     where common_name_en is not null or alt_names_en is not null
        or common_name_en_source is not null or common_name_en_inherited`;
}

async function countNamed(tx) {
  const [{ n }] = await tx`select count(*)::int as n from taxa where common_name_en is not null`;
  return n;
}

async function reportsDigest(tx) {
  const [{ d }] = await tx`
    select md5(coalesce(string_agg(
             id::text || location_precision || coalesce(st_astext(location_public::geometry), ''),
             ',' order by id), '')) as d
      from reports`;
  return d;
}
