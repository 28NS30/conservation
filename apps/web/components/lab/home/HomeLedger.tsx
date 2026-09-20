import { getTranslations } from "next-intl/server";
import Section from "@/components/lab/ui/Section";
import Binomial from "@/components/lab/ui/Binomial";
import { List, DataRow } from "@/components/lab/ui/DataRow";
import type { LedgerRow } from "@/lib/stats";

/**
 * Five real records from this week, in other years.
 *
 * The corpus as a ledger, which is the one piece of the rejected home page
 * worth keeping: it is the only thing on the page that shows what the site
 * actually holds, in the geometry of a single record. Five rows, not twelve —
 * this is the third block of a page whose job is the first screen.
 *
 * NO BLANK FIRST ROW. Today the list opens with a dashed empty line linking to
 * the report form: the call to action drawn as a record that does not exist
 * yet. It is a good idea and it is one ember element too many — the hero
 * already carries the page's one action, and an empty row at the top of a list
 * of real records reads at a glance as a loading state.
 *
 * NO COORDINATES. Today each row ends in a lat/lng to four decimal places.
 * These rows come from `reports_public`, where sensitive locations are already
 * blurred, and printing a coordinate in a list undoes that for anyone who reads
 * two rows of the same species. A row says what and when; where is the map's
 * job, at the precision the database chose.
 */
export default async function HomeLedger({
  locale,
  surface,
  heading,
  rows,
}: {
  locale: string;
  surface: "paper" | "plate" | "field";
  heading: "block" | "margin";
  rows: LedgerRow[];
}) {
  const t = await getTranslations("home");
  const inEnglish = locale.startsWith("en");

  if (rows.length === 0) return null;

  return (
    <Section
      surface={surface}
      heading={heading}
      title={t("ledgerTitle")}
      titleId="lab-home-ledger"
      className="py-16"
    >
      <List aria-labelledby="lab-home-ledger">
        {rows.map((row) => {
          // `observedAt` is a date with no meaningful time of day; slicing the
          // ISO string is what the live page does and keeps the column one
          // width in both locales.
          const date = new Date(row.observedAt).toISOString().slice(0, 10);
          const zhName = row.commonNameZh;
          const latin = row.scientificName ?? undefined;
          const name =
            !inEnglish && zhName ? (
              zhName
            ) : latin ? (
              <Binomial>{latin}</Binomial>
            ) : (
              zhName
            );
          return (
            <DataRow
              key={row.id}
              href={`/reports/${row.id}`}
              name={name}
              binomial={!inEnglish && zhName ? (latin ?? undefined) : undefined}
              meta={
                inEnglish && zhName ? (
                  <span lang="zh-TW">{zhName}</span>
                ) : undefined
              }
              value={<time dateTime={date}>{date}</time>}
            />
          );
        })}
      </List>
    </Section>
  );
}
