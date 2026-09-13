import { useTranslations } from "next-intl";

type Props = {
  protectedStatus?: string | null;
  cites?: string | null;
  iucn?: string | null;
  redlist?: string | null;
  isEndemic?: boolean;
  isInvasive?: boolean;
  alienType?: string | null;
  sensitivity?: string | null;
  kingdom?: string | null;
};

/**
 * Conservation status chips.
 *
 * Every badge is conditional and the component renders nothing at all when a
 * species has no status — which is the common case. Of 66,201 Taiwan species
 * only 308 carry a protection level and 6,977 an IUCN category, so a layout that
 * assumes badges exist looks broken for the overwhelming majority.
 *
 * THE CODES ARE NOW WORDS. These printed raw: `IUCN VU`, `CITES II`, `Red List
 * NVU`, identically in both languages. A visitor who knows what VU means did not
 * need the page, and one who does not was told nothing. Every scheme's
 * vocabulary was checked against TaiCOL, 林業及自然保育署 and the text of 野生動物保育法,
 * then re-checked by a second pass that corrected three of them — Taiwan writes
 * 接近受脅 rather than 近危, 暫無危機 rather than 無危, and has no accepted rendering of
 * LR/cd as 低危.
 *
 * Three traps in the stored data, all of which this component used to fall into.
 */
export default function StatusBadges(p: Props) {
  const t = useTranslations("species");

  const chips: { key: string; label: string; title?: string; tone: string }[] =
    [];
  // Tinted for paper. The previous set was built for the dark theme — pale text
  // on a 15% wash — which disappears entirely once the page behind it is cream.
  const tone = {
    danger: "bg-rose-600/10 text-rose-800 ring-rose-700/25",
    warn: "bg-amber-600/12 text-amber-800 ring-amber-700/25",
    info: "bg-sky-600/10 text-sky-800 ring-sky-700/25",
    good: "bg-ember-500/12 text-ember-700 ring-ember-700/25",
    muted: "bg-ink-900/6 text-ink-600 ring-ink-900/15",
  };

  /** A code's word, falling back to the code so a TaiCOL refresh cannot blank a chip. */
  const word = (ns: string, code: string) => {
    const key = `${ns}.${code.replace(/\//g, "")}`;
    return t.has(key) ? t(key) : code;
  };

  /*
   * TRAP 1: protected_status is two statutes in one column. I/II/III are levels
   * under 野生動物保育法, which by its own §3 covers animals only — every one of the
   * 305 rows carrying them is Animalia. The four rows holding "1" are plants
   * designated 珍貴稀有植物 under 文化資產保存法, an entirely different act. Rendering
   * that as a level produced "Protected 1", which is meaningless and legally
   * wrong, so it branches on the value rather than interpolating it.
   */
  if (p.protectedStatus === "1") {
    chips.push({
      key: "prot-plant",
      label: t("protectedPlant"),
      tone: tone.danger,
    });
  } else if (p.protectedStatus) {
    chips.push({
      key: "prot",
      label: t("protectedChip", {
        name: word("protectedName", p.protectedStatus),
      }),
      title: `${p.protectedStatus}`,
      tone: tone.danger,
    });
  }

  if (p.isEndemic)
    chips.push({ key: "endemic", label: t("endemic"), tone: tone.good });
  if (p.isInvasive)
    chips.push({ key: "invasive", label: t("invasive"), tone: tone.warn });
  else if (p.alienType && p.alienType !== "native") {
    chips.push({ key: "alien", label: t("alien"), tone: tone.muted });
  }

  /*
   * TRAP 2: CITES values combine, and a slash is not a conjunction. Ten Taiwan
   * species carry I/II, II/NC, I/NC or III/NC — a split listing, where different
   * populations of one species sit in different appendices. Printing the raw
   * string gave "CITES I/II".
   *
   * NC is not an appendix. It is the checklist's code for "in none of them",
   * carried by nine species including the domestic cat and aloe vera, and a
   * "CITES NC" chip reads as a conservation status on an animal that has none.
   * So each real appendix gets its own chip and NC is simply dropped.
   */
  for (const part of (p.cites ?? "")
    .split("/")
    .filter((x) => /^(I|II|III)$/.test(x))) {
    chips.push({
      key: `cites-${part}`,
      label: t("citesChip", { name: word("citesCode", part) }),
      tone: tone.info,
    });
  }

  if (p.iucn)
    chips.push({
      key: "iucn",
      label: t("iucnChip", { name: word("iucnCode", p.iucn) }),
      title: p.iucn,
      tone: tone.info,
    });

  /*
   * TRAP 3: redlist is Taiwan's own assessment, not IUCN's. They are independent
   * columns — TaiCOL shows 石虎 as 臺灣紅皮書 瀕危 NEN and IUCN 暫無危機 LC on one page —
   * so the chip names the scheme rather than leaving a bare code to be mistaken
   * for an international one.
   */
  if (p.redlist)
    chips.push({
      key: "redlist",
      label: t("redlistChip", { name: word("redlistCode", p.redlist) }),
      title: p.redlist,
      tone: tone.info,
    });

  if (p.sensitivity)
    chips.push({ key: "sens", label: t("sensitive"), tone: tone.warn });

  if (chips.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <li
          key={c.key}
          title={c.title}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${c.tone}`}
        >
          {c.label}
        </li>
      ))}
    </ul>
  );
}
