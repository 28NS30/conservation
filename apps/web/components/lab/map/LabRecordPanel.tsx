"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { withBase } from "@/lib/basePath";
import Binomial from "@/components/lab/ui/Binomial";
import Button from "@/components/lab/ui/Button";
import Notice from "@/components/lab/ui/Notice";
import Skeleton from "@/components/lab/ui/Skeleton";
import type { LabCopy } from "@/lib/lab/copy";

type Record_ = {
  id: string;
  observedAt: string;
  isObscured: boolean;
  taxonId: number | null;
  scientificName: string | null;
  commonNameZh: string | null;
  source: string;
  photo: string | null;
};

/**
 * The record behind a dot, led by the animal.
 *
 * The live panel opens with the report's CATEGORY as its heading — "Roadkill" —
 * and puts the species three rows down inside a definition list, under a dashed
 * box that says "No photograph" on the roughly nine reports in ten that have
 * none. So the first thing a reader gets is the word they already knew (they
 * clicked an ember dot) and a rectangle apologising for an absence.
 *
 * Here the name is the heading, the binomial sits under it, and the photo area
 * exists only when there is a photo (§2.6 rule 7: an empty slot collapses;
 * nothing is drawn that does not exist). The category becomes a status word
 * beside the date, where it belongs.
 *
 * The blurred-location line is a Notice rather than a tinted 11px box. A
 * blurred point that stops saying it is blurred reads as a precise one, and
 * that sentence is the one thing on this panel with a privacy consequence.
 *
 * Reads `/api/reports/[id]`, which selects from `reports_public` as `web_anon`:
 * a report that is unpublished, or whose taxon is rated 座標不開放, is absent
 * from that view, so this panel cannot be made to show one.
 */
export default function LabRecordPanel({
  id,
  copy,
  onClose,
  className = "",
}: {
  id: string;
  copy: LabCopy;
  onClose: () => void;
  className?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [record, setRecord] = useState<Record_ | null>(null);
  const [failed, setFailed] = useState(false);

  // No reset on `id`: the map keys this component by id, so selecting a
  // different record remounts it with fresh state.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(withBase(`/api/reports/${id}`));
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Record_;
        if (!cancelled) setRecord(data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const zhFirst = locale.startsWith("zh");
  const name = record
    ? zhFirst
      ? (record.commonNameZh ?? record.scientificName)
      : (record.scientificName ?? record.commonNameZh)
    : null;
  // Only when it is not already the heading, so a record with no Chinese name
  // does not print its binomial twice.
  const binomial =
    record && record.scientificName && name !== record.scientificName
      ? record.scientificName
      : null;

  return (
    <aside
      data-surface="field"
      aria-label={t("map.reportPanel")}
      className={`overflow-y-auto bg-(--ground) text-(--fg) ${className}`}
    >
      <div className="flex items-start justify-between gap-4 p-6">
        <div className="min-w-0">
          {record ? (
            <>
              <h2 className="t-head font-bold">
                {name ?? t("map.unidentified")}
              </h2>
              {binomial ? (
                <Binomial className="t-lead block text-(--fg-quiet)">
                  {binomial}
                </Binomial>
              ) : null}
            </>
          ) : (
            <h2 className="t-head font-bold">{t("map.loading")}</h2>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("map.closePanel")}
          className="t-lead -mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center text-(--fg)"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      {!record && !failed ? (
        <div className="px-6 pb-6">
          <Skeleton label={copy.common.loading} lines={3} />
        </div>
      ) : null}

      {failed ? (
        <p className="t-body px-6 pb-6 text-(--fg-quiet)">
          {t("map.panelFailed")}
        </p>
      ) : null}

      {record ? (
        <div className="px-6 pb-6">
          {/* Only when there is one. No placeholder, no dashed box, no sentence
              about an absence — the panel is simply shorter. */}
          {record.photo ? (
            /* eslint-disable-next-line @next/next/no-img-element --
               a signed, short-lived Storage URL: next/image would proxy it
               through the optimizer and cache a link that expires in 15
               minutes. */
            <img
              src={record.photo}
              alt=""
              className="mb-6 w-full object-cover"
            />
          ) : null}

          <p className="t-body text-(--fg-quiet)">
            {t("map.observedOn")}{" "}
            <span className="text-(--fg)">{record.observedAt.slice(0, 10)}</span>
          </p>

          {record.isObscured ? (
            <Notice className="mt-6">{copy.map.blurredNotice}</Notice>
          ) : null}

          <p className="t-note mt-6 text-(--fg-quiet)">
            {copy.map.recordSource.replace("{source}", record.source)}
          </p>

          {/* Secondary, not primary. The one ember thing in this viewport is the
              ring around the dot you picked — §2.6 rule 1 allows ember for
              "press here" OR "the one you selected", and two ember rectangles
              on a screen that already has an ember sign in the chrome is how a
              design stops having a primary action at all. */}
          <Button
            href={`/reports/${record.id}`}
            variant="secondary"
            className="mt-6"
            block
          >
            {copy.map.fullRecord}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
