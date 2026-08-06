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
};

/**
 * Conservation status chips.
 *
 * Every badge is conditional and the component renders nothing at all when a
 * species has no status — which is the common case. Of 66,201 Taiwan species
 * only 308 carry a protection level and 6,977 an IUCN category, so a layout that
 * assumes badges exist looks broken for the overwhelming majority.
 */
export default function StatusBadges(p: Props) {
  const t = useTranslations("species");

  const chips: { key: string; label: string; tone: string }[] = [];
  const tone = {
    danger: "bg-rose-400/15 text-rose-300 ring-rose-400/25",
    warn: "bg-amber-400/15 text-amber-300 ring-amber-400/25",
    info: "bg-sky-400/15 text-sky-300 ring-sky-400/25",
    good: "bg-ember-400/15 text-ember-400 ring-ember-400/25",
    muted: "bg-parchment-400/10 text-parchment-300 ring-parchment-400/20",
  };

  if (p.protectedStatus) {
    chips.push({ key: "prot", label: t("protectedLevel", { level: p.protectedStatus }), tone: tone.danger });
  }
  if (p.isEndemic) chips.push({ key: "endemic", label: t("endemic"), tone: tone.good });
  if (p.isInvasive) chips.push({ key: "invasive", label: t("invasive"), tone: tone.warn });
  else if (p.alienType && p.alienType !== "native") {
    chips.push({ key: "alien", label: t("alien"), tone: tone.muted });
  }
  if (p.cites) chips.push({ key: "cites", label: `CITES ${p.cites}`, tone: tone.info });
  if (p.iucn) chips.push({ key: "iucn", label: `IUCN ${p.iucn}`, tone: tone.info });
  if (p.redlist) chips.push({ key: "redlist", label: t("redlist", { code: p.redlist }), tone: tone.info });
  if (p.sensitivity) chips.push({ key: "sens", label: t("sensitive"), tone: tone.warn });

  if (chips.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <li
          key={c.key}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${c.tone}`}
        >
          {c.label}
        </li>
      ))}
    </ul>
  );
}
