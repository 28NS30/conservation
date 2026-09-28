/**
 * Photographs on the home page, and who took them.
 *
 * Placeholders, at the team's request: "rn there's nothing so just put
 * placeholder images of stock formosan animals". They are replaced by the team's
 * own photographs as those exist. Every one is from Wikimedia Commons, was taken
 * in Taiwan, and is licensed CC BY or CC BY-SA — both require the credit that
 * the page shows under each photo, and /attribution lists them all.
 *
 * THE FILES CARRY NO METADATA. Each was re-encoded to WebP with nothing carried
 * over, because a camera photo can hold GPS coordinates and this project exists
 * to keep protected species' locations private. One source did: the macaque
 * photo had coordinates embedded, and ours does not. test/home-photos.test.mjs
 * keeps it that way for every file added here.
 *
 * Deliberately not here: 石虎. Every candidate on Commons was a kitten held in
 * gloved hands or a taxidermy mount, and neither belongs on the front page.
 */
export type HomePhoto = {
  src: string;
  width: number;
  height: number;
  name: { zh: string; en: string };
  alt: { zh: string; en: string };
  author: string;
  license: string;
  licenseUrl: string;
  source: string;
};

export const PHOTOS = {
  blueMagpie: {
    src: "/home/blue-magpie.webp",
    width: 2000,
    height: 1334,
    name: { zh: "臺灣藍鵲", en: "Taiwan Blue Magpie" },
    alt: { zh: "一隻臺灣藍鵲停在樹枝上，長長的尾羽垂下", en: "A Taiwan blue magpie perched on a branch, its long tail hanging down" },
    author: "Charles J. Sharp",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Taiwan_blue_magpie_(Urocissa_caerulea)_Xindian.jpg",
  },
  mikado: {
    src: "/home/mikado-pheasant.webp",
    width: 2000,
    height: 1334,
    name: { zh: "帝雉", en: "Mikado Pheasant" },
    alt: { zh: "一隻帝雉站在森林地面上，臉上有鮮紅的肉垂", en: "A Mikado pheasant standing on the forest floor, its red face wattle bright" },
    author: "Cataloging Nature",
    license: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    source: "https://commons.wikimedia.org/wiki/File:2014-03-30_Syrmaticus_mikado_(Mikado_Pheasant)_07.jpg",
  },
  swinhoe: {
    src: "/home/swinhoes-pheasant.webp",
    width: 2000,
    height: 1334,
    name: { zh: "藍腹鷴", en: "Swinhoe's Pheasant" },
    alt: { zh: "一隻藍腹鷴在林下行走，白色冠羽與長尾清晰可見", en: "A Swinhoe's pheasant walking through the undergrowth, white crest and long white tail showing" },
    author: "Cataloging Nature",
    license: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    source: "https://commons.wikimedia.org/wiki/File:2014-03-28_Lophura_swinhoii_(Swinhoe%27s_Pheasant)_01.jpg",
  },
  macaque: {
    src: "/home/rock-macaques.webp",
    width: 2000,
    height: 1418,
    name: { zh: "臺灣獼猴", en: "Formosan Rock Macaque" },
    alt: { zh: "兩隻臺灣獼猴坐著互相理毛", en: "Two Formosan rock macaques sitting together, one grooming the other" },
    author: "ufoncz",
    license: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    source: "https://commons.wikimedia.org/wiki/File:Formosan_rock_macaque_2013-06-10_03.jpg",
  },
  muntjac: {
    src: "/home/muntjac.webp",
    width: 2000,
    height: 1333,
    name: { zh: "山羌", en: "Reeves's Muntjac" },
    alt: { zh: "一隻山羌從草叢中直視鏡頭", en: "A Reeves's muntjac looking straight at the camera from the grass" },
    author: "ＣＡＮＹＥＨ",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:K74A5515.jpg",
  },
  blackBear: {
    src: "/home/black-bear.webp",
    width: 2000,
    height: 1329,
    name: { zh: "臺灣黑熊", en: "Formosan Black Bear" },
    alt: { zh: "一隻臺灣黑熊低頭在植物間覓食", en: "A Formosan black bear with its head down, foraging among plants" },
    author: "Abu0804",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    source: "https://commons.wikimedia.org/wiki/File:19-Formosan_Black_Bear.JPG",
  },
  forestRoad: {
    src: "/home/forest-road.webp",
    width: 2000,
    height: 1500,
    name: { zh: "山區道路", en: "Mountain road" },
    alt: { zh: "一條穿過山區森林的道路", en: "A road winding through mountain forest" },
    author: "Eric Deng",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Siangyang_National_Forest_Recreation_Area.jpg",
  },
  iguana: {
    src: "/home/green-iguana.webp",
    width: 2000,
    height: 1499,
    name: { zh: "綠鬣蜥", en: "Green Iguana" },
    alt: { zh: "一隻綠鬣蜥趴在樹枝上", en: "A green iguana lying along a branch" },
    author: "lienyuan lee",
    license: "CC BY 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    source: "https://commons.wikimedia.org/wiki/File:Iguana_iguana_%E7%B6%A0%E9%AC%A3%E8%9C%A5_-_panoramio_(4).jpg",
  },
  treeFrog: {
    src: "/home/green-tree-frog.webp",
    width: 2000,
    height: 1243,
    name: { zh: "莫氏樹蛙", en: "Moltrecht's Green Treefrog" },
    alt: { zh: "一隻莫氏樹蛙蹲在長滿青苔的地方", en: "A Moltrecht's green treefrog sitting on moss" },
    author: "Evan Pickett",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Rhacophorus_moltrechti.jpg",
  },
  mountains: {
    src: "/home/mountains.webp",
    width: 2000,
    height: 1125,
    name: { zh: "十八羅漢山", en: "Shih-ba-luo-han-shan" },
    alt: { zh: "山脈與溪谷，一條道路沿著河岸延伸", en: "Forested mountains above a river valley, with a road along the bank" },
    author: "Huaiwun",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "https://commons.wikimedia.org/wiki/File:Shih-ba-luo-han-shan_Forest_Reserve_(Huaiwun).jpg",
  },
} satisfies Record<string, HomePhoto>;

export type PhotoKey = keyof typeof PHOTOS;

/** The rotating hero, in the order it plays. Animals only — no roads, no rivers. */
export const HERO: PhotoKey[] = ["blueMagpie", "mikado", "muntjac", "macaque", "swinhoe", "blackBear"];

/** The name to show for a photo, in the reader's language first. */
export function photoName(p: HomePhoto, zh: boolean): string {
  return zh ? p.name.zh : p.name.en;
}
