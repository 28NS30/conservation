import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * The sign-in page's title, from a layout because the page is a client
 * component and metadata is server-only. It was the one form page with no
 * title of its own: its tab read only the site name, which is also what the
 * front page's tab reads.
 *
 * Only the title lives here. The page and its form are left exactly as they
 * are; if the page becomes a server component, this can move into it.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "login" });
  return { title: t("heading") };
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
