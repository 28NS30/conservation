"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  REPORT_GROUP_KEYS,
  filterToQuery,
  type MapFilter,
  type ReportGroup,
} from "@conservation/shared";
import Field from "@/components/lab/ui/Field";
import Filter from "@/components/lab/ui/Filter";
import LinkAction from "@/components/lab/ui/LinkAction";
import type { LabCopy } from "@/lib/lab/copy";
import type { LabMapMode, LabMapColour } from "./modes";

export type SpeciesHit = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  reportCount: number;
};

/**
 * Everything the map can be asked, in one column.
 *
 * On the live map these are chips floating over the top-left corner of the
 * canvas, in a translucent rounded bar, with a second rounded bar bottom-right
 * holding the mode toggles and the legend. That is the `pills-and-small-labels`
 * interface language the owner rejected, and it also puts controls over the
 * data they filter.
 *
 * So the panel is docked and opaque: it takes layout space out of the map
 * rather than covering it, and every question in it is asked the same way —
 * words standing on a rule, the chosen one underlined (§2.6 rule 2, "an
 * underlined word means filter"). Nothing here is a rectangle, because a
 * rectangle would mean "press here" and none of these are actions.
 *
 * TYPE IS ONE CHOICE, NOT CHECKBOXES. direction.md §4 asks for checkboxes, and
 * they would be a lie: `mapFilterSchema.group` is a single optional enum and the
 * tile endpoint takes one group per request, so two boxes ticked could not
 * produce a map. Changing that is a live-code change this lab may not make.
 * Asked as one question with an explicit 全部, it says exactly what it does.
 */
export default function LabMapControls({
  filter,
  onFilter,
  mode,
  onMode,
  colour,
  onColour,
  years,
  initialSpecies,
  mapHref,
  copy,
  legend,
  className = "",
}: {
  filter: MapFilter;
  onFilter: (next: MapFilter) => void;
  mode: LabMapMode;
  onMode: (next: LabMapMode) => void;
  colour: LabMapColour;
  onColour: (next: LabMapColour) => void;
  years: { first: number; last: number } | null;
  initialSpecies: SpeciesHit | null;
  /** This map's own route, so the map tab is a real link with `aria-current`. */
  mapHref: string;
  copy: LabCopy;
  /** The Legend, pinned at the foot, generated from the layer that is on. */
  legend: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations();
  const zhFirst = useLocale().startsWith("zh");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SpeciesHit[]>([]);
  const [chosen, setChosen] = useState<SpeciesHit | null>(initialSpecies);

  // Debounced: a short Chinese query is a sequential scan server-side, which is
  // fine per keystroke-pause and not per keystroke.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) return;
    const id = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/species/search?q=${encodeURIComponent(q)}&filter=recorded`,
        );
        if (res.ok) setHits(((await res.json()).results ?? []) as SpeciesHit[]);
      } catch {
        /* offline or aborted — leave the previous results on screen */
      }
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const visibleHits = query.trim().length >= 1 && !chosen ? hits : [];
  const nameOf = (s: SpeciesHit) =>
    zhFirst ? (s.commonNameZh ?? s.scientificName) : s.scientificName;

  const yearOptions = years
    ? Array.from(
        { length: years.last - years.first + 1 },
        (_, i) => years.first + i,
      )
    : [];
  const yearOf = (iso?: string) => (iso ? iso.slice(0, 4) : "");
  const setYear = (which: "from" | "to", year: string) =>
    onFilter({
      ...filter,
      [which]: year
        ? which === "from"
          ? `${year}-01-01`
          : `${year}-12-31`
        : undefined,
    });

  const listHref = `/reports${filterToQuery(filter) ? `?${filterToQuery(filter)}` : ""}`;
  const anyFilter = Boolean(
    filter.group || filter.taxonId || filter.from || filter.to,
  );

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {/* Map or list. The list carries the same filters, because arriving at a
            table that has forgotten what you were looking at is how a filter
            gets set twice. */}
        <Filter
          legend={copy.common.nav}
          hideLegend
          value="map"
          options={[
            { value: "map", label: copy.map.tabMap, href: mapHref },
            { value: "list", label: copy.map.tabList, href: listHref },
          ]}
          className="mb-10"
        />

        <Field
          id="lab-map-species"
          type="search"
          label={copy.map.searchSpecies}
          placeholder={t("map.filterSpecies")}
          autoComplete="off"
          value={chosen ? nameOf(chosen) : query}
          readOnly={Boolean(chosen)}
          onChange={(e) => setQuery(e.target.value)}
        />
        {chosen ? (
          <p className="t-body mt-2">
            <LinkAction
              standalone
              onClick={() => {
                setChosen(null);
                setQuery("");
                onFilter({ ...filter, taxonId: undefined });
              }}
            >
              {copy.map.clearFilters}
            </LinkAction>
          </p>
        ) : null}
        {visibleHits.length > 0 ? (
          <ul aria-label={t("map.speciesResults", { count: visibleHits.length })}>
            {visibleHits.map((hit) => (
              <li key={hit.id} className="rule-quiet border-b">
                <button
                  type="button"
                  className="t-body flex min-h-11 w-full items-center justify-between gap-4 text-left text-(--fg)"
                  onClick={() => {
                    setChosen(hit);
                    setHits([]);
                    onFilter({ ...filter, taxonId: hit.id });
                  }}
                >
                  <span>{nameOf(hit)}</span>
                  <span className="t-note shrink-0 text-(--fg-quiet)">
                    {hit.reportCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {yearOptions.length > 0 ? (
          <fieldset className="mt-10">
            <legend className="t-note t-label mb-2 block font-bold text-(--fg-quiet)">
              {copy.map.years}
            </legend>
            <div className="flex gap-4">
              <Field
                id="lab-map-from"
                as="select"
                label={t("map.fromYear")}
                value={yearOf(filter.from)}
                onChange={(e) => setYear("from", e.target.value)}
                className="flex-1"
              >
                <option value="">{t("map.anyYear")}</option>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Field>
              <Field
                id="lab-map-to"
                as="select"
                label={t("map.toYear")}
                value={yearOf(filter.to)}
                onChange={(e) => setYear("to", e.target.value)}
                className="flex-1"
              >
                <option value="">{t("map.anyYear")}</option>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Field>
            </div>
          </fieldset>
        ) : null}

        <Filter
          legend={copy.map.typeLabel}
          value={filter.group ?? "all"}
          onChange={(next) =>
            onFilter({
              ...filter,
              group: next === "all" ? undefined : (next as ReportGroup),
            })
          }
          options={[
            { value: "all", label: t("map.all") },
            ...REPORT_GROUP_KEYS.map((g) => ({
              value: g,
              label: t(`report.group.${g}`),
            })),
          ]}
          className="mt-10"
        />

        <Filter
          legend={copy.map.displayLabel}
          value={mode}
          onChange={(next) => onMode(next as LabMapMode)}
          options={[
            { value: "bins", label: copy.map.displayGrid },
            { value: "dots", label: copy.map.displayDots },
            { value: "heat", label: copy.map.displayHeat },
          ]}
          className="mt-10"
        />

        <Filter
          legend={copy.map.colourLabel}
          value={colour}
          onChange={(next) => onColour(next as LabMapColour)}
          options={[
            { value: "density", label: copy.map.colourDensity },
            { value: "type", label: copy.map.colourType },
          ]}
          className="mt-10"
        />

        {anyFilter ? (
          <p className="t-body mt-10">
            <LinkAction
              standalone
              onClick={() => {
                setChosen(null);
                setQuery("");
                onFilter({});
              }}
            >
              {copy.map.clearFilters}
            </LinkAction>
          </p>
        ) : null}
      </div>

      {/* Pinned, because a legend you have to scroll to is a legend nobody
          reads, and this one changes with the layer above it. */}
      <div className="rule-quiet border-t px-6 py-4">{legend}</div>
    </div>
  );
}
