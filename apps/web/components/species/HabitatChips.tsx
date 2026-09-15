import { useTranslations } from "next-intl";
import { habitatKnown } from "@conservation/shared";

/**
 * Where it lives, as chips.
 *
 * This is the team's "habitat type", and it is the one part of the creature
 * idea that was already in the database: TaiCOL carries `is_terrestrial`,
 * `is_freshwater`, `is_brackish` and `is_marine` for every species it has
 * assessed. So the type on the card is real, costs no art, and is the same
 * claim a field guide would make.
 *
 * All four columns are NULL for 3,338 Taiwan species, and "we do not know" is
 * not "it lives nowhere" — habitatKnown() keeps those two apart, and this draws
 * nothing rather than drawing a wrong absence.
 */
const HABITATS = [
  ["isTerrestrial", "terrestrial", "#84a07c"],
  ["isFreshwater", "freshwater", "#6aa0c0"],
  ["isBrackish", "brackish", "#8f9bb3"],
  ["isMarine", "marine", "#4d7ea8"],
] as const;

export type HabitatFlags = {
  isTerrestrial: boolean | null;
  isFreshwater: boolean | null;
  isBrackish: boolean | null;
  isMarine: boolean | null;
};

export default function HabitatChips({
  species,
  tone = "light",
}: {
  species: HabitatFlags;
  /** The map's panel is dark; everything else is on paper. */
  tone?: "light" | "dark";
}) {
  const t = useTranslations("species");
  if (!habitatKnown(species)) return null;
  const shown = HABITATS.filter(([key]) => species[key] === true);
  if (shown.length === 0) return null;

  return (
    <span className="flex flex-wrap gap-1.5">
      {shown.map(([, key, colour]) => (
        <span
          key={key}
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] ${
            tone === "dark"
              ? "border-parchment-200/15 bg-parchment-50/5 text-parchment-200"
              : "border-ink-900/10 bg-paper-50 text-ink-700"
          }`}
        >
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: colour }}
          />
          {t(`habitat.${key}`)}
        </span>
      ))}
    </span>
  );
}
