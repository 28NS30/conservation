import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import LabFooter from "@/components/lab/chrome/LabFooter";
import LabHeader from "@/components/lab/chrome/LabHeader";
import LabTabBar from "@/components/lab/chrome/LabTabBar";
import {
  Binomial,
  Button,
  Choice,
  Container,
  DataRow,
  EmptyState,
  Field,
  Figure,
  Filter,
  Legend,
  LinkAction,
  List,
  Notice,
  PageTitle,
  Section,
  Skeleton,
  StatusTag,
} from "@/components/lab/ui";
import { getLabCopy } from "@/lib/lab/copy";
import { isLabDirection } from "@/lib/lab/directions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; direction: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { title: getLabCopy(locale).lab.primitives };
}

/**
 * Every primitive, on every surface, under whichever theme is on.
 *
 * Two jobs. It is the reference a page owner reads instead of the spec — what
 * the components are, what they take, what they look like next to each other.
 * And it is how a change to a theme file gets checked: swap `/lab/roundel/…`
 * for `/lab/journal/…` and every component on this page should change, because
 * none of them names a colour.
 *
 * The same props render both directions. Where that is not true, it is a bug in
 * a primitive, and this page is where it shows.
 */
const TYPE_STEPS = [
  "t-hero",
  "t-display",
  "t-title",
  "t-head",
  "t-lead",
  "t-body",
  "t-note",
] as const;

export default async function LabPrimitivesPage({
  params,
}: {
  params: Promise<{ locale: string; direction: string }>;
}) {
  const { locale, direction } = await params;
  setRequestLocale(locale);
  if (!isLabDirection(direction)) return null;
  const copy = getLabCopy(locale);

  const signs = (
    <div className="flex flex-wrap items-start gap-4">
      <Button size="hero">{copy.report.buttonSend}</Button>
      <Button variant="secondary">{copy.home.openFullMap}</Button>
      <Button variant="tertiary">{copy.report.startOver}</Button>
      <Button
        id={`unready-${direction}`}
        disabled
        disabledReason={copy.report.placeMissing}
      >
        {copy.report.buttonSend}
      </Button>
    </div>
  );

  return (
    <>
      <LabHeader direction={direction} />
      <main className="lab-page-bottom flex-1">
        <Section surface="plate" rule={false} className="py-16">
          <PageTitle size="title">{copy.lab.primitives}</PageTitle>
          <p className="t-lead mt-6 text-(--fg-quiet)">
            {copy.lab.primitivesLead}
          </p>
        </Section>

        <Section title="Type" titleId="type" className="py-16">
          <Container width="prose" className="px-0">
            {TYPE_STEPS.map((step) => (
              <p key={step} className={`${step} mb-4`}>
                福爾摩沙守望計畫 · {step}
              </p>
            ))}
          </Container>
        </Section>

        <Section title="Signs and links" titleId="signs" className="py-16">
          {signs}
          <p className="t-body mt-10">
            <LinkAction href="/about">{copy.home.creditLink}</LinkAction>{" "}
            <LinkAction href="/map" standalone arrow>
              {copy.species.seeOnFullMap}
            </LinkAction>
          </p>
        </Section>

        <Section
          surface="plate"
          title="Signs on plate"
          titleId="signs-plate"
          className="py-16"
        >
          {signs}
        </Section>

        <Section
          surface="field"
          title="Signs on field"
          titleId="signs-field"
          className="py-16"
        >
          {signs}
          <p className="t-body mt-10">
            <LinkAction href="/map" standalone arrow>
              {copy.species.seeOnFullMap}
            </LinkAction>
          </p>
        </Section>

        <Section title="Filters" titleId="filters" className="py-16">
          <Filter
            legend={copy.map.displayLabel}
            value="grid"
            options={[
              { value: "grid", label: copy.map.displayGrid, href: "?display=grid" },
              { value: "dots", label: copy.map.displayDots, href: "?display=dots" },
              { value: "heat", label: copy.map.displayHeat, href: "?display=heat" },
            ]}
          />
          <Filter
            mode="multi"
            legend={copy.map.typeLabel}
            values={["roadkill"]}
            options={[
              { value: "roadkill", label: copy.report.conditionDead },
              { value: "injured", label: copy.report.conditionHurt },
              { value: "sighting", label: copy.report.conditionWell },
            ]}
            className="mt-10"
          />
        </Section>

        <Section
          surface="plate"
          title="One question"
          titleId="choice"
          className="py-16"
        >
          <Container width="prose" className="px-0">
            <Choice
              name="condition"
              legend={copy.report.conditionTitle}
              options={[
                { value: "dead", label: copy.report.conditionDead },
                { value: "hurt", label: copy.report.conditionHurt },
                { value: "well", label: copy.report.conditionWell },
              ]}
            />
            <Field
              id="species-search"
              label={copy.report.speciesTitle}
              type="search"
              placeholder={copy.report.speciesPlaceholder}
              hint={copy.report.photoHelp}
              className="mt-10"
            />
            <Field
              id="species-search-error"
              label={copy.report.speciesTitle}
              type="search"
              error={copy.report.speciesOffline}
              errorAction={
                <LinkAction href="#choice">{copy.report.speciesSkip}</LinkAction>
              }
              className="mt-10"
            />
          </Container>
        </Section>

        <Section title="Status, rows and notices" titleId="rows" className="py-16">
          <div className="flex flex-wrap gap-6">
            <StatusTag kind="protected">{copy.status.protected}</StatusTag>
            <StatusTag kind="endemic">{copy.status.endemic}</StatusTag>
            <StatusTag kind="invasive">{copy.status.invasive}</StatusTag>
            <StatusTag kind="blurred">{copy.status.blurred}</StatusTag>
          </div>
          <List className="mt-10">
            <DataRow
              name="黑眶蟾蜍"
              binomial="Duttaphrynus melanostictus"
              authority="(Schneider, 1799)"
              value="3,978"
              valueLabel={copy.map.legendPoints}
              status={<StatusTag kind="endemic">{copy.status.endemic}</StatusTag>}
            />
            <DataRow
              name="斯文豪氏頸槽蛇"
              binomial="Rhabdophis swinhonis"
              value="90"
              valueLabel={copy.map.legendPoints}
            />
          </List>
          <Notice className="mt-10" title={copy.report.injuredTitle}>
            {copy.report.injuredBody}
          </Notice>
          <Notice tone="error" className="mt-6">
            {copy.report.errorServer}
          </Notice>
          <p className="t-body mt-10">
            <Binomial authority="(Günther, 1864)">Bufo bankorensis</Binomial>
          </p>
        </Section>

        <Section
          surface="field"
          title="Legends"
          titleId="legends"
          className="py-16"
        >
          <Legend
            caption={copy.map.colourDensity}
            items={[1, 2, 3, 4, 5, 6].map((n) => ({
              ramp: n as 1 | 2 | 3 | 4 | 5 | 6,
              label: `${n * 8}`,
            }))}
          />
          <Legend
            mode="bar"
            className="mt-10"
            lowLabel={copy.map.legendLow}
            highLabel={copy.map.legendHigh}
          />
          <Legend
            mode="marks"
            className="mt-10"
            caption={copy.map.legendPoints}
            items={[
              {
                color: "var(--mark-roadkill)",
                shape: "dot",
                label: copy.report.conditionDead,
              },
              {
                color: "var(--mark-invasive)",
                shape: "dot",
                label: copy.status.invasive,
              },
              {
                color: "var(--mark-sighting)",
                shape: "ring",
                label: copy.report.conditionWell,
              },
            ]}
          />
        </Section>

        <Section title="Figures, empty, loading" titleId="figures" className="py-16">
          <Figure
            finding={copy.species.findingSentence
              .replace("{from}", "2011")
              .replace("{to}", "2017")
              .replace("{count}", "3,978")
              .replace("{month}", "4")}
            dataLabel={copy.species.monthlyTitle}
            source={copy.home.sourceLine}
            dataTable={
              <table className="t-note w-full text-left">
                <thead>
                  <tr className="rule-strong border-b-2">
                    <th className="py-2">{copy.species.monthlyTitle}</th>
                    <th className="py-2">{copy.map.legendHigh}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="rule-quiet border-b">
                    <td className="py-2">4</td>
                    <td className="py-2">812</td>
                  </tr>
                  <tr className="rule-quiet border-b">
                    <td className="py-2">5</td>
                    <td className="py-2">640</td>
                  </tr>
                </tbody>
              </table>
            }
          >
            <div className="flex h-60 items-end gap-2" aria-hidden="true">
              {[3, 5, 8, 12, 9, 6, 5, 4, 4, 3, 2, 2].map((n, i) => (
                <span
                  key={i}
                  className="flex-1 bg-(--ramp-1)"
                  style={{ height: `${n * 8}%` }}
                />
              ))}
            </div>
          </Figure>
          <EmptyState
            className="mt-16"
            filters={`${copy.map.typeLabel}: ${copy.report.conditionHurt}`}
            clearLabel={copy.map.clearFilters}
            clearHref="?"
          />
          <Skeleton className="mt-16" label={copy.common.loading} />
        </Section>
      </main>
      <LabFooter direction={direction} />
      <LabTabBar direction={direction} />
    </>
  );
}
