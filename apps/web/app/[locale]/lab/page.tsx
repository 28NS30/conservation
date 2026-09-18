import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import Container from "@/components/lab/ui/Container";
import LinkAction from "@/components/lab/ui/LinkAction";
import PageTitle from "@/components/lab/ui/PageTitle";
import { List, DataRow } from "@/components/lab/ui/DataRow";
import { getLabCopy, type LabCopy } from "@/lib/lab/copy";
import {
  LAB_DIRECTIONS,
  LAB_DIRECTION_LABELS,
  LAB_DIRECTION_NOTES,
  LAB_ROUTES,
  labPath,
  type LabDirection,
} from "@/lib/lab/directions";
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
 * What exists, so that every route is reachable while the rest is built.
 *
 * Not the compare page the brief asks for at the end — that one is a swipeable
 * trio of screenshots per page with the "must show" table as a checklist, and
 * it is PR7's, once there is something to shoot. This is the plain index that
 * has to exist from the first commit, because four agents are about to build
 * pages underneath it and nobody can check their own work through a URL they
 * have to remember.
 *
 * It belongs to no direction, so it renders in today's colours. That is the
 * honest thing for it to do: it is not one of the two designs, and dressing it
 * in either would put a thumb on the scale before the owner has seen anything.
 */
function routeLabel(sub: string, copy: LabCopy): string {
  if (sub === "") return copy.lab.pageHome;
  if (sub === "/map") return copy.lab.pageMap;
  if (sub === "/report/stepper") return copy.lab.pageReportStepper;
  if (sub === "/report/photo-first") return copy.lab.pageReportPhotoFirst;
  if (sub === "/primitives") return copy.lab.primitives;
  return `${copy.lab.pageSpecies} ${sub.replace("/species/", "")}`;
}

export default async function LabIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const copy = getLabCopy(locale);

  return (
    <main className="py-16">
      <Container width="prose">
        <PageTitle>{copy.lab.indexTitle}</PageTitle>
        <p className="t-lead mt-6 text-(--fg-quiet)">{copy.lab.indexLead}</p>
        {/* Said once, here, before either design is opened. Both heroes carry
            the badge at 520px, and at that size the only artwork there is is
            visibly soft and still lettered with a name the project stopped
            using two renames ago. A reviewer who is not told that judges the
            picture instead of the layout. */}
        <p className="t-body mt-4 text-(--fg-quiet)">{copy.lab.emblemNote}</p>

        {LAB_DIRECTIONS.map((direction: LabDirection) => {
          const routes = LAB_ROUTES.filter((route) =>
            (route.directions as readonly string[]).includes(direction),
          );
          return (
            <section key={direction} className="mt-16">
              <h2 className="t-head">
                {LAB_DIRECTION_LABELS[direction][locale as Locale]}
              </h2>
              <p className="t-body mt-2 text-(--fg-quiet)">
                {LAB_DIRECTION_NOTES[direction][locale as Locale]}
              </p>
              <List className="mt-6">
                {routes.map((route) => (
                  // Two links in one row, so neither wraps the other: the
                  // whole-row link DataRow normally draws would nest an anchor
                  // inside an anchor the moment it also carried "today's page".
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
      </Container>
    </main>
  );
}
