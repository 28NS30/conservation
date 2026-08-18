import Badge from "./Badge";

/**
 * Mark plus name, for the header and footer.
 *
 * The Chinese leads and the Latin sits under it at a smaller size, because the
 * audience is Taiwanese and the English exists for researchers and international
 * collaborators. Reversing that would be a quiet statement about who the site is
 * for.
 *
 * NAMING: 棲地守望計畫 / Project HabitatWatch.
 *
 * 棲地 is the word this site already uses for habitat — 棲地破壞, 棲地開發 —
 * and the standard one in Taiwanese conservation writing. 守望 carries over
 * from the previous name and from the lettering on the badge, so the two names
 * stay parallel, which 生態守望計畫 stopped being when the English became
 * HabitatWatch.
 *
 * It does narrow the scope in Chinese: roadkill is not obviously a 棲地 matter.
 * The English narrowed in exactly the same way when EcoWatch became
 * HabitatWatch, and the first line of every page says what is actually
 * collected — 路殺、外來入侵種、污染.
 *
 * The badge artwork still letters 生態守望計畫 / PROJECT ECOWATCH around its
 * ring and needs redrawing to match both halves of this.
 *
 * Before that it was 生態通報地圖 ("ecological reporting map") in metadata while
 * the header said something else, so the two disagreed. The descriptive phrase now
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
        <span className={`block font-medium ${zh}`}>棲地守望計畫</span>
        <span
          className={`mt-1 block font-medium uppercase tracking-[0.3em] opacity-70 ${latin}`}
        >
          Project HabitatWatch
        </span>
      </span>
    </span>
  );
}
