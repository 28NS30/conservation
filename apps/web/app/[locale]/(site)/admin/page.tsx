import { getTranslations, setRequestLocale } from "next-intl/server";
import PageHeader from "@/components/site/PageHeader";
import { Link } from "@/i18n/navigation";
import { sql } from "@/lib/db";
import { currentRole } from "@/lib/auth";
import { signedPhotoUrl } from "@/lib/supabase/service";
import { CATEGORIES, type Category } from "@conservation/shared";
import ModerationRow from "@/components/admin/ModerationRow";

export const dynamic = "force-dynamic";

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
  photo_paths: string[] | null;
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
          <Link href="/login" className="text-ember-700 underline">
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
    select r.id, r.category, r.observed_at, r.notes, r.flagged_reason, r.location_precision,
           st_y(r.location::geometry) as lat,
           st_x(r.location::geometry) as lng,
           t.scientific_name, t.common_name_zh,
           array(select p.storage_path from report_photos p
                  where p.report_id = r.id order by p.created_at) as photo_paths
      from reports r
      left join taxa t on t.id = r.taxon_id
     where r.status = 'pending'
     order by r.created_at desc
     limit 100`;

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
              flaggedReason={r.flagged_reason}
              lat={r.lat}
              lng={r.lng}
              speciesLabel={
                r.common_name_zh || r.scientific_name
                  ? `${r.common_name_zh ?? ""} ${r.scientific_name ?? ""}`.trim()
                  : null
              }
              photoUrls={r.photoUrls}
            />
          ))}
        </ul>
      )}
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
