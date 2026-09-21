"use client";

import { useEffect, useState } from "react";
import Choice, { type ChoiceOption } from "@/components/lab/ui/Choice";
import Field from "@/components/lab/ui/Field";
import Notice from "@/components/lab/ui/Notice";
import PageTitle from "@/components/lab/ui/PageTitle";
import { withBase } from "@/lib/basePath";
import type { LabCopy } from "@/lib/lab/copy";
import type { SpeciesAnswer } from "@conservation/shared";
import type { ReportFlow } from "./useReportFlow";

type Hit = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  isInvasive: boolean | null;
};

/** Long enough that a slow answer still arrives; short enough to act on. */
const SLOW_MS = 4000;

/**
 * What animal? Answerable three ways, and one of them is "I don't know".
 *
 * The search is the live `/api/species/search` endpoint — public data only, so
 * it cannot leak a suppressed taxon's record volume — and the hits are rows, not
 * a dropdown: a 56px row is a target for a thumb, and a dropdown over a soft
 * keyboard on a phone is a list you cannot see.
 *
 * "Not sure" is a first-class answer with its own row rather than a link under
 * the box, because it is the honest answer most of the time and the record is
 * still worth having. The second row — "not sure, but I think it's introduced"
 * — is the only way a reporter's belief about a species reaches the stored
 * category, and it is offered only for an animal that is alive and well: an
 * introduced species that has been run over is a roadkill record, and asking
 * about it would imply otherwise.
 *
 * When the network will not answer, the flow says so and offers a way past. A
 * name that cannot be looked up must never be a wall in front of a record that
 * is otherwise complete.
 */
export default function SpeciesStep({
  copy,
  flow,
  onAdvance,
  titleId,
  heading = "h1",
}: {
  copy: LabCopy;
  flow: ReportFlow;
  onAdvance?: () => void;
  titleId: string;
  heading?: "h1" | "h2";
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  // The query a search failed or timed out on, so typing one more character
  // clears the warning instead of leaving it up for the next 250 ms.
  const [stuckFor, setStuckFor] = useState<string | null>(null);
  const { species, condition } = flow.state;

  useEffect(() => {
    const q = query.trim();
    // Nothing to clear: an empty box derives an empty list below rather than
    // writing one into state, which would cascade a render on every keystroke
    // that empties the field.
    if (!q) return;

    let cancelled = false;
    const controller = new AbortController();
    const slow = setTimeout(() => {
      if (!cancelled) setStuckFor(q);
    }, SLOW_MS);

    const debounce = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({
          q,
          filter: "all",
          prefer: "native",
        });
        const res = await fetch(withBase(`/api/species/search?${params}`), {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { results?: Hit[] };
        if (cancelled) return;
        setHits(body.results ?? []);
        setStuckFor(null);
      } catch {
        // Offline, a superseded request, or a server that is unwell. All three
        // look the same to somebody standing in a field, and all three get the
        // same way out.
        if (!cancelled && !controller.signal.aborted) setStuckFor(q);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(debounce);
      clearTimeout(slow);
    };
  }, [query]);

  const typing = query.trim().length > 0;
  const live = typing ? hits : [];
  const blocked = typing && stuckFor === query.trim();
  const named = species?.kind === "named" ? species : null;
  // A chosen name stays on the list even after the search that produced it has
  // been typed over, so the answer never silently disappears from the screen.
  const shown: Hit[] = named && !live.some((hit) => hit.id === named.id)
    ? [
        {
          id: named.id,
          scientificName: named.scientificName,
          commonNameZh: named.commonNameZh,
          isInvasive: named.isInvasive,
        },
        ...live,
      ]
    : live;

  const options: ChoiceOption[] = [
    ...shown.map((hit) => ({
      value: `taxon:${hit.id}`,
      label: hit.commonNameZh ?? hit.scientificName,
      hint: hit.commonNameZh ? hit.scientificName : undefined,
    })),
    { value: "unsure", label: copy.report.speciesUnsure },
    ...(condition === "well"
      ? [
          {
            value: "unsure-introduced",
            label: copy.report.speciesUnsureIntroduced,
          },
        ]
      : []),
    ...(blocked ? [{ value: "skip", label: copy.report.speciesSkip }] : []),
  ];

  const selected =
    species === null
      ? undefined
      : species.kind === "named"
        ? `taxon:${species.id}`
        : species.kind === "skipped"
          ? "skip"
          : species.introduced
            ? "unsure-introduced"
            : "unsure";

  function answer(value: string): SpeciesAnswer {
    if (value === "unsure") return { kind: "unsure", introduced: false };
    if (value === "unsure-introduced")
      return { kind: "unsure", introduced: true };
    if (value === "skip") return { kind: "skipped" };
    const id = Number(value.slice("taxon:".length));
    const hit = shown.find((candidate) => candidate.id === id)!;
    return {
      kind: "named",
      id: hit.id,
      scientificName: hit.scientificName,
      commonNameZh: hit.commonNameZh,
      isInvasive: hit.isInvasive,
    };
  }

  return (
    <div>
      {heading === "h1" ? (
        <PageTitle id={titleId} size="title">
          {copy.report.speciesTitle}
        </PageTitle>
      ) : (
        <h2 id={titleId} className="t-head text-(--fg)">
          {copy.report.speciesTitle}
        </h2>
      )}

      <Field
        className="mt-8"
        id="lab-species-search"
        type="search"
        autoComplete="off"
        // The heading directly above is this field's label. Printing it twice,
        // once at 40px and once at 16px, is the kind of doubling that makes a
        // form feel like paperwork.
        hideLabel
        label={copy.report.speciesTitle}
        placeholder={copy.report.speciesPlaceholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {searching ? (
        <p className="t-note mt-2 text-(--fg-quiet)">
          {copy.report.speciesSearching}
        </p>
      ) : null}

      {blocked ? (
        <Notice className="mt-4" live>
          {copy.report.speciesOffline}
        </Notice>
      ) : typing && !searching && shown.length === 0 ? (
        <p className="t-body mt-4 text-(--fg-quiet)">
          {copy.report.speciesNoHits}
        </p>
      ) : null}

      <Choice
        className="mt-6"
        name="lab-species"
        legend={copy.report.speciesTitle}
        hideLegend
        value={selected}
        onChange={(value) => flow.setSpecies(answer(value))}
        onCommit={() => onAdvance?.()}
        options={options}
      />
    </div>
  );
}
