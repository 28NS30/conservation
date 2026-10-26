import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Badge from "@/components/brand/Badge";
import PrintButton from "@/components/poster/PrintButton";
import { alternates } from "@/lib/alternates";
import { CANONICAL_ORIGIN } from "@/lib/siteUrl";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "poster" });
  return { title: t("title"), description: t("description"), alternates: alternates(locale, "/poster") };
}

/**
 * A poster to print, and a page on using it in class.
 *
 * Nobody has been told the site exists (docs/plan-game-layer.md), and for its
 * readers, students on phones, a sheet on a classroom wall or a club's notice
 * board is the cheapest way to be told. The QR code goes to the report page
 * of the language the poster is printed in.
 *
 * Every claim on the poster is a sentence the site already makes, read from
 * the same keys (the hero, the report menu's three doors, "about a minute, no
 * account"), so the poster cannot promise what the site does not. Only the
 * poster's own instructions are new.
 *
 * The codes are static SVGs in public/poster, made by scripts/make-qr.swift
 * from CANONICAL_ORIGIN and checked to decode before they were committed.
 * Production's address, not this server's: a poster printed from a preview or
 * a laptop must still send people to the site.
 */
export default async function PosterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("poster");
  const home = await getTranslations("home");
  const report = await getTranslations("report");
  const site = await getTranslations("site");

  const zh = locale.startsWith("zh");
  const reportUrl = `${CANONICAL_ORIGIN}${zh ? "" : "/en"}/report`;
  const shown = reportUrl.replace(/^https:\/\//, "");
  const doors = [
    ["roadkill", "doorRoadkill"],
    ["invasive", "doorInvasive"],
    ["sighting", "doorSighting"],
  ] as const;
  const steps = ["class1", "class2", "class3", "class4", "class5"] as const;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-24 pt-10 sm:pt-14 print:max-w-none print:p-0">
      {/* Print: one A4 sheet per section, nothing of the site's chrome. The
          header, the footer and the queue reminder are outside <main>. */}
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body, [class*="bg-paper-50"] { background: #fff !important; }
          body header, body footer, #queue-reminder { display: none !important; }
        }
      `}</style>

      <div className="mb-8 rounded-lg border border-ink-900/10 bg-paper-100 p-5 print:hidden">
        <h1 className="text-lg font-semibold text-forest-900">{t("screenTitle")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-700">{t("screenBody")}</p>
        <div className="mt-4">
          <PrintButton label={t("print")} />
        </div>
      </div>

      <section
        aria-label={t("title")}
        className="mx-auto flex aspect-[210/297] w-full max-w-[210mm] flex-col border border-ink-900/15 bg-white p-[7%] text-forest-900 shadow-sm print:h-[297mm] print:w-[210mm] print:max-w-none print:border-0 print:p-[16mm] print:shadow-none"
      >
        <div className="flex items-center gap-3">
          <Badge size={56} className="print:h-[22mm] print:w-[22mm]" />
          <div className="leading-tight">
            <p className="text-base font-semibold tracking-[0.12em]">福爾摩沙守望計畫</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.25em] opacity-70">Project FormosaWatch</p>
          </div>
        </div>

        <h2 className="mt-[6%] text-[clamp(1.6rem,6vw,2.75rem)] font-semibold leading-tight print:text-[40pt]">
          {home.rich("heroTitle", { ph: (c) => <span className="inline-block">{c}</span> })}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-700 sm:text-base print:text-[14pt]">{home("heroBody")}</p>

        <ul className="mt-[5%] grid gap-3 print:gap-[7mm]">
          {doors.map(([group, door]) => (
            <li key={group} className="border-l-4 border-forest-700 pl-3">
              <p className="font-semibold print:text-[18pt]">{report(`group.${group}`)}</p>
              <p className="text-sm text-ink-700 print:text-[13pt]">{home(door)}</p>
            </li>
          ))}
        </ul>

        <div className="mt-auto flex items-end gap-5 pt-[5%]">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG, printed at its own size */}
          <img
            src={`/poster/report-${zh ? "zh" : "en"}.svg`}
            alt={t("qrAlt", { url: shown })}
            width={164}
            height={164}
            className="h-auto w-[34%] shrink-0 print:w-[80mm]"
          />
          <div className="pb-1">
            <p className="text-base font-semibold print:text-[18pt]">{t("scan")}</p>
            <p className="mt-1 text-sm text-ink-700 print:text-[13pt]">{home("askHint")}</p>
            <p className="mt-2 break-all font-mono text-xs text-ink-700 print:text-[11pt]">{shown}</p>
          </div>
        </div>
        <p className="mt-4 text-[10px] text-ink-600 print:text-[8pt]">{site("tagline")}</p>
      </section>

      <section
        aria-labelledby="poster-class"
        className="mx-auto mt-10 w-full max-w-[210mm] text-forest-900 print:mt-0 print:break-before-page print:p-[16mm]"
      >
        <h2 id="poster-class" className="text-xl font-semibold">{t("classTitle")}</h2>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-ink-800 sm:text-base print:text-[12pt]">
          {steps.map((s) => (
            <li key={s}>{t(s)}</li>
          ))}
        </ol>
        <p className="mt-6 font-mono text-xs text-ink-700">{shown}</p>
      </section>
    </main>
  );
}
