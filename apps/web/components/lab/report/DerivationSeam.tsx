"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { LabCopy } from "@/lib/lab/copy";
import {
  derivationFor,
  deriveCategory,
  taxonSource,
} from "@/lib/lab/deriveCategory";
import { outcomeFor, type FlowState, type Outcome } from "@/lib/lab/reportFlow";

/**
 * The argument, made visible: the category nobody was asked for, being worked
 * out from the two answers that were.
 *
 * This panel is NOT part of either design and must never be mistaken for one.
 * It wears the compare strip's own greys for exactly the reason the strip does:
 * a block that took the theme's colours would be read as something the owner is
 * being asked to judge. What is being demonstrated here is a rule, not a look.
 *
 * It is worth the space because "stop asking for the category" is the one
 * change in this chapter that cannot be seen by looking at a screenshot. Every
 * other improvement — the photo first, the big rows, the honest receipt — shows
 * itself. This one only shows when you watch the stored value change while
 * nobody types it.
 */
const TABLE = [
  { condition: "dead", species: "any", flag: "any", category: "roadkill" },
  { condition: "hurt", species: "any", flag: "any", category: "injured" },
  { condition: "well", species: "named", flag: "yes", category: "invasive" },
  { condition: "well", species: "named", flag: "no", category: "sighting" },
  { condition: "well", species: "named", flag: "unknown", category: "either" },
  {
    condition: "well",
    species: "unsureIntroduced",
    flag: "na",
    category: "invasive",
  },
  {
    condition: "well",
    species: "unsureOrSkipped",
    flag: "na",
    category: "sighting",
  },
] as const;

/** Which row of the table the current answers land on, or -1 while unanswered. */
function matchedRow(state: FlowState): number {
  if (state.condition === "dead") return 0;
  if (state.condition === "hurt") return 1;
  if (state.condition !== "well") return -1;
  const species = state.species;
  if (!species) return -1;
  if (species.kind === "named") {
    if (species.isInvasive === true) return 2;
    if (species.isInvasive === false) return 3;
    return 4;
  }
  if (species.kind === "unsure" && species.introduced) return 5;
  return 6;
}

export default function DerivationSeam({
  copy,
  state,
  flowPath,
  outcome: shown,
}: {
  copy: LabCopy;
  state: FlowState;
  /** This flow's own path, so the three forced receipts land back here. */
  flowPath: string;
  /**
   * The receipt actually on screen, when there is one. Without it a forced
   * `?receipt=published` would be explained by a panel reading the empty
   * answers underneath it, and the seam would contradict the page it is
   * attached to.
   */
  outcome?: Outcome | null;
}) {
  const categories = useTranslations("categories");
  const precision = useTranslations("precision");
  const row = matchedRow(state);
  const derivation = derivationFor(state.species);
  const category = state.condition
    ? deriveCategory(state.condition, derivation)
    : null;
  const source = taxonSource(state.species);
  const outcome = shown ?? outcomeFor(state);

  const conditionWord = state.condition
    ? {
        dead: copy.report.conditionDead,
        hurt: copy.report.conditionHurt,
        well: copy.report.conditionWell,
      }[state.condition]
    : copy.seam.unanswered;

  const speciesWord = !state.species
    ? copy.seam.unanswered
    : state.species.kind === "named"
      ? copy.seam.named
      : state.species.kind === "skipped"
        ? copy.report.speciesSkip
        : state.species.introduced
          ? copy.seam.unsureIntroduced
          : copy.report.speciesUnsure;

  const flagWord =
    state.species?.kind === "named"
      ? state.species.isInvasive === true
        ? copy.seam.yes
        : state.species.isInvasive === false
          ? copy.seam.no
          : copy.seam.unknown
      : "—";

  const word = (key: string) =>
    ({
      any: copy.seam.any,
      yes: copy.seam.yes,
      no: copy.seam.no,
      unknown: copy.seam.unknown,
      na: "—",
      named: copy.seam.named,
      unsureIntroduced: copy.seam.unsureIntroduced,
      unsureOrSkipped: copy.seam.unsureOrSkipped,
      dead: copy.report.conditionDead,
      hurt: copy.report.conditionHurt,
      well: copy.report.conditionWell,
      either: `${categories("invasive")} / ${categories("sighting")}`,
      roadkill: categories("roadkill"),
      injured: categories("injured"),
      invasive: categories("invasive"),
      sighting: categories("sighting"),
    })[key] ?? key;

  const rule = { borderColor: "color-mix(in srgb, currentColor 30%, transparent)" };

  const facts: [string, string][] = [
    [copy.seam.condition, conditionWord],
    [copy.seam.speciesAnswer, speciesWord],
    [copy.seam.invasiveFlag, flagWord],
    [copy.seam.category, category ? categories(category) : copy.seam.unanswered],
    [
      copy.seam.taxonSource,
      source === "user"
        ? copy.seam.sourceUser
        : source === "unknown"
          ? copy.seam.sourceUnknown
          : copy.seam.sourceNone,
    ],
    [
      copy.seam.precision,
      outcome.precision === "taxon"
        ? copy.seam.precisionTaxon
        : precision("coarse_10km"),
    ],
    [
      copy.seam.status,
      outcome.kind === "published"
        ? copy.receipt.published
        : outcome.kind === "queued"
          ? copy.receipt.queued
          : copy.receipt.held,
    ],
  ];

  return (
    <section className="lab-strip">
      <div className="mx-auto w-full max-w-5xl px-(--gutter) py-10">
        <h2 className="t-lead font-bold">{copy.seam.title}</h2>
        <p className="t-note mt-2 opacity-80">{copy.seam.lead}</p>

        <dl className="mt-6 grid grid-cols-2 gap-x-6">
          {facts.map(([label, value]) => (
            <div key={label} className="col-span-2 grid grid-cols-2 border-b py-2" style={rule}>
              <dt className="t-note opacity-80">{label}</dt>
              <dd className="t-note font-bold">{value}</dd>
            </div>
          ))}
        </dl>

        <p className="t-note mt-4 font-bold">{copy.seam.notAsked}</p>

        <details className="mt-6">
          <summary className="t-note flex min-h-11 items-center">
            {copy.seam.table}
          </summary>
          <table className="t-note mt-2 w-full text-left">
            <thead>
              <tr className="border-b-2" style={rule}>
                <th className="py-2 pr-4">{copy.seam.condition}</th>
                <th className="py-2 pr-4">{copy.seam.speciesAnswer}</th>
                <th className="py-2 pr-4">{copy.seam.invasiveFlag}</th>
                <th className="py-2">{copy.seam.category}</th>
              </tr>
            </thead>
            <tbody>
              {TABLE.map((entry, index) => (
                <tr
                  key={index}
                  className={`border-b ${index === row ? "font-bold" : "opacity-70"}`}
                  style={rule}
                  aria-current={index === row ? "true" : undefined}
                >
                  <td className="py-2 pr-4">
                    {index === row ? <span aria-hidden="true">▸ </span> : null}
                    {word(entry.condition)}
                  </td>
                  <td className="py-2 pr-4">{word(entry.species)}</td>
                  <td className="py-2 pr-4">{word(entry.flag)}</td>
                  <td className="py-2">{word(entry.category)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <p className="t-note mt-8 opacity-80">{copy.seam.static}</p>
        <p className="t-note mt-2">
          {copy.seam.receipts}{" "}
          {(["published", "held", "queued"] as const).map((kind, index) => (
            <span key={kind}>
              {index > 0 ? " · " : null}
              <Link
                href={`${flowPath}?receipt=${kind}`}
                className="underline underline-offset-4"
              >
                {kind === "published"
                  ? copy.receipt.published
                  : kind === "held"
                    ? copy.receipt.held
                    : copy.receipt.queued}
              </Link>
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
