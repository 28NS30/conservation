import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Container from "@/components/lab/ui/Container";
import LinkAction from "@/components/lab/ui/LinkAction";
import Notice from "@/components/lab/ui/Notice";
import PageTitle from "@/components/lab/ui/PageTitle";
import { List, DataRow } from "@/components/lab/ui/DataRow";
import MustShow from "@/components/lab/compare/MustShow";
import ShotTrio from "@/components/lab/compare/ShotTrio";
import { getLabCopy, type LabCopy } from "@/lib/lab/copy";
import {
  LAB_DIRECTIONS,
  LAB_DIRECTION_LABELS,
  LAB_DIRECTION_NOTES,
  LAB_ROUTES,
  COMPARE_ROWS,
  labPath,
  type LabDirection,
} from "@/lib/lab/directions";
import { VERIFIED } from "@/lib/lab/verified";
import type { Locale } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { title: getLabCopy(locale).lab.indexTitle };
}

/**
 * The page the owner opens, and the only page in the lab that is not a design.
 *
 * Its job is to make one decision easy to make and hard to get wrong. Four rows
 * of screenshots — today's page, then the redesign, then for home the runner-up
 * — each one a link to the real route, so the comparison starts as a glance and
 * ends on the actual page. Then the two questions being asked, the design
 * document's own "must show" table with the verdicts filled in, the numbers
 * that were measured rather than asserted, and a list of what the prototypes
 * fake.
 *
 * IT BELONGS TO NO DIRECTION, so it renders in today's colours. That is the
 * honest thing for it to do: it is not one of the two designs, and dressing it
 * in either would put a thumb on the scale before the owner has seen anything.
 * It still uses the lab's own primitives and semantic variables — outside a
 * `[data-direction]` those fall through to the live palette.
 *
 * NOTHING ON THIS PAGE MAY CLAIM A NUMBER IT DID NOT MEASURE. Every figure
 * comes from `lib/lab/verified.ts`, which carries the date and names the script
 * that produced it, and every criterion the scripts cannot answer says out loud
 * that it needs the owner's own eyes.
 */
function routeLabel(sub: string, copy: LabCopy): string {
  if (sub === "") return copy.lab.pageHome;
  if (sub === "/map") return copy.lab.pageMap;
  if (sub === "/report/stepper") return copy.lab.pageReportStepper;
  if (sub === "/report/photo-first") return copy.lab.pageReportPhotoFirst;
  if (sub === "/primitives") return copy.lab.primitives;
  return `${copy.lab.pageSpecies} ${sub.replace("/species/", "")}`;
}

/** The live catalogue's own word for the page, where it has one. */
function rowTitle(page: string, copy: LabCopy, report: string): string {
  if (page === "home") return copy.lab.pageHome;
  if (page === "map") return copy.lab.pageMap;
  if (page === "report") return report;
  return copy.lab.pageSpecies;
}

/** A section of this page: a 2px rule, a heading, and whatever it holds. */
function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rule-strong mt-16 border-t-2 pt-10">
      <h2 className="t-title">{title}</h2>
      {children}
    </section>
  );
}

export default async function LabComparePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const copy = getLabCopy(locale);
  const nav = await getTranslations("nav");
  const loc = locale as Locale;
  const compare = copy.compare;

  const numbers: [string, string][] = [
    [compare.numberAxe, String(VERIFIED.axeViolations)],
    [compare.numberSmall, String(VERIFIED.textUnderFloor)],
    [compare.numberContrast, `${VERIFIED.contrastFloor.toFixed(2)}:1`],
    [
      compare.numberHomeFont,
      `${VERIFIED.homeFontKb.roundel} KB / ${VERIFIED.homeFontKb.journal} KB`,
    ],
    [compare.numberMapFont, String(VERIFIED.mapFontFiles)],
    [compare.numberTiles, `${VERIFIED.mapTiles.lab} / ${VERIFIED.mapTiles.live}`],
  ];

  const fakes = [
    compare.fakeSend,
    compare.fakeReal,
    copy.lab.emblemNote,
    compare.fakeCopy,
    compare.fakeJournal,
    compare.fakeInjured,
  ];

  return (
    <main className="py-12 md:py-16">
      <Container>
        <PageTitle>{copy.lab.indexTitle}</PageTitle>
        <p className="t-lead mt-6 max-w-(--container-prose) text-(--fg-quiet)">
          {compare.lead}
        </p>

        <Block title={compare.decisionTitle}>
          <p className="t-body mt-4 max-w-(--container-prose)">
            {compare.decisionLead}
          </p>
          <ol className="t-lead mt-6 max-w-(--container-prose) list-decimal space-y-4 ps-6 marker:font-bold">
            <li>{compare.questionDirection}</li>
            <li>{compare.questionFlow}</li>
            <li>{compare.questionLightMap}</li>
          </ol>
        </Block>

        <Block title={compare.howTitle}>
          <div className="t-body mt-4 max-w-(--container-prose) space-y-4">
            <p>{compare.how}</p>
            <p className="text-(--fg-quiet)">{compare.fakeStrip}</p>
          </div>
        </Block>

        {COMPARE_ROWS.map((row) => (
          <ShotTrio
            key={row.page}
            page={row.page}
            title={rowTitle(row.page, copy, nav("report"))}
            note={compare.rowNote[row.note]}
            copy={copy}
            locale={loc}
          />
        ))}

        <Block title={compare.mustTitle}>
          <p className="t-body mt-4 max-w-(--container-prose)">
            {compare.mustLead}
          </p>
          {/* Said once, before the table, because it is the row that decides
              whether the recommendation survives and it is the row no script
              will ever tick. */}
          <Notice className="mt-6 max-w-(--container-prose)" title={compare.must.sun.label}>
            {compare.must.sun.roundel}
          </Notice>
          <MustShow copy={copy} />
        </Block>

        <Block title={compare.numbersTitle}>
          <p className="t-body mt-4 max-w-(--container-prose)">
            {compare.numbersLead}
          </p>
          <List className="mt-8">
            {numbers.map(([label, value]) => (
              <DataRow key={label} name={label} nameSize="lead" value={value} />
            ))}
          </List>
        </Block>

        <Block title={compare.fakesTitle}>
          <ul className="t-body mt-6 max-w-(--container-prose) space-y-4">
            {fakes.map((line) => (
              <li key={line} className="rule-quiet border-l-4 ps-4">
                {line}
              </li>
            ))}
          </ul>
        </Block>

        <Block title={compare.routesTitle}>
          <p className="t-body mt-4 max-w-(--container-prose)">
            {compare.routesLead}
          </p>
          {LAB_DIRECTIONS.map((direction: LabDirection) => {
            const routes = LAB_ROUTES.filter((route) =>
              (route.directions as readonly string[]).includes(direction),
            );
            return (
              <section key={direction} className="mt-10">
                <h3 className="t-head">{LAB_DIRECTION_LABELS[direction][loc]}</h3>
                <p className="t-body mt-2 text-(--fg-quiet)">
                  {LAB_DIRECTION_NOTES[direction][loc]}
                </p>
                <List className="mt-6">
                  {routes.map((route) => (
                    // Two links in one row, so neither wraps the other: the
                    // whole-row link DataRow normally draws would nest an
                    // anchor inside an anchor the moment it also carried
                    // "today's page".
                    <DataRow
                      key={route.sub}
                      name={
                        route.built ? (
                          <LinkAction href={labPath(direction, route.sub)}>
                            {routeLabel(route.sub, copy)}
                          </LinkAction>
                        ) : (
                          routeLabel(route.sub, copy)
                        )
                      }
                      meta={route.built ? undefined : copy.lab.notBuilt}
                      value={
                        <LinkAction href={route.live}>
                          {copy.lab.todaysPage}
                        </LinkAction>
                      }
                    />
                  ))}
                </List>
              </section>
            );
          })}
        </Block>
      </Container>
    </main>
  );
}
