import { Link } from "@/i18n/navigation";

/**
 * How a forum page opens: a trail back up, the title in the display face, the
 * short orange rule the home page's section heads use, and a line under it.
 *
 * `kind="section"` is a title we wrote (Community, a topic's name) and is set
 * like the home page's headings, capitals in English. `kind="content"` is a
 * title a member wrote, and keeps their capitals: shouting someone's question
 * back at them in upper case changes what it says. Either way it may be one
 * long unbroken string, so it is allowed to break anywhere rather than push
 * the page sideways on a phone.
 */
export default function ForumHeading({
  title,
  lede,
  crumbs,
  crumbLabel,
  zh,
  kind = "section",
  titleId,
  children,
}: {
  title: string;
  /** An id for the heading, for controls elsewhere that name it (a thread's vote arrows). */
  titleId?: string;
  lede?: string;
  crumbs?: { href: string; label: string }[];
  crumbLabel: string;
  zh: boolean;
  kind?: "section" | "content";
  children?: React.ReactNode;
}) {
  const section = kind === "section";
  return (
    <header className="mb-8">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label={crumbLabel} className="mb-3">
          <ol className="flex flex-wrap items-center gap-x-1 text-[14px] text-ink-600">
            {crumbs.map((c, i) => (
              <li key={c.href} className="flex items-center gap-x-1">
                {i > 0 && <span aria-hidden>›</span>}
                <Link
                  href={c.href}
                  className="inline-flex min-h-11 items-center px-1 underline-offset-2 hover:text-ink-900 hover:underline"
                >
                  {c.label}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <h1
        id={titleId}
        className={`font-display font-bold leading-[1.05] text-forest-900 [overflow-wrap:anywhere] [text-wrap:balance] ${
          section
            ? `text-[clamp(2.1rem,6vw,3.2rem)] ${zh ? "tracking-[0.04em]" : "uppercase tracking-[0.01em]"}`
            : "text-[clamp(1.75rem,5vw,2.5rem)]"
        }`}
      >
        {title}
      </h1>
      <span aria-hidden className="mt-4 block h-1 w-14 bg-ember-500" />
      {lede && <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-ink-700">{lede}</p>}
      {children}
    </header>
  );
}
