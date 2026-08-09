import Badge from "./Badge";

/**
 * Mark plus name, for the header and footer.
 *
 * The Chinese leads and the Latin sits under it at a smaller size, because the
 * audience is Taiwanese and the English exists for researchers and international
 * collaborators. Reversing that would be a quiet statement about who the site is
 * for.
 *
 * NAMING: the project is 生態守望計畫 / Project EcoWatch, after the badge. It
 * used to be 生態通報地圖 ("ecological reporting map") in metadata while the
 * header already said this, so the two disagreed. The descriptive phrase now
 * lives in site.tagline and site.description, where it describes rather than
 * names — a name that means "reporting map" could not follow the organisation
 * past roadkill.
 */
export default function Wordmark({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  // The badge, not a reduction of it. Below about 48px its two rings of type
  // stop resolving — but a single mark used everywhere is worth more than a
  // sharper one that shares nothing with the logo people will actually see on a
  // sticker or a report cover.
  const mark = size === "lg" ? 44 : size === "md" ? 32 : 28;
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
      <Badge size={mark} className="shrink-0" />
      <span className="leading-none">
        {/* The wide tracking is doing real work: at these sizes Hanzi set solid
            look like a dense block, and opening them up is what makes the name
            read as a mark rather than as a line of body text. */}
        <span className={`block font-medium ${zh}`}>生態守望計畫</span>
        <span
          className={`mt-1 block font-medium uppercase tracking-[0.3em] opacity-70 ${latin}`}
        >
          Project Ecowatch
        </span>
      </span>
    </span>
  );
}
