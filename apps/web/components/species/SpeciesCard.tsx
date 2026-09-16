import { useTranslations, useLocale } from "next-intl";
import StatusBadges from "./StatusBadges";
import HabitatChips from "./HabitatChips";

/**
 * A species, as a card.
 *
 * The team asked for creatures with a habitat type, strengths and weaknesses,
 * and something worth collecting. This is that, built entirely from columns
 * TaiCOL already gives us: the habitat type is real (`is_terrestrial` and its
 * three siblings), and the strengths and weaknesses are real ecology — where it
 * is found, whether it exists anywhere else on earth, and who has assessed it as
 * at risk. Every one of Taiwan's 125,438 species gets a card for free, none of
 * it needs drawing, and nothing on it is invented.
 *
 * That is not a smaller version of the idea. Balmford's 2002 finding — that
 * eight-year-olds identified 80% of Pokémon and under half of the wildlife
 * around them — ended with the suggestion that someone build this for real
 * species.
 *
 * No state, no score, nothing earnable: a card is content, and the one rule the
 * game layer has to obey is that nothing unlockable may influence what people
 * report or where they go to report it.
 */

export type CardSpecies = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  nameAuthor?: string | null;
  altNamesZh?: string[] | null;
  family: string | null;
  order?: string | null;
  class?: string | null;
  isEndemic: boolean;
  isInvasive: boolean;
  protectedStatus: string | null;
  sensitivity?: string | null;
  cites: string | null;
  iucn: string | null;
  redlist: string | null;
  reportCount: number;
  isTerrestrial: boolean | null;
  isFreshwater: boolean | null;
  isBrackish: boolean | null;
  isMarine: boolean | null;
};

export default function SpeciesCard({
  species: s,
  peakMonth,
}: {
  species: CardSpecies;
  /** 1–12, from the monthly distribution, when there is enough data to mean it. */
  peakMonth?: number | null;
}) {
  const t = useTranslations("species");
  const locale = useLocale();
  const zhFirst = locale.startsWith("zh");

  const lineage = [s.class, s.order, s.family].filter(Boolean) as string[];

  return (
    <article className="overflow-hidden rounded-xl border border-ink-900/12 bg-paper-100">
      <div className="border-b border-ink-900/8 px-4 py-3.5">
        <h2 className="text-lg font-semibold leading-tight text-ink-900">
          {zhFirst ? (s.commonNameZh ?? s.scientificName) : s.scientificName}
        </h2>
        <p className="mt-0.5 text-[13px] text-ink-500">
          <span className={zhFirst ? "italic" : ""}>
            {zhFirst ? s.scientificName : (s.commonNameZh ?? "")}
          </span>
          {s.nameAuthor && (
            <span className="ml-1.5 text-ink-500">{s.nameAuthor}</span>
          )}
        </p>
        <StatusBadges {...s} />
      </div>

      <dl className="divide-y divide-ink-900/8 text-[13px]">
        <div className="flex gap-3 px-4 py-2.5">
          <dt className="w-20 shrink-0 text-ink-500">{t("habitatLabel")}</dt>
          <dd>
            <HabitatChips species={s} />
          </dd>
        </div>

        {lineage.length > 0 && (
          <div className="flex gap-3 px-4 py-2.5">
            <dt className="w-20 shrink-0 text-ink-500">{t("taxonomy")}</dt>
            <dd className="text-ink-700">{lineage.join(" › ")}</dd>
          </div>
        )}

        <div className="flex gap-3 px-4 py-2.5">
          <dt className="w-20 shrink-0 text-ink-500">{t("cardRecords")}</dt>
          <dd className="text-ink-700">
            {/* Deliberately not "rarity". A species can be absent from this map
                because it is rare, or because nobody has walked that road with a
                phone — and on 46,334 imported roadkill records, mostly the
                second. Saying "records" claims only what we actually know. */}
            {t("cardRecordCount", { count: s.reportCount })}
            {peakMonth != null && (
              <span className="ml-1.5 text-ink-500">
                ·{" "}
                {t("cardPeak", {
                  month: new Intl.DateTimeFormat(locale, {
                    month: "long",
                  }).format(new Date(Date.UTC(2021, peakMonth - 1, 1))),
                })}
              </span>
            )}
          </dd>
        </div>
      </dl>
    </article>
  );
}
