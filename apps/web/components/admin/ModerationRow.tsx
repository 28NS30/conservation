"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  publishReport,
  rejectReport,
} from "@/app/[locale]/(site)/admin/actions";

export default function ModerationRow(props: {
  id: string;
  categoryLabel: string;
  categoryColor: string;
  observedAt: string;
  notes: string | null;
  flaggedReason: string | null;
  lat: number;
  lng: number;
  speciesLabel: string | null;
  photoUrls: string[];
  /** A moderator's test (0018): publishing it still shows it to nobody. */
  test?: boolean;
}) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<"published" | "rejected" | null>(null);
  // Whether the last action failed, not why: a production build replaces a
  // server action's message with a generic English one, which is what the
  // queue used to show. The real message goes to the console.
  const [failed, setFailed] = useState(false);

  if (done) {
    return (
      <li className="rounded-lg border border-ink-900/10 bg-paper-100/60 px-4 py-3 text-sm text-ink-700">
        {done === "published" ? t("published") : t("rejected")} ·{" "}
        {props.id.slice(0, 8)}
      </li>
    );
  }

  const act = (fn: () => Promise<void>, next: "published" | "rejected") =>
    startTransition(async () => {
      setFailed(false);
      try {
        await fn();
        setDone(next);
      } catch (e) {
        console.error("[moderation]", (e as Error).message);
        setFailed(true);
      }
    });

  return (
    <li className="rounded-xl border border-ink-900/10 bg-paper-100 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: props.categoryColor }}
        />
        <span className="font-semibold text-ink-900">{props.categoryLabel}</span>
        <span className="text-ink-700">
          {new Date(props.observedAt).toLocaleString(locale, {
            timeZone: "Asia/Taipei",
          })}
        </span>
        {props.test && (
          <span className="rounded border border-dashed border-forest-900/50 px-1.5 py-0.5 text-[11px] font-medium text-forest-900">
            {t("testChip")}
          </span>
        )}
      </div>

      {/* Why it was held, as a sentence (lib/report/flagReasons.ts): it was a
          10px English chip, and it is the first thing a moderator needs. */}
      {props.flaggedReason && (
        <p className="mt-2 rounded-md bg-amber-400/15 px-2.5 py-1.5 text-sm leading-snug text-amber-900">
          {props.flaggedReason}
        </p>
      )}

      {props.speciesLabel && (
        <p className="mt-2 text-sm text-ink-800">{props.speciesLabel}</p>
      )}
      {props.notes && (
        <p className="mt-1 text-sm leading-relaxed text-ink-700">{props.notes}</p>
      )}

      <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm tabular-nums text-ink-700">
        {props.lat.toFixed(5)}, {props.lng.toFixed(5)}
        <a
          className="inline-flex min-h-11 items-center font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900"
          href={`https://www.google.com/maps?q=${props.lat},${props.lng}`}
          target="_blank"
          rel="noreferrer"
        >
          {t("view")}
        </a>
      </p>

      {props.photoUrls.length > 0 && (
        <div className="mt-2 flex gap-2">
          {props.photoUrls.map((u) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={u}
              src={u}
              alt=""
              className="h-24 w-24 rounded-lg object-cover"
            />
          ))}
        </div>
      )}

      {failed && (
        <p role="alert" className="mt-2 text-sm text-rose-800">
          {t("actionFailed")}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => publishReport(props.id), "published")}
          className="inline-flex min-h-11 items-center rounded-lg bg-ember-500 px-5 text-base font-semibold text-ink-950 hover:bg-ember-400 disabled:opacity-50"
        >
          {t("publish")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const reason = prompt(t("rejectReason")) ?? "";
            if (reason) act(() => rejectReport(props.id, reason), "rejected");
          }}
          className="inline-flex min-h-11 items-center rounded-lg border-2 border-ink-900/20 px-5 text-base font-medium text-ink-800 hover:border-ink-900/40 disabled:opacity-50"
        >
          {t("reject")}
        </button>
      </div>
    </li>
  );
}
