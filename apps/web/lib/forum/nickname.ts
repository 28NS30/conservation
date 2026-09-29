/**
 * Forum nicknames: an animal from a fixed list and four digits.
 *
 * WHY GENERATED. Most of the people this forum is for are high-school
 * students, and many will be under 18. Anything a person types as a name —
 * their real name, their school, a LINE or Instagram handle — is something a
 * classmate or a stranger can find them by. Google sign-in also hands the
 * account a full name and a photo. So the forum never asks for a name and
 * never reads one: it hands out `blue-magpie-4821`, and the only choice a
 * person has is to ask for another. Nothing here takes an email, a profile or
 * any other input about the person; that is the whole design.
 *
 * ONE IDENTITY, TWO LANGUAGES. What is stored is the list's key and the number
 * (migration 0019), and it is shown as 臺灣藍鵲 4821 to a Chinese reader and
 * Taiwan Blue Magpie 4821 to an English one. The URL uses the key, so a
 * profile's address is the same in both languages and plain ASCII.
 *
 * THE LIST. Common animals of Taiwan that a student would recognise. A name
 * says nothing about where anyone has seen one, so protected animals are as
 * welcome here as sparrows.
 *
 * Pure and dependency-free: the join form (client), the join action (server)
 * and the unit tests all import it.
 */
export type Animal = { key: string; zh: string; en: string };

export const ANIMALS: readonly Animal[] = [
  { key: "blue-magpie", zh: "臺灣藍鵲", en: "Taiwan Blue Magpie" },
  { key: "barbet", zh: "五色鳥", en: "Taiwan Barbet" },
  { key: "bulbul", zh: "白頭翁", en: "Bulbul" },
  { key: "black-bulbul", zh: "紅嘴黑鵯", en: "Black Bulbul" },
  { key: "night-heron", zh: "黑冠麻鷺", en: "Night Heron" },
  { key: "egret", zh: "小白鷺", en: "Little Egret" },
  { key: "kingfisher", zh: "翠鳥", en: "Kingfisher" },
  { key: "sparrow", zh: "麻雀", en: "Sparrow" },
  { key: "white-eye", zh: "綠繡眼", en: "White-eye" },
  { key: "drongo", zh: "大卷尾", en: "Drongo" },
  { key: "swallow", zh: "家燕", en: "Swallow" },
  { key: "woodpecker", zh: "啄木鳥", en: "Woodpecker" },
  { key: "oriole", zh: "黃鸝", en: "Oriole" },
  { key: "owl", zh: "貓頭鷹", en: "Owl" },
  { key: "serpent-eagle", zh: "大冠鷲", en: "Serpent Eagle" },
  { key: "partridge", zh: "竹雞", en: "Bamboo Partridge" },
  { key: "pheasant", zh: "帝雉", en: "Mikado Pheasant" },
  { key: "macaque", zh: "臺灣獼猴", en: "Macaque" },
  { key: "squirrel", zh: "松鼠", en: "Squirrel" },
  { key: "flying-squirrel", zh: "飛鼠", en: "Flying Squirrel" },
  { key: "pangolin", zh: "穿山甲", en: "Pangolin" },
  { key: "leopard-cat", zh: "石虎", en: "Leopard Cat" },
  { key: "muntjac", zh: "山羌", en: "Muntjac" },
  { key: "sambar", zh: "水鹿", en: "Sambar Deer" },
  { key: "serow", zh: "長鬃山羊", en: "Serow" },
  { key: "wild-boar", zh: "山豬", en: "Wild Boar" },
  { key: "civet", zh: "白鼻心", en: "Civet" },
  { key: "ferret-badger", zh: "鼬獾", en: "Ferret-badger" },
  { key: "otter", zh: "水獺", en: "Otter" },
  { key: "bat", zh: "蝙蝠", en: "Bat" },
  { key: "tree-frog", zh: "樹蛙", en: "Tree Frog" },
  { key: "toad", zh: "蟾蜍", en: "Toad" },
  { key: "gecko", zh: "壁虎", en: "Gecko" },
  { key: "skink", zh: "石龍子", en: "Skink" },
  { key: "tortoise", zh: "食蛇龜", en: "Box Turtle" },
  { key: "sea-turtle", zh: "綠蠵龜", en: "Green Turtle" },
  { key: "dolphin", zh: "白海豚", en: "White Dolphin" },
  { key: "salmon", zh: "櫻花鉤吻鮭", en: "Formosan Salmon" },
  { key: "firefly", zh: "螢火蟲", en: "Firefly" },
  { key: "butterfly", zh: "蝴蝶", en: "Butterfly" },
  { key: "dragonfly", zh: "蜻蜓", en: "Dragonfly" },
  { key: "stag-beetle", zh: "鍬形蟲", en: "Stag Beetle" },
  { key: "cicada", zh: "蟬", en: "Cicada" },
  { key: "mantis", zh: "螳螂", en: "Mantis" },
  { key: "crab", zh: "螃蟹", en: "Crab" },
  { key: "snail", zh: "蝸牛", en: "Snail" },
  { key: "firecrest", zh: "火冠戴菊鳥", en: "Firecrest" },
  { key: "yuhina", zh: "冠羽畫眉", en: "Yuhina" },
];

const BY_KEY = new Map(ANIMALS.map((a) => [a.key, a]));

export const NUMBER_MIN = 1000;
export const NUMBER_MAX = 9999;

export type Nickname = { key: string; no: number };

/** A random nickname. `rng` returns [0, 1), like Math.random, so tests can seed it. */
export function generateNickname(rng: () => number = Math.random): Nickname {
  const animal = ANIMALS[Math.floor(rng() * ANIMALS.length) % ANIMALS.length];
  const span = NUMBER_MAX - NUMBER_MIN + 1;
  const no = NUMBER_MIN + (Math.floor(rng() * span) % span);
  return { key: animal.key, no };
}

/** The URL and database form: "blue-magpie-4821". */
export function handleOf(n: Nickname): string {
  return `${n.key}-${n.no}`;
}

/**
 * A handle back into its parts, or null if it is not one this module could
 * have generated.
 *
 * This is the check that makes "you can only take a generated name" true on
 * the server. The join form sends the nickname it was shown; a person can edit
 * that request to say anything at all, so the server accepts only a key that
 * is on the list and a number in range. Anything else — a real name, an email
 * address, a key that looks right but is not on the list — is refused.
 */
export function parseHandle(raw: unknown): Nickname | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const m = /^([a-z]+(?:-[a-z]+)*)-(\d{4})$/.exec(raw);
  if (!m) return null;
  const no = Number(m[2]);
  if (!BY_KEY.has(m[1]) || no < NUMBER_MIN || no > NUMBER_MAX) return null;
  return { key: m[1], no };
}

/**
 * How a nickname reads in a language. A key that is no longer on the list —
 * an animal removed after someone took its name — still shows, as its key, so
 * nobody's name silently becomes blank.
 */
export function displayNickname(n: Nickname, locale: string): string {
  const animal = BY_KEY.get(n.key);
  const name = animal ? (locale.startsWith("zh") ? animal.zh : animal.en) : n.key;
  return `${name} ${n.no}`;
}

/** Display straight from a stored handle; null for a deleted member. */
export function displayHandle(handle: string | null | undefined, locale: string): string | null {
  if (!handle) return null;
  const m = /^(.*)-(\d{4})$/.exec(handle);
  if (!m) return handle;
  return displayNickname({ key: m[1], no: Number(m[2]) }, locale);
}
