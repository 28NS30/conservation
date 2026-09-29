"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import SpeciesName from "@/components/species/SpeciesName";
import { confirmSpecies } from "@/app/[locale]/(site)/reports/[id]/actions";

export type Suggestion = {
  taxonId: number;
  rank: number;
  score: number;
  scientificName: string;
  commonNameZh: string | null;
  commonNameEn?: string | null;
  taicolId?: string | null;
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
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<number | null>(currentTaxonId);
  // Whether the last choice failed to save, not why. A server action's own
  // message is replaced by a generic English one in a production build, so
  // showing it put developer text in front of the reporter; it goes to the
  // console instead.
  const [failed, setFailed] = useState(false);

  if (suggestions.length === 0) return null;

  return (
    <section aria-labelledby="suggestions-title" className="mt-6">
      {/* Set like the page's other section headings ("Species", "Location");
          it was 12px grey capitals, the faintest heading on the page, over
          the one thing on it a reporter is asked to do. */}
      <h2 id="suggestions-title" className="text-base font-semibold text-ink-900">
        {t("suggestions")}
      </h2>
      {/* What to do, before the list rather than after it. */}
      {canEdit && (
        <p className="mt-1 text-sm leading-relaxed text-ink-700">{t("pickCorrect")}</p>
      )}

      <ul className="mt-3 space-y-2">
        {suggestions.map((s) => {
          const active = chosen === s.taxonId;
          return (
            <li key={s.taxonId}>
              <button
                type="button"
                disabled={!canEdit || pending}
                aria-pressed={canEdit ? active : undefined}
                onClick={() =>
                  startTransition(async () => {
                    setFailed(false);
                    try {
                      await confirmSpecies(reportId, s.taxonId);
                      setChosen(s.taxonId);
                    } catch (e) {
                      console.error("[species confirm]", (e as Error).message);
                      setFailed(true);
                    }
                  })
                }
                className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-left text-base transition ${
                  active
                    ? "border-ember-500/60 bg-ember-500/10"
                    : "border-ink-900/15 bg-paper-100"
                } ${canEdit ? "hover:border-ink-900/30" : "cursor-default"}`}
              >
                <span className="min-w-0">
                  <SpeciesName
                    species={s}
                    locale={locale}
                    primaryClassName="text-ink-900"
                    secondaryClassName="text-sm text-ink-700"
                  />
                </span>
                <span className="shrink-0 tabular-nums text-sm text-ink-700">
                  {Math.round(s.score * 100)}%
                  {active && <span className="ml-2 text-ember-700">✓</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {failed && (
        <p role="alert" className="mt-2 text-sm text-rose-800">
          {t("confirmFailed")}
        </p>
      )}

      {!canEdit && (
        <p className="mt-2 text-sm leading-relaxed text-ink-700">{t("confirmedBy")}</p>
      )}
    </section>
  );
}
