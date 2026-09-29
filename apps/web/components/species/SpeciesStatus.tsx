import { useLocale, useTranslations } from "next-intl";
import { speciesNotes } from "@/lib/speciesNotes";

type Props = {
  protectedStatus?: string | null;
  cites?: string | null;
  iucn?: string | null;
  redlist?: string | null;
  isEndemic?: boolean;
  isInvasive?: boolean;
  alienType?: string | null;
  kingdom?: string | null;
  rank?: string | null;
  taicolId?: string | null;
};

/** Assessments that say something. "Not evaluated" and "not applicable" do not. */
const ASSESSED = (code: string | null | undefined): code is string =>
  !!code && code !== "NE" && code !== "NA";

/**
 * A species' status as a few plain sentences, for its own page.
 *
 * The page showed up to six small chips: "Protected · Endangered Wildlife",
 * "Endemic", "CITES Appendix II", "IUCN Least Concern", "Red List Nationally
 * Endangered", "Sensitive". Each was accurate, and together they asked a
 * reader to know what four different schemes are before learning anything.
 * The same facts as sentences say which body decided what: Taiwan's law,
 * Taiwan's Red List, the IUCN, the trade convention.
 *
 * Lists and cards keep the chips (StatusBadges), where there is no room for a
 * sentence and a reader is scanning, not reading.
 *
 * The data carries three traps, and this keeps StatusBadges' answers to them:
 * protected_status holds two statutes ("1" is a plant under the Cultural
 * Heritage Preservation Act, not wildlife level one); a slash in `cites` is a
 * split listing and NC is no appendix at all; and `redlist` is Taiwan's own
 * assessment, independent of the IUCN's.
 *
 * "Sensitive" is not repeated here: what it causes, the blur, is said beside
 * the map, where it applies (blurredNotice on the species page).
 *
 * Renders nothing for a species with no status, which is most of them.
 */
export default function SpeciesStatus(p: Props) {
  const t = useTranslations("species");
  const locale = useLocale();

  /** A code's word, falling back to the code so a TaiCOL refresh cannot blank a sentence. */
  const word = (ns: string, code: string) => {
    const key = `${ns}.${code.replace(/\//g, "")}`;
    return t.has(key) ? t(key) : code;
  };

  const sentences: string[] = [];

  // Where it belongs. On a subspecies row TaiCOL's endemic flag means an
  // endemic subspecies: 白頭翁's Taiwan form is Taiwan's own, the bird is not.
  if (p.isEndemic)
    sentences.push(
      p.rank && p.rank !== "Species" && p.rank !== "Genus"
        ? t("status.endemicSubspecies")
        : t("status.endemic"),
    );
  if (p.isInvasive) sentences.push(t("status.invasive"));
  else if (p.alienType && p.alienType !== "native") sentences.push(t("status.alien"));
  else if (speciesNotes(p.taicolId).includes("introducedMainIsland"))
    sentences.push(t("status.introducedMainIsland"));

  // The law. Two statutes in one column; see above.
  if (p.protectedStatus === "1") sentences.push(t("status.protectedPlant"));
  else if (p.protectedStatus)
    sentences.push(
      t("status.protected", { name: word("protectedName", p.protectedStatus) }),
    );

  // How threatened it is: Taiwan's assessment first, then the world's.
  if (ASSESSED(p.redlist))
    sentences.push(t("status.redlist", { name: word("redlistCode", p.redlist) }));
  if (ASSESSED(p.iucn))
    sentences.push(t("status.iucn", { name: word("iucnCode", p.iucn) }));

  // Trade. Each real appendix, joined as the language joins a list.
  const appendices = (p.cites ?? "")
    .split("/")
    .filter((x) => /^(I|II|III)$/.test(x))
    .map((x) => word("citesCode", x));
  if (appendices.length > 0)
    sentences.push(
      t("status.cites", {
        list: new Intl.ListFormat(locale, { type: "conjunction" }).format(appendices),
      }),
    );

  if (sentences.length === 0) return null;

  // Chinese sentences end in 。 and run on without a space.
  const joiner = locale.startsWith("zh") ? "" : " ";
  return (
    <p
      id="species-status"
      className="mt-4 max-w-prose text-[17px] leading-relaxed text-ink-800"
    >
      {sentences.join(joiner)}
    </p>
  );
}
