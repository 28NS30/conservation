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
}) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<"published" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <li className="rounded-lg border border-ink-900/10 bg-paper-100/60 px-4 py-2 text-xs text-ink-500">
        {done === "published" ? t("published") : t("rejected")} ·{" "}
        {props.id.slice(0, 8)}
      </li>
    );
  }

  const act = (fn: () => Promise<void>, next: "published" | "rejected") =>
    startTransition(async () => {
      setError(null);
      try {
        await fn();
        setDone(next);
      } catch (e) {
        setError((e as Error).message);
      }
    });

  return (
    <li className="rounded-xl border border-ink-900/10 bg-paper-100 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: props.categoryColor }}
        />
        <span className="font-medium text-ink-800">{props.categoryLabel}</span>
        <span className="text-ink-500">
          {new Date(props.observedAt).toLocaleString(locale, {
            timeZone: "Asia/Taipei",
          })}
        </span>
        {props.flaggedReason && (
          <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-700">
            {props.flaggedReason}
          </span>
        )}
      </div>

      {props.speciesLabel && (
        <p className="mt-1 text-xs text-ink-600">{props.speciesLabel}</p>
      )}
      {props.notes && (
        <p className="mt-1 text-xs text-ink-500">{props.notes}</p>
      )}

      <p className="mt-1 text-[11px] tabular-nums text-ink-500">
        {props.lat.toFixed(5)}, {props.lng.toFixed(5)}{" "}
        <a
          className="underline hover:text-ink-600"
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

      {error && <p className="mt-2 text-[11px] text-rose-700">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => publishReport(props.id), "published")}
          className="rounded-lg bg-ember-500 px-3 py-1.5 text-xs font-semibold text-bark-950 disabled:opacity-50"
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
          className="rounded-lg border border-ink-900/12 px-3 py-1.5 text-xs text-ink-600 disabled:opacity-50"
        >
          {t("reject")}
        </button>
      </div>
    </li>
  );
}
