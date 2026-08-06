"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CATEGORIES,
  CATEGORY_KEYS,
  type Category,
  type MapFilter,
} from "@conservation/shared";

type SpeciesHit = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  reportCount: number;
};

/**
 * Category, date-range and species filters.
 *
 * All three are already supported by the tile endpoint and folded into the query
 * string, which doubles as the CDN cache key — so a filtered view is cached
 * independently rather than recomputed per request.
 */
export default function MapFilters({
  value,
  onChange,
  years,
}: {
  value: MapFilter;
  onChange: (next: MapFilter) => void;
  years: { first: number; last: number } | null;
}) {
  const t = useTranslations();
  const [speciesQuery, setSpeciesQuery] = useState("");
  const [hits, setHits] = useState<SpeciesHit[]>([]);
  const [chosen, setChosen] = useState<SpeciesHit | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced: a short Chinese query is a sequential scan server-side (~18 ms),
  // which is fine per keystroke-pause but not per keystroke.
  useEffect(() => {
    const q = speciesQuery.trim();
    if (q.length < 1) return;
    const id = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/species/search?q=${encodeURIComponent(q)}&filter=recorded`,
        );
        if (res.ok) setHits((await res.json()).results ?? []);
      } catch {
        /* offline or aborted — leave the previous results */
      }
    }, 250);
    return () => clearTimeout(id);
  }, [speciesQuery]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Derived rather than cleared via setState inside the effect: a synchronous
  // setState in an effect triggers a cascading render.
  const visibleHits = speciesQuery.trim().length >= 1 ? hits : [];

  const pickCategory = (c?: Category) =>
    onChange({ ...value, category: value.category === c ? undefined : c });

  const yearOptions = years
    ? Array.from(
        { length: years.last - years.first + 1 },
        (_, i) => years.first + i,
      )
    : [];

  const setYear = (which: "from" | "to", year: string) => {
    if (!year) return onChange({ ...value, [which]: undefined });
    onChange({
      ...value,
      [which]: which === "from" ? `${year}-01-01` : `${year}-12-31`,
    });
  };

  const yearOf = (iso?: string) => (iso ? iso.slice(0, 4) : "");
  const active = value.category || value.taxonId || value.from || value.to;

  return (
    <div className="pointer-events-auto flex flex-col gap-1.5">
      {/* Categories */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => pickCategory(undefined)}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur transition ${
            !value.category
              ? "border-parchment-200/70 bg-parchment-50/90 text-bark-950"
              : "border-parchment-200/20 bg-bark-900/70 text-parchment-200 hover:bg-bark-800/80"
          }`}
        >
          {t("map.all")}
        </button>
        {CATEGORY_KEYS.map((k) => (
          <button
            key={k}
            onClick={() => pickCategory(k)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur transition ${
              value.category === k
                ? "border-parchment-200/70 bg-parchment-50/90 text-bark-950"
                : "border-parchment-200/20 bg-bark-900/70 text-parchment-200 hover:bg-bark-800/80"
            }`}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: CATEGORIES[k].color }}
            />
            {t(`categories.${k}`)}
          </button>
        ))}
      </div>

      {/* Species + years */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div ref={boxRef} className="relative">
          {chosen ? (
            <button
              onClick={() => {
                setChosen(null);
                setSpeciesQuery("");
                onChange({ ...value, taxonId: undefined });
              }}
              className="flex items-center gap-1.5 rounded-full border border-ember-400/60 bg-ember-400/15 px-3 py-1.5 text-xs text-ember-400 backdrop-blur"
            >
              {chosen.commonNameZh ?? chosen.scientificName}
              <span aria-hidden>×</span>
            </button>
          ) : (
            <input
              type="search"
              value={speciesQuery}
              onChange={(e) => {
                setSpeciesQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder={t("map.filterSpecies")}
              aria-label={t("map.filterSpecies")}
              className="w-44 rounded-full border border-parchment-200/20 bg-bark-900/70 px-3 py-1.5 text-xs text-parchment-200 backdrop-blur placeholder:text-parchment-500"
            />
          )}

          {/*
            Deliberately a plain list of buttons rather than an ARIA combobox.
            Tab reaches each suggestion and Enter selects it, which works today;
            a half-built combobox (role without aria-activedescendant and arrow-key
            handling) would announce a listbox that does not behave like one, and
            that is worse than a simple list of labelled buttons.

            What was missing is any signal that results appeared at all — sighted
            users see the list drop down, screen reader users got nothing. Hence
            the live region.
          */}
          <p aria-live="polite" className="sr-only">
            {open && !chosen && speciesQuery.trim()
              ? t("map.speciesResults", { count: visibleHits.length })
              : ""}
          </p>

          {open && visibleHits.length > 0 && !chosen && (
            <ul className="absolute z-20 mt-1 max-h-60 w-64 overflow-auto rounded-lg border border-parchment-200/15 bg-bark-900/95 py-1 backdrop-blur">
              {visibleHits.map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => {
                      setChosen(h);
                      setOpen(false);
                      onChange({ ...value, taxonId: h.id });
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-bark-800"
                  >
                    <span className="min-w-0 truncate">
                      <span className="text-parchment-100">
                        {h.commonNameZh ?? h.scientificName}
                      </span>
                      {h.commonNameZh && (
                        <span className="ml-1.5 italic text-parchment-500">
                          {h.scientificName}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-parchment-500">
                      {h.reportCount}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {yearOptions.length > 1 && (
          <div className="flex items-center gap-1 rounded-full border border-parchment-200/20 bg-bark-900/70 px-2.5 py-1 text-xs text-parchment-300 backdrop-blur">
            <select
              value={yearOf(value.from)}
              onChange={(e) => setYear("from", e.target.value)}
              aria-label={t("map.fromYear")}
              className="bg-transparent text-xs"
            >
              <option value="">{t("map.anyYear")}</option>
              {yearOptions.map((y) => (
                <option key={y} value={y} className="bg-bark-900">
                  {y}
                </option>
              ))}
            </select>
            <span className="text-parchment-500">–</span>
            <select
              value={yearOf(value.to)}
              onChange={(e) => setYear("to", e.target.value)}
              aria-label={t("map.toYear")}
              className="bg-transparent text-xs"
            >
              <option value="">{t("map.anyYear")}</option>
              {yearOptions.map((y) => (
                <option key={y} value={y} className="bg-bark-900">
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}

        {active && (
          <button
            onClick={() => {
              setChosen(null);
              setSpeciesQuery("");
              onChange({});
            }}
            className="rounded-full border border-parchment-200/15 px-3 py-1.5 text-xs text-parchment-400 backdrop-blur hover:bg-bark-800"
          >
            {t("map.clearFilters")}
          </button>
        )}
      </div>
    </div>
  );
}
