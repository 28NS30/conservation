/* eslint-disable @next/next/no-html-link-for-pages --
   This page bypasses the app's rendering entirely: no layout, no router, no
   client bundle. next/link would ship one to a page whose whole point is being
   served without it, and a full navigation is what should happen when someone
   leaves a dead URL. The docs' own example uses plain anchors for this file. */
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "找不到這個頁面 · 棲地守望計畫",
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
 */
export default function GlobalNotFound() {
  return (
    <html lang="zh-Hant" className="h-full">
      <body className="min-h-full antialiased">
        <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-6 text-center">
          <p className="text-4xl font-semibold tabular-nums text-ink-500">404</p>
          <h1 className="mt-3 text-lg font-semibold text-ink-900">
            找不到這個頁面
          </h1>
          <p className="mt-1 text-sm text-ink-500">Page not found</p>
          <p className="mt-4 text-sm leading-relaxed text-ink-600">
            這個網址可能已經失效，或是打錯了。
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <a
              href="/"
              className="rounded-full bg-ember-500 px-5 py-2 text-xs font-semibold text-bark-950 transition hover:bg-ember-400"
            >
              回首頁
            </a>
            <a
              href="/map"
              className="rounded-full border border-ink-900/15 px-5 py-2 text-xs text-ink-600 transition hover:bg-paper-200"
            >
              查看地圖
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
