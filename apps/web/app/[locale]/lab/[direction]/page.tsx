import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import LabFooter from "@/components/lab/chrome/LabFooter";
import LabHeader from "@/components/lab/chrome/LabHeader";
import LabTabBar from "@/components/lab/chrome/LabTabBar";
import Container from "@/components/lab/ui/Container";
import LinkAction from "@/components/lab/ui/LinkAction";
import PageTitle from "@/components/lab/ui/PageTitle";
import Section from "@/components/lab/ui/Section";
import { getLabCopy } from "@/lib/lab/copy";
import {
  LAB_DIRECTION_LABELS,
  isLabDirection,
  labPath,
} from "@/lib/lab/directions";
import type { Locale } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; direction: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { title: getLabCopy(locale).lab.pageHome };
}

/**
 * A STUB. The home page of each direction is PR3's, and replaces this file
 * wholesale.
 *
 * It exists so the direction routes answer 200 from the first commit, and so
 * the chrome around every page — the forest band, the phone tab bar, the
 * footer — is on screen and checkable before anything is built inside it. That
 * is worth a file somebody else will delete: chrome that has never been
 * rendered is chrome that does not work.
 *
 * `LAB_ROUTES` still records home as unbuilt, so the index does not offer it.
 */
export default async function LabDirectionHomeStub({
  params,
}: {
  params: Promise<{ locale: string; direction: string }>;
}) {
  const { locale, direction } = await params;
  setRequestLocale(locale);
  if (!isLabDirection(direction)) return null;
  const copy = getLabCopy(locale);

  return (
    <>
      <LabHeader direction={direction} variant="home" />
      <main className="lab-page-bottom flex-1">
        <Section surface="plate" rule={false} className="py-16">
          <PageTitle size="display">
            {LAB_DIRECTION_LABELS[direction][locale as Locale]}
          </PageTitle>
          <p className="t-lead mt-6 text-(--fg-quiet)">{copy.lab.bannerLong}</p>
          <p className="t-body mt-10">
            <LinkAction
              href={labPath(direction, "/primitives")}
              standalone
              arrow
            >
              {copy.lab.primitives}
            </LinkAction>
          </p>
        </Section>
        <Section rule={false} className="py-16">
          <Container width="prose" className="px-0">
            <p className="t-body text-(--fg-quiet)">{copy.lab.notBuilt}</p>
          </Container>
        </Section>
      </main>
      <LabFooter direction={direction} />
      <LabTabBar direction={direction} reportVariant="outline" />
    </>
  );
}
