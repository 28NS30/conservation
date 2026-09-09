import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { sql } from "@/lib/db";
import { currentUserId } from "@/lib/supabase/server";
import { speciesSlug } from "@/lib/species";
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
  locationPrecision: string;
  taxonId: number | null;
  scientificName: string | null;
  commonNameZh: string | null;
  aiBand: string | null;
  aiConfidence: number | null;
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
 *
 * TWO THINGS THIS PAGE DELIBERATELY IS. It is the journey — a record's four
 * states are all knowable and were all invisible, and the meta-analytic finding
 * on rewards (Deci, Koestner & Ryan 1999) is that non-controlling informational
 * feedback about competence is the one form that does not undermine intrinsic
 * motivation. And it is the collection — the species you have personally put on
 * the map, which is Balmford's actual proposal from Science 2002, built out of
 * real taxa with real pages rather than invented creatures.
 *
 * It stays private, and that is structural rather than shy. A public roster of
 * what someone has recorded is a per-person index over taxa, and taxa are not
 * covered by the obscuring stack — `reports_public` drops `reporter_id` on
 * purpose, and this page must not put it back.
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
           r.is_obscured as "isObscured",
           r.location_precision as "locationPrecision",
           r.taxon_id as "taxonId",
           r.ai_band as "aiBand", r.ai_confidence as "aiConfidence",
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

  // The collection: one entry per species, newest contribution first, which is
  // the order they were added to it.
  const journal = new Map<
    number,
    {
      id: number;
      scientificName: string;
      commonNameZh: string | null;
      n: number;
    }
  >();
  for (const r of rows) {
    if (!r.taxonId || !r.scientificName) continue;
    const seen = journal.get(r.taxonId);
    if (seen) seen.n += 1;
    else
      journal.set(r.taxonId, {
        id: r.taxonId,
        scientificName: r.scientificName,
        commonNameZh: r.commonNameZh,
        n: 1,
      });
  }
  const species = [...journal.values()];

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
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { v: rows.length, k: t("statTotal") },
              { v: published, k: t("statPublished") },
              { v: identified, k: t("statIdentified") },
              { v: species.length, k: t("statSpecies") },
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

          {species.length > 0 && (
            <section className="mt-10">
              <h2 className="text-lg font-semibold text-ink-900">
                {t("journalTitle")}
              </h2>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500">
                {t("journalHint")}
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {species.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/species/${speciesSlug(s)}`}
                      className="flex items-baseline justify-between gap-3 rounded-lg border border-ink-900/10 bg-paper-100/60 px-4 py-2.5 transition hover:border-ink-900/25 hover:bg-paper-100"
                    >
                      <span className="min-w-0">
                        {s.commonNameZh && (
                          <span className="mr-2 text-sm text-ink-900">
                            {s.commonNameZh}
                          </span>
                        )}
                        <span className="text-[12px] italic text-ink-500">
                          {s.scientificName}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-ink-500">
                        {s.n}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <h2 className="mt-10 text-lg font-semibold text-ink-900">
            {t("reportsTitle")}
          </h2>
          <ul className="mt-4 space-y-1.5">
            {rows.map((r) => {
              const name =
                zhFirst && r.commonNameZh ? r.commonNameZh : r.scientificName;
              return (
                <li key={r.id}>
                  <Link
                    href={`/reports/${r.id}`}
                    className="block rounded-lg border border-ink-900/10 bg-paper-100/60 px-4 py-3 transition hover:border-ink-900/25 hover:bg-paper-100"
                  >
                    <span className="flex items-center gap-3">
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
                      {r.status === "rejected" && (
                        <Status label={t("status.rejected")} />
                      )}
                    </span>

                    {r.status !== "rejected" && (
                      <Journey
                        report={r}
                        labels={{
                          submitted: t("journey.submitted"),
                          identified: r.aiConfidence
                            ? t("journey.identifiedAt", {
                                pct: Math.round(r.aiConfidence * 100),
                              })
                            : t("journey.identified"),
                          published: t("journey.published"),
                          open: t("journey.open"),
                        }}
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-500">
            {t("journeyHint")}
          </p>
        </>
      )}
    </main>
  );
}

/**
 * How far a record has got, in the four states that actually exist.
 *
 * `open` is not decoration: the Darwin Core export in scripts/export-dwca.ts
 * takes published, non-suppressed, identified records with source 'user', which
 * is exactly the condition below. Nothing here claims an upload that has not
 * happened — it says the record qualifies for the next one.
 */
function Journey({
  report,
  labels,
}: {
  report: Pick<Row, "status" | "taxonId" | "locationPrecision">;
  labels: {
    submitted: string;
    identified: string;
    published: string;
    open: string;
  };
}) {
  const published = report.status === "published";
  const steps = [
    { label: labels.submitted, done: true },
    { label: labels.identified, done: report.taxonId !== null },
    { label: labels.published, done: published },
    {
      label: labels.open,
      done:
        published &&
        report.taxonId !== null &&
        report.locationPrecision !== "suppressed",
    },
  ];

  return (
    <span className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-[22px]">
      {steps.map((s, i) => (
        <span key={s.label} className="flex items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden className="text-[10px] text-ink-900/25">
              →
            </span>
          )}
          <span
            className={`text-[11px] ${
              s.done ? "font-medium text-moss-700" : "text-ink-400"
            }`}
          >
            {s.done && (
              <span aria-hidden className="mr-1">
                ✓
              </span>
            )}
            {s.label}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Reserved for the one state that is not a stage on the way somewhere. */
function Status({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded bg-rose-600/10 px-2 py-0.5 text-[10px] font-medium text-rose-800 ring-1 ring-inset ring-rose-700/25">
      {label}
    </span>
  );
}
