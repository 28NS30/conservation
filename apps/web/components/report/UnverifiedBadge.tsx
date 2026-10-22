/**
 * The mark on a public record whose species no moderator has checked yet:
 * 尚未查證, "Not yet verified".
 *
 * The receipt for an invasive-page report promises it (report.receipt.
 * invasiveNextBody: "it is marked 'not yet verified'"), and /me and the queue
 * banner already showed it; the record itself, and the lists that lead to it,
 * did not, so the one place a stranger reads the record said nothing of the
 * kind. Whether a record carries it is awaitingVerification()'s question
 * (lib/report/verification.ts), never this component's.
 *
 * The same outlined pill as on /me, set apart from InvasiveBadge's orange fill:
 * that one says what the animal is, this one says how sure anyone is of it.
 * Plain markup, so server pages and client components can both render it; the
 * words arrive already translated.
 */
export default function UnverifiedBadge({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-ink-900/20 bg-paper-50 px-2.5 py-0.5 text-[14px] leading-5 text-ink-800 ${className}`}
    >
      {label}
    </span>
  );
}
