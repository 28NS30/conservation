/**
 * A stand-in for the classifier service, so CI can run the photo suggestions.
 *
 * The real service is BioCLIP on a GPU behind Modal (apps/ml), and CI has no
 * GPU and no Modal account, so nothing in CI ever asked /api/identify for a
 * suggestion: the filtering of what the model says (lib/report/identify.ts)
 * and both contracts it speaks (lib/report/classifyPolicy.ts mlContract,
 * docs/ai-rollout.md) were held only by reading their source. This answers
 * the way apps/ml/endpoint.py does, with fixed candidates from the test
 * fixture's taxa, so what the website does with an answer can be checked:
 *
 *   - 布氏樹蛙, a native frog, first at 0.62: what the wildlife page offers,
 *     and on the invasive page the answer it cannot offer and has to say so;
 *   - 多線真稜蜥, an invasive skink, at 0.21: offered on every page;
 *   - 臺灣穗花杉, a tree, at 0.12: outside every page, never offered;
 *   - 澤蛙 at 0.004: under 1%, never offered;
 *
 * and, when the photo's bytes hold the words below, a low-band answer that
 * nothing may be offered from, or the refusal the real service gives a file
 * it cannot open. A photo from a browser's canvas holds neither, and gets the
 * first answer.
 *
 *   stub-ml:low      everything under the wildlife set's 0.378, band "low"
 *   stub-ml:refuse   400, "not a readable image"
 *
 * The legacy contract ({token, imageBase64, category}) answers taxa.id with a
 * band; contract 2 ({token, imageBase64, contract: 2}) answers TaiCOL ids and
 * leaves the deciding to the website. The token must be ML_ENDPOINT_TOKEN, as
 * the real one checks it first. GET /health says it is a stand-in, so a test
 * can tell it is not about to spend the project's GPU.
 *
 *   node apps/web/test/stub-ml.mjs     # listens where ML_ENDPOINT_URL points
 *
 * It refuses any address that is not this machine, as stub-gotrue.mjs does:
 * a laptop's .env points ML_ENDPOINT_URL at production.
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

export const STUB_NAME = "stub-ml";
export const STUB_MODEL_VERSION = "stub-ml-1";

const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The fixture's taxa the answers name, by both keys the two contracts use. */
export const CANDIDATES = {
  native: { id: 32463, taicolId: "t0032463", name: "Polypedates braueri" },
  invasive: { id: 29144, taicolId: "t0029144", name: "Eutropis multifasciata" },
  plant: { id: 52582, taicolId: "t0052582", name: "Amentotaxus formosana" },
  faint: { id: 29194, taicolId: "t0029194", name: "Fejervarya limnocharis" },
};

const ANSWERS = {
  default: {
    band: "medium",
    scores: [
      [CANDIDATES.native, 0.62],
      [CANDIDATES.invasive, 0.21],
      [CANDIDATES.plant, 0.12],
      [CANDIDATES.faint, 0.004],
    ],
  },
  low: {
    band: "low",
    scores: [
      [CANDIDATES.native, 0.2],
      [CANDIDATES.faint, 0.15],
    ],
  },
};

export async function startStubMl({ host = "127.0.0.1", port = 0, token = process.env.ML_ENDPOINT_TOKEN } = {}) {
  /** What each request asked for, for a test to read back. */
  const seen = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    if (req.method === "GET" && url.pathname.replace(/\/$/, "").endsWith("/health"))
      return send(res, 200, { name: STUB_NAME, modelVersion: STUB_MODEL_VERSION, requests: seen.length });
    if (req.method === "GET" && url.pathname.endsWith("/requests")) return send(res, 200, seen);
    if (req.method !== "POST") return send(res, 405, { detail: "Method Not Allowed" });

    let payload;
    try {
      payload = JSON.parse(await text(req));
    } catch {
      return send(res, 400, { detail: "body is not JSON" });
    }
    if (!token || payload?.token !== token) return send(res, 401, { detail: "unauthorized" });
    const contract = payload.contract === undefined ? 1 : payload.contract;
    if (contract !== 1 && contract !== 2) return send(res, 400, { detail: `unknown contract ${contract}` });
    if (contract === 1 && !payload.category) return send(res, 400, { detail: "category required" });
    if (typeof payload.imageBase64 !== "string" || !payload.imageBase64)
      return send(res, 400, { detail: "imageBase64 required" });
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload.imageBase64))
      return send(res, 400, { detail: "imageBase64 is not base64" });

    const bytes = Buffer.from(payload.imageBase64, "base64").toString("latin1");
    seen.push({ contract, category: payload.category ?? null, bytes: bytes.length });
    if (bytes.includes("stub-ml:refuse"))
      return send(res, 400, { detail: "not a readable image: cannot identify image file" });
    const answer = bytes.includes("stub-ml:low") ? ANSWERS.low : ANSWERS.default;

    if (contract === 2)
      return send(res, 200, {
        contract: 2,
        candidates: answer.scores.map(([c, score]) => ({ taicol_id: c.taicolId, score })),
        detectorHit: false,
        modelVersion: STUB_MODEL_VERSION,
        speciesCount: answer.scores.length,
      });
    return send(res, 200, {
      predictions: answer.scores.map(([c, score], i) => ({ taxon_id: c.id, score, rank: i + 1 })),
      detectorHit: false,
      band: answer.band,
      modelVersion: STUB_MODEL_VERSION,
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return {
    url: `http://${host}:${server.address().port}`,
    seen,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

/**
 * Whether ML_ENDPOINT_URL is this stand-in, asked of it rather than assumed:
 * a test that is about to send a photo must not send it to the real GPU.
 */
export async function isStubMl(endpoint = process.env.ML_ENDPOINT_URL) {
  if (!endpoint) return false;
  const target = new URL(endpoint);
  if (!LOCAL.has(target.hostname)) return false;
  const health = await fetch(new URL("/health", target), { signal: AbortSignal.timeout(2000) })
    .then((r) => r.json())
    .catch(() => null);
  return health?.name === STUB_NAME;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function text(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = new URL(process.env.ML_ENDPOINT_URL ?? "http://127.0.0.1:54329");
  if (!LOCAL.has(target.hostname)) {
    console.error(`Refusing to stand in for ${target.origin}: not this machine.`);
    process.exit(1);
  }
  if (!process.env.ML_ENDPOINT_TOKEN) {
    console.error("ML_ENDPOINT_TOKEN is not set: the website would send no token to check.");
    process.exit(1);
  }
  const host = target.hostname === "localhost" ? "127.0.0.1" : target.hostname.replace(/^\[|\]$/g, "");
  const { url } = await startStubMl({ host, port: Number(target.port) || 80 });
  console.log(`${STUB_NAME} listening at ${url}`);
}
