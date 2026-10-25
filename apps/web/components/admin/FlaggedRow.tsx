"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { clearFlag } from "@/app/[locale]/(site)/admin/actions";

/**
 * A published record with a flag, in the moderation queue's list of them.
 *
 * Less than a held report shows: no coordinates and no notes, because nothing
 * here decides where the record is shown. The one action says the flag was
 * looked at; correcting the species is done on the record's own page, where a
 * moderator can name any species and the blur follows.
 */
export default function FlaggedRow(props: {
  id: string;
  categoryLabel: string;
  categoryColor: string;
  observedAt: string;
  flaggedReason: string;
  /** The species the record is published under, as named by the person. */
  speciesLabel: string | null;
  /** The model's first answer: what it suggested, or what it disagrees with. */
  modelLabel: string | null;
  /** How the record is shown on the map now, in words. */
  blurLabel: string;
  photoUrls: string[];
  test?: boolean;
}) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  // As in ModerationRow: whether it failed, not why, since a production build
  // replaces a server action's message with a generic English one.
  const [failed, setFailed] = useState(false);

  if (done) {
    return (
      <li className="rounded-lg border border-ink-900/10 bg-paper-100/60 px-4 py-3 text-sm text-ink-700">
        {t("flagged.cleared")} · {props.id.slice(0, 8)}
      </li>
    );
  }

  const ok = () =>
    startTransition(async () => {
      setFailed(false);
      try {
        await clearFlag(props.id);
        setDone(true);
      } catch (e) {
        console.error("[moderation]", (e as Error).message);
        setFailed(true);
      }
    });

  return (
    <li className="rounded-xl border border-ink-900/10 bg-paper-100 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="h-2 w-2 rounded-full" style={{ background: props.categoryColor }} />
        <span className="font-semibold text-ink-900">{props.categoryLabel}</span>
        <span className="text-ink-700">
          {new Date(props.observedAt).toLocaleString(locale, { timeZone: "Asia/Taipei" })}
        </span>
        {props.test && (
          <span className="rounded border border-dashed border-forest-900/50 px-1.5 py-0.5 text-[11px] font-medium text-forest-900">
            {t("testChip")}
          </span>
        )}
      </div>

      <p className="mt-2 rounded-md bg-amber-400/15 px-2.5 py-1.5 text-sm leading-snug text-amber-900">
        {props.flaggedReason}
      </p>

      {props.speciesLabel && (
        <p className="mt-2 text-sm text-ink-800">
          {t("flagged.named", { name: props.speciesLabel })}
        </p>
      )}
      {props.modelLabel && (
        <p className="mt-1 text-sm text-ink-800">
          {t("flagged.model", { name: props.modelLabel })}
        </p>
      )}
      <p className="mt-1 text-sm text-ink-700">{props.blurLabel}</p>

      {props.photoUrls.length > 0 && (
        <div className="mt-2 flex gap-2">
          {props.photoUrls.map((u) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={u} src={u} alt="" className="h-24 w-24 rounded-lg object-cover" />
          ))}
        </div>
      )}

      {failed && (
        <p role="alert" className="mt-2 text-sm text-rose-800">
          {t("actionFailed")}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          disabled={pending}
          onClick={ok}
          className="inline-flex min-h-11 items-center rounded-lg border-2 border-ink-900/20 px-5 text-base font-semibold text-ink-800 hover:border-ink-900/40 disabled:opacity-50"
        >
          {t("flagged.ok")}
        </button>
        <Link
          href={`/reports/${props.id}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900"
        >
          {t("flagged.open")}
        </Link>
      </div>
    </li>
  );
}
