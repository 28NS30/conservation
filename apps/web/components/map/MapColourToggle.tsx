"use client";

import { useTranslations } from "next-intl";
import { COLOURS, type MapColour } from "./mapMode";

/**
 * What the colour on the map means: how many, or what kind.
 *
 * Deliberately a second control rather than three more entries in the display
 * toggle. They are different questions — density says where this is happening,
 * type says what is happening there — and the map is asked both, so two small
 * controls offer six useful views where one list would offer six choices.
 */
export default function MapColourToggle({
  colour,
  onChange,
  className = "",
}: {
  colour: MapColour;
  onChange: (c: MapColour) => void;
  className?: string;
}) {
  const t = useTranslations();
  return (
    <div
      role="group"
      aria-label={t("map.colourBy")}
      className={`flex rounded-md border border-parchment-200/15 p-0.5 ${className}`}
    >
      {COLOURS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-pressed={colour === c}
          className={`flex-1 rounded px-2 py-1 text-[11px] whitespace-nowrap transition ${
            colour === c
              ? "bg-parchment-50/90 font-medium text-bark-950"
              : "text-parchment-300 hover:bg-parchment-50/10"
          }`}
        >
          {t(`map.colour.${c}`)}
        </button>
      ))}
    </div>
  );
}
