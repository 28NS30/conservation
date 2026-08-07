"use client";

import { useTranslations } from "next-intl";
import { MODES, type MapMode } from "./mapMode";

/**
 * heat / bins / dots, rendered identically wherever a density map appears.
 *
 * It lived inline in the main map's legend, which meant the species pages chose
 * a representation for you based on record count and gave you no say. Same
 * control, same words, same order everywhere — the point of a display toggle is
 * that it is where you expect it.
 *
 * Not offered on maps with no density to re-express: a single report's obscured
 * footprint and the location picker have exactly one thing to draw.
 */
export default function MapModeToggle({
  mode,
  onChange,
  modes = MODES,
  className = "",
}: {
  mode: MapMode;
  onChange: (m: MapMode) => void;
  /** Subset to offer. Species with few records leave `heat` off the menu. */
  modes?: readonly MapMode[];
  className?: string;
}) {
  const t = useTranslations();
  return (
    <div
      role="group"
      aria-label={t("map.displayMode")}
      className={`flex rounded-md border border-parchment-200/15 p-0.5 ${className}`}
    >
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={mode === m}
          className={`flex-1 rounded px-2 py-1 text-[11px] whitespace-nowrap transition ${
            mode === m
              ? "bg-parchment-50/90 font-medium text-bark-950"
              : "text-parchment-300 hover:bg-parchment-50/10"
          }`}
        >
          {t(`map.mode.${m}`)}
        </button>
      ))}
    </div>
  );
}
