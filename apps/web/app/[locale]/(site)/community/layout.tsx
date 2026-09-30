import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { getMessages, setRequestLocale } from "next-intl/server";
import { clientMessages, FORUM_NAMESPACES } from "@/i18n/clientMessages";
import { routing } from "@/i18n/routing";
import { requireForum } from "@/lib/forum/server";

/**
 * Everything under /community: the gate, and noindex.
 *
 * THE GATE. The forum is off unless the server was started with
 * FORUM_ENABLED=1 (lib/forum/gate.ts), and then every page here is a 404 — not
 * a redirect and not a teaser. This check is the outer one; every page also
 * makes it itself before it queries anything, because Next renders a layout
 * and its page at the same time and a page would otherwise run its queries
 * behind a layout that had already said no.
 *
 * There must be no loading.tsx anywhere under here. Beneath one, a route that
 * calls notFound() answers 200 with the skeleton instead of 404 (see
 * components/site/Skeleton.tsx), which would turn a switched-off forum into a
 * page that exists.
 *
 * NOINDEX, during the pilot (plan section 7): members are mostly minors, and a
 * post a moderator has not yet caught should not sit in a search engine's
 * cache. Metadata merges shallowly and the deepest `robots` wins, so no page
 * under here sets its own; test/forum-gate.test.mjs checks that.
 *
 * Dynamic, because the switch is read when a request arrives, not when the
 * site is built: a page prerendered by a build with the forum off would go on
 * answering 404 after the switch was turned on, and one built with it on would
 * go on answering after it was turned off.
 *
 * MESSAGES. The root layout gives the browser only the namespaces client code
 * outside the forum reads (i18n/clientMessages.ts); the forum's own are added
 * here, so no other page carries them.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function CommunityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  requireForum();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <NextIntlClientProvider messages={clientMessages(await getMessages(), FORUM_NAMESPACES)}>
      <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">{children}</div>
    </NextIntlClientProvider>
  );
}
