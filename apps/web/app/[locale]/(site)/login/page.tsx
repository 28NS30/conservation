import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import PageHeader from "@/components/site/PageHeader";
import SignInForm from "@/components/auth/SignInForm";
import { browserPath } from "@/components/auth/signInHref";
import { googleSignInEnabled } from "@/lib/authProviders";
import { safeNextPath } from "@/lib/signInNext";
import { currentUserId } from "@/lib/supabase/server";

/**
 * Rendered per request, not at build time: whether "Continue with Google"
 * appears is the Supabase project's setting as it is now (lib/authProviders.ts),
 * and a page frozen at build would keep showing whatever it was on deploy day.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "login" });
  // Its own title: every tab and bookmark of this page used to read as the
  // site's name alone. Not indexed — a sign-in form is nobody's search result.
  return { title: t("title"), robots: { index: false, follow: true } };
}

/**
 * Sign in.
 *
 * The page says what an account is for and what is kept, before it asks for an
 * address. It used to say that signing in "only gives you your own history",
 * which stops being true the day the forum or a moderator needs an account;
 * what stays true, and is said first, is that reporting never needs one.
 */
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const next =
    safeNextPath(Array.isArray(query.next) ? query.next[0] : query.next) ??
    browserPath(locale, "/");

  // Already signed in — say from a "sign in to reply" link in another tab —
  // so there is nothing to do here but carry on.
  if (await currentUserId()) redirect(next);

  const [t, google] = await Promise.all([getTranslations("login"), googleSignInEnabled()]);

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-24 pt-12 sm:pt-16">
      <PageHeader title={t("heading")} lede={t("explain")} />

      <SignInForm next={next} google={google} callbackError={Boolean(query.error)} />

      <section className="mt-12 border-t border-ink-900/10 pt-8 text-sm leading-relaxed text-ink-700">
        <h2 className="text-base font-semibold text-ink-900">{t("whyTitle")}</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li>{t("whyMine")}</li>
          <li>{t("whyForum")}</li>
          <li>{t("whyModerate")}</li>
        </ul>

        <h2 className="mt-8 text-base font-semibold text-ink-900">{t("keptTitle")}</h2>
        <p className="mt-3">{t("keptBody")}</p>
        <p className="mt-3">
          <Link href="/privacy" className="text-ember-700 underline underline-offset-2">
            {t("privacyLink")}
          </Link>
        </p>
      </section>
    </main>
  );
}
