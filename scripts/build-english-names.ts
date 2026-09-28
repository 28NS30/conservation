/**
 * Find an English name for the taxa people meet on this site, and write them to
 * the committed scripts/english-names.json.
 *
 *   npm run build:names-en                 # uses the cache, fetches what is missing
 *   npm run build:names-en -- --offline    # cache only; fails on a miss
 *   npm run build:names-en -- --refresh    # ignore the cache and ask again
 *
 * This is the network half. It READS the local database, to know which taxa to
 * name, and writes nothing to it: `npm run import:names-en` applies the file.
 * The split is the one taxon-crosswalk.json uses — every name lands in a diff
 * the team can read before it reaches a page, production needs no network to
 * apply it, and re-applying is deterministic.
 *
 * WHY THESE SOURCES, IN THIS ORDER. TaiCOL has no English names (every /v2/taxon
 * record has the same 34 fields, none English). GBIF, COL's extended release
 * and Wikidata were measured on every recorded taxon and rejected: most taxa
 * get several conflicting names, some tagged English are not ("Mocassim
 * chinês", "铅色水蛇"), and GBIF's own pick called a dog a "gray wolf". (That
 * count included hidden records, so it is not written here: see WHICH TAXA.)
 * What is left, first answer wins:
 *
 *   1. birds    AviList v2025b, column English_name_Clements_v2025. Taiwan's own
 *               TWBF 2026 checklist follows Clements v2025 and agrees on 697 of
 *               its 703 species; AviList carries those names under CC BY 4.0.
 *               The 37 species Clements does not recognise fall back to
 *               AviList's own name. AviList's spelling, where it differs, is
 *               kept as an alternate ("Rock Dove" beside "Rock Pigeon").
 *   2. mammals  MDD v2.5 mainCommonName; otherCommonNames become alternates.
 *   3. the rest, and any bird or mammal the above miss: iNaturalist's preferred
 *               English name, its other English names as alternates.
 *   4. the Catalogue of Life (2026-09-11 base release), only when it gives
 *               exactly one English name. Several means nobody agrees, and
 *               choosing between them would be us inventing an answer. And
 *               only when its Chinese names, if it has any, include TaiCOL's:
 *               otherwise the record is carrying another animal's names.
 *   5. nothing. A taxon no source names gets no English name — never a
 *               translation of the Chinese — and `why` in the file says so,
 *               which makes the file the review queue for the team.
 *
 * Subspecies, varieties and forms are not looked up under their own names.
 * They show their species' name, marked `inherited_from`, and the import sets
 * common_name_en_inherited — unless the source has raised that subspecies to a
 * species of its own, when it gets that species' name instead (see
 * nameElevated(): 櫻花鉤吻鮭 is the Formosan Landlocked Salmon, not its species'
 * Cherry Salmon), or it is a pathogen's host form, which gets no inherited
 * name at all (see inheritsSpeciesName()).
 *
 * Why not ask iNaturalist, which does name some subspecies? Because the
 * subspecies it names are where a name is most likely to be about somewhere
 * else. It calls *Prionailurus bengalensis euptilurus*, TaiCOL's name for
 * Taiwan's 石虎, the "Amur Leopard Cat", and a subspecies with a name of its
 * own no longer inherits the team's "Leopard Cat" from its species. The
 * subspecies whose own English name matters (the Red-eared Slider, on the
 * invasive register) are few enough to name in the overrides file, with a
 * reason each.
 *
 * The reverse case the build can only report: when TaiCOL keeps a species
 * whole and the source has split Taiwan's birds off into another species, the
 * name the source gives TaiCOL's species belongs to birds elsewhere (TaiCOL's
 * 洋燕 *Hirundo tahitica* is Clements's "Tahiti Swallow"; Taiwan's are Pacific
 * Swallows). The run prints the species it can see this for, and the team's
 * answer goes in the overrides file.
 *
 * A taxon whose own name no source knows is retried under its TaiCOL synonyms,
 * but only those that keep its species epithet — see synonymCandidates() in
 * english-names.ts for the seven animals that rule exists for.
 *
 * WHICH TAXA. Every taxon with a public record, everything TaiCOL tags invasive,
 * every protected species, and every accepted Taiwanese bird, mammal, reptile
 * and amphibian — plus the species of any subspecies among them. "Public
 * record" means reports_public, not reports: which taxa are in this file is
 * committed to a public repository, and a taxon rated 座標不開放 must not be
 * revealed as recorded by its presence here (0005 says the same of counts).
 *
 * POLITENESS. Every source is a public good run on someone else's budget.
 * Requests are sequential, identify this project in the User-Agent, keep a gap
 * per host (iNaturalist asks for at most 60 a minute and 10,000 a day; TaiCOL
 * answered "Too Many Requests" during the research), honour Retry-After on a
 * 429, and are cached under data/cache/english-names/ so a re-run asks nothing
 * it has asked before.
 *
 * REPRODUCIBILITY, and its limit. AviList, MDD and the Catalogue of Life are
 * pinned releases: the same question gets the same answer anywhere. iNaturalist
 * is not. Its API is live and unversioned, and the cache that makes
 * `--offline` repeat a build exactly is not committed (data/ is ignored). On a
 * machine without that cache a rebuild asks iNaturalist again, and a name its
 * curators have changed since comes back changed. That is why the output is a
 * committed file with one taxon a line: the diff of a rebuild is where such a
 * change is seen and reviewed, before the import applies it anywhere.
 *
 * SOURCE FILES. AviList and MDD are read from slim CSVs committed under
 * scripts/sources/, so this package needs no spreadsheet dependency. Each was
 * cut once from the pinned download below, keeping the species rows and only
 * the columns read here, in the source's own order and with its own headers:
 *
 *   avilist-v2025b-species.csv   sheet "AviList v2025b extended", rows with
 *                                Taxon_rank = species; Scientific_name,
 *                                Authority, English_name_AviList,
 *                                English_name_Clements_v2025
 *   mdd-v2.5-names.csv           every row; sciName, authoritySpeciesAuthor,
 *                                authoritySpeciesYear, mainCommonName,
 *                                otherCommonNames
 *
 * The authorities are there for nameElevated(): they are how a subspecies
 * raised to a species is told from an unrelated species sharing its epithet.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db.ts";
import {
  AVILIST_CSV,
  MDD_CSV,
  NAMES_PATH,
  chineseNamesAgree,
  cleanAlts,
  csvRecords,
  displayName,
  epithetStem,
  inheritsSpeciesName,
  loadOverrides,
  nameParts,
  nameProblem,
  sameAuthority,
  sameEpithet,
  serializeNamesFile,
  synonymCandidates,
  type NameEntry,
  type NamesFile,
} from "./english-names.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, "..", "data", "cache", "english-names");

const OFFLINE = process.argv.includes("--offline");
const REFRESH = process.argv.includes("--refresh");

const USER_AGENT =
  "conservation-tw-english-names/1.0 (+https://github.com/28NS30/conservation; Taiwan wildlife map run by a high-school nonprofit)";

/** Pinned: every name in the output can be traced to one of these. */
const SOURCES = {
  avilist: {
    title: "AviList: The Global Avian Checklist, v2025b",
    url: "https://www.avilist.org/wp-content/uploads/2026/06/AviList-v2025b-10Jun2026-extended.xlsx",
    sha256: "2e1fd3374e23af732b04115b033dd9d97fc53ba275c312d02ef5d12cfb85c988",
    doi: "10.2173/avilist.v2025b",
    licence: "CC BY 4.0",
    file: "scripts/sources/avilist-v2025b-species.csv",
  },
  mdd: {
    title: "Mammal Diversity Database v2.5 (MDD_v2.5_6904species.csv)",
    url: "https://zenodo.org/api/records/21654811/files/MDD_v2.5_6904species.csv/content",
    md5: "533e662fd5b8f66a5f56c191e7efac44",
    doi: "10.5281/zenodo.21654811",
    licence: "CC BY 4.0",
    file: "scripts/sources/mdd-v2.5-names.csv",
  },
  inat: {
    title: "iNaturalist taxonomy, preferred English common name",
    url: "https://api.inaturalist.org/v1/taxa",
    version: "unversioned API; the retrieval month is in each name's source",
    licence: "iNaturalist Taxonomy is listed as CC BY on ChecklistBank (dataset 139831)",
  },
  col: {
    title: "Catalogue of Life, base release 2026-09-11 (COL26.9)",
    url: "https://api.checklistbank.org/dataset/316321",
    doi: "10.48580/dgz5n",
    licence: "CC BY 4.0",
  },
} as const;

const COL = "https://api.checklistbank.org/dataset/316321";
const COL_SOURCE = "col-2026-09-11";

// ---------------------------------------------------------------------------
// A polite HTTP client with a disk cache
// ---------------------------------------------------------------------------

type Cached = { url: string; fetched_at: string; status: number; body: unknown };

/** Minimum gap between requests to one host, and a hard cap per run. */
const HOSTS: Record<string, { gapMs: number; cap: number }> = {
  // ≤ 60 a minute and ≤ 10,000 a day is what iNaturalist asks of API clients.
  "api.inaturalist.org": { gapMs: 1100, cap: 9000 },
  "api.taicol.tw": { gapMs: 1000, cap: 5000 },
  "api.checklistbank.org": { gapMs: 500, cap: 5000 },
};
const lastAt = new Map<string, number>();
const sent = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seconds from a Retry-After header, which may be a number or an HTTP date. */
function retryAfterMs(h: string | null): number | null {
  if (!h) return null;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(h);
  return Number.isNaN(t) ? null : Math.max(0, t - Date.now());
}

async function getJson(url: string): Promise<Cached> {
  const file = join(CACHE_DIR, createHash("sha1").update(url).digest("hex") + ".json");
  if (!REFRESH && existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Cached;
  if (OFFLINE) throw new Error(`--offline and not cached: ${url}`);

  const host = new URL(url).host;
  const policy = HOSTS[host];
  if (!policy) throw new Error(`no request policy for ${host}`);

  for (let attempt = 0; ; attempt++) {
    const n = (sent.get(host) ?? 0) + 1;
    if (n > policy.cap) throw new Error(`${host}: ${policy.cap} requests this run, stopping`);
    const wait = (lastAt.get(host) ?? 0) + policy.gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt.set(host, Date.now());
    sent.set(host, n);

    let status = 0;
    let retryMs: number | null = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { "user-agent": USER_AGENT, accept: "application/json" },
        });
        status = res.status;
        if (res.ok || status === 404 || status === 400) {
          const body = res.ok ? await res.json() : null;
          const cached: Cached = { url, fetched_at: new Date().toISOString(), status, body };
          mkdirSync(CACHE_DIR, { recursive: true });
          writeFileSync(file, JSON.stringify(cached));
          return cached;
        }
        retryMs = retryAfterMs(res.headers.get("retry-after"));
        await res.body?.cancel();
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      if (attempt >= 5) throw err;
    }
    if (attempt >= 5) throw new Error(`HTTP ${status} for ${url}`);
    // 429: wait as long as the server asked, or a minute if it did not say.
    // Anything else transient: 2, 4, 8, 16, 32 seconds.
    const delay = status === 429 ? (retryMs ?? 60_000) : Math.min(2000 * 2 ** attempt, 32_000);
    console.warn(`\n  ${host} answered ${status || "nothing"}; waiting ${Math.round(delay / 1000)}s`);
    await sleep(delay);
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

type Taxon = {
  taicol_id: string;
  parent_taicol_id: string | null;
  scientific_name: string;
  common_name_zh: string | null;
  alt_names_zh: string[] | null;
  rank: string | null;
  kingdom: string | null;
  class: string | null;
  name_author: string | null;
};

/**
 * A name from a source, the scientific name the source filed it under, and
 * that name's authority when the source gives one (AviList and MDD do).
 */
type Hit = { name: string; alts: string[]; source: string; matched: string; authority: string | null };

/**
 * The taxon a source is being asked about — its scientific name, kingdom and
 * TaiCOL's Chinese names — and why the sources said nothing usable, collected
 * for the file's `why`.
 */
type Ctx = { sci: string; kingdom: string | null; zh: (string | null)[]; why: string[] };
const ctxOf = (t: Taxon): Ctx => ({
  sci: t.scientific_name,
  kingdom: t.kingdom,
  zh: [t.common_name_zh, ...(t.alt_names_zh ?? [])],
  why: [],
});

const INFRASPECIFIC = new Set(["Subspecies", "Variety", "Form", "Special Form"]);

/**
 * A checklist indexed by exact name and by genus plus epithet stem, so that
 * "Lophospiza trivirgatus" finds AviList's "Lophospiza trivirgata": the same
 * name, agreeing with a different genus's gender. A stem shared by two entries
 * of one genus is ambiguous and matches neither.
 */
function checklist<T>(rows: [string, T][]) {
  const exact = new Map<string, { sci: string; row: T }>();
  const byStem = new Map<string, { sci: string; row: T } | null>();
  const stemKey = (name: string) => {
    const p = nameParts(name);
    return p.length >= 2 ? `${p[0].toLowerCase()} ${epithetStem(p[1])}` : null;
  };
  for (const [sci, row] of rows) {
    exact.set(sci.toLowerCase(), { sci, row });
    const k = stemKey(sci);
    if (k) byStem.set(k, byStem.has(k) ? null : { sci, row });
  }
  return (name: string) => {
    const hit = exact.get(name.toLowerCase());
    if (hit) return hit;
    const k = stemKey(name);
    return (k && byStem.get(k)) || null;
  };
}

const AVILIST = checklist(
  csvRecords(readFileSync(AVILIST_CSV, "utf8")).map((r) => [
    r.Scientific_name,
    { authority: r.Authority, avilist: r.English_name_AviList, clements: r.English_name_Clements_v2025 },
  ]),
);

const MDD = checklist(
  csvRecords(readFileSync(MDD_CSV, "utf8")).map((r) => [
    r.sciName.replace(/_/g, " "),
    {
      authority: `${r.authoritySpeciesAuthor}, ${r.authoritySpeciesYear}`,
      main: r.mainCommonName,
      other: r.otherCommonNames ? r.otherCommonNames.split("|") : [],
    },
  ]),
);

/** iNaturalist's iconic taxa that are not animals, and the kingdom each is in. */
const ICONIC_KINGDOM: Record<string, string> = {
  Plantae: "Plantae",
  Fungi: "Fungi",
  Protozoa: "Protozoa",
  Chromista: "Chromista",
};

/**
 * A plant and an animal can share a binomial. iNaturalist's search does not
 * take a kingdom, so check the answer's iconic taxon against TaiCOL's kingdom.
 */
function kingdomAgrees(iconic: string | null | undefined, kingdom: string | null): boolean {
  if (!iconic || !kingdom) return true;
  return (ICONIC_KINGDOM[iconic] ?? "Animalia") === kingdom;
}

type InatTaxon = {
  id: number;
  name: string;
  rank: string;
  is_active: boolean;
  matched_term?: string;
  preferred_common_name?: string;
  iconic_taxon_name?: string | null;
  names?: { name: string; locale: string; is_valid?: boolean }[];
};

type ColVernacular = { name?: string; language?: string };
type ColMatch = {
  match?: boolean;
  type?: string;
  usage?: { id: string; name: string; status: string; parentId?: string };
};

async function taicolSynonyms(taicolId: string): Promise<string[]> {
  const r = await getJson(`https://api.taicol.tw/v2/taxon?taxon_id=${encodeURIComponent(taicolId)}`);
  const d = r.body as { data?: { synonyms?: string | null }[] } | null;
  const raw = d?.data?.[0]?.synonyms ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const sameName = (a: string, b: string) =>
  a.toLowerCase().replace(/grey/g, "gray").replace(/[^a-z]/g, "") ===
  b.toLowerCase().replace(/grey/g, "gray").replace(/[^a-z]/g, "");

function acceptable(ctx: Ctx, label: string, name: string | undefined | null): name is string {
  if (!name) return false;
  const p = nameProblem(name, ctx.sci);
  if (p) ctx.why.push(`${label} "${name}": ${p}`);
  return !p;
}

function fromAviList(n: string, ctx: Ctx): Hit | null {
  const hit = AVILIST(n);
  if (!hit) return null;
  // Clements v2025 is what Taiwan's own checklist uses. The 37 AviList species
  // Clements does not recognise have only AviList's name.
  const display = displayName(hit.row.clements || hit.row.avilist);
  if (!acceptable(ctx, "avilist", display)) return null;
  return {
    name: display,
    alts: cleanAlts([hit.row.avilist], display, ctx.sci),
    source: hit.row.clements ? "avilist-v2025b:clements-v2025" : "avilist-v2025b:avilist",
    matched: hit.sci,
    authority: hit.row.authority || null,
  };
}

function fromMdd(n: string, ctx: Ctx): Hit | null {
  const hit = MDD(n);
  const display = hit ? displayName(hit.row.main) : null;
  if (!hit || !acceptable(ctx, "mdd", display)) return null;
  return {
    name: display,
    alts: cleanAlts(hit.row.other, display, ctx.sci),
    source: "mdd-v2.5",
    matched: hit.sci,
    authority: hit.row.authority,
  };
}

async function fromInat(n: string, ctx: Ctx): Promise<Hit | null> {
  const params = new URLSearchParams({
    q: n,
    rank: "species",
    locale: "en",
    per_page: "30",
    is_active: "any",
    all_names: "true",
  });
  const r = await getJson(`https://api.inaturalist.org/v1/taxa?${params}`);
  const results = ((r.body as { results?: InatTaxon[] } | null)?.results ?? []).filter(
    (x) => x.rank === "species" && kingdomAgrees(x.iconic_taxon_name, ctx.kingdom),
  );
  const [genus] = nameParts(n);
  const same = (x: InatTaxon) => nameParts(x.name)[0] === genus && sameEpithet(x.name, n);
  // An active taxon of this name (allowing for gender); else an active taxon
  // iNaturalist files this name under, if it kept the epithet — iNaturalist
  // lumps too, and the same rule as TaiCOL's synonyms applies; else a retired
  // taxon of this name.
  const pick =
    results.find((x) => x.is_active && same(x)) ??
    results.find(
      (x) => x.is_active && (x.matched_term ?? "").toLowerCase() === n.toLowerCase() && sameEpithet(x.name, n),
    ) ??
    results.find((x) => !x.is_active && same(x));
  if (!pick) return null;
  const display = pick.preferred_common_name ? displayName(pick.preferred_common_name) : null;
  if (!acceptable(ctx, "inat", display)) return null;
  const others = (pick.names ?? []).filter((x) => x.locale === "en" && x.is_valid !== false).map((x) => x.name);
  return {
    name: display,
    alts: cleanAlts(others, display, ctx.sci),
    source: `inat-${r.fetched_at.slice(0, 7)}`,
    matched: pick.name,
    authority: null,
  };
}

async function fromCol(n: string, ctx: Ctx): Promise<Hit | null> {
  const params = new URLSearchParams({ scientificName: n, kingdom: ctx.kingdom ?? "Animalia" });
  const m = (await getJson(`${COL}/match/nameusage?${params}`)).body as ColMatch | null;
  const u = m?.usage;
  if (!m?.match || !u?.id || u.name.toLowerCase() !== n.toLowerCase()) return null;
  let id = u.id;
  let matched = u.name;
  if (u.status !== "accepted" && u.status !== "provisionally accepted") {
    if (!u.parentId) return null;
    const acc = (await getJson(`${COL}/taxon/${encodeURIComponent(u.parentId)}`)).body as {
      id?: string;
      name?: { scientificName?: string };
    } | null;
    const accName = acc?.name?.scientificName;
    if (!acc?.id || !accName || !sameEpithet(accName, n)) {
      ctx.why.push(`col files ${n} under ${accName ?? "?"}`);
      return null;
    }
    id = acc.id;
    matched = accName;
  }
  const v = (await getJson(`${COL}/taxon/${encodeURIComponent(id)}/vernacular`)).body as ColVernacular[] | null;
  const eng: string[] = [];
  for (const x of v ?? []) {
    const name = x.language === "eng" ? x.name?.trim() : "";
    if (name && !eng.some((e) => sameName(e, name))) eng.push(name);
  }
  if (eng.length === 0) return null;
  if (eng.length > 1) {
    ctx.why.push(`col has ${eng.length} different English names`);
    return null;
  }
  // A record carrying another species' vernaculars gives itself away in its
  // Chinese names; see chineseNamesAgree(). COL's Dopasia formosensis holds
  // D. harti's 脆蛇蜥 and "Hart's Glass Lizard", and D. harti is on this site
  // with records of its own, so the two would have shown one English name.
  // Only COL is held to this: it is the source of last resort, taken on a
  // single name with nothing else to corroborate it.
  const zho = (v ?? []).filter((x) => x.language === "zho" && x.name).map((x) => x.name!.trim());
  if (chineseNamesAgree(zho, ctx.zh) === false) {
    ctx.why.push(`col's Chinese name ${zho.join("/")} is not TaiCOL's, so its English one may be another species'`);
    return null;
  }
  const display = displayName(eng[0]);
  if (!acceptable(ctx, "col", display)) return null;
  return { name: display, alts: cleanAlts([], display, ctx.sci), source: COL_SOURCE, matched, authority: null };
}

/**
 * The English name of one species, or the reasons there is none.
 *
 * TaiCOL's own binomial is asked first; its synonyms are fetched only when a
 * source does not know it, so most species cost one request or none.
 */
async function nameSpecies(t: Taxon): Promise<Hit | { why: string }> {
  const parts = nameParts(t.scientific_name);
  if (parts.length < 2 || parts.includes("×") || /^x$/i.test(parts[1])) return { why: "not a binomial" };
  const own = `${parts[0]} ${parts[1]}`;
  const ctx = ctxOf(t);

  let candidates: string[] | null = null;
  const tryNames = async (fn: (n: string) => Promise<Hit | null> | Hit | null) => {
    const direct = await fn(own);
    if (direct) return direct;
    candidates ??= synonymCandidates(own, await taicolSynonyms(t.taicol_id));
    for (const c of candidates) {
      const h = await fn(c);
      if (h) return h;
    }
    return null;
  };

  if (t.class === "Aves") {
    const hit = await tryNames((n) => fromAviList(n, ctx));
    if (hit) return hit;
    ctx.why.push("not in AviList");
  }
  if (t.class === "Mammalia") {
    const hit = await tryNames((n) => fromMdd(n, ctx));
    if (hit) return hit;
    ctx.why.push("not in MDD");
  }
  const inat = await tryNames((n) => fromInat(n, ctx));
  if (inat) return inat;
  ctx.why.push("no English name on iNaturalist");

  const col = await tryNames((n) => fromCol(n, ctx));
  if (col) return col;
  if (!ctx.why.some((w) => w.startsWith("col"))) ctx.why.push("no English name in COL");
  // A synonym COL files under the same record gets the same answer; say it once.
  return { why: [...new Set(ctx.why)].join("; ") };
}

/**
 * A subspecies the source treats as a species of its own, or null.
 *
 * Inheriting the species' name is right for most of Taiwan's subspecies and
 * wrong for the ones an authority has split off. TaiCOL keeps Taiwan's cattle
 * egret as *Bubulcus ibis coromandus*; Clements v2025 made it a species,
 * *Ardea coromanda*, the Eastern Cattle-Egret, and calls what is left of *ibis*
 * the Western Cattle-Egret — a bird Taiwan does not have. So before a
 * subspecies inherits, its own epithet is asked about as a species, in its
 * TaiCOL genus and in the genus the source filed its species under. A
 * nominate subspecies (ibis ibis) is its species and is not asked about.
 *
 * Animals only. In zoology a subspecies epithet and a species epithet in one
 * genus are the same name, so a species "Ardea coromanda" can only be the
 * raised subspecies. Botany has no such rule: a variety "japonica" and an
 * unrelated species "japonica" routinely share a genus.
 */
async function nameElevated(t: Taxon, species: Hit | null): Promise<Hit | null> {
  const p = nameParts(t.scientific_name);
  if (t.kingdom !== "Animalia") return null;
  if (p.length < 3 || epithetStem(p[2]) === epithetStem(p[1])) return null;
  const ctx = ctxOf(t);
  const genera = [...new Set([p[0], species ? nameParts(species.matched)[0] : null])].filter(
    (g): g is string => !!g,
  );
  for (const g of genera) {
    const n = `${g} ${p[2]}`;
    const hit =
      t.class === "Aves" ? fromAviList(n, ctx) : t.class === "Mammalia" ? fromMdd(n, ctx) : await fromInat(n, ctx);
    if (!hit) continue;
    // iNaturalist gives no authority; the Catalogue of Life usually knows it.
    const authority = hit.authority ?? (await colAuthorship(hit.matched, t.kingdom));
    // A different year and author is a different name that collided with
    // this one. No authority to compare (a split too recent for COL) is not
    // evidence against, and the source did file that name as a species.
    if (sameAuthority(t.name_author, authority) === false) {
      notRaised.push(`${t.taicol_id} ${t.scientific_name} ${t.name_author ?? ""} is not ${hit.matched} ${authority ?? ""}`);
      continue;
    }
    return hit;
  }
  return null;
}

/** Subspecies that looked raised to a species but whose authority says otherwise. */
const notRaised: string[] = [];

async function colAuthorship(name: string, kingdom: string | null): Promise<string | null> {
  const params = new URLSearchParams({ scientificName: name, kingdom: kingdom ?? "Animalia" });
  const m = (await getJson(`${COL}/match/nameusage?${params}`)).body as
    | { usage?: { name?: string; authorship?: string } }
    | null;
  return m?.usage?.name?.toLowerCase() === name.toLowerCase() ? (m.usage.authorship ?? null) : null;
}

// ---------------------------------------------------------------------------
// Scope, and the run
// ---------------------------------------------------------------------------

async function loadScope(): Promise<{ scope: Taxon[]; byId: Map<string, Taxon> }> {
  const scope = await sql<Taxon[]>`
    select t.taicol_id, t.parent_taicol_id, t.scientific_name, t.common_name_zh, t.alt_names_zh,
           t.rank, t.kingdom, t.class, t.name_author
      from taxa t
     where t.id in (select taxon_id from reports_public where taxon_id is not null)
        or t.is_invasive
        or (t.protected_status is not null
            and t.taxon_status = 'accepted'
            and t.rank in ('Species', 'Subspecies'))
        or (t.is_in_taiwan
            and t.taxon_status = 'accepted'
            and t.rank in ('Species', 'Subspecies')
            and t.class in ('Aves', 'Mammalia', 'Reptilia', 'Amphibia'))
     order by t.taicol_id`;

  // The species of every subspecies in scope, so the subspecies has a name to
  // inherit even when its species is not itself recorded or protected.
  const parentIds = [
    ...new Set(
      scope
        .filter((t) => INFRASPECIFIC.has(t.rank ?? "") && t.parent_taicol_id)
        .map((t) => t.parent_taicol_id!),
    ),
  ];
  const parents = parentIds.length
    ? await sql<Taxon[]>`
        select taicol_id, parent_taicol_id, scientific_name, common_name_zh, alt_names_zh,
               rank, kingdom, class, name_author
          from taxa where taicol_id = any(${parentIds}::text[])`
    : [];
  const byId = new Map<string, Taxon>();
  for (const t of [...scope, ...parents]) byId.set(t.taicol_id, t);
  return { scope, byId };
}

async function main() {
  const { scope, byId } = await loadScope();
  console.log(`English names for ${scope.length.toLocaleString()} taxa in scope\n`);

  const names: Record<string, NameEntry> = {};
  const entry = (t: Taxon, rest: Omit<NameEntry, "scientific_name" | "common_name_zh">): NameEntry => ({
    scientific_name: t.scientific_name,
    common_name_zh: t.common_name_zh,
    ...rest,
  });

  // Each infraspecific taxon's species, or the reason it shows none. A pathogen's
  // host form does not look its species up at all (see inheritsSpeciesName()).
  const speciesOf = new Map<string, Taxon | string>();
  for (const t of scope) {
    if (!INFRASPECIFIC.has(t.rank ?? "")) continue;
    if (!inheritsSpeciesName(t.rank, t.kingdom)) {
      speciesOf.set(
        t.taicol_id,
        `a ${t.rank} in ${t.kingdom ?? "an unknown kingdom"} is taken for a pathogen's host form, which its species' name does not describe`,
      );
      continue;
    }
    const p = t.parent_taicol_id ? byId.get(t.parent_taicol_id) : undefined;
    speciesOf.set(t.taicol_id, p && p.rank === "Species" ? p : `parent ${t.parent_taicol_id ?? "none"} is not a species`);
  }

  const toLookUp = new Map<string, Taxon>();
  for (const t of scope) if (t.rank === "Species") toLookUp.set(t.taicol_id, t);
  for (const s of speciesOf.values()) if (typeof s !== "string") toLookUp.set(s.taicol_id, s);

  const species = [...toLookUp.values()].sort((a, b) => a.taicol_id.localeCompare(b.taicol_id));
  const hits = new Map<string, Hit>();
  const viaOf = (t: Taxon, h: Hit) =>
    h.matched.toLowerCase() === nameParts(t.scientific_name).slice(0, 2).join(" ").toLowerCase() ? null : h.matched;
  let done = 0;
  for (const t of species) {
    const r = await nameSpecies(t);
    if ("why" in r) {
      names[t.taicol_id] = entry(t, { name: null, alts: [], source: null, via: null, why: r.why });
    } else {
      hits.set(t.taicol_id, r);
      names[t.taicol_id] = entry(t, { name: r.name, alts: r.alts, source: r.source, via: viaOf(t, r) });
    }
    done++;
    if (done % 25 === 0 || done === species.length)
      process.stdout.write(`\r  species looked up: ${done}/${species.length}   `);
  }
  process.stdout.write("\n");

  // Species whose Taiwanese subspecies a source has made a species of its own:
  // the species' name may describe animals Taiwan does not have. Printed for
  // review, and settled in the overrides file. The ones already settled are
  // printed apart, so an unsettled one cannot hide among them — Larus
  // argentatus sat in this list as "European Herring Gull" through a review.
  const settled = new Set(loadOverrides().map((o) => o.taicol_id));
  const splits: { line: string; settled: boolean }[] = [];
  for (const t of scope) {
    if (names[t.taicol_id]) continue;
    const s = speciesOf.get(t.taicol_id);
    if (s && typeof s !== "string") {
      const parentHit = hits.get(s.taicol_id) ?? null;
      const own = await nameElevated(t, parentHit);
      if (own) {
        names[t.taicol_id] = entry(t, { name: own.name, alts: own.alts, source: own.source, via: own.matched });
        if (parentHit && !sameName(parentHit.name, own.name))
          splits.push({
            line:
              `${s.taicol_id} ${s.scientific_name} "${parentHit.name}" — its subspecies ${t.taicol_id} ` +
              `${t.scientific_name} is ${own.matched} "${own.name}" in ${own.source}`,
            settled: settled.has(s.taicol_id) || settled.has(t.taicol_id),
          });
        continue;
      }
      const p = names[s.taicol_id];
      names[t.taicol_id] = p.name
        ? entry(t, { name: p.name, alts: p.alts, source: p.source, via: p.via, inherited_from: s.taicol_id })
        : entry(t, { name: null, alts: [], source: null, via: null, inherited_from: s.taicol_id, why: "its species has no English name" });
    } else {
      names[t.taicol_id] = entry(t, {
        name: null,
        alts: [],
        source: null,
        via: null,
        why: typeof s === "string" ? s : `rank ${t.rank ?? "unknown"} is not looked up`,
      });
    }
  }

  const file: NamesFile = {
    generated_by: "scripts/build-english-names.ts",
    generated_at: new Date().toISOString().slice(0, 10),
    scope:
      "taxa with a public record, TaiCOL's invasive taxa, protected species and subspecies, " +
      "accepted Taiwanese birds, mammals, reptiles and amphibians, and the species of any subspecies among them",
    sources: Object.fromEntries(
      Object.entries(SOURCES).map(([k, v]) => [k, { ...v }]),
    ) as Record<string, Record<string, string>>,
    names,
  };
  writeFileSync(NAMES_PATH, serializeNamesFile(file));

  const all = Object.values(names);
  const bySource = new Map<string, number>();
  for (const e of all) {
    const k = e.name ? (e.inherited_from ? `${e.source} (inherited)` : e.source!) : "none";
    bySource.set(k, (bySource.get(k) ?? 0) + 1);
  }
  console.log(`\n  wrote ${NAMES_PATH}\n  ${all.length.toLocaleString()} taxa, ${all.filter((e) => e.name).length.toLocaleString()} named`);
  for (const [k, v] of [...bySource].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(5)}  ${k}`);
  const openSplits = splits.filter((x) => !x.settled);
  const settledSplits = splits.filter((x) => x.settled);
  if (openSplits.length) {
    console.log(
      `\n  ${openSplits.length} species whose subspecies a source treats as its own species; review the species' name:`,
    );
    for (const x of openSplits) console.log(`    ${x.line}`);
  }
  if (settledSplits.length) {
    console.log(`\n  ${settledSplits.length} more, whose species or subspecies already has a row in the overrides file:`);
    for (const x of settledSplits) console.log(`    ${x.line}`);
  }
  if (notRaised.length) {
    console.log(`\n  ${notRaised.length} subspecies NOT taken for the species that shares their epithet (different authority):`);
    for (const x of notRaised) console.log(`    ${x}`);
  }
  console.log(`\n  requests sent: ${[...sent].map(([h, n]) => `${h} ${n}`).join(", ") || "none (all cached)"}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error("\nbuild-english-names failed:\n", err);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
