import Mark from "./Mark";

/**
 * Mark plus name, for the header and footer.
 *
 * The Chinese leads and the Latin sits under it at a smaller size, because the
 * audience is Taiwanese and the English exists for researchers and international
 * collaborators. Reversing that would be a quiet statement about who the site is
 * for.
 *
 * NAMING: the badge says 生態守望計畫 / PROJECT ECOWATCH; the old header said
 * 生態通報地圖 ("ecological reporting map"). Those are an organisation and a
 * product respectively, so both survive — the org names the site, the map keeps
 * its descriptive name where it is actually describing the map.
 */
export default function Wordmark({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const mark = size === "lg" ? "size-11" : size === "md" ? "size-8" : "size-7";
  const zh =
    size === "lg"
      ? "text-lg tracking-[0.2em]"
      : size === "md"
        ? "text-[15px] tracking-[0.18em]"
        : "text-[13px] tracking-[0.16em]";
  const latin =
    size === "lg" ? "text-[10px]" : size === "md" ? "text-[9px]" : "text-[8px]";

  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <Mark className={`${mark} shrink-0`} />
      <span className="leading-none">
        {/* The wide tracking is doing real work: at these sizes Hanzi set solid
            look like a dense block, and opening them up is what makes the name
            read as a mark rather than as a line of body text. */}
        <span className={`block font-medium text-parchment-50 ${zh}`}>
          生態守望計畫
        </span>
        <span
          className={`mt-1 block font-medium uppercase tracking-[0.3em] text-parchment-400 ${latin}`}
        >
          Project Ecowatch
        </span>
      </span>
    </span>
  );
}
