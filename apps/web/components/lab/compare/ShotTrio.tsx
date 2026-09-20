import { Link } from "@/i18n/navigation";
import { withBase } from "@/lib/basePath";
import type { LabCopy } from "@/lib/lab/copy";
import { LAB_DIRECTION_LABELS, type LabDirection } from "@/lib/lab/directions";
import { SHOTS_DIR, shotsFor, type LabShot } from "@/lib/lab/shots";
import type { Locale } from "@/i18n/routing";

/**
 * One page of the site, in every version of it there is, side by side.
 *
 * THE PICTURES ARE THUMBNAILS ON PURPOSE. Three 110px columns on a 390px phone
 * is small — and small is the test. direction.md asks whether a thumbnail is
 * still mistaken for today's site, and that question is answered at thumbnail
 * size or not at all. Anything bigger and the owner is comparing typography;
 * the typography is one tap away, on the real page, where it belongs.
 *
 * THE WIDTH FOLLOWS THE SCREEN. A `<picture>` rather than two `<img>`s behind
 * `hidden` classes, because art direction is exactly what `<picture>` is for
 * and because a hidden `<img>` may or may not be fetched depending on the
 * browser's mood: on a phone you get the phone shots, on a desktop the desktop
 * ones, and one file is downloaded either way. The locale follows the page you
 * are reading, so the strip's language switch flips the screenshots too.
 *
 * The whole card is one link, so the accessible name is the caption and the
 * screenshot's `alt` is empty — a second name here would have a screen reader
 * read "Roundel, Home, Roundel" on every card.
 */
function Card({
  label,
  route,
  phone,
  desktop,
}: {
  label: string;
  route: string | undefined;
  phone: LabShot | undefined;
  desktop: LabShot | undefined;
}) {
  const src = (shot: LabShot) => withBase(`${SHOTS_DIR}/${shot.file}`);
  // The phone shot is the fallback `<img>`, so a card with only a desktop shot
  // still draws. A card with neither says so rather than leaving a hole.
  const fallback = phone ?? desktop;

  return (
    <li className="min-w-0">
      {route ? (
        <Link href={route} className="group block">
          {fallback ? (
            <picture>
              {desktop && phone ? (
                <source
                  media="(min-width: 768px)"
                  srcSet={src(desktop)}
                  width={desktop.width}
                  height={desktop.height}
                />
              ) : null}
              {/* A plain `<img>`, not `next/image`. `next/image` cannot art
                  direct — the phone and desktop shots have different aspect
                  ratios — and there is nothing here for it to optimise: these
                  are already WebP at a fixed size, committed, on a route that
                  is a 404 in production. */}
              <img
                src={src(fallback)}
                width={fallback.width}
                height={fallback.height}
                alt=""
                loading="lazy"
                decoding="async"
                className="rule-quiet block h-auto w-full border"
              />
            </picture>
          ) : null}
          {/* One rung down on a phone, where three of these share 358px and
              a 16px caption turns every one of them into four lines. 14px is
              the floor, not a loophole: it is the same step the legends and
              table heads use. */}
          <span className="t-body t-sm-note lab-underline mt-2 block font-bold underline underline-offset-4">
            {label}
          </span>
        </Link>
      ) : (
        <span className="t-body t-sm-note block font-bold">{label}</span>
      )}
      {/* The route, on a desktop only. On a phone it is a third of a path
          broken across three lines under a thumbnail, and the caption above it
          already says the picture is a link. */}
      <p className="t-note mt-1 hidden break-all text-(--fg-quiet) md:block">
        {route}
      </p>
    </li>
  );
}

export default function ShotTrio({
  page,
  title,
  note,
  copy,
  locale,
}: {
  page: string;
  title: string;
  note: string;
  copy: LabCopy;
  locale: Locale;
}) {
  const columns = shotsFor(page, locale, 390);

  const label = (variant: string) => {
    if (variant === "today") return copy.lab.todaysPage;
    const [direction, ...flow] = variant.split("-");
    const name = LAB_DIRECTION_LABELS[direction as LabDirection]?.[locale] ?? variant;
    if (!flow.length) return name;
    return `${name} · ${
      flow.join("-") === "stepper" ? copy.compare.flowStepper : copy.compare.flowPhotoFirst
    }`;
  };

  return (
    <section className="rule-strong mt-16 border-t-2 pt-10">
      <h2 className="t-title">{title}</h2>
      <p className="t-body mt-4 max-w-(--container-prose) text-(--fg-quiet)">
        {note}
      </p>
      {/* Every column on one row at every width, including 390. Two columns
          with the third wrapping underneath was tried and is wrong: the whole
          question a thumbnail answers — is this still the same site — is a
          question about seeing them at the same time. Three 110px pictures on
          a phone is small, and small is the test. */}
      <ul
        className={`mt-8 grid gap-3 sm:gap-6 ${
          columns.length >= 3 ? "grid-cols-3" : "grid-cols-2"
        }`}
      >
        {columns.map((column) => (
          <Card
            key={column.variant}
            label={label(column.variant)}
            route={column.href}
            phone={column.fold}
            desktop={
              shotsFor(page, locale, 1440).find(
                (other) => other.variant === column.variant,
              )?.fold
            }
          />
        ))}
      </ul>
    </section>
  );
}
