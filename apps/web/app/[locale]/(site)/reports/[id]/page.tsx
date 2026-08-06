import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { asPublic, sql } from "@/lib/db";
import { signedPhotoUrl } from "@/lib/supabase/service";
import { CATEGORIES, type Category, type LocationPrecision } from "@conservation/shared";
import { currentRole } from "@/lib/auth";
import SpeciesConfirm, { type Suggestion } from "@/components/report/SpeciesConfirm";

export const dynamic = "force-dynamic";

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

export default async function ReportPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  // Read through `reports_public` as web_anon. Reports that are unpublished, or
  // whose taxon is rated 座標不開放, are absent from that view — so this page
  // cannot render them at all, rather than relying on a check we might forget.
  const [row] = await asPublic((tx) =>
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

  if (!row) notFound();

  // Safe to read photo paths with the privileged connection: the row above
  // already proved this report is publicly visible.
  const photos = await sql<{ storage_path: string }[]>`
    select storage_path from report_photos where report_id = ${id}::uuid order by created_at`;
  const urls = (await Promise.all(photos.map((p) => signedPhotoUrl(p.storage_path, 900)))).filter(
    (u): u is string => !!u,
  );

  // Top-k AI suggestions. `report_ai_suggestions` is itself joined to published,
  // non-suppressed reports, so it cannot expose anything the page shouldn't.
  const suggestions = await asPublic((tx) =>
    tx<Suggestion[]>`
      select taxon_id as "taxonId", rank, score,
             scientific_name as "scientificName", common_name_zh as "commonNameZh"
        from report_ai_suggestions
       where report_id = ${id}::uuid
       order by rank`,
  );

  // Only the report's author or a moderator may change an identification.
  const { userId, role } = await currentRole();
  const [owner] = await sql<{ reporter_id: string | null }[]>`
    select reporter_id from reports where id = ${id}::uuid`;
  const canEdit =
    !!userId && (role === "moderator" || role === "admin" || owner?.reporter_id === userId);


  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-xl px-4 pb-16 pt-5">
      <Link href="/" className="text-xs text-parchment-400 hover:text-parchment-200">
        {t("nav.backToMap")}
      </Link>

      <header className="mt-3 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORIES[row.category].color }} />
        <h1 className="text-lg font-semibold text-parchment-50">{t(`categories.${row.category}`)}</h1>
      </header>

      <p className="mt-1 text-xs text-parchment-400">
        {new Date(row.observed_at).toLocaleString(locale, { timeZone: "Asia/Taipei" })}
      </p>

      {urls.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {urls.map((u) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={u} src={u} alt="" className="w-full rounded-lg object-cover" />
          ))}
        </div>
      )}

      <section className="mt-5 space-y-3 text-sm">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wide text-parchment-500">{t("detail.species")}</h2>
          {row.scientific_name ? (
            <p className="mt-0.5 text-parchment-100">
              {row.common_name_zh && <span className="mr-2">{row.common_name_zh}</span>}
              <span className="italic text-parchment-300">{row.scientific_name}</span>
              {row.protected_status && (
                <span className="ml-2 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                  {t("detail.protected", { level: row.protected_status })}
                </span>
              )}
              {row.taxon_source === "ai" && (
                <span className="ml-2 text-[10px] text-parchment-500">
                  {t("detail.aiSuggested")}{row.ai_confidence != null && ` · ${Math.round(row.ai_confidence * 100)}%`}
                </span>
              )}
            </p>
          ) : (
            <p className="mt-0.5 text-parchment-400">
              {row.verbatim_name ?? t("detail.notYetIdentified")}
            </p>
          )}
        </div>

        {row.notes && (
          <div>
            <h2 className="text-xs font-medium uppercase tracking-wide text-parchment-500">{t("detail.notes")}</h2>
            <p className="mt-0.5 whitespace-pre-wrap text-parchment-200">{row.notes}</p>
          </div>
        )}

        <div>
          <h2 className="text-xs font-medium uppercase tracking-wide text-parchment-500">{t("detail.location")}</h2>
          <p className="mt-0.5 tabular-nums text-parchment-200">
            {row.lat?.toFixed(4)}, {row.lng?.toFixed(4)}
          </p>
          {row.is_obscured && (
            <p className="mt-1 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200">
              {t("detail.blurredNotice", { precision: t(`precision.${row.location_precision}`) })}
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
          <p className="text-[11px] text-parchment-500">
            {t("detail.source")}: GBIF{row.rights_holder && ` · ${row.rights_holder}`}
            {row.license && ` · ${row.license}`}
          </p>
        )}
      </section>
    </main>
  );
}
