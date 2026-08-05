"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { confirmSpecies } from "@/app/[locale]/reports/[id]/actions";

export type Suggestion = {
  taxonId: number;
  rank: number;
  score: number;
  scientificName: string;
  commonNameZh: string | null;
};

export default function SpeciesConfirm({
  reportId,
  suggestions,
  canEdit,
  currentTaxonId,
}: {
  reportId: string;
  suggestions: Suggestion[];
  canEdit: boolean;
  currentTaxonId: number | null;
}) {
  const t = useTranslations("detail");
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<number | null>(currentTaxonId);
  const [error, setError] = useState<string | null>(null);

  if (suggestions.length === 0) return null;

  return (
    <section className="mt-5">
      <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("suggestions")}</h2>

      <ul className="mt-1.5 space-y-1">
        {suggestions.map((s) => {
          const active = chosen === s.taxonId;
          return (
            <li key={s.taxonId}>
              <button
                type="button"
                disabled={!canEdit || pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    try {
                      await confirmSpecies(reportId, s.taxonId);
                      setChosen(s.taxonId);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  })
                }
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${
                  active
                    ? "border-emerald-500/50 bg-emerald-500/10"
                    : "border-white/10 bg-slate-900/50"
                } ${canEdit ? "hover:border-white/30" : "cursor-default"}`}
              >
                <span className="min-w-0">
                  {s.commonNameZh && <span className="mr-2 text-slate-100">{s.commonNameZh}</span>}
                  <span className="italic text-slate-400">{s.scientificName}</span>
                </span>
                <span className="shrink-0 tabular-nums text-xs text-slate-500">
                  {Math.round(s.score * 100)}%
                  {active && <span className="ml-2 text-emerald-400">✓</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}

      <p className="mt-2 text-[11px] text-slate-500">
        {canEdit ? t("pickCorrect") : t("confirmedBy")}
      </p>
    </section>
  );
}
