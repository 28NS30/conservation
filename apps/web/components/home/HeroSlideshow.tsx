"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type Slide = {
  src: string;
  alt: string;
  name: string;
  author: string;
  license: string;
  licenseUrl: string;
  source: string;
};

/**
 * The home page's rotating photographs — the team's brief, taken from WWF's
 * hero: "instead show like cycling images of us and animals".
 *
 * Moving content has rules, and each is here for a reason:
 *
 * - A PAUSE BUTTON (WCAG 2.2.2). Anything that moves on its own for more than
 *   five seconds must be stoppable. It is a real button, 44px, and says which
 *   state it will put you in.
 * - NOTHING MOVES FOR SOMEONE WHO ASKED IT NOT TO. prefers-reduced-motion starts
 *   the slideshow paused and drops the crossfade. The first photo shows, and the
 *   dots still work.
 * - IT HOLDS STILL WHILE YOU ARE ON IT. Hover or keyboard focus inside pauses the
 *   timer, so a slide does not change under someone reading a credit or reaching
 *   for a dot.
 * - A HIDDEN TAB DOES NOT TICK. The timer stops while the page is not visible.
 * - ONE CREDIT AT A TIME. The credit links belong to the visible photo only, so
 *   a keyboard never tabs into a caption for a picture it cannot see.
 * - ONLY WHAT IS NEEDED IS LOADED. The current slide and the next are mounted;
 *   the rest mount as the show reaches them. On a phone that is two photos
 *   fetched at first paint rather than six.
 *
 * Screen readers hear it as a carousel of labelled slides, and announcements are
 * off while it plays — a live region that speaks every six seconds is noise —
 * and polite once someone takes control.
 */
export default function HeroSlideshow({
  slides,
  labels,
  sizes,
}: {
  slides: Slide[];
  labels: {
    region: string;
    pause: string;
    play: string;
    goTo: string; // "Show photo {n}"
    slide: string; // "{n} of {total}"
    photoBy: string; // "Photo:"
  };
  sizes: string;
}) {
  // Where the show is, and the furthest it has been. Mounting is derived from
  // the second: the current slide and the next are in the DOM, nothing beyond.
  const [pos, setPos] = useState({ index: 0, furthest: 0 });
  const index = pos.index;
  const mounted = Math.min(slides.length, pos.furthest + 2);

  // Reduced motion is external state, so it is read as one. The server cannot
  // know it and says "no preference"; nothing moves before hydration anyway.
  const reduced = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  // True only in the browser, after hydration. No timer and no controls before.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);

  // The reader's own choice, once they make one, beats the system preference.
  const [choice, setChoice] = useState<boolean | null>(null);
  const playing = hydrated && (choice ?? !reduced);

  const [hold, setHold] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing || hold || slides.length < 2) return;
    let id: number | undefined;
    const start = () => {
      window.clearInterval(id);
      if (document.visibilityState === "visible")
        id = window.setInterval(
          () =>
            setPos((p) => {
              const i = (p.index + 1) % slides.length;
              return { index: i, furthest: Math.max(p.furthest, i) };
            }),
          6000,
        );
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", start);
    };
  }, [playing, hold, slides.length]);

  const go = (n: number) => {
    setPos((p) => ({ index: n, furthest: Math.max(p.furthest, n) }));
    setChoice(false); // taking control stops the show; the button restarts it
  };

  // Controls exist only once the script runs. Without JavaScript nothing moves,
  // so a pause button would be a dead control and the dots would do nothing.
  const ready = hydrated;
  const current = slides[index];
  const fill = (s: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), s);

  return (
    <div
      ref={root}
      className="relative h-full w-full overflow-hidden bg-forest-950"
      role="region"
      aria-roledescription="carousel"
      aria-label={labels.region}
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setHold(false);
      }}
    >
      <div aria-live={playing ? "off" : "polite"} className="absolute inset-0">
        {slides.slice(0, mounted).map((s, i) => (
          <div
            key={s.src}
            role="group"
            aria-roledescription="slide"
            aria-label={fill(labels.slide, { n: i + 1, total: slides.length })}
            aria-hidden={i !== index}
            className={`absolute inset-0 ${reduced ? "" : "transition-opacity duration-700 ease-out"} ${
              i === index ? "opacity-100" : "opacity-0"
            }`}
          >
            <Image
              src={s.src}
              alt={s.alt}
              fill
              sizes={sizes}
              priority={i === 0}
              className="object-cover"
            />
          </div>
        ))}
      </div>

      {/* Credit and controls sit on a scrim so white text reads over any photo. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent pt-16" />
      <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-4 pb-3 sm:px-5 sm:pb-4">
        <p className="min-w-0 text-[13px] leading-snug text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
          <span className="font-semibold">{current.name}</span>
          <span className="text-white/85">
            {" · "}
            {labels.photoBy}{" "}
            <a href={current.source} className="whitespace-nowrap underline underline-offset-2 hover:text-white" target="_blank" rel="noopener noreferrer">
              {current.author}
            </a>
            {" · "}
            <a href={current.licenseUrl} className="whitespace-nowrap underline underline-offset-2 hover:text-white" target="_blank" rel="noopener noreferrer">
              {current.license}
            </a>
          </span>
        </p>

        <div className="flex items-center">
          {ready &&
            slides.length > 1 &&
            slides.map((s, i) => (
              <button
                key={s.src}
                type="button"
                onClick={() => go(i)}
                aria-label={fill(labels.goTo, { n: i + 1 })}
                aria-current={i === index ? "true" : undefined}
                className="group grid size-10 place-items-center"
              >
                <span
                  aria-hidden
                  className={`block size-2 rounded-full transition ${
                    i === index ? "scale-125 bg-white" : "bg-white/55 group-hover:bg-white/85"
                  }`}
                />
              </button>
            ))}
          {ready && slides.length > 1 && (
            <button
              type="button"
              onClick={() => setChoice(!playing)}
              className="ml-1 grid size-11 place-items-center rounded-full bg-black/35 text-white transition hover:bg-black/55"
              aria-label={playing ? labels.pause : labels.play}
            >
              {playing ? (
                <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="currentColor">
                  <rect x="3" y="2" width="3.5" height="12" rx="1" />
                  <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
                </svg>
              ) : (
                <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="currentColor">
                  <path d="M4 2.5v11a.75.75 0 0 0 1.14.64l9-5.5a.75.75 0 0 0 0-1.28l-9-5.5A.75.75 0 0 0 4 2.5Z" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function readReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function subscribeNothing() {
  return () => {};
}
