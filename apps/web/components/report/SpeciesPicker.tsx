"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { withBase } from "@/lib/basePath";
import type { ReportGroup } from "@conservation/shared";

export type SpeciesHit = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  isInvasive: boolean | null;
  reportCount: number;
};

/**
 * What the reporter saw, named by the reporter.
 *
 * The team asked for a search over a large database of animals at the top of
 * the form, scoped by report type: the invasive register for an invasive
 * report, Taiwan's wildlife for the other two.
 *
 * Scoped, but never walled. An invasive report searches the 274-taxon register
 * by default and can be widened in one click, because a reporter who cannot
 * find the animal in front of them learns that the site is wrong about reality,
 * which is a worse outcome than a report filed in the wrong bucket. The other
 * two groups search everything and merely rank natives first — a roadkill
 * victim is very often not native.
 *
 * Naming a species is consequential: it is what sets the published location
 * precision, because the trigger derives the blur from the taxon's TaiCOL
 * sensitivity. A protected species named honestly still blurs automatically.
 */
export default function SpeciesPicker({
  group,
  value,
  onChange,
  unsure,
  onUnsure,
}: {
  group: ReportGroup;
  value: SpeciesHit | null;
  onChange: (hit: SpeciesHit | null) => void;
  unsure: boolean;
  onUnsure: (v: boolean) => void;
}) {
  const t = useTranslations("report");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SpeciesHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [wide, setWide] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // The invasive register is the only scope narrow enough to need widening.
  const scoped = group === "invasive" && !wide;

  // Widening or switching group re-runs the search rather than silently leaving
  // results from the previous scope on screen.
  useEffect(() => {
    const q = query.trim();
    // Nothing to clear: `visible` below derives the empty list from the empty
    // query. Setting state here instead would cascade a render on every
    // keystroke that empties the box.
    if (!q) return;
    const params = new URLSearchParams({ q });
    if (scoped) params.set("filter", "invasive");
    else {
      params.set("filter", "all");
      params.set("prefer", "native");
    }

    let cancelled = false;
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(withBase(`/api/species/search?${params}`));
        if (res.ok && !cancelled) setHits((await res.json()).results ?? []);
      } catch {
        /* offline, or the request was superseded — keep what is on screen */
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, scoped]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const visible = query.trim() ? hits : [];

  if (value) {
    return (
      <section>
        <h2 className="mb-2 text-sm font-medium text-ink-700">{t("species")}</h2>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-900/12 bg-paper-100 px-3.5 py-3">
          <span className="min-w-0">
            <span className="text-[15px] font-medium text-ink-900">
              {value.commonNameZh ?? value.scientificName}
            </span>
            {value.commonNameZh && (
              <span className="ml-2 text-[13px] italic text-ink-500">
                {value.scientificName}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
            className="ml-auto rounded-full border border-ink-900/15 px-3 py-1 text-xs text-ink-600 transition hover:bg-paper-200"
          >
            {t("speciesChange")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-ink-700">
        {t("species")}{" "}
        <span className="font-normal text-ink-400">{t("optional")}</span>
      </h2>

      <div ref={boxRef} className="relative">
        <input
          type="search"
          value={query}
          disabled={unsure}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={scoped ? t("speciesSearchInvasive") : t("speciesSearch")}
          aria-label={t("species")}
          className="w-full rounded-lg border border-ink-900/12 bg-paper-100 px-3.5 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 disabled:opacity-50"
        />

        {/*
          A plain list of buttons rather than a half-built ARIA combobox, for the
          same reason as the map's filter: Tab reaches each suggestion and Enter
          selects it, whereas a listbox role without arrow-key handling announces
          behaviour the widget does not have. The live region is what sighted
          users get for free when the list drops down.
        */}
        <p aria-live="polite" className="sr-only">
          {open && query.trim() && !searching
            ? t("speciesResults", { count: visible.length })
            : ""}
        </p>

        {open && !unsure && query.trim() && (
          <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-ink-900/12 bg-paper-50 py-1 shadow-lg">
            {visible.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(h);
                    onUnsure(false);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left hover:bg-paper-200"
                >
                  <span className="min-w-0">
                    <span className="text-[15px] text-ink-900">
                      {h.commonNameZh ?? h.scientificName}
                    </span>
                    {h.commonNameZh && (
                      <span className="ml-2 text-[13px] italic text-ink-500">
                        {h.scientificName}
                      </span>
                    )}
                  </span>
                  {h.isInvasive && (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-700">
                      {t("speciesInvasive")}
                    </span>
                  )}
                </button>
              </li>
            ))}

            {visible.length === 0 && !searching && (
              <li className="px-3.5 py-2 text-[13px] text-ink-500">
                {t("speciesNoHits")}
              </li>
            )}

            {scoped && (
              <li className="border-t border-ink-900/8 mt-1 pt-1">
                <button
                  type="button"
                  onClick={() => setWide(true)}
                  className="w-full px-3.5 py-2 text-left text-[13px] text-ink-600 hover:bg-paper-200"
                >
                  {t("speciesWiden")}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      {/*
        The team's own words: if it cannot be identified, submit it as uncertain,
        especially roadkill. Recorded as a judgement rather than as an empty
        field, so a reviewer can tell "nobody could name this" from "nobody has
        looked yet".
      */}
      <label className="mt-2.5 flex items-start gap-2.5 text-[13px] text-ink-600">
        <input
          type="checkbox"
          checked={unsure}
          onChange={(e) => {
            onUnsure(e.target.checked);
            if (e.target.checked) {
              onChange(null);
              setQuery("");
              setOpen(false);
            }
          }}
          className="mt-0.5 size-4 shrink-0 accent-ink-900"
        />
        <span>
          {t("speciesUnsure")}
          <span className="block text-ink-400">{t("speciesUnsureHint")}</span>
        </span>
      </label>
    </section>
  );
}
