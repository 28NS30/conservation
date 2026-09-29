"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { withBase } from "@/lib/basePath";
import SpeciesName from "@/components/species/SpeciesName";
import type { SpeciesHit } from "@/components/report/SpeciesPicker";
import { confirmSpecies } from "@/app/[locale]/(site)/reports/[id]/actions";

/**
 * A moderator names the species, whatever it is.
 *
 * confirmSpecies has always let a moderator set any species ("the whole point
 * of an expert correction is that the classifier's five guesses were wrong"),
 * but the only control on the page was the list of those five guesses. A
 * moderator who knew the animal and did not see it listed had no way to say
 * so. This is that way: a search over every animal on Taiwan's species list,
 * the same one the wildlife page's picker uses, and one button to save.
 *
 * Shown to moderators only (the record page decides), and the server checks
 * the role again: an action is a public endpoint. Saving re-derives the blur
 * in the same statement, so naming a protected species blurs the record at
 * once (0014).
 */
export default function ModeratorSpeciesFix({ reportId }: { reportId: string }) {
  const t = useTranslations("detail.fix");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SpeciesHit[]>([]);
  const [chosen, setChosen] = useState<SpeciesHit | null>(null);
  const [state, setState] = useState<"idle" | "saved" | "failed">("idle");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const q = query.trim();
    if (!q || chosen) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const res = await fetch(
          withBase(`/api/species/search?${new URLSearchParams({ q, page: "wildlife" })}`),
        );
        if (res.ok && !cancelled) setHits(((await res.json()).results ?? []).slice(0, 8));
      } catch {
        /* offline, or superseded: keep what is on screen */
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, chosen]);

  const save = () =>
    chosen &&
    startTransition(async () => {
      setState("idle");
      try {
        await confirmSpecies(reportId, chosen.id);
        setState("saved");
      } catch (e) {
        console.error("[species fix]", (e as Error).message);
        setState("failed");
      }
    });

  return (
    <section aria-labelledby="species-fix" className="mt-6 rounded-lg border border-ink-900/15 bg-paper-100 p-4">
      <h2 id="species-fix" className="text-base font-semibold text-ink-900">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-700">{t("body")}</p>

      {chosen ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-base text-ink-900">
            <SpeciesName species={chosen} locale={locale} layout="inline" />
          </span>
          <button
            type="button"
            onClick={() => {
              setChosen(null);
              setState("idle");
            }}
            className="inline-flex min-h-11 items-center text-sm font-medium text-leaf-700 underline underline-offset-2"
          >
            {t("change")}
          </button>
        </div>
      ) : (
        <>
          <label htmlFor="species-fix-search" className="sr-only">
            {t("search")}
          </label>
          <input
            id="species-fix-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search")}
            className="mt-3 block min-h-11 w-full rounded-lg border border-ink-900/20 bg-paper-50 px-3 text-base text-ink-900"
          />
          {query.trim() !== "" && hits.length > 0 && (
            <ul className="mt-2 space-y-1">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => setChosen(h)}
                    className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-base text-ink-900 hover:bg-paper-200"
                  >
                    <SpeciesName species={h} locale={locale} layout="inline" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!chosen || pending || state === "saved"}
          onClick={save}
          className="inline-flex min-h-11 items-center rounded-lg bg-leaf-600 px-5 text-base font-semibold text-white hover:bg-leaf-700 disabled:opacity-50"
        >
          {t("save")}
        </button>
        {state === "saved" && (
          <p role="status" className="text-sm text-ink-800">
            {t("saved")}
          </p>
        )}
        {state === "failed" && (
          <p role="alert" className="text-sm text-rose-800">
            {t("failed")}
          </p>
        )}
      </div>
    </section>
  );
}
