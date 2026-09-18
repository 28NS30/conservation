import { getTranslations } from "next-intl/server";
import Button from "@/components/lab/ui/Button";
import Container from "@/components/lab/ui/Container";
import Emblem from "@/components/lab/ui/Emblem";
import LinkAction from "@/components/lab/ui/LinkAction";
import { getLabCopy } from "@/lib/lab/copy";
import { labHref, type LabDirection } from "@/lib/lab/directions";

/** The project's Latin name without the "Project" prefix the masthead omits. */
const SHORT_NAME_EN = "FormosaWatch";

/**
 * The first viewport: the badge, the name, one line, and what to do.
 *
 * THE BRIEF IN ONE PARAGRAPH. The owner has rejected two versions of this page
 * and asked for the emblem much larger with very little text beside it. So the
 * badge is 520px on a desktop and 300px on a phone — against 320 and 172 today
 * — and the only words in the first screen are the project's name, the tagline
 * it already has, at most two signs and one credit line. There is no question
 * (你看到了什麼？ is gone), no three category doors, no record count, no picture
 * of the data and no Latin second line on the Chinese page. Everything that
 * explained the project in the rejected versions now lives on /about.
 *
 * ONE report action beside ONE way into the map. On a phone there is only the
 * report sign: 看地圖 is the tab bar's first item, one thumb-reach below, and a
 * second 56px block under the first is what pushed the fold in the version
 * before this one. That also keeps §2.6 rule 1 — one ember element per content
 * viewport — true at both widths.
 *
 * The credit sits at the plate's foot rather than in the footer because the
 * records are CC BY 4.0 and because a Taiwanese reader who recognises 路殺社's
 * data and finds no acknowledgement in the first screen reads the site as
 * appropriation. That is a first-impression problem, so it is this block's.
 */
export default async function HomeHero({
  direction,
  locale,
  surface,
}: {
  direction: LabDirection;
  locale: string;
  /** Cream plate for Roundel; the sheet itself for the Field journal. */
  surface: "paper" | "plate" | "field";
}) {
  const t = await getTranslations("home");
  const site = await getTranslations("site");
  // The project's name in the other script, read from the live catalogue rather
  // than typed here: it is the same string the header and the tab title use,
  // and a prototype that spells the name its own way is testing the wrong thing.
  const zhSite = await getTranslations({ locale: "zh-TW", namespace: "site" });
  const copy = getLabCopy(locale);
  const inEnglish = locale.startsWith("en");

  return (
    <section
      data-surface={surface}
      // 24px of gutter on a phone (§4) is the page's 16px plus this 8px, which
      // is predictable in a way that two competing padding utilities are not.
      // `svh` rather than `vh` so a phone's collapsing address bar cannot make
      // the hero taller than the screen it is meant to fill; 124px is the
      // compare strip and the band above it.
      className={`px-2 md:flex md:min-h-[max(640px,calc(100svh_-_124px))] md:flex-col md:px-0 bg-(--ground) text-(--fg)`}
    >
      <Container className="py-8 md:flex md:flex-1 md:items-center md:py-16">
        <div className="flex w-full flex-col items-center gap-6 text-center md:flex-row md:items-center md:gap-10 md:text-left">
          <Emblem
            size={520}
            eager
            sizes="(min-width: 1280px) 520px, (min-width: 768px) 360px, 300px"
            className="h-auto w-[300px] shrink-0 md:w-[360px] xl:w-[520px]"
          />
          <div className="min-w-0 md:max-w-[640px]">
            {/* "FormosaWatch", not "Project FormosaWatch". §4 asks for the
                bare name here, and the reason shows up the moment you render
                the other one: at 80px the two words do not fit the 640px
                column, and the heading's own overflow rule then breaks the
                product's name mid-word — "Project / FormosaWatc / h", with an
                orphaned letter on a line of its own, as the loudest thing on
                the page. The word is the masthead; the sentence is the
                tagline underneath. */}
            <h1 className="t-masthead text-(--fg)">
              {inEnglish ? SHORT_NAME_EN : site("title")}
            </h1>
            {inEnglish ? (
              // §4: on /en the Latin name is the masthead and the Chinese name
              // sits under it at `head`. It is not a translation — it is the
              // project's other name — so it carries its own lang.
              <p lang="zh-TW" className="t-head mt-2 text-(--fg)">
                {zhSite("title")}
              </p>
            ) : null}
            <p className="t-tagline mt-4 text-(--fg-quiet) md:mt-6">
              {t("tagline")}
            </p>
            <div className="mt-8 flex flex-col items-stretch gap-4 md:mt-10 md:flex-row md:items-start">
              <Button
                href={labHref(direction, "/report/stepper")}
                size="hero"
                block
                className="md:w-auto"
              >
                {t("ctaReport")}
              </Button>
              {/* Desktop only. On a phone this is the tab bar's first item.
                  Hidden by a wrapper rather than by a `hidden` class on the
                  sign itself: Button's own `inline-flex` is a display utility
                  too, and which of two display utilities wins depends on the
                  order Tailwind happens to emit them in — here it was the
                  wrong one, and the phone hero carried two 56px blocks. The
                  wrapper goes to `contents` above the breakpoint, so the sign
                  is still a direct child of the row. */}
              <span className="hidden md:contents">
                <Button
                  href={labHref(direction, "/map")}
                  variant="secondary"
                  size="hero"
                >
                  {copy.home.seeMap}
                </Button>
              </span>
            </div>
          </div>
        </div>
      </Container>
      <Container className="pb-8 md:pb-10">
        <p className="t-note text-center text-(--fg-quiet) md:text-left">
          {/* `standalone`, because a link alone on a line is a target: without
              it this credit is 17px tall and unhittable with a thumb. */}
          <LinkAction href="/attribution" standalone>
            {copy.home.sourceLine}
          </LinkAction>
        </p>
      </Container>
    </section>
  );
}
