import { asPublic } from "@/lib/db";
import { receiptState } from "@/lib/receipt";

/**
 * Where each of a phone's sent reports stands: public, held, or gone.
 *
 * For /me, signed out (components/me/SentOnThisPhone.tsx). Reporting needs no
 * account, so for most reporters the only record of what they sent is the
 * list of ids their phone kept (lib/offline/sent.ts), and this says what has
 * become of each.
 *
 * It discloses exactly what /reports/{id} already does to anyone holding the
 * id, and through the same two reads: `reports_public` as web_anon for the
 * public record, and lib/receipt.ts for a held one — that module's docblock is
 * why only `pending` answers there, and why anything else is indistinguishable
 * from an id that was never issued. So "gone" covers rejected, withdrawn,
 * withheld, deleted and never-existed alike, and nobody learns from it which.
 * Always answered as for a stranger, whoever is signed in: a reporter's own
 * rejections are on their signed-in /me, not here.
 *
 * A POST with the ids in the body, so a list of someone's reports is not left
 * in an access log as a query string. At most MAX_IDS per call.
 */
type State = "public" | "held" | "gone";

const MAX_IDS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids : null;
  if (!ids || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === "string" && UUID.test(id)))
    return Response.json({ error: "bad_request" }, { status: 400 });
  const wanted = [...new Set(ids.map((id) => id.toLowerCase()))];

  const shown = await asPublic(
    (tx) => tx<{ id: string }[]>`
      select id::text from reports_public where id = any(${wanted}::uuid[])`,
  );
  const isPublic = new Set(shown.map((r) => r.id));

  const states: Record<string, State> = {};
  for (const id of wanted) {
    states[id] = isPublic.has(id)
      ? "public"
      : (await receiptState(id, null)) === "held"
        ? "held"
        : "gone";
  }

  return Response.json(
    { states },
    // One person's list: never kept by anything shared.
    { headers: { "cache-control": "private, no-store" } },
  );
}
