"use client";

import { useSyncExternalStore } from "react";
import { useLocale } from "next-intl";
import { List, DataRow } from "@/components/lab/ui/DataRow";
import type { LabCopy } from "@/lib/lab/copy";
import type { FlowState } from "@/lib/lab/reportFlow";

/**
 * The record as it stands: four quiet rows, and the whole row is the way back.
 *
 * No small 修改 links beside each line. A 13px link inside a table row is a
 * target a thumb misses, and the row already means one thing — this answer — so
 * the row is the target. The hashes are the same ones the stepper routes on, so
 * one set of links serves both proofs: in the stepper the screen swaps, on the
 * photo-first page it scrolls.
 *
 * NO COORDINATE. The place row says a place is set and nothing more. A record
 * summary is exactly the kind of screen where a lat/lng gets read out loud,
 * screenshotted and pasted, and the precision a sensitive species is published
 * at is decided by the database, not by what the form happened to show.
 *
 * An unanswered row is not drawn at all. There is nothing in an empty row worth
 * the line it sits on, and on the desktop pane this is the record taking shape —
 * it should grow, not sit there as four blanks waiting to be filled.
 */
/**
 * A clock, read as an external store rather than during render.
 *
 * The server has no answer to "what time is it for the reader", so it returns
 * null and the row is not drawn; the browser fills it in on subscribe, which is
 * after hydration. That is one render later than reading `Date.now()` inline
 * and it is the difference between a stable row and one that is right, then
 * briefly wrong, then right again — which is what a server-rendered clock does
 * when React silently repairs the mismatch.
 *
 * Refreshed on every mount, so "now" is when this record was filled in and not
 * when the tab was opened.
 */
let clockAt: number | null = null;

function subscribeClock(onChange: () => void) {
  clockAt = Date.now();
  onChange();
  return () => {};
}

const clockOnClient = () => clockAt;
const clockOnServer = () => null;

export default function RecordSummary({
  copy,
  state,
  className = "",
}: {
  copy: LabCopy;
  state: FlowState;
  className?: string;
}) {
  const locale = useLocale();
  const takenAt = state.photos.find((photo) => photo.takenAt)?.takenAt ?? null;

  // The clock is read only after hydration. A time rendered on the server is a
  // different time from the one the browser renders a moment later, and React
  // repairs that silently — so the row would be right, then briefly wrong, then
  // right again. `useSyncExternalStore` gives the server `false` and the client
  // `true` without a state update in an effect.
  const clock = useSyncExternalStore(
    subscribeClock,
    clockOnClient,
    clockOnServer,
  );
  const at = takenAt ?? clock;

  function time(stamp: number): string {
    const when = new Date(stamp);
    const clock = when.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
    const today = new Date();
    const sameDay =
      when.getFullYear() === today.getFullYear() &&
      when.getMonth() === today.getMonth() &&
      when.getDate() === today.getDate();
    const day = sameDay
      ? copy.report.timeToday
      : when.toLocaleDateString(locale, { month: "short", day: "numeric" });
    return `${day} ${clock}`;
  }

  const speciesValue = (() => {
    const answer = state.species;
    if (!answer) return null;
    if (answer.kind === "named")
      return answer.commonNameZh ?? answer.scientificName;
    if (answer.kind === "skipped") return copy.report.speciesSkip;
    return answer.introduced
      ? copy.report.speciesUnsureIntroduced
      : copy.report.speciesUnsure;
  })();

  const conditionValue = state.condition
    ? {
        dead: copy.report.conditionDead,
        hurt: copy.report.conditionHurt,
        well: copy.report.conditionWell,
      }[state.condition]
    : null;

  return (
    <List className={className}>
      {state.photos.length > 0 ? (
        <DataRow
          external
          href="#photo"
          name={copy.report.rowPhoto}
          value={copy.report.photoCount.replace(
            "{n}",
            String(state.photos.length),
          )}
          valueLabel={copy.report.change}
        />
      ) : null}
      {state.place ? (
        <DataRow
          external
          href="#place"
          name={copy.report.rowPlace}
          value={copy.report.placeSet}
          valueLabel={copy.report.change}
        />
      ) : null}
      {conditionValue ? (
        <DataRow
          external
          href="#condition"
          name={copy.report.rowCondition}
          value={conditionValue}
          valueLabel={copy.report.change}
        />
      ) : null}
      {speciesValue ? (
        <DataRow
          external
          href="#species"
          name={copy.report.rowSpecies}
          value={speciesValue}
          valueLabel={copy.report.change}
        />
      ) : null}
      {at !== null ? (
        <DataRow
          name={copy.report.rowTime}
          value={
            <>
              {time(at)}{" "}
              <span className="text-(--fg-quiet)">
                {takenAt ? copy.report.timeFromPhoto : copy.report.timeNow}
              </span>
            </>
          }
        />
      ) : null}
    </List>
  );
}
