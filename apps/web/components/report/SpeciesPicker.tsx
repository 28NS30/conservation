"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import SpeciesName from "@/components/species/SpeciesName";
import { withBase } from "@/lib/basePath";
import { Link } from "@/i18n/navigation";
import type { ReportPage } from "@conservation/shared";

export type SpeciesHit = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  /** Since migration 0015; absent from a hit saved offline by an older build. */
  commonNameEn?: string | null;
  taicolId?: string | null;
  isInvasive: boolean | null;
  reportCount: number;
};

/**
 * What the reporter saw, named by the reporter.
 *
 * The team asked for a search over a large database of animals, scoped by the
 * kind of report: the invasive register on the invasive page, Taiwan's animals
 * on the other two. Each page's list is defined once, in packages/shared
 * (REPORT_PAGES), and the picker asks the search by page rather than by
 * filter, so it cannot offer a species the server would then refuse.
 *
 * The invasive page no longer has a "not what you saw? search all species"
 * button. It used to, on the reasoning that a reporter who cannot find the
 * animal learns the site is wrong about reality — but what it actually did
 * was file native animals as invasive ones, which is the one thing request 6
 * asked this page never to do. Its place is taken by a way out that files the
 * animal honestly: "not on this list? report it as a wildlife sighting", and
 * "I'm not sure what it was" for an animal the reporter thinks is invasive but
 * cannot name.
 *
 * The other two pages search every animal and merely rank natives first — a
 * roadkill victim is very often not native.
 *
 * Naming a species is consequential: it is what sets the published location
 * precision, because the trigger derives the blur from the taxon's TaiCOL
 * sensitivity. A protected species named honestly still blurs automatically.
 */
export default function SpeciesPicker({
  page,
  value,
  onChange,
  unsure,
  onUnsure,
  hasEntries = false,
}: {
  page: ReportPage;
  value: SpeciesHit | null;
  onChange: (hit: SpeciesHit | null) => void;
  unsure: boolean;
  onUnsure: (v: boolean) => void;
  /** Whether the form holds anything that leaving this page would lose. */
  hasEntries?: boolean;
}) {
  const t = useTranslations("report");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SpeciesHit[]>([]);
  /**
   * The query `hits` answer, and the last query whose search failed.
   *
   * A failed search kept the previous query's results on screen under the new
   * one: one tap from naming the wrong species, which sets the blur. With no
   * earlier results it said the name did not exist, when the cause was the
   * signal (security audit, 29 September 2026).
   */
  const [hitsFor, setHitsFor] = useState("");
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const invasivePage = page === "invasive";

  useEffect(() => {
    const q = query.trim();
    // Nothing to clear: `visible` below derives the empty list from the empty
    // query. Setting state here instead would cascade a render on every
    // keystroke that empties the box.
    if (!q) return;
    const params = new URLSearchParams({ q, page });

    let cancelled = false;
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(withBase(`/api/species/search?${params}`));
        if (!res.ok) throw new Error(`search ${res.status}`);
        const results = (await res.json()).results ?? [];
        if (!cancelled) {
          setHits(results);
          setHitsFor(q);
          setFailedFor(null);
        }
      } catch {
        // Offline, or the search failed. Superseded requests are `cancelled`.
        if (!cancelled) setFailedFor(q);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, page]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const q = query.trim();
  const visible = q && hitsFor === q ? hits : [];
  const failed = q !== "" && failedFor === q;

  if (value) {
    return (
      <section>
        <h2 className="mb-2 text-base font-semibold text-forest-900">
          {t("species")}
        </h2>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-900/12 bg-paper-100 px-3.5 py-3">
          <span className="min-w-0">
            <SpeciesName
              species={value}
              locale={locale}
              primaryClassName="text-[15px] font-medium text-ink-900"
              secondaryClassName="text-sm text-ink-600"
            />
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
            className="ml-auto inline-flex min-h-11 items-center rounded-full border border-ink-900/15 px-4 text-sm text-ink-700 transition hover:bg-paper-200"
          >
            {t("speciesChange")}
          </button>
        </div>
        {/*
          Request 7: an invasive animal seen alive is a wildlife sighting AND an
          invasive record. The reporter does not have to know that, or tick
          anything — the species says it, from TaiCOL's own flag — but they are
          told, so the record turning up in both places is not a surprise.
        */}
        {page === "wildlife" && value.isInvasive && (
          <p
            role="note"
            className="mt-2 border-l-4 border-leaf-600 pl-3 text-sm leading-relaxed text-ink-800"
          >
            {t("alsoInvasive")}
          </p>
        )}
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-forest-900">
        {t("species")}{" "}
        <span className="text-sm font-normal text-ink-600">{t("optional")}</span>
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
          placeholder={
            invasivePage ? t("speciesSearchInvasive") : t("speciesSearch")
          }
          aria-label={t("species")}
          className="min-h-12 w-full rounded-lg border border-ink-900/20 bg-paper-100 px-3.5 py-3 text-base text-ink-900 placeholder:text-ink-600 disabled:opacity-50"
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
            ? failed
              ? t("speciesSearchFailed")
              : t("speciesResults", { count: visible.length })
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
                  className="flex min-h-11 w-full items-center justify-between gap-2 px-3.5 py-2 text-left hover:bg-paper-200"
                >
                  <span className="min-w-0">
                    <SpeciesName
                      species={h}
                      locale={locale}
                      primaryClassName="text-[15px] text-ink-900"
                      secondaryClassName="text-sm text-ink-600"
                    />
                  </span>
                  {/* Every hit on the invasive page is invasive; a chip on
                      each would say nothing. */}
                  {h.isInvasive && !invasivePage && (
                    <span className="shrink-0 rounded-full bg-ember-500/15 px-2 py-0.5 text-sm text-ember-700">
                      {t("speciesInvasive")}
                    </span>
                  )}
                </button>
              </li>
            ))}

            {visible.length === 0 && !searching && (
              <li className="px-3.5 py-2 text-sm text-ink-600">
                {failed
                  ? t("speciesSearchFailed")
                  : invasivePage
                    ? t("speciesNoHitsInvasive")
                    : t("speciesNoHits")}
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
      <label className="mt-2 flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-ink-700">
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
          className="mt-0.5 size-5 shrink-0 accent-forest-900"
        />
        <span>
          {t("speciesUnsure")}
          <span className="mt-0.5 block text-ink-600">
            {invasivePage
              ? t("speciesUnsureHintInvasive")
              : t("speciesUnsureHint")}
          </span>
        </span>
      </label>

      {/*
        The honest way out of a closed list. Someone whose animal is not here
        has either seen a native animal — a wildlife sighting — or an invasive
        one TaiCOL does not list, which the wildlife page takes too. Either way
        the record is filed as what it is, rather than squeezed into the
        nearest invasive name.
      */}
      {invasivePage && (
        <p className="mt-1 text-sm text-ink-700">
          {t("notOnListLead")}{" "}
          {/* A plain link to another page, which starts empty: the photo
              (often not in the camera roll when taken through the form), the
              place and the notes would all be gone. So it asks first. */}
          <Link
            href="/report/wildlife"
            onClick={(e) => {
              if (hasEntries && !window.confirm(t("notOnListConfirm"))) e.preventDefault();
            }}
            className="inline-flex min-h-11 items-center font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900"
          >
            {t("notOnListLink")}
          </Link>
        </p>
      )}
    </section>
  );
}
