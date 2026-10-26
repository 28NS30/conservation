"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { withBase } from "@/lib/basePath";
import { forgetSent, listSent, type SentReport } from "@/lib/offline/sent";

type State = "public" | "held" | "gone";

/** The newest this asks about; the list on the phone is longer. */
const ASKED = 50;

/**
 * 這支手機送出的通報: the reports sent from this device, and where each one is.
 *
 * For someone who is not signed in, which for now is every reporter outside
 * the team: an account is the only other way to find a report again, and
 * reporting has never needed one. The ids are the ones the phone kept when it
 * sent them (lib/offline/sent.ts); whether each is public, held or gone is
 * asked of app/api/receipts, which says no more than /reports/{id} does.
 *
 * A held report links to its receipt and a public one to its record; a gone
 * one links nowhere, because nothing is behind it. Without a signal the list
 * still shows, without the states.
 */
export default function SentOnThisPhone() {
  const t = useTranslations("me.phone");
  const tc = useTranslations("categories");
  const locale = useLocale();
  const [sent, setSent] = useState<SentReport[] | null>(null);
  const [states, setStates] = useState<Record<string, State> | null>(null);
  const [unknown, setUnknown] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const all = await listSent();
      if (!live) return;
      setSent(all);
      if (all.length === 0) return;
      try {
        const res = await fetch(withBase("/api/receipts"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: all.slice(0, ASKED).map((r) => r.id) }),
        });
        if (!res.ok) throw new Error(`receipts ${res.status}`);
        const data = (await res.json()) as { states: Record<string, State> };
        if (live) setStates(data.states);
      } catch {
        if (live) setUnknown(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Nothing until the phone has been read, rather than an "empty" that flips.
  if (sent === null) return null;

  return (
    <section aria-labelledby="sent-on-this-phone" className="mb-10">
      <h2 id="sent-on-this-phone" className="text-lg font-semibold text-ink-900">
        {t("title")}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-700">{t("intro")}</p>

      {sent.length === 0 ? (
        <p className="mt-4 rounded-xl border border-ink-900/12 bg-paper-100 p-6 text-sm text-ink-700">
          {t("empty")}
        </p>
      ) : (
        <>
          {unknown && (
            <p role="status" className="mt-3 text-sm text-ink-700">
              {t("unknown")}
            </p>
          )}
          <ul className="mt-4 space-y-1.5">
            {sent.map((r) => {
              const state = states?.[r.id.toLowerCase()];
              const what = `${new Date(r.sentAt).toLocaleDateString(locale, {
                timeZone: "Asia/Taipei",
              })} · ${tc(r.category)}`;
              return (
                <li
                  key={r.id}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-ink-900/10 bg-paper-100/60 px-4 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-ink-900">{r.label ?? t("unnamed")}</span>
                    <span className="block text-xs text-ink-600">{what}</span>
                  </span>
                  {state === "gone" ? (
                    <span className="shrink-0 text-sm text-ink-700">{t("gone")}</span>
                  ) : state ? (
                    <Link
                      href={`/reports/${r.id}`}
                      // Which report, for a screen reader moving from link to
                      // link: a list of 已公開, 已公開, 還沒公開 says nothing.
                      aria-label={`${t(state)} · ${r.label ?? t("unnamed")} · ${what}`}
                      className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900"
                    >
                      {t(state)}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={async () => {
              await forgetSent();
              setSent([]);
            }}
            className="mt-3 inline-flex min-h-11 items-center text-sm text-ink-700 underline underline-offset-2 hover:text-ink-950"
          >
            {t("forget")}
          </button>
        </>
      )}
    </section>
  );
}
