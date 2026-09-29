/* eslint-disable @next/next/no-html-link-for-pages --
   This page bypasses the app's rendering entirely: no layout, no router, no
   client bundle. next/link would ship one to a page whose whole point is being
   served without it, and a full navigation is what should happen when someone
   leaves a dead URL. The docs' own example uses plain anchors for this file. */
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "找不到這個頁面 · Page not found · 福爾摩沙守望計畫",
  robots: { index: false, follow: false },
};

/**
 * The 404 for URLs that match no route at all.
 *
 * `app/[locale]/not-found.tsx` only covers paths that already resolved into the
 * locale segment — a species id that does not exist, say. A mistyped or dead
 * top-level URL never gets that far, so it was falling through to Next's own
 * built-in page: unstyled, unbranded, English, on a site whose audience is
 * Taiwanese. That is most real 404s.
 *
 * The docs name this exact case for `global-not-found`: a root layout defined
 * under a top-level dynamic segment, which `[locale]` is. It bypasses layouts
 * entirely, so the stylesheet and the html/body shell are declared here — and
 * for the same reason it cannot use next-intl, which is why both languages are
 * written out rather than translated.
 *
 * BOTH LANGUAGES, AT THE SAME WEIGHT. This page cannot know which one the
 * reader wanted: it gets no props and no locale, and `/en/anything-mistyped`
 * lands here as surely as `/anything-mistyped` does. It used to answer every
 * one of them in Chinese, with "Page not found" as a grey subtitle and both
 * buttons in Chinese — so an English reader who mistyped one letter was sent
 * to a page they could not use, with a way home they could not read. Now each
 * language has its own heading, sentence and buttons, and each language's
 * buttons go to that language's site. test/page-titles.test.mjs holds it there.
 */
export default function GlobalNotFound() {
  // The site's buttons, square as in the team's design. No display face here:
  // the fonts load in the locale layout, which this page never passes through.
  const button = "inline-flex min-h-12 items-center px-6 text-base font-bold transition";
  const primary = `${button} bg-ember-500 text-ink-950 hover:bg-ember-400`;
  const secondary = `${button} border-2 border-forest-900 text-forest-900 hover:bg-forest-900/5`;

  return (
    <html lang="zh-Hant-TW" className="h-full">
      <body className="min-h-full bg-paper-50 antialiased">
        <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col justify-center px-6 py-12">
          <p className="text-5xl font-bold tabular-nums text-forest-900">404</p>
          <span aria-hidden className="mt-4 block h-1 w-14 bg-ember-500" />
          <div className="mt-6 grid gap-10 sm:grid-cols-2">
            <section aria-labelledby="nf-zh">
              <h1 id="nf-zh" className="text-2xl font-semibold text-ink-900">
                找不到這個頁面
              </h1>
              <p className="mt-2 text-[17px] leading-relaxed text-ink-800">
                這個網址可能已經失效，或是打錯了。
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <a href="/" className={primary}>
                  回首頁
                </a>
                <a href="/map" className={secondary}>
                  查看地圖
                </a>
              </div>
            </section>
            <section lang="en" aria-labelledby="nf-en">
              <h2 id="nf-en" className="text-2xl font-semibold text-ink-900">
                Page not found
              </h2>
              <p className="mt-2 text-[17px] leading-relaxed text-ink-800">
                The link may be out of date, or mistyped.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <a href="/en" className={primary}>
                  Home
                </a>
                <a href="/en/map" className={secondary}>
                  Open the map
                </a>
              </div>
            </section>
          </div>
        </main>
      </body>
    </html>
  );
}
