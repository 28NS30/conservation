import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import LabFooter from "@/components/lab/chrome/LabFooter";
import LabHeader from "@/components/lab/chrome/LabHeader";
import LabTabBar from "@/components/lab/chrome/LabTabBar";
import MonthlyBars, {
  MonthlyTable,
} from "@/components/lab/species/MonthlyBars";
import SpeciesFigureMap from "@/components/lab/species/SpeciesFigureMap";
import {
  Binomial,
  Button,
  DataRow,
  Figure,
  Legend,
  LinkAction,
  List,
  Notice,
  PageTitle,
  Section,
  StatusTag,
  type StatusKind,
} from "@/components/lab/ui";
import { getLabCopy } from "@/lib/lab/copy";
import { isLabDirection, labHref, labSectionBuilt } from "@/lib/lab/directions";
import {
  chartFinding,
  findingSentence,
  isWithheld,
  lineageRows,
  mapFinding,
  nameSizes,
  reportThis,
  speciesLegendItems,
} from "@/lib/lab/species";
import {
  getSpecies,
  monthlyCounts,
  parseSpeciesId,
  speciesSlug,
  type SpeciesDetail,
} from "@/lib/species";

/**
 * The species page, Roundel: the name is the picture.
 *
 * There is no wildlife photography on this site and none is coming, so the page
 * cannot be built around an image slot that is empty 66,201 times out of 66,201.
 * What it has instead is a name — 黑眶蟾蜍 — and in a design whose display face
 * is the badge's own lettering, that name AT HERO SIZE is the strongest picture
 * available. Everything else on the page is arranged under it.
 *
 * Four things follow from that, and each replaces something the live page does:
 *
 *  - No artwork slot. §2.6 rule 7: an empty slot collapses. A grey rectangle
 *    with a camera glyph in it is a promise the project cannot keep.
 *  - ONE FINDING SENTENCE instead of stat tiles. 2011–2017 年間有 3,978 筆紀錄，
 *    四月最多。 A reader who looks at nothing else leaves knowing the thing the
 *    page was built to say; four numbers in four boxes have never managed that.
 *  - A PORTRAIT map. The island is 2.3 degrees wide and 3.7 tall, and the live
 *    landscape panel spends two thirds of its area on open sea.
 *  - THE CHART'S VALUES IN TEXT. The live chart hides them in a tooltip, which
 *    is unreadable on a phone, unreadable to a screen reader and unquotable.
 *
 * Three cases, and the page is honest about all three. A taxon with records gets
 * the finding, the map and the chart. A taxon with none gets the hero and the
 * closing block and nothing else — never a sentence about absence, because "no
 * reports yet" is a fact about us, not about the animal. A taxon TaiCOL rates
 * 座標不開放 gets a Notice saying the coordinates are withheld, and no map and no
 * count at all: its `reportCount` reads 0 because it has no rows in
 * `reports_public`, and rendering that as "no reports yet" would be the one
 * outright lie available on this page.
 *
 * PRIVACY. Everything here is `getSpecies` and `monthlyCounts`, both of which go
 * through `asPublic` and `reports_public`, plus the public `/api/tiles`
 * endpoint. Blurring is inherited rather than reimplemented, and no coordinate
 * is printed anywhere — `recentRecords` is deliberately not called.
 */

/**
 * The parent direction segment sets `dynamicParams = false`, which is what makes
 * `/lab/anything-else` a 404. There are 66,201 taxa and no reason to enumerate
 * any of them, so this segment opts back in: an id that is not a species is
 * caught below by `parseSpeciesId` and `getSpecies`, which is a 404 for the
 * right reason rather than for the routing table's.
 */
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const taxonId = parseSpeciesId(id);
  const s = taxonId ? await getSpecies(taxonId) : null;
  // No `robots` here, ever: metadata merges shallowly and the last segment to
  // define a field wins, so setting it would undo the lab layout's noindex.
  return { title: s ? headlineOf(s, locale) : getLabCopy(locale).lab.pageSpecies };
}

/** zh-TW reads the Chinese name; /en has no English common name to read. */
function headlineOf(s: SpeciesDetail, locale: string): string {
  return locale.startsWith("zh") && s.commonNameZh
    ? s.commonNameZh
    : s.scientificName;
}

export default async function LabSpeciesPage({
  params,
}: {
  params: Promise<{ locale: string; direction: string; id: string }>;
}) {
  const { locale, direction, id } = await params;
  setRequestLocale(locale);
  if (!isLabDirection(direction)) notFound();
  if (!labSectionBuilt("/species/", direction)) notFound();

  const taxonId = parseSpeciesId(id);
  if (!taxonId) notFound();
  const s = await getSpecies(taxonId);
  if (!s) notFound();

  // Numeric ids, no slug redirect (brief W1, step 6). A prototype URL is typed
  // by hand and pasted into a phone; a canonical redirect buys nothing here and
  // costs a round trip on every visit.

  const copy = getLabCopy(locale);
  const t = await getTranslations("species");
  const zhFirst = locale.startsWith("zh");

  const headline = headlineOf(s, locale);
  const sizes = nameSizes(headline);
  const withheld = isWithheld(s.sensitivity);
  const counts = !withheld && s.reportCount > 0 ? await monthlyCounts(s.id) : null;
  const finding = counts ? findingSentence(copy, locale, s, counts) : null;
  const chart = counts ? chartFinding(copy, locale, counts) : null;
  const lineage = lineageRows(copy, s);

  /**
   * An array rather than a fragment, so the row it sits in can collapse.
   *
   * 黑眶蟾蜍 is not protected, not endemic, not invasive and not blurred, which
   * is true of most of the 354 taxa with records: an empty `<div className="mt-8
   * flex …">` under its name is 32px of nothing that reads as a missing block
   * (§2.6 rule 7). 座標不開放 deliberately draws no "blurred" tag — the Notice
   * below says something stronger and a tag beside it would soften it.
   */
  const tags: { kind: StatusKind; label: string }[] = [];
  if (s.protectedStatus)
    tags.push({ kind: "protected", label: copy.status.protected });
  if (s.isEndemic) tags.push({ kind: "endemic", label: copy.status.endemic });
  if (s.isInvasive) tags.push({ kind: "invasive", label: copy.status.invasive });
  if (s.sensitivity && !withheld)
    tags.push({ kind: "blurred", label: copy.status.blurred });

  // `labHref` rather than `labPath`: the lab's pages land over several weeks,
  // and a link to a prototype that does not exist yet is a 404 in the owner's
  // hand while they are deciding whether the design is any good. Until /map is
  // built this opens today's map with the same filter on; the day it is built,
  // this link follows without being touched.
  const mapHref = `${labHref(direction, "/map")}?taxonId=${s.id}`;
  /**
   * The record list is the live one either way. The lab map's own 清單 tab
   * points at `/reports?taxonId=`, so the two agree, and there is no prototype
   * of a list to disagree with.
   */
  const listHref = `/reports?taxonId=${s.id}`;
  /** The whole point of the closing block: the taxon rides into the flow. */
  const reportHref = `${labHref(direction, "/report/stepper")}?taxonId=${s.id}`;
  const hasMiddle = withheld || Boolean(counts);

  return (
    <>
      <LabHeader direction={direction} current="species" />
      <main className="lab-page-bottom flex-1">
        {/* ---- hero: the name, and almost nothing else ------------------- */}
        <Section surface="plate" rule={false} className="py-16 md:py-24">
          <div className="max-w-(--container-prose)">
            {lineage.length > 0 ? (
              // Not linked. direction.md asks for a linked lineage and there is
              // nowhere true to link it: the species directory searches names,
              // not ranks, so `?q=Bufonidae` answers "no matching species". A
              // link that lands on an empty result teaches a reader the site is
              // broken. Left as the fact it is until a taxon browse exists.
              <p className="t-note text-(--fg-quiet)">
                {lineage.map((row) => row.name).join(" › ")}
              </p>
            ) : null}

            <PageTitle
              size={sizes.desktop}
              phoneSize={sizes.phone}
              className="mt-4"
            >
              {zhFirst ? headline : <Binomial>{headline}</Binomial>}
            </PageTitle>

            {zhFirst ? (
              <p className="t-lead mt-6 text-(--fg-quiet)">
                <Binomial authority={s.nameAuthor ?? undefined}>
                  {s.scientificName}
                </Binomial>
              </p>
            ) : (
              <>
                {s.commonNameZh ? (
                  // The Chinese name is still the picture on /en, one step down —
                  // the same treatment direction.md gives the project's own name
                  // on the English home page.
                  <p className="t-head mt-6" lang="zh-TW">
                    {s.commonNameZh}
                  </p>
                ) : null}
                {s.nameAuthor ? (
                  <p className="t-body mt-2 text-(--fg-quiet)">
                    {s.nameAuthor}
                  </p>
                ) : null}
              </>
            )}

            {s.altNamesZh && s.altNamesZh.length > 0 ? (
              <p className="t-body mt-4 text-(--fg-quiet)">
                <span lang="zh-TW">
                  {copy.species.alsoCalled}
                  {zhFirst ? "" : ": "}
                  {s.altNamesZh.join("、")}
                </span>
              </p>
            ) : null}

            {tags.length > 0 ? (
              <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2">
                {tags.map((tag) => (
                  <StatusTag key={tag.kind} kind={tag.kind} size="body">
                    {tag.label}
                  </StatusTag>
                ))}
              </div>
            ) : null}
          </div>
        </Section>

        {/* ---- withheld: a notice, no map, no count ---------------------- */}
        {withheld ? (
          <Section className="py-16">
            <div className="max-w-(--container-prose)">
              <Notice title={copy.species.withheldNotice}>
                {/* The live sentence, verbatim: it names TaiCOL's sensitivity
                    rating as the reason, which is the honest answer and is
                    already written and already read by a native speaker. */}
                {t("coordinatesWithheld")}
              </Notice>
            </div>
          </Section>
        ) : null}

        {/* ---- the finding, then the two figures ------------------------- */}
        {counts && !withheld ? (
          <Section className="py-16">
            {finding ? <h2 className="t-head">{finding}</h2> : null}

            <div className="mt-10 grid gap-16 lg:grid-cols-[480px_minmax(0,1fr)]">
              <div>
                <Figure
                  headingLevel={3}
                  finding={mapFinding(copy, locale, s.reportCount)}
                >
                  <SpeciesFigureMap
                    taxonId={s.id}
                    label={`${headline} · ${copy.lab.pageMap}`}
                    unavailableText={copy.species.mapUnavailable}
                  />
                </Figure>
                <Legend
                  className="mt-6 max-w-(--container-prose)"
                  caption={copy.species.countColumn}
                  items={speciesLegendItems()}
                />
                {s.sensitivity ? (
                  <Notice className="mt-6">{t("blurredNotice")}</Notice>
                ) : null}
                <div className="mt-6 flex flex-col items-start">
                  <LinkAction href={mapHref} standalone arrow>
                    {copy.species.seeOnFullMap}
                  </LinkAction>
                  <LinkAction href={listHref} standalone arrow>
                    {copy.species.seeRecordList}
                  </LinkAction>
                </div>
              </div>

              <div>
                {chart ? (
                  <Figure
                    headingLevel={3}
                    finding={chart}
                    dataLabel={copy.species.dataTable}
                    dataTable={
                      <MonthlyTable
                        counts={counts}
                        copy={copy}
                        locale={locale}
                      />
                    }
                  >
                    <MonthlyBars
                      counts={counts}
                      copy={copy}
                      locale={locale}
                    />
                  </Figure>
                ) : null}

                {lineage.length > 0 ? (
                  <>
                    <h3 className="t-head mt-16" id="lineage">
                      {t("taxonomy")}
                    </h3>
                    <List className="mt-6" aria-labelledby="lineage">
                      {lineage.map((row) => (
                        <DataRow
                          key={row.rank}
                          name={row.rank}
                          value={
                            row.italic ? (
                              <Binomial>{row.name}</Binomial>
                            ) : (
                              row.name
                            )
                          }
                        />
                      ))}
                    </List>
                  </>
                ) : null}
              </div>
            </div>
          </Section>
        ) : null}

        {/* ---- closing: the one ember sign on the page -------------------- */}
        <Section
          surface="plate"
          // Without a middle section this sits straight under the hero, which is
          // also plate, so a 2px rule is what keeps them from reading as one
          // block. That is the whole zero-record page: a name and an invitation.
          rule={!hasMiddle}
          className="py-16 md:py-24"
        >
          <h2 className="t-title">{copy.species.sawItTitle}</h2>
          <Button
            href={reportHref}
            size="hero"
            className="mt-10 w-full md:w-auto"
          >
            {reportThis(copy, headline)}
          </Button>
          <p className="t-note mt-10 text-(--fg-quiet)">
            {copy.home.sourceLine}
            {" · "}
            {/* Lab furniture, kept to fourteen pixels and to one line: the
                compare strip can only resolve the four species ids the route
                table lists, and the owner will open others. `speciesSlug`
                spares the live route its own canonical redirect. */}
            <LinkAction href={`/species/${speciesSlug(s)}`}>
              {copy.lab.todaysPage}
            </LinkAction>
          </p>
        </Section>
      </main>
      <LabFooter direction={direction} />
      {/* Outlined, not ember. The closing block above is already this page's
          one ember element (§2.6 rule 1), and on a phone both are in the same
          viewport at the foot of the page. */}
      <LabTabBar
        direction={direction}
        current="species"
        reportVariant="outline"
      />
    </>
  );
}
