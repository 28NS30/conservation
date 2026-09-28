import Image from "next/image";
import { Link } from "@/i18n/navigation";
import type { HomePhoto } from "@/lib/home/photos";

/**
 * One row of the home page's scroll: a large photograph on one side, a headline
 * and two sentences on the other, alternating sides row by row.
 *
 * The team's brief points at National Geographic's long-scroll layout for this,
 * and the note on it matters as much as the reference: "copy this format"
 * means do something LIKE it, not the same. So the structure is borrowed — big
 * image, short text, alternating — and the rest is this site's: its palette,
 * its type, a credit under every photograph because the licences require one.
 *
 * `tone` is the ground the row sits on. Ivory rows use forest headings and a
 * leaf-green button; rows on the forest band use ivory text and an ivory
 * button. Both pairings were measured: leaf on white text 4.94:1, forest on
 * ivory 10.98:1.
 */
export default function StoryRow({
  photo,
  zh,
  photoBy,
  title,
  body,
  cta,
  href,
  reverse = false,
  tone = "light",
  id,
  children,
}: {
  photo: HomePhoto;
  zh: boolean;
  photoBy: string;
  title: string;
  body: React.ReactNode;
  cta: string;
  href: string;
  reverse?: boolean;
  tone?: "light" | "dark";
  id?: string;
  children?: React.ReactNode;
}) {
  const dark = tone === "dark";
  return (
    <article id={id} className="grid items-center gap-7 md:grid-cols-2 md:gap-12 lg:gap-16">
      <figure className={reverse ? "md:order-2" : ""}>
        <div className="relative aspect-[3/2] w-full overflow-hidden bg-forest-950/10">
          <Image
            src={photo.src}
            alt={zh ? photo.alt.zh : photo.alt.en}
            fill
            sizes="(min-width: 1280px) 600px, (min-width: 768px) 48vw, 100vw"
            className="object-cover"
          />
        </div>
        <figcaption className={`mt-2 text-[12px] leading-snug ${dark ? "text-parchment-300" : "text-ink-500"}`}>
          {zh ? photo.name.zh : photo.name.en}
          {" · "}
          {photoBy}{" "}
          <a
            href={photo.source}
            target="_blank"
            rel="noopener noreferrer"
            className={`whitespace-nowrap underline underline-offset-2 ${dark ? "hover:text-parchment-50" : "hover:text-ink-900"}`}
          >
            {photo.author}
          </a>
          {" · "}
          <a
            href={photo.licenseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`whitespace-nowrap underline underline-offset-2 ${dark ? "hover:text-parchment-50" : "hover:text-ink-900"}`}
          >
            {photo.license}
          </a>
        </figcaption>
      </figure>

      <div className={reverse ? "md:order-1" : ""}>
        <h3
          className={`font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold leading-[1.05] [text-wrap:balance] ${
            dark ? "text-paper-50" : "text-forest-900"
          } ${zh ? "tracking-[0.02em]" : "uppercase tracking-[0.01em]"}`}
        >
          {title}
        </h3>
        <p className={`mt-4 max-w-[34rem] text-[17px] leading-relaxed ${dark ? "text-paper-50/90" : "text-ink-950"}`}>
          {body}
        </p>
        {children}
        <Link
          href={href}
          className={`mt-7 inline-flex min-h-12 items-center gap-2 px-6 font-display text-[17px] font-semibold uppercase tracking-[0.06em] transition ${
            dark
              ? "bg-paper-50 text-forest-900 hover:bg-white"
              : "bg-leaf-600 text-white hover:bg-leaf-700"
          }`}
        >
          {cta}
          <span aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}

/**
 * A section's opening: the title centred, one line under it, and a short
 * orange rule — the idea of National Geographic's section heads, in this
 * site's colours. The rule is decoration and hidden from screen readers.
 */
export function SectionTitle({
  title,
  hint,
  tone = "light",
  id,
  zh,
}: {
  title: string;
  hint?: string;
  tone?: "light" | "dark";
  id?: string;
  zh: boolean;
}) {
  const dark = tone === "dark";
  return (
    <header className="mx-auto max-w-2xl text-center">
      <h2
        id={id}
        className={`font-display text-[clamp(2.1rem,6vw,3.4rem)] font-bold leading-none [text-wrap:balance] ${
          dark ? "text-paper-50" : "text-forest-900"
        } ${zh ? "tracking-[0.04em]" : "uppercase tracking-[0.02em]"}`}
      >
        {title}
      </h2>
      {hint && (
        <p className={`mt-4 text-[17px] leading-relaxed ${dark ? "text-paper-50/85" : "text-ink-700"}`}>{hint}</p>
      )}
      <span aria-hidden className="mx-auto mt-6 block h-1 w-16 bg-ember-500" />
    </header>
  );
}
