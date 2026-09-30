import { parseEvidence, type EvidenceResponse } from "@/lib/report/classifyPolicy";

/**
 * The calls to the model service, for the classification worker (a report
 * after it is filed) and for the report form (a photo as soon as it is added,
 * app/api/identify). One place, so both read its answers the same way.
 */

export type MlPrediction = { taxon_id: number; score: number; rank: number };
export type MlResult = {
  predictions: MlPrediction[];
  detectorHit: boolean;
  band: "high" | "medium" | "low";
  modelVersion: string;
};

/**
 * Send the photo bytes rather than a URL.
 *
 * The endpoint accepts either, but a URL requires the photo to be publicly
 * fetchable *from Modal*, which couples inference to storage reachability and
 * fails outright against a local Supabase (Modal's 127.0.0.1 is its own
 * loopback, not the developer's machine). Photos are ~250 KB after the
 * client-side downscale, so inlining them is cheap — and it means a report photo
 * never needs a publicly reachable URL at all.
 */
/**
 * The model service refused the photograph itself: a 400, which it gives for
 * a file it cannot open or one with too many pixels to decode (apps/ml
 * endpoint.py). Sending it again gets the same answer, so the job gives up at
 * once, blurred and held for a person, instead of spending four more calls on
 * the GPU (security audit, 29 September 2026). Every other failure — a 401, a
 * 503, a timeout — may be temporary and is retried as before.
 */
export class ModelRefused extends Error {}

async function modelError(res: Response): Promise<Error> {
  const detail = (await res.text()).slice(0, 200);
  const message = `model endpoint ${res.status}: ${detail}`;
  return res.status === 400 ? new ModelRefused(message) : new Error(message);
}

export async function callModel(
  imageBase64: string,
  category: string,
  timeoutMs = 120_000,
): Promise<MlResult> {
  const url = process.env.ML_ENDPOINT_URL;
  const token = process.env.ML_ENDPOINT_TOKEN;
  if (!url || !token)
    throw new Error("ML_ENDPOINT_URL / ML_ENDPOINT_TOKEN not configured");

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, imageBase64, category }),
    signal: AbortSignal.timeout(timeoutMs), // generous by default: covers a Modal cold start
  });
  if (!res.ok) throw await modelError(res);
  return (await res.json()) as MlResult;
}

/**
 * The evidence contract: no category, because which species a page may be
 * named as is decided here now, and a category reaching the model is how the
 * invasive page's closed list happened. The answer is checked for shape
 * (parseEvidence) so a service that is still the old version fails loudly
 * instead of looking like a model that recognised nothing.
 */
export async function callEvidenceModel(
  imageBase64: string,
  timeoutMs = 120_000,
): Promise<EvidenceResponse> {
  const url = process.env.ML_ENDPOINT_URL;
  const token = process.env.ML_ENDPOINT_TOKEN;
  if (!url || !token)
    throw new Error("ML_ENDPOINT_URL / ML_ENDPOINT_TOKEN not configured");

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, imageBase64, contract: 2 }),
    signal: AbortSignal.timeout(timeoutMs), // generous by default: covers a Modal cold start
  });
  if (!res.ok) throw await modelError(res);
  return parseEvidence(await res.json());
}

