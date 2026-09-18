/**
 * A labelled control: input, textarea, select or search.
 *
 * Label above, never a placeholder standing in for one — a placeholder
 * disappears the moment someone types, and the report form is filled in one
 * hand at the roadside. 56px of control, a 2px ink border that is 6.91:1
 * against paper, and the error sentence directly beneath rather than beside,
 * because on a 390px phone "beside" is a second line anyway and it lands in the
 * wrong reading order.
 *
 * `id` is required rather than generated. A generated id would make this a
 * client component for no other reason, and every caller needs the id anyway to
 * point a `<label>`, an error or a caption at it.
 */
type Common = {
  id: string;
  label: React.ReactNode;
  name?: string;
  hint?: React.ReactNode;
  /** The sentence, in the alert colour, under the control. */
  error?: React.ReactNode;
  /** A way out of the error — usually a LinkAction or a tertiary sign. */
  errorAction?: React.ReactNode;
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

export default function Field({
  id,
  label,
  name,
  hint,
  error,
  errorAction,
  required,
  disabled,
  className = "",
  as = "input",
  type = "text",
  rows = 4,
  children,
  ...control
}: Common & {
  as?: "input" | "textarea" | "select";
  type?: "text" | "search" | "email" | "number" | "tel" | "url" | "date" | "datetime-local";
  rows?: number;
  /** `<option>`s, when `as="select"`. */
  children?: React.ReactNode;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?: React.ChangeEventHandler<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >;
  onInput?: React.FormEventHandler<HTMLInputElement>;
  inputMode?: "text" | "search" | "email" | "numeric" | "tel" | "url";
  autoComplete?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  list?: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  // One bag of attributes for three different elements. TypeScript will not
  // accept `min`/`step`/`list` on a <select>, and rightly — but splitting this
  // into three prop types for one prototype component buys nothing a caller can
  // see, and a select that is handed `step` simply never receives it.
  const shared = {
    id,
    name: name ?? id,
    required,
    disabled,
    "aria-describedby": describedBy,
    "aria-invalid": error ? (true as const) : undefined,
    className:
      "rounded-(--radius-sign) w-full min-h-14 border-2 border-(--input-rule) bg-(--input-bg) px-4 py-3 t-body text-(--input-fg)",
    ...control,
  };

  return (
    <div className={className}>
      <label htmlFor={id} className="t-body t-label block font-bold text-(--fg)">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="t-note mt-1 text-(--fg-quiet)">
          {hint}
        </p>
      ) : null}
      <div className="mt-2">
        {as === "textarea" ? (
          <textarea
            {...(shared as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            rows={rows}
          />
        ) : as === "select" ? (
          <select {...(shared as React.SelectHTMLAttributes<HTMLSelectElement>)}>
            {children}
          </select>
        ) : (
          <input {...(shared as React.InputHTMLAttributes<HTMLInputElement>)} type={type} />
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} className="t-body mt-2 text-(--alert)">
          {error}
          {errorAction ? <span className="ml-2">{errorAction}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
