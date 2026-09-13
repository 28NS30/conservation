import Badge from "./Badge";

/**
 * Mark plus name, for the header and footer.
 *
 * The Chinese leads and the Latin sits under it at a smaller size, because the
 * audience is Taiwanese and the English exists for researchers and international
 * collaborators. Reversing that would be a quiet statement about who the site is
 * for.
 *
 * NAMING: 福爾摩沙守望計畫 / Project FormosaWatch.
 *
 * 福爾摩沙 is the island's old European name, long since naturalised in Taiwan —
 * 福爾摩沙高速公路 carries it — so it reads as affectionate rather than colonial.
 * 守望 has now outlived three names and the lettering on the badge, and is what
 * keeps the Chinese and the Latin halves parallel.
 *
 * This is the third name, after 生態守望計畫 / EcoWatch and 棲地守望計畫 /
 * HabitatWatch. Each of those named what the project collects, and each time the
 * two languages drifted apart when the scope moved: 棲地 means habitat, which
 * never obviously covered roadkill. A place name cannot fail that way. It says
 * where the project works and claims nothing about what it gathers, which leaves
 * the first line of every page free to do that — 路殺、外來入侵種、污染.
 *
 * 台灣守望計畫 is the alternative, two characters shorter and less evocative.
 *
 * The badge artwork still letters 生態守望計畫 / PROJECT ECOWATCH around its
 * ring — two names behind now — and needs redrawing.
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
        <span className={`block font-medium ${zh}`}>福爾摩沙守望計畫</span>
        <span
          className={`mt-1 block font-medium uppercase tracking-[0.3em] opacity-70 ${latin}`}
        >
          Project FormosaWatch
        </span>
      </span>
    </span>
  );
}
