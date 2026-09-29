import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import PageHeader from "@/components/site/PageHeader";
import { Link } from "@/i18n/navigation";
import { sql } from "@/lib/db";
import { currentRole } from "@/lib/auth";
import { signedPhotoUrl } from "@/lib/supabase/service";
import { CATEGORIES, REPORT_PAGE_KEYS, type Category } from "@conservation/shared";
import ModerationRow from "@/components/admin/ModerationRow";
import { signInHref } from "@/components/auth/signInHref";
import { speciesLabel } from "@/lib/speciesNames";
import { flagReason } from "@/lib/report/flagReasons";

export const dynamic = "force-dynamic";

// Its own title, and never indexed: it shared the home page's title, and a
// role-gated queue is nothing a search engine should list.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("heading"), robots: { index: false, follow: false } };
}

type Pending = {
  id: string;
  category: Category;
  observed_at: string;
  notes: string | null;
  flagged_reason: string | null;
  location_precision: string;
  lat: number;
  lng: number;
  scientific_name: string | null;
  common_name_zh: string | null;
  common_name_en: string | null;
  photo_paths: string[] | null;
  is_test: boolean;
};

/** A test's status, in words that do not say "public" of a test. */
const TEST_STATUSES = ["published", "pending", "rejected"];

type TestReport = {
  id: string;
  category: Category;
  status: string;
  created_at: string;
};

export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const tc = await getTranslations("categories");
  const { userId, role } = await currentRole();

  if (!userId) {
    return (
      <Shell>
        <p className="text-sm text-ink-600">
          {t("signInRequired")}{" "}
          <Link href={signInHref(locale, "/admin")} className="text-ember-700 underline">
            {t("signInPrompt")}
          </Link>
        </p>
      </Shell>
    );
  }

  if (role !== "moderator" && role !== "admin") {
    /**
     * Anyone with an account can reach this page, so what it says to a
     * non-moderator is public copy.
     *
     * It used to hand them a hardcoded English sentence — on a site whose
     * default locale is Traditional Chinese — followed by the SQL to promote
     * themselves, with their own user id interpolated into it. That is
     * development scaffolding, and it was being shown to real signed-in people:
     * untranslated, and narrating that the privilege model is a `role` column on
     * `profiles`. Knowing the statement does not grant anyone the ability to run
     * it, so this is not a hole — it is the app explaining its own internals to
     * someone who did not ask, in the wrong language.
     *
     * The hint is genuinely useful when setting up a local database, so it is
     * kept and gated rather than deleted. Same test as the design lab: anywhere
     * that is not production.
     */
    const showSetupHint = process.env.VERCEL_ENV !== "production";
    return (
      <Shell>
        <p className="text-sm text-ink-600">
          {t("moderatorsOnly")}
          {showSetupHint && (
            <span className="mt-2 block text-xs text-ink-500">
              Grant yourself access with:
              <code className="mt-1 block rounded bg-paper-100 px-2 py-1 font-mono text-[11px]">
                update profiles set role = &apos;admin&apos; where id = &apos;
                {userId}&apos;;
              </code>
            </span>
          )}
        </p>
      </Shell>
    );
  }

  const rows = await sql<Pending[]>`
    select r.id, r.category, r.observed_at, r.notes, r.flagged_reason, r.location_precision, r.is_test,
           st_y(r.location::geometry) as lat,
           st_x(r.location::geometry) as lng,
           t.scientific_name, t.common_name_zh, t.common_name_en,
           array(select p.storage_path from report_photos p
                  where p.report_id = r.id order by p.created_at) as photo_paths
      from reports r
      left join taxa t on t.id = r.taxon_id
     where r.status = 'pending'
     order by r.created_at desc
     limit 100`;

  // Why each was held, in the page's language (lib/report/flagReasons.ts);
  // a reason this build does not know is shown as stored rather than hidden.
  const tf = await getTranslations("admin.flag");
  const flagText = (stored: string | null) => {
    if (!stored) return null;
    const known = flagReason(stored);
    return known ? tf(known.key, known.values) : stored;
  };

  const withUrls = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      photoUrls: (
        await Promise.all(
          (r.photo_paths ?? []).map((p) => signedPhotoUrl(p, 900)),
        )
      ).filter((u): u is string => !!u),
    })),
  );

  // The last test reports, whatever became of them. A test the classifier
  // names is published straight away and leaves the queue above, and it is
  // on no public page, so this list is the way back to it.
  const tests = await sql<TestReport[]>`
    select r.id, r.category, r.status, r.created_at
      from reports r
     where r.is_test
     order by r.created_at desc
     limit 10`;

  return (
    <Shell>
      <p className="mb-4 text-xs text-ink-500">
        {t("pendingCount", { count: withUrls.length })}
      </p>

      {withUrls.length === 0 ? (
        <p className="rounded-lg border border-ink-900/10 bg-paper-100 px-4 py-6 text-center text-sm text-ink-500">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {withUrls.map((r) => (
            <ModerationRow
              key={r.id}
              id={r.id}
              categoryLabel={tc(r.category)}
              categoryColor={CATEGORIES[r.category]?.color}
              observedAt={r.observed_at}
              notes={r.notes}
              flaggedReason={flagText(r.flagged_reason)}
              lat={r.lat}
              lng={r.lng}
              speciesLabel={
                r.scientific_name
                  ? `${speciesLabel({ scientificName: r.scientific_name, commonNameZh: r.common_name_zh, commonNameEn: r.common_name_en }, locale)} · ${r.scientific_name}`
                  : null
              }
              photoUrls={r.photoUrls}
              test={r.is_test}
            />
          ))}
        </ul>
      )}

      {/*
        Trying the whole path without it being public (migration 0018). The
        server accepts `test` from moderators only, so these links do nothing
        for anyone else but get their report refused.
      */}
      <section aria-labelledby="test-heading" className="mt-12 border-t border-ink-900/10 pt-6">
        <h2 id="test-heading" className="text-base font-semibold text-forest-900">
          {t("test.heading")}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-700">{t("test.body")}</p>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {REPORT_PAGE_KEYS.map((page) => (
            <li key={page}>
              <Link
                href={{ pathname: `/report/${page}`, query: { test: "1" } }}
                className="inline-flex min-h-11 items-center font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900"
              >
                {t(`test.${page}`)}
              </Link>
            </li>
          ))}
        </ul>
        {tests.length > 0 && (
          <>
            <h3 className="mt-5 text-sm font-semibold text-ink-900">{t("test.recent")}</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {tests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3">
                  <Link
                    href={`/reports/${r.id}`}
                    className="inline-flex min-h-11 items-center text-leaf-700 underline underline-offset-2 hover:text-forest-900"
                  >
                    {tc(r.category)} · {r.id.slice(0, 8)}
                  </Link>
                  <span className="text-ink-600">
                    {TEST_STATUSES.includes(r.status) ? t(`test.status.${r.status}`) : r.status} ·{" "}
                    {new Date(r.created_at).toLocaleString(locale, { timeZone: "Asia/Taipei" })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </Shell>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("admin");
  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-24 pt-12">
      <PageHeader title={t("heading")} />
      {children}
    </main>
  );
}
