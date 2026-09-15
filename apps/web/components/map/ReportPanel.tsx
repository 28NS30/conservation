"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { withBase } from "@/lib/basePath";
import type { Category } from "@conservation/shared";

type Report = {
  id: string;
  category: Category;
  observedAt: string;
  notes: string | null;
  isObscured: boolean;
  taxonId: number | null;
  scientificName: string | null;
  commonNameZh: string | null;
  photo: string | null;
};

/**
 * The record behind a dot, beside the map.
 *
 * What was there before was a MapLibre popup carrying a category and a date —
 * enough to label a dot, not enough to read it. The team asked for the
 * photograph and the details under it, which is a reading surface and does not
 * belong in a bubble anchored to a moving point.
 *
 * On a phone "the right" is the bottom: a 400px side panel on a 390px screen is
 * the whole screen, so it docks as a sheet over the lower half and the map keeps
 * the upper half, where the selected point is.
 */
export default function ReportPanel({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);

  // No reset on `id` here: the map keys this component by id, so selecting a
  // different report remounts it with fresh state. Clearing it in the effect
  // instead would cascade a render on every selection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(withBase(`/api/reports/${id}`));
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Report;
        if (!cancelled) setReport(data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Escape closes it, as it would any transient layer over a map.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const zhFirst = locale.startsWith("zh");
  const name = report
    ? zhFirst
      ? (report.commonNameZh ?? report.scientificName)
      : (report.scientificName ?? report.commonNameZh)
    : null;

  return (
    <aside
      aria-label={t("map.reportPanel")}
      // bottom-6 on a phone, not bottom-0: MapLibre's attribution control sits
      // in that strip, and OpenFreeMap and OpenStreetMap both require it to stay
      // visible. A panel that covers it is a licensing problem, not a layout
      // preference.
      className="pointer-events-auto absolute inset-x-0 bottom-6 z-20 max-h-[55%] overflow-y-auto rounded-t-xl border-t border-parchment-200/15 bg-bark-900/95 backdrop-blur sm:inset-y-0 sm:bottom-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-80 sm:rounded-none sm:border-l sm:border-t-0"
    >
      <div className="flex items-start justify-between gap-2 p-3.5 pb-2">
        <h2 className="text-sm font-medium text-parchment-100">
          {report ? t(`categories.${report.category}`) : t("map.loading")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("map.closePanel")}
          className="-mt-0.5 rounded-full px-2 py-0.5 text-parchment-400 transition hover:bg-parchment-50/10 hover:text-parchment-100"
        >
          ×
        </button>
      </div>

      {failed && (
        <p className="px-3.5 pb-4 text-xs text-parchment-400">
          {t("map.panelFailed")}
        </p>
      )}

      {report && (
        <div className="px-3.5 pb-5">
          {report.photo ? (
            /* eslint-disable-next-line @next/next/no-img-element --
               a signed, short-lived Storage URL: next/image would proxy it
               through the optimizer and cache a link that expires in 15
               minutes. */
            <img
              src={report.photo}
              alt=""
              className="mb-3 w-full rounded-lg border border-parchment-200/10 object-cover"
            />
          ) : (
            <p className="mb-3 rounded-lg border border-dashed border-parchment-200/15 px-3 py-4 text-center text-[11px] text-parchment-500">
              {t("map.noPhoto")}
            </p>
          )}

          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-parchment-500">{t("detail.species")}</dt>
              <dd className="text-parchment-100">
                {name ? (
                  report.taxonId ? (
                    <Link
                      href={`/species/${report.taxonId}`}
                      className="underline decoration-parchment-200/30 underline-offset-2 hover:decoration-parchment-200"
                    >
                      {name}
                    </Link>
                  ) : (
                    name
                  )
                ) : (
                  t("map.unidentified")
                )}
              </dd>
            </div>

            <div>
              <dt className="text-parchment-500">{t("map.observedOn")}</dt>
              <dd className="tabular-nums text-parchment-100">
                {report.observedAt.slice(0, 10)}
              </dd>
            </div>

            {report.notes && (
              <div>
                <dt className="text-parchment-500">{t("report.notes")}</dt>
                <dd className="whitespace-pre-line text-parchment-200">
                  {report.notes}
                </dd>
              </div>
            )}
          </dl>

          {/* Carried over from the popup deliberately. A blurred point that stops
              saying it is blurred reads as a precise one. */}
          {report.isObscured && (
            <p className="mt-3 rounded-md border border-amber-400/25 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
              {t("map.blurred")}
            </p>
          )}

          <Link
            href={`/reports/${report.id}`}
            className="mt-4 inline-block text-[11px] text-parchment-300 underline decoration-parchment-200/30 underline-offset-2 hover:text-parchment-100"
          >
            {t("map.openReport")}
          </Link>
        </div>
      )}
    </aside>
  );
}
