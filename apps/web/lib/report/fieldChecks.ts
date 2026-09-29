import {
  contactEmailSchema,
  creditNameSchema,
  OBSERVED_AT_EARLIEST,
  OBSERVED_AT_SLACK_MS,
  MAX_ACCURACY_M,
} from "@conservation/shared";

/**
 * The typed fields, checked before a report is sent or saved on the phone.
 *
 * With the server's own rules (packages/shared), so what passes here passes
 * there. A report saved on the phone cannot be edited, so a slip caught only
 * by the server made it unsendable for good; and online, the answer was one
 * sentence at the bottom of the form that named no field (security audit, 29
 * September 2026).
 */

/** Which field is wrong, as a key under `report.errors` and the slot it sits in. */
export type FieldProblem =
  | { key: "timeInvalid"; slot: "time" }
  | { key: "emailInvalid"; slot: "contact" }
  | { key: "creditInvalid"; slot: "credit" };

/**
 * The time field's value as an instant, or null when it names none.
 *
 * A datetime-local that is cleared (iOS has a Clear button) or half typed has
 * the value "", and `new Date("").toISOString()` throws: the send failed as a
 * server error, and a save on the phone as full storage.
 */
export function observedInstant(local: string): string | null {
  // The shape a datetime-local gives, and nothing looser: `new Date` reads
  // "2026-09-" as the last day of August.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(local)) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function checkFields(
  fields: {
    observedAt: string;
    email: string;
    /** Only when the licence asks for credit; otherwise it is not sent. */
    creditName?: string;
  },
  now = Date.now(),
): FieldProblem | null {
  const at = observedInstant(fields.observedAt);
  if (
    !at ||
    Date.parse(at) > now + OBSERVED_AT_SLACK_MS ||
    Date.parse(at) < Date.parse(OBSERVED_AT_EARLIEST)
  )
    return { key: "timeInvalid", slot: "time" };
  const email = fields.email.trim();
  if (email && !contactEmailSchema.safeParse(email).success)
    return { key: "emailInvalid", slot: "contact" };
  const credit = fields.creditName?.trim();
  if (credit && !creditNameSchema.safeParse(credit).success)
    return { key: "creditInvalid", slot: "credit" };
  return null;
}

/**
 * The device's accuracy as the server takes it: a whole number of metres, and
 * nothing beyond MAX_ACCURACY_M. A desktop placed by its IP address can claim
 * hundreds of kilometres, and the reporter did nothing wrong, so it is left
 * out rather than refused.
 */
export function sendableAccuracy(m: number | null | undefined): number | undefined {
  if (m == null || !Number.isFinite(m) || m < 0) return undefined;
  const whole = Math.round(m);
  return whole <= MAX_ACCURACY_M ? whole : undefined;
}
