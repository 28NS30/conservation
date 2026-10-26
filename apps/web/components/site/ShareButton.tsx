"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { routing } from "@/i18n/routing";

/** What is being shared, which names the button: 分享這筆紀錄, 分享這個物種. */
export type ShareWhat = "record" | "species" | "page";

/**
 * LINE's own share page for a URL. Opened in LINE's in-app browser, or on a
 * phone with LINE installed, it goes straight to LINE's chat picker.
 */
export function lineShareUrl(url: string): string {
  return `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`;
}

/** Whether there is a share sheet does not change while the page is open. */
const noSubscription = () => () => {};

/**
 * Share this page: the phone's own share sheet where there is one, LINE and
 * a copied link where there is not.
 *
 * Students here share by LINE, and very often they are reading the site
 * inside LINE already, having opened a link a classmate posted. LINE's
 * in-app browser has no navigator.share, so a button that only called it
 * would do nothing at all exactly where it is most used. Where the call is
 * missing, or fails for any reason but the reader cancelling, the button
 * opens two plain choices instead: a link to LINE's share page, which works
 * with no script of ours, and "copy link", which says that it worked.
 *
 * Copying tries the clipboard API, then the older execCommand route that
 * in-app browsers still honour, and if both are refused it shows the link in
 * a field, selected, with a line saying to press and hold it. Nobody is left
 * with a button that silently did nothing.
 *
 * The address is built in the browser from the page's own origin and the
 * path it is given, in the page's language, so a link copied on /en opens in
 * English. Nothing is added to it: no tracking parameter, no referrer.
 *
 * Every control is 44px tall (min-h-11) and named by its visible words.
 */
export default function ShareButton({
  path,
  title,
  what = "page",
}: {
  /** The page's path without the locale prefix: "/reports/…", "/season". */
  path: string;
  /**
   * For the share sheet; this page's own title when it is this page. A link
   * preview reads the shared page's title whatever this says.
   */
  title?: string;
  what?: ShareWhat;
}) {
  const t = useTranslations("share");
  const locale = useLocale();
  const panelId = useId();
  // Unknown on the server, so the server's answer is "no share sheet" and
  // the button is corrected as it hydrates.
  const native = useSyncExternalStore(
    noSubscription,
    () => typeof navigator.share === "function",
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  const address = () => {
    const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
    return new URL(`${prefix}${path}`, window.location.origin).toString();
  };

  async function share() {
    const here = address();
    setUrl(here);
    if (typeof navigator.share === "function") {
      // The page's own title when it is this page being shared; the receipt
      // shares a record it is not, and its title would name the form.
      const named =
        title ?? (new URL(here).pathname === window.location.pathname ? document.title : undefined);
      try {
        await navigator.share(named ? { title: named, url: here } : { url: here });
        return;
      } catch (e) {
        // Closing the sheet is an answer, not a failure.
        if ((e as { name?: string })?.name === "AbortError") return;
      }
      setOpen(true);
    } else {
      setOpen((was) => !was);
    }
    setCopy("idle");
  }

  async function copyLink() {
    const here = url ?? address();
    try {
      await navigator.clipboard.writeText(here);
      setCopy("copied");
      return;
    } catch {
      // Refused, or not offered: try the way older in-app browsers allow.
    }
    try {
      const area = document.createElement("textarea");
      area.value = here;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      setCopy(ok ? "copied" : "failed");
    } catch {
      setCopy("failed");
    }
  }

  const control =
    "inline-flex min-h-11 items-center gap-2 rounded-full border border-forest-900/25 bg-paper-50 px-4 text-sm font-medium text-forest-900 transition hover:border-forest-900/50 hover:bg-paper-100";

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={share}
        // A disclosure only where it discloses something: with a share sheet
        // the button opens the phone's, not a panel of ours.
        aria-expanded={native ? undefined : open}
        aria-controls={!native && open ? panelId : undefined}
        className={control}
      >
        <svg aria-hidden viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13V3M6 7l4-4 4 4M4 11v5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5" />
        </svg>
        {t(what)}
      </button>

      {open && url && (
        <div id={panelId} className="flex flex-wrap items-center gap-2">
          <a
            href={lineShareUrl(url)}
            target="_blank"
            rel="noopener noreferrer"
            // Underlined like every link that leaves the site
            // (test/a11y-basics.test.mjs).
            className={`${control} underline underline-offset-2`}
          >
            {t("line")}
            <span className="sr-only">{t("newTab")}</span>
          </a>
          <button type="button" onClick={copyLink} className={control}>
            {t("copy")}
          </button>
          {/* Always in the panel, so a screen reader is listening before the
              words change. */}
          <p role="status" className="text-sm font-medium text-forest-900">
            {copy === "copied" ? t("copied") : ""}
          </p>
          {copy === "failed" && (
            <div className="w-full">
              <p className="text-sm text-ink-700">{t("copyFailed")}</p>
              <input
                type="url"
                readOnly
                value={url}
                aria-label={t("linkLabel")}
                // Selected as it appears, so "press and hold" finds the
                // whole address already chosen.
                ref={(el) => el?.select()}
                onFocus={(e) => e.currentTarget.select()}
                className="mt-1 min-h-11 w-full rounded-lg border border-ink-900/20 bg-paper-50 px-3 text-sm text-ink-900"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
