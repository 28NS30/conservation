import { getTranslations, setRequestLocale } from "next-intl/server";
import { sql } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { mapFilterSchema } from "@conservation/shared";
import HeatmapView from "@/components/map/HeatmapView";
import LanguageSwitcher from "@/components/LanguageSwitcher";

// Stats are cheap but not worth recomputing per request.
export const revalidate = 300;

type Stats = {
  reports: string;
  species: string;
  obscured: string;
  earliest: string | null;
  latest: string | null;
};

async function getStats(): Promise<Stats> {
  const [row] = await sql<Stats[]>`
    select count(*)::text                                            as reports,
           count(distinct taxon_id)::text                            as species,
           count(*) filter (where is_obscured)::text                 as obscured,
           to_char(min(observed_at), 'YYYY')                         as earliest,
           to_char(max(observed_at), 'YYYY')                         as latest
      from reports_public`;
  return row;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="leading-tight">
      <div className="text-sm font-semibold text-slate-100 tabular-nums sm:text-base">{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  );
}

/**
 * Deep-link target: `/?lng=120.4&lat=22.7&z=11`.
 *
 * Parsed here rather than in the client component so a bad or hostile query
 * string can never reach MapLibre — an out-of-range latitude throws inside
 * `jumpTo` and takes the whole map down with it.
 */
function parseView(q: { lng?: string; lat?: string; z?: string }) {
  const lng = Number(q.lng);
  const lat = Number(q.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -85 || lat > 85) return null;
  const z = Number(q.z);
  return { center: [lng, lat] as [number, number], zoom: Number.isFinite(z) ? Math.min(Math.max(z, 0), 16) : 11 };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const view = parseView(sp as { lng?: string; lat?: string; z?: string });
  // Filters travel in the URL too, so a shared link carries what the sender was
  // actually looking at rather than just where. Parsed with the same schema the
  // tile endpoint uses, so an unknown or malformed filter is dropped rather than
  // handed to the client.
  const parsedFilter = mapFilterSchema.safeParse(sp);
  const initialFilter = parsedFilter.success ? parsedFilter.data : {};

  const t = await getTranslations();
  const s = await getStats();
  const n = (v: string) => Number(v).toLocaleString(locale);

  return (
    // 100dvh rather than an h-full chain from <html>: it does not depend on every
    // ancestor declaring a height, and it tracks mobile browser chrome collapsing,
    // which matters because reports get filed one-handed at the roadside.
    <main className="flex h-[100dvh] flex-col">
      <header className="z-10 flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-white/10 bg-slate-950/90 px-4 py-2.5 backdrop-blur">
        <div className="leading-tight">
          <h1 className="text-sm font-semibold text-slate-50 sm:text-base">{t("site.title")}</h1>
          <p className="text-[11px] text-slate-500">{t("site.tagline")}</p>
        </div>

        <div className="flex items-center gap-4 sm:gap-5">
          <Stat value={n(s.reports)} label={t("stats.records")} />
          <Stat value={n(s.species)} label={t("stats.species")} />
          {s.earliest && s.latest && (
            <Stat value={`${s.earliest}–${s.latest}`} label={t("stats.range")} />
          )}
          <Link
            href="/species"
            className="hidden text-xs text-slate-400 transition hover:text-slate-200 sm:block"
          >
            {t("nav.species")}
          </Link>
          <Link
            href="/stats"
            className="hidden text-xs text-slate-400 transition hover:text-slate-200 sm:block"
          >
            {t("nav.stats")}
          </Link>
          <LanguageSwitcher className="hidden sm:flex" />
          <Link
            href="/report"
            className="rounded-full bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            + {t("nav.report")}
          </Link>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <HeatmapView
          maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined}
          initialView={view}
          initialFilter={initialFilter}
          years={
            s.earliest && s.latest
              ? { first: Number(s.earliest), last: Number(s.latest) }
              : null
          }
        />
      </div>

      <footer className="z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-slate-950/90 px-4 py-1.5 text-[10px] text-slate-500">
        <span>
          {t("footer.dataSource")}:{" "}
          <a className="text-slate-400 underline-offset-2 hover:underline" href="https://roadkill.tw" target="_blank" rel="noreferrer">
            TaiRON
          </a>{" "}
          via{" "}
          <a className="text-slate-400 underline-offset-2 hover:underline" href="https://www.gbif.org" target="_blank" rel="noreferrer">
            GBIF
          </a>{" "}
          (CC BY 4.0) · {t("footer.checklist")}{" "}
          <a className="text-slate-400 underline-offset-2 hover:underline" href="https://taicol.tw" target="_blank" rel="noreferrer">
            TaiCOL
          </a>
          {Number(s.obscured) > 0 && <> · {t("footer.blurredCount", { count: n(s.obscured) })}</>}
        </span>
        <span className="flex items-center gap-3">
          <Link href="/stats" className="hover:text-slate-300 sm:hidden">{t("nav.stats")}</Link>
          <Link href="/about" className="hover:text-slate-300">{t("nav.about")}</Link>
          <Link href="/attribution" className="hover:text-slate-300">{t("nav.attribution")}</Link>
          <Link href="/privacy" className="hover:text-slate-300">{t("nav.privacy")}</Link>
          <LanguageSwitcher className="sm:hidden" />
        </span>
      </footer>
    </main>
  );
}
