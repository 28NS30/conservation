import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import PageHeader from "@/components/site/PageHeader";
import { licenseLabel } from "@/lib/license";
import { asPublic } from "@/lib/db";

export const revalidate = 3600;

/**
 * Data attribution.
 *
 * This page is a licence condition, not a courtesy. The seeded records are
 * CC BY 4.0 via GBIF, which requires attribution, and `reports.license` /
 * `reports.rights_holder` are stored per record precisely so it can be produced
 * from the data rather than hand-maintained and allowed to drift.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "attribution" });
  return { title: t("title") };
}

export default async function AttributionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("attribution");

  const licenses = await asPublic(
    (tx) => tx<
      { license: string | null; rightsHolder: string | null; n: number }[]
    >`
      select license, rights_holder as "rightsHolder", count(*)::int as n
        from reports_public
       where source = 'gbif'
       group by 1, 2
       order by n desc`,
  );

  const total = licenses.reduce((a, b) => a + b.n, 0);
  const licenseName = (url: string | null) =>
    licenseLabel(url) ?? t("unspecified");

  return (
    <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-12">
      <PageHeader title={t("title")} lede={t("intro")} />

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink-900">
          {t("occurrenceData")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          {t.rich("gbifBody", {
            tairon: (c) => (
              <a
                href="https://roadkill.tw"
                target="_blank"
                rel="noreferrer"
                className="text-ember-700 underline-offset-2 hover:underline"
              >
                {c}
              </a>
            ),
            gbif: (c) => (
              <a
                href="https://www.gbif.org/dataset/db09684b-0fd1-431e-b5fa-4c1532fbdb14"
                target="_blank"
                rel="noreferrer"
                className="text-ember-700 underline-offset-2 hover:underline"
              >
                {c}
              </a>
            ),
          })}
        </p>

        {licenses.length > 0 && (
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-ink-500">
              <tr>
                <th className="py-1 font-medium">{t("licence")}</th>
                <th className="py-1 font-medium">{t("rightsHolder")}</th>
                <th className="py-1 text-right font-medium">{t("records")}</th>
              </tr>
            </thead>
            <tbody className="text-ink-600">
              {licenses.map((l, i) => (
                <tr key={i} className="border-t border-ink-900/10">
                  <td className="py-1.5">{licenseName(l.license)}</td>
                  <td className="py-1.5 text-ink-500">
                    {l.rightsHolder ?? t("unspecified")}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {l.n.toLocaleString(locale)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-ink-900/10 font-medium">
                <td className="py-1.5" colSpan={2}>
                  {t("total")}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {total.toLocaleString(locale)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink-900">
          {t("checklist")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          {t.rich("taicolBody", {
            taicol: (c) => (
              <a
                href="https://taicol.tw"
                target="_blank"
                rel="noreferrer"
                className="text-ember-700 underline-offset-2 hover:underline"
              >
                {c}
              </a>
            ),
          })}
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink-900">
          {t("basemap")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          {t("basemapBody")}
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink-900">
          {t("models")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          {t("modelsBody")}
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink-900">
          {t("ourData")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          {t("ourDataBody")}
        </p>
      </section>
    </main>
  );
}
