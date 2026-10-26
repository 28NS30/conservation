import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import PageHeader from "@/components/site/PageHeader";
import { Link } from "@/i18n/navigation";
import { sql } from "@/lib/db";
import { currentRole } from "@/lib/auth";
import { signedPhotoUrl } from "@/lib/supabase/service";
import {
  CATEGORIES,
  LOCATION_PRECISION,
  REPORT_PAGE_KEYS,
  type Category,
} from "@conservation/shared";
import ModerationRow from "@/components/admin/ModerationRow";
import FlaggedRow from "@/components/admin/FlaggedRow";
import { signInHref } from "@/components/auth/signInHref";
import { speciesLabel } from "@/lib/speciesNames";
import { flagReason } from "@/lib/report/flagReasons";
import { UNAVAILABLE_FLAG } from "@/lib/report/classificationHold";

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

/** How many held reports the queue shows at once; the header counts them all. */
const QUEUE_PAGE = 100;

/** A published record that still carries a reason to look at it. */
type Flagged = {
  id: string;
  category: Category;
  observed_at: string;
  flagged_reason: string;
  location_precision: string;
  is_test: boolean;
  scientific_name: string | null;
  common_name_zh: string | null;
  common_name_en: string | null;
  model_scientific_name: string | null;
  model_common_name_zh: string | null;
  model_common_name_en: string | null;
  photo_paths: string[] | null;
  /** Still held at 10 km and off the map, waiting for the model (0033). */
  held: boolean;
};

/** How many flagged records are listed at once, oldest first, as the queue. */
const FLAGGED_PAGE = 50;

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

  // The oldest first, and the whole count in the header. Newest-first with a
  // cap of 100 meant a burst of new reports hid everything behind it, and the
  // header counted only what was shown, so the queue looked cleared when it
  // was not (security audit, 29 September 2026).
  const [{ pending }] = await sql<{ pending: number }[]>`
    select count(*)::int as pending from reports where status = 'pending'`;
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
     order by r.created_at, r.id
     limit ${QUEUE_PAGE}`;

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

  // Published, and flagged, which until this list nothing showed to anyone.
  // Two kinds are common: a record the classifier published unidentified
  // because the model could only suggest a species (the moderator should name
  // it), and a record whose reporter and model, sure of itself, name different
  // species, kept on the map under the reporter's name and blurred at least as
  // the model's species would be. The model's first answer is shown beside the
  // record's species, since both kinds are about it. A third is rarer and
  // matters more: a named record still held at 10 km and off the map because
  // the model never answered for its photo. It stays so until a moderator has
  // the model try again (classifyAgain), so the row says that, and offers it.
  const [{ flagged }] = await sql<{ flagged: number }[]>`
    select count(*)::int as flagged from reports
     where status = 'published' and flagged_reason is not null`;
  const flaggedRows = await sql<Flagged[]>`
    select r.id, r.category, r.observed_at, r.flagged_reason, r.location_precision, r.is_test,
           r.held_for_classification as held,
           t.scientific_name, t.common_name_zh, t.common_name_en,
           m.scientific_name as model_scientific_name,
           m.common_name_zh as model_common_name_zh,
           m.common_name_en as model_common_name_en,
           array(select p.storage_path from report_photos p
                  where p.report_id = r.id order by p.created_at) as photo_paths
      from reports r
      left join taxa t on t.id = r.taxon_id
      left join lateral (
        select mt.scientific_name, mt.common_name_zh, mt.common_name_en
          from classifications c
          join taxa mt on mt.id = c.taxon_id
         where c.report_id = r.id
         order by c.rank
         limit 1) m on true
     where r.status = 'published'
       and r.flagged_reason is not null
     order by r.created_at, r.id
     limit ${FLAGGED_PAGE}`;
  const tp = await getTranslations("precision");
  const named = (n: string | null, zh: string | null, en: string | null) =>
    n
      ? `${speciesLabel({ scientificName: n, commonNameZh: zh, commonNameEn: en }, locale)} · ${n}`
      : null;
  const flaggedWithUrls = await Promise.all(
    flaggedRows.map(async (r) => ({
      ...r,
      photoUrls: (
        await Promise.all((r.photo_paths ?? []).map((p) => signedPhotoUrl(p, 900)))
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

  const tg = await getTranslations("moderationGuide");

  return (
    <Shell>
      {/*
        What each button does, for the team's first days of moderating. The
        facts of the tool only (see admin/actions.ts and the blur trigger), not
        policy: what counts as a report worth publishing is the team's to write.
        It starts closed, so to someone who has read it, it costs one line.
      */}
      <details className="mb-6 rounded-lg border border-ink-900/15 bg-paper-100 px-4 py-2">
        <summary className="flex min-h-11 cursor-pointer items-center text-base font-semibold text-forest-900">
          {tg("title")}
        </summary>
        <ul className="mb-2 mt-1 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-800">
          <li>{tg("held")}</li>
          <li>{tg("publish")}</li>
          <li>{tg("reject")}</li>
          <li>{tg("flagged")}</li>
          <li>{tg("tests")}</li>
        </ul>
      </details>

      <p className="mb-4 text-sm text-ink-700">
        {t("pendingCount", { count: pending })}
        {pending > withUrls.length && (
          <> {t("oldestShown", { shown: withUrls.length })}</>
        )}
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

      <section aria-labelledby="flagged-heading" className="mt-12 border-t border-ink-900/10 pt-6">
        <h2 id="flagged-heading" className="text-base font-semibold text-forest-900">
          {t("flagged.heading")}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-700">{t("flagged.body")}</p>
        <p className="mb-4 mt-3 text-sm text-ink-700">
          {t("flagged.count", { count: flagged })}
          {flagged > flaggedWithUrls.length && (
            <> {t("oldestShown", { shown: flaggedWithUrls.length })}</>
          )}
        </p>
        {flaggedWithUrls.length === 0 ? (
          <p className="rounded-lg border border-ink-900/10 bg-paper-100 px-4 py-6 text-center text-sm text-ink-500">
            {t("flagged.empty")}
          </p>
        ) : (
          <ul className="space-y-3">
            {flaggedWithUrls.map((r) => (
              <FlaggedRow
                key={r.id}
                id={r.id}
                categoryLabel={tc(r.category)}
                categoryColor={CATEGORIES[r.category]?.color}
                observedAt={r.observed_at}
                flaggedReason={
                  r.held && r.flagged_reason === UNAVAILABLE_FLAG
                    ? t("flagged.heldUnavailable")
                    : (flagText(r.flagged_reason) ?? r.flagged_reason)
                }
                held={r.held}
                speciesLabel={named(r.scientific_name, r.common_name_zh, r.common_name_en)}
                modelLabel={named(
                  r.model_scientific_name,
                  r.model_common_name_zh,
                  r.model_common_name_en,
                )}
                blurLabel={
                  r.location_precision in LOCATION_PRECISION
                    ? tp(r.location_precision)
                    : r.location_precision
                }
                photoUrls={r.photoUrls}
                test={r.is_test}
              />
            ))}
          </ul>
        )}
      </section>

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
