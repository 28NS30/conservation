"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import Emblem from "@/components/lab/ui/Emblem";
import type { LabCopy } from "@/lib/lab/copy";
import { labPath, type LabDirection } from "@/lib/lab/directions";
import { SEGMENTS } from "@/lib/lab/reportFlow";

/**
 * The frame both proofs are drawn in: a 56px bar, five progress segments, and a
 * button pinned to the bottom of the screen that is never dead.
 *
 * NO SITE CHROME. No header nav, no footer, no tab bar. A person filling this
 * in is standing at a roadside doing one thing, and every link out of it is an
 * invitation to lose what they have typed. Today's page carries a two-row site
 * header and a viewport-tall footer, which is most of what makes it read as a
 * government form; removing them is not a cosmetic change.
 *
 * FIVE SEGMENTS, NO NUMERAL. "2／5" reads as four more of these to go and is
 * the single most discouraging thing a form can say on its second screen. A bar
 * says the same thing about how much is left without counting it out, and the
 * injured notice shares the condition segment rather than adding a sixth,
 * because answering "hurt" must not make the form look longer.
 *
 * THE BUTTON IS NEVER DEAD. It carries `aria-disabled` and stays focusable and
 * pressable, and the caption above it names what is still missing. The live
 * form disables submit outright whenever the browser check has not solved,
 * which offline is a button nobody can ever press and no explanation on screen.
 *
 * At 1024px and up the same frame becomes two panes: the flow on the left at
 * 420px with the button at the foot of its own column, and the record taking
 * shape on the right. The button is `fixed` below that and `static` above it,
 * which is one element in one place in the DOM rather than two that can
 * disagree about what they say.
 */
export default function FlowShell({
  copy,
  direction,
  segment,
  onBack,
  caption,
  captionAlert = false,
  action,
  aside,
  children,
}: {
  copy: LabCopy;
  direction: LabDirection;
  /** Which of the five segments is current. */
  segment: (typeof SEGMENTS)[number];
  /** Absent on the first screen, where there is nothing behind. */
  onBack?: () => void;
  /** The one line above the button. It warns; it never promises. */
  caption?: React.ReactNode;
  captionAlert?: boolean;
  /** The pinned sign itself, so each flow owns its own label and handler. */
  action: React.ReactNode;
  /** Desktop only: the record taking shape, beside the question. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("nav");
  const home = labPath(direction);
  const reached = SEGMENTS.indexOf(segment);

  const segmentLabels: Record<(typeof SEGMENTS)[number], string> = {
    photo: copy.report.stepPhoto,
    place: copy.report.stepPlace,
    condition: copy.report.stepCondition,
    species: copy.report.stepSpecies,
    send: copy.report.stepSend,
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-(--ground) text-(--fg)">
      <header
        data-surface="field"
        className="sticky top-0 z-30 bg-(--ground) text-(--fg)"
      >
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-(--gutter)">
          <Link href={home} className="flex shrink-0 items-center gap-3">
            <Emblem size={48} className="h-12 w-12" />
            <span className="t-lead t-label font-bold">{t("report")}</span>
          </Link>
          <div className="flex shrink-0 items-center gap-4">
            <LanguageSwitcher className="t-note" />
            <Link
              href={home}
              className="t-body inline-flex min-h-11 items-center text-(--fg)"
            >
              {copy.report.leave}
            </Link>
          </div>
        </div>
        <ol
          aria-label={copy.report.progressLabel}
          className="mx-auto flex w-full max-w-5xl gap-1 px-(--gutter) pb-2"
        >
          {SEGMENTS.map((key, index) => (
            <li
              key={key}
              className="h-1 flex-1"
              aria-current={key === segment ? "step" : undefined}
            >
              <span className="sr-only">{segmentLabels[key]}</span>
              <span
                aria-hidden="true"
                className="block h-1 w-full"
                style={{
                  background:
                    index <= reached
                      ? "var(--accent-text)"
                      : "color-mix(in srgb, var(--fg) 25%, transparent)",
                }}
              />
            </li>
          ))}
        </ol>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-16 px-(--gutter)">
        <div className="lab-flow-bottom flex min-w-0 flex-1 flex-col lg:max-w-[420px] lg:flex-none">
          {onBack ? (
            <p className="pt-4">
              <button
                type="button"
                onClick={onBack}
                className="t-body inline-flex min-h-11 items-center text-(--fg)"
              >
                {copy.report.back}
              </button>
            </p>
          ) : null}
          <main className="flex-1 pt-6 pb-8">{children}</main>

          {/* One bar, two behaviours. Fixed over the page on a phone, where the
              thumb is at the bottom of the screen and the content behind it
              scrolls; static at the foot of the left pane on a desktop, where
              nothing overlaps and a floating bar would be a phone habit
              transplanted onto a mouse. */}
          <div className="lab-flow-bar rule-strong fixed inset-x-0 bottom-0 z-40 border-t-2 bg-(--ground) lg:static lg:border-t-0 lg:pb-12">
            <div className="mx-auto w-full max-w-5xl px-(--gutter) py-4 lg:px-0 lg:py-0">
              {caption ? (
                <p
                  aria-live="polite"
                  className={`t-note mb-2 ${
                    captionAlert ? "text-(--alert)" : "text-(--fg-quiet)"
                  }`}
                >
                  {caption}
                </p>
              ) : null}
              {action}
            </div>
          </div>
        </div>

        {aside ? (
          <aside className="hidden min-w-0 flex-1 lg:block">
            <div className="sticky top-28 py-6">{aside}</div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
