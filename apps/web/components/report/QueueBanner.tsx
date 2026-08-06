"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  listQueued,
  removeQueued,
  requestPersistence,
  type QueuedReport,
} from "@/lib/offline/queue";
import { flushQueue, startFlushTriggers } from "@/lib/offline/flush";

/**
 * Shows what is still waiting to be sent.
 *
 * Deliberately prominent: on iOS there is no Background Sync, so a queued report
 * only leaves the device when the user opens the app. Hiding that would let
 * someone believe a report was transmitted when it was not.
 */
export default function QueueBanner() {
  const t = useTranslations("offline");
  const [items, setItems] = useState<QueuedReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [justSent, setJustSent] = useState(0);
  const [stale, setStale] = useState(false);

  const STALE_AFTER_MS = 3 * 24 * 3600 * 1000;

  const refresh = useCallback(async () => {
    const queued = await listQueued();
    setItems(queued);
    // Computed here rather than during render: Date.now() is impure and would
    // make the component's output depend on when it happened to re-render.
    setStale(queued.some((i) => Date.now() - i.createdAt > STALE_AFTER_MS));
  }, [STALE_AFTER_MS]);

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
    });
    const onChange = () => void refresh();
    window.addEventListener("conservation:queue-changed", onChange);
    return () => {
      alive = false;
      stop();
      window.removeEventListener("conservation:queue-changed", onChange);
    };
  }, [refresh, STALE_AFTER_MS]);

  if (items.length === 0) {
    if (justSent > 0) {
      return (
        <p className="mb-4 rounded-lg border border-ember-500/30 bg-ember-500/10 px-3 py-2 text-xs text-ember-700">
          {t("sentCount", { count: justSent })}
        </p>
      );
    }
    return null;
  }

  return (
    <section className="mb-4 rounded-lg border border-amber-500/30 bg-amber-600/10 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-amber-800">
          {t("waiting", { count: items.length })}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await flushQueue();
            await refresh();
            setBusy(false);
          }}
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
  );
}
