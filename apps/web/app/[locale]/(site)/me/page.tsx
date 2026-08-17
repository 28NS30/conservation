import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { sql } from "@/lib/db";
import { currentUserId } from "@/lib/supabase/server";
import { CATEGORIES, type Category } from "@conservation/shared";
import PageHeader from "@/components/site/PageHeader";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "me" });
  // Never indexable: it is one person's own contributions.
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Row = {
  id: string;
  category: Category;
  observedAt: string;
  status: string;
  isObscured: boolean;
  taxonId: number | null;
  scientificName: string | null;
  commonNameZh: string | null;
  aiBand: string | null;
};

/**
 * Your own reports.
 *
 * Signing in previously did nothing you could see — the only thing an account
 * bought you was a moderator queue you almost certainly could not open. For
 * citizen science that is a wasted mechanic: people contribute again when they
 * can watch their own observations get identified and published.
 *
 * Reads `reports` rather than `reports_public`, because the point is to show
 * someone their OWN submission — including the ones still pending, which by
 * design are absent from the public view. That makes the WHERE clause the whole
 * security boundary, so it is bound to the session's user id and nothing else;
 * there is no id parameter to tamper with.
 */
export default async function MyReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("me");
  const tc = await getTranslations("categories");

  const userId = await currentUserId();
  if (!userId) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-12">
        <PageHeader title={t("title")} lede={t("signedOut")} />
        <Link
          href="/login"
          className="inline-block rounded-full bg-ember-500 px-5 py-2.5 text-sm font-semibold text-bark-950 transition hover:bg-ember-400"
        >
          {t("signIn")}
        </Link>
      </main>
    );
  }

  const rows = await sql<Row[]>`
    select r.id::text, r.category, r.observed_at as "observedAt", r.status,
           r.is_obscured as "isObscured", r.taxon_id as "taxonId",
           r.ai_band as "aiBand",
           t.scientific_name as "scientificName",
           t.common_name_zh as "commonNameZh"
      from reports r
      left join taxa t on t.id = r.taxon_id
     where r.reporter_id = ${userId}::uuid
     order by r.created_at desc
     limit 200`;

  const zhFirst = locale.startsWith("zh");
  const published = rows.filter((r) => r.status === "published").length;
  const identified = rows.filter((r) => r.taxonId).length;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-24 pt-12">
      <PageHeader title={t("title")} lede={t("lede")} />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-ink-900/12 bg-paper-100 p-8 text-center">
          <p className="text-sm text-ink-600">{t("empty")}</p>
          <Link
            href="/report"
            className="mt-5 inline-block rounded-full bg-ember-500 px-5 py-2.5 text-sm font-semibold text-bark-950 transition hover:bg-ember-400"
          >
            {t("first")}
          </Link>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3">
            {[
              { v: rows.length, k: t("statTotal") },
              { v: published, k: t("statPublished") },
              { v: identified, k: t("statIdentified") },
            ].map((x) => (
              <div
                key={x.k}
                className="rounded-lg border border-ink-900/12 bg-paper-100 px-4 py-3.5"
              >
                <dd className="text-xl font-semibold tabular-nums text-ink-900">
                  {x.v.toLocaleString(locale)}
                </dd>
                <dt className="mt-0.5 text-[11px] text-ink-500">{x.k}</dt>
              </div>
            ))}
          </dl>

          <ul className="mt-6 space-y-1.5">
            {rows.map((r) => {
              const name =
                zhFirst && r.commonNameZh ? r.commonNameZh : r.scientificName;
              return (
                <li key={r.id}>
                  <Link
                    href={`/reports/${r.id}`}
                    className="flex items-center gap-3 rounded-lg border border-ink-900/10 bg-paper-100/60 px-4 py-3 transition hover:border-ink-900/25 hover:bg-paper-100"
                  >
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: CATEGORIES[r.category]?.color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink-900">
                        {name ?? t("unidentified")}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-500">
                        {tc(r.category)} ·{" "}
                        {new Date(r.observedAt).toLocaleDateString(locale, {
                          timeZone: "Asia/Taipei",
                        })}
                      </span>
                    </span>
                    <Status status={r.status} label={t(`status.${r.status}`)} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}

/** Where a report has got to, in the one word that matters to its author. */
function Status({ status, label }: { status: string; label: string }) {
  const tone =
    status === "published"
      ? "bg-moss-700/12 text-moss-700 ring-moss-700/25"
      : status === "rejected"
        ? "bg-rose-600/10 text-rose-800 ring-rose-700/25"
        : "bg-amber-600/12 text-amber-800 ring-amber-700/25";
  return (
    <span
      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${tone}`}
    >
      {label}
    </span>
  );
}
