"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  listQueued,
  removeQueued,
  retryQueued,
  purgeUploaded,
  isPending,
  requestPersistence,
  type QueuedReport,
} from "@/lib/offline/queue";
import { Link } from "@/i18n/navigation";
import {
  flushQueue,
  startFlushTriggers,
  currentlySending,
  holdBack,
  type FlushOptions,
} from "@/lib/offline/flush";
import Turnstile from "@/components/report/Turnstile";
import { turnstileEnabled } from "@/lib/turnstile";
import { receiptLinkFor } from "@/lib/report/outcome";
import { errorKey } from "@/lib/report/errors";
import { awaitingVerification } from "@/lib/report/verification";
import { useOnline } from "@/lib/offline/online";

/**
 * Shows what is still waiting to be sent.
 *
 * Deliberately prominent: on iOS there is no Background Sync, so a queued report
 * only leaves the device while a report page is open — this banner is on the
 * chooser and on all three pages, and nowhere else, because it owns the
 * challenge and the flush. Hiding that would let someone believe a report was
 * transmitted when it was not, which is why the words say "open the report
 * page" and not "open this site".
 *
 * It also owns the queue's Turnstile challenge, which is why a widget appears in
 * what is otherwise a status banner. `/api/reports` requires a token, the form
 * only ever obtained one at submit time, and a queued report by definition never
 * reached submit — so in production every queued report was rejected 403 and
 * written off. The challenge has to be solved somewhere, and this is the one
 * place on screen whenever there is something to send.
 *
 * A token is single-use, so one is minted per report: `getToken` hands out the
 * solved token, immediately resets the widget, and the next call waits for the
 * replacement. That is why the flush loop is sequential rather than parallel.
 */
export default function QueueBanner() {
  const t = useTranslations("offline");
  /** The submission vocabulary is shared with the form; see lib/report. */
  const tReport = useTranslations("report");
  const tCategory = useTranslations("categories");
  const locale = useLocale();
  const online = useOnline();
  const [items, setItems] = useState<QueuedReport[]>([]);
  /** Reports that have landed, kept as receipts. See markUploaded. */
  const [sent, setSent] = useState<QueuedReport[]>([]);
  const [busy, setBusy] = useState(false);
  /** The report a flush is sending now; it cannot be discarded mid-send. */
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [ready, setReady] = useState(!turnstileEnabled);

  const STALE_AFTER_MS = 3 * 24 * 3600 * 1000;
  /** How long a "sent" receipt survives. Long enough to come down off a hill. */
  const RECEIPT_TTL_MS = 24 * 3600 * 1000;
  /** How long a flush waits for the widget before holding a report back. */
  const TOKEN_WAIT_MS = 15_000;
  /** How long a discarded report can be brought back before it is deleted. */
  const UNDO_MS = 5_000;

  const tokenRef = useRef<string | null>(null);
  const waitersRef = useRef<((token: string | undefined) => void)[]>([]);
  const resetRef = useRef<(() => void) | null>(null);
  /** Reports this page has already tried to send by itself. */
  const autoFlushedRef = useRef(new Set<string>());
  /**
   * Reports discarded in the last UNDO_MS, each with the timer that deletes
   * it. A tap on 刪除 next to 再試一次, on a phone, on a moving bus, is easily
   * the wrong one, and it threw away the only copy of a report at once.
   */
  const [discarding, setDiscarding] = useState<string[]>([]);
  const undoTimers = useRef(new Map<string, number>());

  const refresh = useCallback(async () => {
    // Receipts are kept for a day so a reporter who closes the app on a
    // mountain road and opens it in town still sees that their report went.
    await purgeUploaded(RECEIPT_TTL_MS);
    const all = await listQueued();
    const waiting = all.filter(isPending);
    setItems(waiting);
    setSent(all.filter((i) => i.status === "uploaded"));
    // Computed here rather than during render: Date.now() is impure and would
    // make the component's output depend on when it happened to re-render.
    setStale(waiting.some((i) => Date.now() - i.createdAt > STALE_AFTER_MS));
    setSendingId(currentlySending());
  }, [STALE_AFTER_MS, RECEIPT_TTL_MS]);

  /** Hand out one token, then start minting the next. */
  const getToken = useCallback(async (): Promise<string | undefined> => {
    if (!turnstileEnabled) return undefined;

    const held = tokenRef.current;
    if (held) {
      tokenRef.current = null;
      resetRef.current?.();
      return held;
    }

    return new Promise<string | undefined>((resolve) => {
      const waiter = (token: string | undefined) => resolve(token);
      waitersRef.current.push(waiter);
      window.setTimeout(() => {
        const i = waitersRef.current.indexOf(waiter);
        if (i >= 0) {
          waitersRef.current.splice(i, 1);
          resolve(undefined);
        }
      }, TOKEN_WAIT_MS);
    });
  }, [TOKEN_WAIT_MS]);

  const onToken = useCallback((token: string | null) => {
    if (token === null) {
      tokenRef.current = null;
      setReady(false);
      return;
    }
    setReady(true);

    const waiter = waitersRef.current.shift();
    if (waiter) {
      resetRef.current?.();
      waiter(token);
      return;
    }
    tokenRef.current = token;
  }, []);

  const runFlush = useCallback(
    async (options?: FlushOptions) => {
      setBusy(true);
      await flushQueue(getToken, options);
      await refresh();
      setBusy(false);
    },
    [getToken, refresh],
  );

  /** Delete it for good, now: its undo is over, or the banner is going. */
  const commitDiscard = useCallback(async (id: string) => {
    const timer = undoTimers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    undoTimers.current.delete(id);
    await removeQueued(id);
    holdBack(id, false);
  }, []);

  const discard = useCallback(
    (id: string) => {
      // Held back from the flush at once, so a send that starts during the
      // undo does not file a report its reporter has just thrown away.
      holdBack(id, true);
      setDiscarding((d) => [...d, id]);
      const timer = window.setTimeout(() => {
        void commitDiscard(id).then(() => {
          setDiscarding((d) => d.filter((x) => x !== id));
          return refresh();
        });
      }, UNDO_MS);
      undoTimers.current.set(id, timer);
    },
    [UNDO_MS, commitDiscard, refresh],
  );

  const undoDiscard = useCallback((id: string) => {
    const timer = undoTimers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    undoTimers.current.delete(id);
    holdBack(id, false);
    setDiscarding((d) => d.filter((x) => x !== id));
  }, []);

  // Leaving the page during an undo keeps the decision: the reporter said
  // discard, and the undo is a few seconds' grace, not a reprieve.
  useEffect(() => {
    const timers = undoTimers.current;
    return () => {
      for (const id of [...timers.keys()]) void commitDiscard(id);
    };
  }, [commitDiscard]);

  // The queue's first flush fires on mount, before the widget can possibly have
  // solved, so it holds everything back. This is the retry that actually sends.
  //
  // Once per report, not once per page. It was once per mount, so a report
  // saved on a page that had already sent one — the report pages' "weak
  // signal? save on this phone" button saves on a page that is online — sat
  // waiting until the tab was hidden and shown again, with a solved challenge
  // and a connection right there. Remembering which reports it has tried keeps
  // the reason for "once": a report the server keeps refusing is not retried
  // on every render that lists it.
  useEffect(() => {
    if (!ready) return;
    const fresh = items.filter((i) => !autoFlushedRef.current.has(i.id));
    if (fresh.length === 0) return;
    for (const i of fresh) autoFlushedRef.current.add(i.id);
    void runFlush();
  }, [ready, items, runFlush]);

  useEffect(() => {
    void (async () => {
      await requestPersistence();
      // Through refresh(), not a second copy of it: this used to count every row
      // in the store as still waiting, and a sent report now leaves a receipt
      // there — so on mount the banner claimed reports were waiting that had
      // already landed, until the next refresh corrected it.
      await refresh();
    })();
    const stop = startFlushTriggers(() => void refresh(), getToken);
    const onChange = () => void refresh();
    window.addEventListener("conservation:queue-changed", onChange);
    return () => {
      stop();
      window.removeEventListener("conservation:queue-changed", onChange);
    };
  }, [refresh, getToken]);

  // The team asked for an "uploaded" state, and this is why: a sent report used
  // to be deleted outright, so the banner it had been sitting in simply
  // vanished. Someone who queues a report where there is no signal and watches
  // it go deserves to see that it went, and to be able to open it.
  const receipts = sent.length > 0 && (
    <div
      role="status"
      className="mb-6 rounded-lg border border-ember-500/30 bg-ember-500/10 px-4 py-3 text-sm text-ink-800"
    >
      {/* The count is the list's length, not the last flush's. With one report
          just sent and two receipts still on screen, "1 sent" above three links
          was a banner arguing with itself. */}
      <p className="font-semibold text-ember-700">
        {t("sentCount", { count: sent.length })}
      </p>
      {/*
        One row each, and each one says which report it is.

        This was N identical 開啟 links in a row. Someone who queued three
        reports on a hill and came down to town had no way to tell which was
        which, and every one of them led to /reports/{id} whether or not that
        report had been published — so a held one was a 404. The date and
        category come from the payload the queue already holds; the link is
        offered only for a status that has a page behind it, and a row queued by
        an older build has no stored status and so is plain text.

        A report from the invasive page says it has not been checked, as the
        form's own receipt does: that is what is true of it, and it is why its
        place is blurred.
      */}
      <ul className="mt-1.5 space-y-1">
        {sent.map((r) => {
          // With the server's `visible`, as the form's own receipt has it: a
          // withheld species is published but has no page, and this was a 404.
          const link = r.reportId
            ? receiptLinkFor(r.serverStatus, r.serverVisible !== false)
            : null;
          const label = `${new Date(r.payload.observedAt).toLocaleDateString(
            locale,
            { timeZone: "Asia/Taipei" },
          )} · ${tCategory(r.payload.category)}`;
          const unverified = awaitingVerification({
            category: r.payload.category,
            taxonSource: null,
          });
          return (
            <li
              key={r.id}
              className="flex min-h-11 flex-wrap items-center gap-x-2"
            >
              {link ? (
                <Link
                  href={`/reports/${r.reportId}`}
                  className="inline-flex min-h-11 items-center underline decoration-ember-700/40 underline-offset-2"
                >
                  {label} — {tReport(`receipt.${link}`)}
                </Link>
              ) : (
                <span>{label}</span>
              )}
              {unverified && (
                <span className="rounded-full border border-ink-900/20 bg-paper-50 px-2.5 py-0.5 text-sm text-ink-800">
                  {tReport("receipt.notVerified")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  if (items.length === 0) return receipts || null;

  return (
    <>
      {receipts}
      <section
        aria-labelledby="queue-waiting"
        className="mb-6 rounded-lg border-2 border-forest-900/25 bg-paper-100 px-4 py-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="queue-waiting"
            className="text-base font-semibold text-forest-900"
          >
            {t("waiting", { count: items.length - discarding.length })}
          </h2>
          {/* Pressed, it tries every report now, including one waiting out
              the pause after a server error (lib/offline/flush.ts). */}
          <button
            type="button"
            disabled={busy || !online}
            onClick={() => void runFlush({ force: true })}
            className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-forest-900 px-4 text-sm font-semibold text-paper-50 transition hover:bg-forest-800 disabled:cursor-not-allowed disabled:bg-paper-200 disabled:text-ink-700"
          >
            {busy ? t("sending") : t("sendNow")}
          </button>
        </div>

        <p className="mt-1 text-sm leading-relaxed text-ink-800">
          {online ? t("explain") : t("explainOffline")}
        </p>
        {stale && (
          <p className="mt-1 text-sm font-medium text-ember-700">
            {t("staleWarning")}
          </p>
        )}

        {/* Only with a connection, for the reason the form's widget is: its
            script is Cloudflare's, and it can only load with the signal. */}
        {turnstileEnabled && online && (
          <div className="mt-2">
            {!ready && (
              <p className="mb-1 text-sm text-ink-700">{t("verifying")}</p>
            )}
            <Turnstile
              onToken={onToken}
              locale={locale}
              theme="light"
              onReady={(api) => {
                resetRef.current = api.reset;
              }}
            />
          </div>
        )}

        <ul className="mt-2 space-y-1">
          {items.map((i) => {
            // Which report this is, in words, for the buttons beside it: a
            // screen reader moving through the list heard 刪除, 刪除, 刪除.
            const which = `${new Date(i.createdAt).toLocaleString(locale, {
              timeZone: "Asia/Taipei",
            })} · ${tCategory(i.payload.category)}`;
            if (discarding.includes(i.id))
              return (
                <li
                  key={i.id}
                  className="flex min-h-11 items-center justify-between gap-3 text-sm text-ink-800"
                >
                  <span role="status" className="min-w-0">
                    {t("discarded", { report: which })}
                  </span>
                  <button
                    type="button"
                    onClick={() => undoDiscard(i.id)}
                    aria-label={t("undoItem", { report: which })}
                    className="inline-flex min-h-11 shrink-0 items-center px-2 font-medium text-forest-900 underline underline-offset-2 hover:text-ink-950"
                  >
                    {t("undo")}
                  </button>
                </li>
              );
            return (
            <li
              key={i.id}
              className="flex min-h-11 items-center justify-between gap-3 text-sm text-ink-800"
            >
              <span className="min-w-0">
                {which}
                {/* `lastError` holds a code now, and a code gets translated.
                    It used to hold whatever English sentence flush.ts had
                    assembled — "upload signing failed (500)" — printed
                    verbatim under a Chinese banner. */}
                {i.lastError && (
                  <span className="mt-0.5 block text-ember-700">
                    {tReport(`errors.${errorKey(i.lastError)}`)}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {/* One the queue stopped trying: refused, or fourteen days
                    old. It used to be the end of the report. */}
                {i.status === "failed" && (
                  <button
                    type="button"
                    disabled={busy || !online}
                    onClick={async () => {
                      await retryQueued(i.id);
                      await refresh();
                      await runFlush();
                    }}
                    aria-label={t("retryItem", { report: which })}
                    className="inline-flex min-h-11 items-center px-2 font-medium text-forest-900 underline underline-offset-2 hover:text-ink-950 disabled:cursor-not-allowed disabled:text-ink-600 disabled:no-underline"
                  >
                    {t("retry")}
                  </button>
                )}
                {/* Not while it is being sent. The flush already holds the report
                    and would file it anyway, and the reporter, told it was
                    deleted, would have no receipt for a report now public. */}
                <button
                  type="button"
                  disabled={sendingId === i.id}
                  onClick={() => {
                    if (currentlySending() === i.id) return;
                    discard(i.id);
                  }}
                  aria-label={t("discardItem", { report: which })}
                  className="inline-flex min-h-11 items-center px-2 text-ink-700 underline underline-offset-2 hover:text-ink-950 disabled:cursor-not-allowed disabled:text-ink-600 disabled:no-underline"
                >
                  {t("discard")}
                </button>
              </span>
            </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
