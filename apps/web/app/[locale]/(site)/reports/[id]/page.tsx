import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { asPublic, sql } from "@/lib/db";
import { receiptState } from "@/lib/receipt";
import { currentUserId } from "@/lib/supabase/server";
import { signedPhotoUrl } from "@/lib/supabase/service";
import {
  CATEGORIES,
  type Category,
  type LocationPrecision,
} from "@conservation/shared";
import { currentRole } from "@/lib/auth";
import { licenseLabel } from "@/lib/license";
import ReportMap from "@/components/report/ReportMap";
import SpeciesCard from "@/components/species/SpeciesCard";
import { getSpecies, monthlyCounts, speciesSlug } from "@/lib/species";
import SpeciesConfirm, {
  type Suggestion,
} from "@/components/report/SpeciesConfirm";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Keep whatever is not on the public map out of search results.
 *
 * A published record is indexed as it always was. A receipt is not: it exists
 * for one person holding one id, it says nothing an index could want, and a
 * crawler that finds one and keeps it would turn an id given to a reporter into
 * a public fact. The question asked here is only "is this in the public view",
 * so it takes no viewer and stays the same for everybody.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  if (!UUID.test(id)) return {};

  const [pub] = await asPublic(
    (tx) => tx<{ one: number }[]>`
      select 1 as one from reports_public where id = ${id}::uuid`,
  );
  if (pub) return {};

  const t = await getTranslations({ locale, namespace: "detail" });
  return {
    title: t("receipt.title"),
    robots: { index: false, follow: false },
  };
}

/**
 * The receipt a reporter gets for a report that is not on the map.
 *
 * It carries one fact — this id was received and is not public — in the same
 * words for every held report, plus the words 未採用 for the reporter's own
 * rejected one. No date, category, species, photograph, coordinate or map, and
 * no reason particular to this record: telling a stranger why a given report is
 * not public is exactly the disclosure the obscuring stack exists to prevent.
 * See lib/receipt.ts for what a holder of an id can and cannot learn.
 */
function Receipt({
  state,
  t,
}: {
  state: "held" | "rejected";
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <main className="mx-auto w-full max-w-xl px-6 pb-24 pt-12">
      <h1 className="text-lg font-semibold text-ink-900">
        {t("detail.receipt.title")}
      </h1>
      <p className="mt-3 border-l-4 border-ink-600 pl-3 text-sm leading-relaxed text-ink-700">
        {state === "rejected"
          ? t("me.status.rejected")
          : t("detail.receipt.body")}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <Link
          href="/report"
          className="inline-flex min-h-6 items-center text-ember-700 underline underline-offset-2"
        >
          {t("report.receipt.another")}
        </Link>
        <Link
          href="/map"
          className="inline-flex min-h-6 items-center text-ink-600 underline decoration-ink-900/25 underline-offset-2 hover:text-ink-900"
        >
          {t("nav.backToMap")}
        </Link>
      </div>
    </main>
  );
}

type Row = {
  id: string;
  taxon_id: number | null;
  reporter_id: string | null;
  category: Category;
  location_precision: LocationPrecision;
  is_obscured: boolean;
  observed_at: string;
  notes: string | null;
  taxon_source: string | null;
  verbatim_name: string | null;
  ai_confidence: number | null;
  source: string;
  license: string | null;
  rights_holder: string | null;
  lng: number | null;
  lat: number | null;
  scientific_name: string | null;
  common_name_zh: string | null;
  protected_status: string | null;
};

export default async function ReportPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  if (!UUID.test(id)) notFound();

  // Read through `reports_public` as web_anon. Reports that are unpublished, or
  // whose taxon is rated 座標不開放, are absent from that view — so this page
  // cannot render them at all, rather than relying on a check we might forget.
  const [row] = await asPublic(
    (tx) =>
      tx<Row[]>`
      select rp.id, rp.taxon_id, null::uuid as reporter_id,
             rp.category, rp.location_precision, rp.is_obscured, rp.observed_at,
             rp.notes, rp.taxon_source, rp.verbatim_name, rp.ai_confidence,
             rp.source, rp.license, rp.rights_holder,
             st_x(rp.location_public::geometry) as lng,
             st_y(rp.location_public::geometry) as lat,
             t.scientific_name, t.common_name_zh, t.protected_status
        from reports_public rp
        left join taxa t on t.id = rp.taxon_id
       where rp.id = ${id}::uuid`,
  );

  if (!row) {
    // Not in the public view. That is the ordinary case for a report someone
    // filed minutes ago, and until now it was a 404 — the form linked every
    // reporter here and most of them arrived at nothing. A separate, narrow
    // query answers whether this is a held report of theirs to be told about,
    // deliberately NOT by widening the read above: that one stays the public
    // one, as `web_anon`, seeing only what anybody may see.
    const state = await receiptState(id, await currentUserId());
    if (!state) notFound();
    return <Receipt state={state} t={t} />;
  }

  // Safe to read photo paths with the privileged connection: the row above
  // already proved this report is publicly visible.
  const photos = await sql<{ storage_path: string }[]>`
    select storage_path from report_photos where report_id = ${id}::uuid order by created_at`;
  const urls = (
    await Promise.all(photos.map((p) => signedPhotoUrl(p.storage_path, 900)))
  ).filter((u): u is string => !!u);

  // Top-k AI suggestions. `report_ai_suggestions` is itself joined to published,
  // non-suppressed reports, so it cannot expose anything the page shouldn't.
  const suggestions = await asPublic(
    (tx) =>
      tx<Suggestion[]>`
      select taxon_id as "taxonId", rank, score,
             scientific_name as "scientificName", common_name_zh as "commonNameZh"
        from report_ai_suggestions
       where report_id = ${id}::uuid
       order by rank`,
  );

  // The species card, when this report has a species. Two small reads rather
  // than widening the query above: the page renders without either of them, and
  // neither should be able to fail the page.
  const card = row.taxon_id ? await getSpecies(row.taxon_id) : null;
  const months = row.taxon_id ? await monthlyCounts(row.taxon_id) : null;
  // A peak only means something with enough records to have a shape. Below
  // that, the "peak" is whichever month happened to catch two instead of one.
  const total = months?.reduce((a, b) => a + b, 0) ?? 0;
  const peakMonth =
    months && total >= 12 ? months.indexOf(Math.max(...months)) + 1 : null;

  // Only the report's author or a moderator may change an identification.
  const { userId, role } = await currentRole();
  const [owner] = await sql<{ reporter_id: string | null }[]>`
    select reporter_id from reports where id = ${id}::uuid`;
  const canEdit =
    !!userId &&
    (role === "moderator" || role === "admin" || owner?.reporter_id === userId);

  return (
    <main className="mx-auto w-full max-w-xl px-6 pb-24 pt-12">
      <Link
        href="/map"
        className="text-xs text-ink-500 hover:text-ink-700"
      >
        {t("nav.backToMap")}
      </Link>

      <header className="mt-3 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: CATEGORIES[row.category].color }}
        />
        <h1 className="text-lg font-semibold text-ink-900">
          {t(`categories.${row.category}`)}
        </h1>
      </header>

      <p className="mt-1 text-xs text-ink-500">
        {new Date(row.observed_at).toLocaleString(locale, {
          timeZone: "Asia/Taipei",
        })}
      </p>

      {urls.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {urls.map((u) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={u}
              src={u}
              alt=""
              className="w-full rounded-lg object-cover"
            />
          ))}
        </div>
      )}

      <section className="mt-5 space-y-3 text-sm">
        {/*
          What this turned out to be, as a card.

          A report page is where someone is most curious about the animal —
          they either just filed it or just clicked it on the map — so the
          species gets a card here rather than a line of text. Everything on it
          comes from TaiCOL, so a common species gets exactly as complete a card
          as a rare one, and nothing on it is earned, ranked or unlockable.
        */}
        <div>
          <h2 className="mb-2 text-base font-semibold text-ink-900">
            {t("detail.species")}
          </h2>

          {card ? (
            <>
              <SpeciesCard species={card} peakMonth={peakMonth} />
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
                <Link
                  href={`/species/${speciesSlug(card)}`}
                  className="underline decoration-ink-900/20 underline-offset-2 hover:text-ink-700"
                >
                  {t("species.seeAllRecords")}
                </Link>
                {row.taxon_source === "ai" && (
                  <span>
                    {t("detail.aiSuggested")}
                    {row.ai_confidence != null &&
                      ` · ${Math.round(row.ai_confidence * 100)}%`}
                  </span>
                )}
              </p>
            </>
          ) : (
            <p className="mt-0.5 text-sm text-ink-500">
              {row.verbatim_name ?? t("detail.notYetIdentified")}
            </p>
          )}
        </div>

        {row.notes && (
          <div>
            <h2 className="text-base font-semibold text-ink-900">
              {t("detail.notes")}
            </h2>
            <p className="mt-0.5 whitespace-pre-wrap text-ink-700">
              {row.notes}
            </p>
          </div>
        )}

        <div>
          <h2 className="text-base font-semibold text-ink-900">
            {t("detail.location")}
          </h2>
          <p className="mt-0.5 tabular-nums text-ink-700">
            {row.lat?.toFixed(4)}, {row.lng?.toFixed(4)}
          </p>
          {row.lat != null && row.lng != null && (
            // reports_public coordinates — already generalised for sensitive
            // species by the time they reach this page. See ReportMap.
            <ReportMap
              lat={row.lat}
              lng={row.lng}
              precision={row.location_precision}
              maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined}
            />
          )}
          {row.is_obscured && (
            <p className="mt-1 rounded-lg border border-amber-700/30 bg-amber-600/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800">
              {/* Why it is blurred, not merely that it is. A record with no
                  taxon is blurred because nobody knows what it is, which is a
                  different sentence from "this species is protected" — and
                  telling a reader the second about the first would be a claim
                  about an animal we cannot name (0011_blur_unknown_taxa.sql). */}
              {t(
                row.taxon_id
                  ? "detail.blurredNotice"
                  : "detail.blurredUnknownNotice",
                { precision: t(`precision.${row.location_precision}`) },
              )}
            </p>
          )}
        </div>
      </section>

      <SpeciesConfirm
        reportId={row.id}
        suggestions={suggestions}
        canEdit={canEdit}
        currentTaxonId={row.taxon_id}
      />

      <section className="mt-5 space-y-3 text-sm">
        {row.source === "gbif" && (
          <p className="text-[11px] text-ink-500">
            {t("detail.source")}: GBIF
            {row.rights_holder && ` · ${row.rights_holder}`}
            {row.license && (
              <>
                {" · "}
                <a
                  href={row.license}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ember-700 underline underline-offset-2 transition hover:text-ink-900"
                >
                  {licenseLabel(row.license)}
                </a>
              </>
            )}
          </p>
        )}
      </section>
    </main>
  );
}
