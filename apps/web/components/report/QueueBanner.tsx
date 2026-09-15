"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  listQueued,
  removeQueued,
  purgeUploaded,
  isPending,
  requestPersistence,
  type QueuedReport,
} from "@/lib/offline/queue";
import { Link } from "@/i18n/navigation";
import { flushQueue, startFlushTriggers } from "@/lib/offline/flush";
import Turnstile from "@/components/report/Turnstile";
import { turnstileEnabled } from "@/lib/turnstile";

/**
 * Shows what is still waiting to be sent.
 *
 * Deliberately prominent: on iOS there is no Background Sync, so a queued report
 * only leaves the device when the user opens the app. Hiding that would let
 * someone believe a report was transmitted when it was not.
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
  const locale = useLocale();
  const [items, setItems] = useState<QueuedReport[]>([]);
  /** Reports that have landed, kept as receipts. See markUploaded. */
  const [sent, setSent] = useState<QueuedReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [justSent, setJustSent] = useState(0);
  const [stale, setStale] = useState(false);
  const [ready, setReady] = useState(!turnstileEnabled);

  const STALE_AFTER_MS = 3 * 24 * 3600 * 1000;
  /** How long a "sent" receipt survives. Long enough to come down off a hill. */
  const RECEIPT_TTL_MS = 24 * 3600 * 1000;
  /** How long a flush waits for the widget before holding a report back. */
  const TOKEN_WAIT_MS = 15_000;

  const tokenRef = useRef<string | null>(null);
  const waitersRef = useRef<((token: string | undefined) => void)[]>([]);
  const resetRef = useRef<(() => void) | null>(null);
  const autoFlushedRef = useRef(false);

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

  const runFlush = useCallback(async () => {
    setBusy(true);
    const r = await flushQueue(getToken);
    if (r.sent > 0) setJustSent(r.sent);
    await refresh();
    setBusy(false);
  }, [getToken, refresh]);

  // The queue's first flush fires on mount, before the widget can possibly have
  // solved, so it holds everything back. This is the retry that actually sends.
  useEffect(() => {
    if (!ready || autoFlushedRef.current || items.length === 0) return;
    autoFlushedRef.current = true;
    void runFlush();
  }, [ready, items.length, runFlush]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await requestPersistence();
      const queued = await listQueued();
      if (!alive) return;
      setItems(queued);
      setStale(queued.some((i) => Date.now() - i.createdAt > STALE_AFTER_MS));
    })();
    const stop = startFlushTriggers((r) => {
      setJustSent(r.sent);
      void refresh();
    }, getToken);
    const onChange = () => void refresh();
    window.addEventListener("conservation:queue-changed", onChange);
    return () => {
      alive = false;
      stop();
      window.removeEventListener("conservation:queue-changed", onChange);
    };
  }, [refresh, STALE_AFTER_MS, getToken]);

  // The team asked for an "uploaded" state, and this is why: a sent report used
  // to be deleted outright, so the banner it had been sitting in simply
  // vanished. Someone who queues a report where there is no signal and watches
  // it go deserves to see that it went, and to be able to open it.
  const receipts = sent.length > 0 && (
    <div className="mb-4 rounded-lg border border-ember-500/30 bg-ember-500/10 px-3 py-2 text-xs text-ember-700">
      <p>{t("sentCount", { count: justSent || sent.length })}</p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {sent.map(
          (r) =>
            r.reportId && (
              <li key={r.id}>
                <Link
                  href={`/reports/${r.reportId}`}
                  className="underline decoration-ember-700/30 underline-offset-2"
                >
                  {t("viewSent")}
                </Link>
              </li>
            ),
        )}
      </ul>
    </div>
  );

  if (items.length === 0) return receipts || null;

  return (
    <>
      {receipts}
      <section className="mb-4 rounded-lg border border-amber-500/30 bg-amber-600/10 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-amber-800">
            {t("waiting", { count: items.length })}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runFlush()}
            className="shrink-0 rounded bg-amber-600/15 px-2.5 py-1 text-[11px] font-medium text-amber-900 disabled:opacity-50"
          >
            {busy ? t("sending") : t("sendNow")}
          </button>
        </div>

        <p className="mt-1 text-[11px] leading-relaxed text-amber-800/70">
          {t("explain")}
        </p>
        {stale && (
          <p className="mt-1 text-[11px] text-amber-700">{t("staleWarning")}</p>
        )}

        {turnstileEnabled && (
          <div className="mt-2">
            {!ready && (
              <p className="mb-1 text-[11px] text-amber-800/70">
                {t("verifying")}
              </p>
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
          {items.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between gap-3 text-[11px] text-amber-800/80"
            >
              <span className="truncate">
                {new Date(i.createdAt).toLocaleString()}
                {i.lastError && (
                  <span className="ml-2 text-rose-700">{i.lastError}</span>
                )}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await removeQueued(i.id);
                  await refresh();
                }}
                className="shrink-0 text-amber-700/70 hover:text-rose-700"
              >
                {t("discard")}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
