import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import PageHeader from "@/components/site/PageHeader";
import { TEAM_GROUPS, peopleIn, teamPublished } from "@/lib/team";

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "team" });
  return { title: t("title"), description: t("lede") };
}

/**
 * The team, in the order the team asked for: leadership, then FormosaWatch with
 * the people in Taiwan, then FlamaWatch with the people in Colombia.
 *
 * 404s while the roster is empty — see lib/team.ts. The layout is here and
 * reviewed so that adding real people is a data change rather than a build, and
 * so that nobody is tempted to ship placeholder faces to see what it looks like.
 */
export default async function TeamPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!teamPublished()) notFound();

  const t = await getTranslations("team");
  const zh = locale.startsWith("zh");

  return (
    <main className="mx-auto w-full max-w-4xl px-6 pb-24 pt-12">
      <PageHeader title={t("title")} lede={t("lede")} />

      {TEAM_GROUPS.map((group) => {
        const people = peopleIn(group);
        if (people.length === 0) return null;
        return (
          <section key={group} className="mt-12">
            <h2 className="text-lg font-semibold text-ink-900">
              {t(`group.${group}`)}
            </h2>
            <p className="mt-1 text-sm text-ink-500">{t(`place.${group}`)}</p>

            <ul className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {people.map((p) => (
                <li key={p.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element --
                      a local square headshot at its display size; the image
                      optimizer would add a fetch and nothing else. */}
                  <img
                    src={p.photo}
                    alt=""
                    width={640}
                    height={640}
                    className="aspect-square w-full rounded-xl border border-ink-900/10 object-cover"
                  />
                  <p className="mt-2.5 text-[15px] font-medium text-ink-900">
                    {zh ? p.name.zh : p.name.en}
                  </p>
                  <p className="text-[13px] text-ink-600">
                    {zh ? p.role.zh : p.role.en}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-ink-500">
                    {p.email && (
                      <a
                        href={`mailto:${p.email}`}
                        className="underline decoration-ink-900/20 underline-offset-2 hover:text-ink-800"
                      >
                        {t("email")}
                      </a>
                    )}
                    {p.instagram && (
                      <a
                        href={`https://instagram.com/${p.instagram}`}
                        rel="noreferrer noopener"
                        target="_blank"
                        className="underline decoration-ink-900/20 underline-offset-2 hover:text-ink-800"
                      >
                        @{p.instagram}
                      </a>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
