"use client";

import { useLocale, useTranslations } from "next-intl";
import SpeciesName from "@/components/species/SpeciesName";
import type { PhotoSuggestion, PhotoIdentification } from "@/lib/report/photoSuggestion";

export type PhotoSuggestionsState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "failed" }
  | ({ status: "done" } & Pick<PhotoIdentification, "suggestions" | "outsidePage">);

/**
 * What the model thinks the photo shows, above the species search, while the
 * reporter is still filling the form in.
 *
 * The team asked for the identification to appear as soon as a photo is added
 * (30 September 2026); it used to appear only on the record page, after the
 * report was sent. These are suggestions: tapping one names the species, as
 * choosing it in the search would, and the reporter can still search, or say
 * they are not sure. The percentage is the model's, shown as it is.
 *
 * On the invasive page, an answer the page cannot offer — the model thinks the
 * animal is native — is said in words, because a native animal's invasive
 * look-alike is exactly what a reporter would otherwise pick.
 */
export default function PhotoSuggestions({
  state,
  onPick,
}: {
  state: PhotoSuggestionsState;
  onPick: (hit: PhotoSuggestion) => void;
}) {
  const t = useTranslations("report");
  const locale = useLocale();

  if (state.status === "idle") return null;
  if (state.status === "working")
    return (
      <p role="status" className="mb-3 text-sm text-ink-700">
        {t("aiLooking")}
      </p>
    );
  if (state.status === "failed")
    return (
      <p role="status" className="mb-3 text-sm text-ink-700">
        {t("aiUnavailable")}
      </p>
    );

  const outside = state.outsidePage;
  return (
    <div role="status" className="mb-3">
      {state.suggestions.length > 0 ? (
        <>
          <p className="mb-1.5 text-sm font-semibold text-forest-900">{t("aiSuggests")}</p>
          <ul className="space-y-1.5">
            {state.suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onPick(s)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-ink-900/15 bg-paper-100 px-3.5 py-2 text-left hover:border-forest-900/50"
                >
                  <span className="min-w-0">
                    <SpeciesName
                      species={s}
                      locale={locale}
                      primaryClassName="text-[15px] text-ink-900"
                      secondaryClassName="text-sm text-ink-600"
                    />
                  </span>
                  <span className="shrink-0 tabular-nums text-sm text-ink-700">
                    {Math.round(s.score * 100)}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-sm text-ink-600">{t("aiPickHint")}</p>
        </>
      ) : (
        <p className="text-sm text-ink-700">{t("aiUnsure")}</p>
      )}
      {outside && (
        <p className="mt-2 border-l-4 border-leaf-600 pl-3 text-sm leading-relaxed text-ink-800">
          {t("aiLooksNative", {
            name: (locale === "en" ? outside.commonNameEn : outside.commonNameZh) || outside.scientificName,
          })}
        </p>
      )}
    </div>
  );
}
