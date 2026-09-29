"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ANIMAL_GROUPS, animalGroupOf } from "@/lib/animalGroups";

export type InvasiveSpeciesRow = {
  id: number;
  slug: string;
  scientificName: string;
  commonNameZh: string | null;
  altNamesZh: string[] | null;
  class: string | null;
  protectedStatus: string | null;
  reportCount: number;
  note: string | null;
};

/**
 * TaiCOL's invasive animals, grouped, with a search box.
 *
 * The whole list is in the server's HTML, grouped and complete, so it reads
 * and links with no script at all; the search box only narrows what is shown.
 * It matches the Chinese name, TaiCOL's other Chinese names and the scientific
 * name, because the name a reader knows is often the alternate: TaiCOL spells
 * the iguana 綠鬛蜥 and the site's own front page says 綠鬣蜥.
 *
 * Each row is one link, to the species page, and at least 44px tall: on a
 * phone the row is the target, not the name inside it.
 */
export default function InvasiveSpeciesList({
  species,
  zh,
}: {
  species: InvasiveSpeciesRow[];
  zh: boolean;
}) {
  const t = useTranslations("collections");
  const [q, setQ] = useState("");
  const inputId = useId();

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle
        ? species.filter(
            (s) =>
              s.scientificName.toLowerCase().includes(needle) ||
              (s.commonNameZh ?? "").includes(needle) ||
              (s.altNamesZh ?? []).some((a) => a.includes(needle)),
          )
        : species,
    [species, needle],
  );

  const groups = ANIMAL_GROUPS.map((g) => ({
    key: g,
    rows: shown.filter((s) => animalGroupOf(s.class) === g),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="mx-auto mt-10 max-w-[900px]">
      <label
        htmlFor={inputId}
        className="block text-[15px] font-semibold text-forest-900"
      >
        {t("invasive.searchLabel")}
      </label>
      <input
        id={inputId}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("invasive.searchPlaceholder")}
        autoComplete="off"
        className="mt-2 block min-h-12 w-full border-2 border-forest-900/25 bg-paper-100 px-4 text-[16px] text-ink-950 placeholder:text-ink-500 focus:border-forest-900"
      />
      {/* Said out loud, since the list below changes silently as one types. */}
      <p aria-live="polite" className="mt-2 text-[14px] text-ink-600">
        {needle
          ? shown.length
            ? t("invasive.matches", { count: shown.length })
            : t("invasive.noMatch", { q: q.trim() })
          : t("invasive.total", { count: species.length })}
      </p>

      {groups.map((g) => (
        <section key={g.key} className="mt-10" aria-labelledby={`${inputId}-${g.key}`}>
          <h3
            id={`${inputId}-${g.key}`}
            className={`flex items-baseline justify-between gap-3 border-b-2 border-forest-900 pb-2 font-display text-[22px] font-bold text-forest-900 ${
              zh ? "tracking-[0.04em]" : "uppercase tracking-[0.02em]"
            }`}
          >
            <span>{t(`group.${g.key}`)}</span>
            <span className="font-sans text-[14px] font-normal normal-case tracking-normal text-ink-600">
              {t("invasive.groupCount", { count: g.rows.length })}
            </span>
          </h3>
          <ul className="divide-y divide-ink-900/10">
            {g.rows.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/species/${s.slug}`}
                  className="group flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2.5 transition hover:bg-paper-100"
                >
                  <span className="min-w-0 flex-1">
                    {zh && s.commonNameZh ? (
                      <>
                        <span className="block text-[16px] font-semibold text-ink-950 group-hover:text-leaf-700">
                          {s.commonNameZh}
                        </span>
                        <span className="block break-words text-[14px] italic text-ink-600">
                          {s.scientificName}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="block break-words text-[16px] font-semibold italic text-ink-950 group-hover:text-leaf-700">
                          {s.scientificName}
                        </span>
                        {s.commonNameZh && (
                          <span lang="zh-TW" className="block text-[14px] text-ink-600">
                            {s.commonNameZh}
                          </span>
                        )}
                      </>
                    )}
                    {s.note && (
                      <span className="mt-1 block text-[14px] leading-snug text-ink-600">
                        {t("invasive.taicolNote", { note: s.note })}
                      </span>
                    )}
                  </span>
                  {/* Protected by law and invasive at once: the cockatoos. Said
                      so, because the location of each record is blurred for
                      it, which a reader of an invasive list would not expect. */}
                  {s.protectedStatus && (
                    <span className="rounded-full border border-forest-900/30 px-2.5 py-0.5 text-[14px] text-forest-900">
                      {t("invasive.protected")}
                    </span>
                  )}
                  <span className="shrink-0 text-right text-[14px] tabular-nums text-ink-700">
                    {t("invasive.records", { count: s.reportCount })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
