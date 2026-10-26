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
  hidden = false,
}: {
  state: PhotoSuggestionsState;
  onPick: (hit: PhotoSuggestion) => void;
  /** A species is named, or the reporter said they are not sure: nothing to suggest. */
  hidden?: boolean;
}) {
  const t = useTranslations("report");
  const locale = useLocale();

  /*
   * ONE live region, always in the page, whose words change. There used to be
   * a new status element for each state, mounted with its text already
   * inside it, and a region that arrives already speaking is one most screen
   * readers never announce: "looking at your photo" and then the suggestions
   * came and went in silence. Only the sentence is in it. The suggestions are
   * buttons, read when they are reached, not recited every time they change.
   */
  const shown = hidden ? null : state;
  const message =
    shown?.status === "working"
      ? t("aiLooking")
      : shown?.status === "failed"
        ? t("aiUnavailable")
        : shown?.status === "done"
          ? shown.suggestions.length > 0
            ? t("aiSuggests")
            : t("aiUnsure")
          : "";
  const done = shown?.status === "done" ? shown : null;
  const outside = done?.outsidePage;

  return (
    <div className={message ? "mb-3" : undefined}>
      <p
        role="status"
        className={
          done && done.suggestions.length > 0
            ? "mb-1.5 text-sm font-semibold text-forest-900"
            : "text-sm text-ink-700"
        }
      >
        {message}
      </p>
      {done && done.suggestions.length > 0 && (
        <>
          <ul className="space-y-1.5">
            {done.suggestions.map((s) => (
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
