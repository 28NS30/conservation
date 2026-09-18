"use client";

import { useRef, useState } from "react";

/**
 * The pill replacement: one question, full-width rows, nothing preselected.
 *
 * This is the component the rejected designs got wrong twice. A row of pills
 * says "filter" and invites a tap on whichever is nearest; a column of 64px
 * rows says "answer this", which is what the report flow is actually asking.
 * Nothing is preselected, because a silent default on condition files injured
 * animals as roadkill — that is a live defect, not a hypothetical.
 *
 * `role="radiogroup"` with `aria-checked` on each row, and a roving tabindex,
 * which is what the WAI pattern asks for and what lets arrow keys move through
 * the options without a tap. TESTS READ `aria-checked`, never a class string:
 * the live report form's tests pin class names, so a restyle breaks them and a
 * genuinely broken control does not.
 *
 * The mark is a 28px square with a check in it rather than a circle, because
 * `rounded-full` is banned outside the emblem and a square mark is the same
 * geometry as the multi-select Filter's checkbox — one idiom, two behaviours.
 */
export type ChoiceOption = {
  value: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
};

export default function Choice({
  name,
  legend,
  options,
  value,
  defaultValue,
  onChange,
  onCommit,
  hideLegend = false,
  className = "",
}: {
  name: string;
  legend: React.ReactNode;
  options: ChoiceOption[];
  /** Controlled. Leave unset for uncontrolled; never preselect a default. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /**
   * Fired only when a row is actually pressed — a tap, or Enter or Space on a
   * focused row — and never when an arrow key moves the selection.
   *
   * That distinction is the whole reason this exists. The report stepper
   * advances the moment the condition is answered, which is right for a thumb
   * and wrong for a keyboard: in a radiogroup, arrowing down the list would
   * pick each option in turn and shoot the reporter through the flow on the
   * first key press. `onChange` is "the selection is now this"; `onCommit` is
   * "this is my answer".
   */
  onCommit?: (value: string) => void;
  hideLegend?: boolean;
  className?: string;
}) {
  const [internal, setInternal] = useState(defaultValue);
  const selected = value !== undefined ? value : internal;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function pick(next: string) {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const back = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!forward && !back) return;
    event.preventDefault();
    const next =
      (index + (forward ? 1 : options.length - 1)) % options.length;
    refs.current[next]?.focus();
    pick(options[next].value);
  }

  // Roving tabindex: with nothing chosen the first row is the way in, so the
  // group is one Tab stop rather than three.
  const focusIndex = Math.max(
    0,
    options.findIndex((o) => o.value === selected),
  );

  return (
    <div className={className}>
      <p
        id={`${name}-legend`}
        className={hideLegend ? "sr-only" : "t-head mb-6 text-(--fg)"}
      >
        {legend}
      </p>
      <div role="radiogroup" aria-labelledby={`${name}-legend`}>
        {options.map((option, index) => {
          const checked = selected === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={index === focusIndex ? 0 : -1}
              ref={(node) => {
                refs.current[index] = node;
              }}
              onClick={() => {
                pick(option.value);
                onCommit?.(option.value);
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`rule-quiet flex min-h-16 w-full items-center gap-4 border-b px-4 py-3 text-left transition-colors duration-150 ${
                checked
                  ? "bg-(--selected-bg) text-(--selected-fg)"
                  : "text-(--fg) hover:bg-(--hover)"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center border-2 ${
                  checked ? "border-current" : "border-(--fg)"
                }`}
              >
                {checked ? "✓" : ""}
              </span>
              <span className="min-w-0">
                <span className="t-lead block">{option.label}</span>
                {option.hint ? (
                  <span className="t-note block opacity-80">{option.hint}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
