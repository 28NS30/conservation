import { Link } from "@/i18n/navigation";

/**
 * Words on a rule. The site's entire filtering language.
 *
 * direction.md §2.6 rule 2: a filled rectangle is an action, an underlined word
 * is a filter. So a filter is never a button-shaped thing — single choice is a
 * row of words standing on a 2px rule, and the one you picked grows a 4px
 * underline. The header nav uses the same idiom, which is the point: "which of
 * these am I looking at" is one question and it should look like one question
 * everywhere.
 *
 * Multi-choice is 24px square checkboxes in 44px rows, using real checkbox
 * inputs. A hand-rolled one would have to reimplement the space bar, the
 * indeterminate state and every screen reader's idea of a group for no visual
 * gain; `accent-color` recolours the native control from the surface's own
 * accent.
 *
 * Options with no public records must not be rendered at all — a filter that
 * leads to an empty map teaches people the map is broken. That is the caller's
 * job, because only the caller has the counts.
 */
export type FilterOption = {
  value: string;
  label: React.ReactNode;
  /** A link filter — server-rendered, no client module, `aria-current`. */
  href?: string;
};

type Shared = {
  legend: React.ReactNode;
  options: FilterOption[];
  hideLegend?: boolean;
  className?: string;
};

export default function Filter(
  props: Shared &
    (
      | {
          mode?: "single";
          value?: string;
          onChange?: (value: string) => void;
        }
      | {
          mode: "multi";
          values?: string[];
          onChange?: (values: string[]) => void;
        }
    ),
) {
  const { legend, options, hideLegend = false, className = "" } = props;
  const legendClass = hideLegend
    ? "sr-only"
    : "t-note t-label mb-2 block font-bold text-(--fg-quiet)";

  if (props.mode === "multi") {
    const values = props.values ?? [];
    return (
      <fieldset className={className}>
        <legend className={legendClass}>{legend}</legend>
        {options.map((option) => {
          const checked = values.includes(option.value);
          return (
            <label
              key={option.value}
              className="flex min-h-11 items-center gap-3 text-(--fg)"
            >
              <input
                type="checkbox"
                checked={props.onChange ? checked : undefined}
                defaultChecked={props.onChange ? undefined : checked}
                onChange={() =>
                  props.onChange?.(
                    checked
                      ? values.filter((v) => v !== option.value)
                      : [...values, option.value],
                  )
                }
                className="h-6 w-6 shrink-0"
                style={{ accentColor: "var(--accent-text)" }}
              />
              <span className="t-body">{option.label}</span>
            </label>
          );
        })}
      </fieldset>
    );
  }

  const selected = props.value;

  return (
    <div className={className}>
      <p className={legendClass}>{legend}</p>
      <div
        role={options.every((o) => o.href) ? undefined : "group"}
        className="rule-strong flex flex-wrap items-end gap-x-6 border-b-2"
      >
        {options.map((option) => {
          const on = selected === option.value;
          const shape =
            "t-body -mb-0.5 inline-flex min-h-11 items-center border-b-4 text-(--fg)";
          const underline = {
            borderBottomColor: on ? "var(--accent-text)" : "transparent",
          };
          return option.href ? (
            <Link
              key={option.value}
              href={option.href}
              aria-current={on ? "true" : undefined}
              className={shape}
              style={underline}
            >
              {option.label}
            </Link>
          ) : (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => props.onChange?.(option.value)}
              className={shape}
              style={underline}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
