import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import type postgres from "postgres";
import { asPublic, sql } from "@/lib/db";
import { receiptState } from "@/lib/receipt";
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
import ModeratorSpeciesFix from "@/components/report/ModeratorSpeciesFix";
import SpeciesConfirm, {
  type Suggestion,
} from "@/components/report/SpeciesConfirm";
import InvasiveBadge from "@/components/collections/InvasiveBadge";
import { alternates } from "@/lib/alternates";
import { speciesLabel } from "@/lib/speciesNames";
import SpeciesName from "@/components/species/SpeciesName";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * The date a record was seen, as the source actually recorded it.
 *
 * GBIF gives a date and no time, stored as midnight UTC, which is 08:00 in
 * Taipei — so every imported record, some forty-six thousand, was shown as seen
 * at "上午8:00:00", a time nobody wrote down. Only a report filed here carries a
 * real time, so only a report filed here shows one.
 */
function seenOn(observedAt: string, source: string, locale: string) {
  const d = new Date(observedAt);
  return source === "gbif"
    ? d.toLocaleDateString(locale, { timeZone: "Asia/Taipei", dateStyle: "long" })
    : d.toLocaleString(locale, {
        timeZone: "Asia/Taipei",
        dateStyle: "long",
        timeStyle: "short",
      });
}

/**
 * A title for the tab and for a shared link, and search rules.
 *
 * A published record is titled by what was seen and when — "黑眶蟾蜍 · 2017年
 * 12月31日" — and indexed as it always was. Every record page used to carry the
 * bare site name, so a list of shared records was a list of identical titles.
 *
 * Anything not in the public view is kept out of search results. A receipt
 * exists for one person holding one id, it says nothing an index could want,
 * and a crawler that kept one would turn an id given to a reporter into a
 * public fact.
 *
 * Its title follows what the page below it says. A held report's receipt is
 * titled as the receipt, because the page says "Received" to anyone holding the
 * id and a tab saying "isn't available" above that heading contradicted it.
 * Everything else absent from the view — an id that never existed, a rejected
 * report, a withheld record — gets one neutral title. The receipt title used to
 * be on all of them, which put "Received" over a 404 for a mistyped link.
 *
 * Both questions are asked without a viewer, so the title is the same for
 * everybody. `receiptState(id, null)` answers "held" for a pending report and
 * nothing else: a rejection is disclosed only to its own reporter, and that
 * page keeps the neutral title rather than asking who is looking. See
 * lib/receipt.ts for why confirming a pending id to its holder is safe.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  if (!UUID.test(id)) return {};

  const [pub] = await asPublic(
    (tx) => tx<
      {
        observedAt: string;
        source: string;
        category: Category;
        scientificName: string | null;
        commonNameZh: string | null;
        commonNameEn: string | null;
        taicolId: string | null;
      }[]
    >`
      select rp.observed_at as "observedAt", rp.source, rp.category,
             t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh",
             t.common_name_en as "commonNameEn",
             t.taicol_id as "taicolId"
        from reports_public rp
        left join taxa t on t.id = rp.taxon_id
       where rp.id = ${id}::uuid`,
  );

  const t = await getTranslations({ locale });
  if (!pub) {
    const held = (await receiptState(id, null)) === "held";
    // A moderator opening a published test report sees the record (see the
    // page below), so the tab says what it is rather than "not available".
    const test = !held && (await moderatorSeesTest(id));
    return {
      title: held
        ? t("detail.receipt.title")
        : test
          ? t("detail.testTitle")
          : t("detail.unavailableTitle"),
      robots: { index: false, follow: false },
    };
  }

  // Both names, the page's language first (lib/speciesNames.ts); the
  // category when nobody has named the animal.
  const name = pub.scientificName
    ? speciesLabel({ ...pub, scientificName: pub.scientificName }, locale)
    : t(`categories.${pub.category}`);
  return {
    title: `${name} · ${seenOn(pub.observedAt, pub.source, locale)}`,
    alternates: alternates(locale, `/reports/${id}`),
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
  common_name_en: string | null;
  taicol_id: string | null;
  protected_status: string | null;
  is_invasive: boolean;
};

/** Whether the viewer is a moderator and this id a published test report. */
async function moderatorSeesTest(id: string): Promise<boolean> {
  const { role } = await currentRole();
  if (role !== "moderator" && role !== "admin") return false;
  const [row] = await sql<{ ok: boolean }[]>`
    select true as ok from reports_published
     where id = ${id}::uuid and is_test`;
  return Boolean(row);
}

/**
 * The record as the public sees it, from one of two views with the same rules
 * (migration 0018): `reports_public` for everyone, read as web_anon, or
 * `reports_published` for a moderator's test reports, read on the server's
 * connection. One query for both, so a test is shown with exactly the columns
 * and the blur a real record would have.
 */
function recordQuery(
  tx: postgres.Sql | postgres.TransactionSql,
  id: string,
  from: "public" | "tests",
) {
  return tx<Row[]>`
      select rp.id, rp.taxon_id, null::uuid as reporter_id,
             rp.category, rp.location_precision, rp.is_obscured, rp.observed_at,
             rp.notes, rp.taxon_source, rp.verbatim_name, rp.ai_confidence,
             rp.source, rp.license, rp.rights_holder,
             st_x(rp.location_public::geometry) as lng,
             st_y(rp.location_public::geometry) as lat,
             t.scientific_name, t.common_name_zh, t.common_name_en, t.taicol_id,
             t.protected_status,
             rp.is_invasive
        from ${from === "public" ? tx`reports_public` : tx`reports_published`} rp
        left join taxa t on t.id = rp.taxon_id
       where rp.id = ${id}::uuid
         ${from === "tests" ? tx`and rp.is_test` : tx``}`;
}

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
  const [publicRow] = await asPublic((tx) => recordQuery(tx, id, "public"));

  // A moderator's test report (migration 0018): published, and deliberately
  // absent from the view above. Its sender needs to see what the public
  // would have seen, so a moderator reads it from reports_published, which
  // applies the same rules and keeps tests, on the server's connection. Asked
  // only when the public read found nothing, so an ordinary record costs no
  // extra round trip, and never for anyone but a moderator.
  const viewer = publicRow ? null : await currentRole();
  const [testRow] =
    viewer && (viewer.role === "moderator" || viewer.role === "admin")
      ? await recordQuery(sql, id, "tests")
      : [];
  const row = publicRow ?? testRow;

  if (!row) {
    // Not in the public view. That is the ordinary case for a report someone
    // filed minutes ago, and until now it was a 404 — the form linked every
    // reporter here and most of them arrived at nothing. A separate, narrow
    // query answers whether this is a held report of theirs to be told about,
    // deliberately NOT by widening the read above: that one stays the public
    // one, as `web_anon`, seeing only what anybody may see.
    const state = await receiptState(id, viewer?.userId ?? null);
    if (!state) notFound();
    return <Receipt state={state} t={t} />;
  }

  // Safe to read photo paths with the privileged connection: the row above
  // already proved this report is publicly visible, or is a test report and
  // the viewer a moderator.
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
      select s.taxon_id as "taxonId", s.rank, s.score,
             s.scientific_name as "scientificName", s.common_name_zh as "commonNameZh",
             -- The English name from taxa, which the public role reads, rather
             -- than a new column on the 0004 view.
             t.common_name_en as "commonNameEn", t.taicol_id as "taicolId"
        from report_ai_suggestions s
        left join taxa t on t.id = s.taxon_id
       where s.report_id = ${id}::uuid
       order by s.rank`,
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
  const { userId, role } = viewer ?? (await currentRole());
  const [owner] = await sql<{ reporter_id: string | null }[]>`
    select reporter_id from reports where id = ${id}::uuid`;
  // A moderator's identification is final for the reporter (confirmSpecies
  // refuses it too), so the owner is not offered buttons that would fail.
  const canEdit =
    !!userId &&
    (role === "moderator" ||
      role === "admin" ||
      (owner?.reporter_id === userId && row.taxon_source !== "expert"));

  return (
    <main className="mx-auto w-full max-w-xl px-6 pb-24 pt-12">
      <Link
        href="/map"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900"
      >
        {t("nav.backToMap")}
      </Link>

      {/* The animal is the title when someone has named it: it is what a
          reader came to see, and the kind of report and the date follow it.
          A record nobody has named is titled by what was reported. */}
      {row.scientific_name && (
        <h1 className="mt-3 text-2xl font-semibold leading-tight text-forest-900">
          <SpeciesName
            species={{
              scientificName: row.scientific_name,
              commonNameZh: row.common_name_zh,
              commonNameEn: row.common_name_en,
              taicolId: row.taicol_id,
            }}
            locale={locale}
            secondaryClassName="mt-1 text-base font-normal text-ink-600"
          />
        </h1>
      )}
      <header className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: CATEGORIES[row.category].color }}
        />
        {row.scientific_name ? (
          <p className="text-base font-semibold text-ink-800">
            {t(`categories.${row.category}`)}
          </p>
        ) : (
          <h1 className="text-lg font-semibold text-ink-900">
            {t(`categories.${row.category}`)}
          </h1>
        )}
        {/* From the species, not from the form: a live invasive animal filed
            as a sighting carries it, and a native one filed as invasive does
            not. With no species named, it says what the reporter said and no
            more. */}
        {row.is_invasive && (
          <InvasiveBadge
            label={t(row.taxon_id ? "collections.badge.invasive" : "collections.badge.reported")}
            title={t(row.taxon_id ? "collections.badge.invasiveWhy" : "collections.badge.reportedWhy")}
          />
        )}
      </header>

      <p className="mt-1 text-sm text-ink-600">
        {seenOn(row.observed_at, row.source, locale)}
      </p>

      {/* Only a moderator ever reaches a test report's page (see above), and
          it says what it is before anything else could be mistaken for a
          public record. */}
      {!publicRow && (
        <p
          role="note"
          className="mt-4 rounded-lg border-2 border-dashed border-forest-900/40 bg-paper-100 px-3 py-2.5 text-sm leading-relaxed text-ink-800"
        >
          {t("detail.testNote")}
        </p>
      )}

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
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-sm text-ink-700">
                <Link
                  href={`/species/${speciesSlug(card)}`}
                  className="inline-flex min-h-11 items-center font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900"
                >
                  {t("species.seeAllRecords")}
                </Link>
                {/* The model named this species by itself, not a person. It
                    is not a suggestion — the species is the record's — and the
                    team's rule is that such a record says who named it. */}
                {row.taxon_source === "ai" && (
                  <span>
                    {t("detail.aiIdentified")}
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
          {/* Three decimals, about 100 m, as the list prints them, and marked
              when blurred: four decimals (11 m) on a point that is only true
              to 10 km read as a precision the record does not have. */}
          <p className="mt-0.5 tabular-nums text-ink-700">
            {row.is_obscured && <span aria-hidden>≈ </span>}
            {row.lat?.toFixed(3)}, {row.lng?.toFixed(3)}
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
            <p className="mt-2 rounded-lg border border-amber-700/30 bg-amber-600/10 px-3 py-2.5 text-sm leading-relaxed text-amber-900">
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

      {/* Any species, for a moderator: the list above is only the model's
          five guesses. confirmSpecies checks the role again. */}
      {(role === "moderator" || role === "admin") && (
        <ModeratorSpeciesFix reportId={row.id} />
      )}

      <section className="mt-5 space-y-3 text-sm">
        {/* "Source: GBIF · Taiwan Biodiversity Research Institute" named an
            acronym most readers have never met. The sentence says what GBIF
            is, and whose data this is; /attribution has the rest. */}
        {row.source === "gbif" && (
          <p className="text-sm leading-relaxed text-ink-700">
            {t("detail.source")}:{" "}
            {row.rights_holder
              ? t("detail.sourceGbif", { holder: row.rights_holder })
              : t("detail.sourceGbifNoHolder")}
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
