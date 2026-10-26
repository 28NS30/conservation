"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { withBase } from "@/lib/basePath";

/** One record as GET /api/species/[id]/records sends it. */
type ListedRecord = {
  id: string;
  observedAt: string;
  lat: number;
  lng: number;
  isObscured: boolean;
};

/**
 * A sparse species' records, each with its date and its point, asked for when
 * the page opens.
 *
 * In the browser, from a route that reads them per request, because the page
 * around it is cached for everybody and a cached page may not carry a
 * record's point (see the route). Until they arrive the list holds a row for
 * each record the page counted, so nothing below it moves when they do; if
 * they cannot be had, the reader is sent to the list of records, which
 * renders per request too.
 */
export default function SpeciesRecords({
  taxonId,
  expected,
}: {
  taxonId: number;
  /** How many the cached page counted, for the rows held while loading. */
  expected: number;
}) {
  const t = useTranslations("species");
  const locale = useLocale();
  const [records, setRecords] = useState<ListedRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  // No reset on `taxonId`: a species page has one, and navigating to another
  // species renders another page, which mounts this afresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(withBase(`/api/species/${taxonId}/records`), { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { records: ListedRecord[] };
        if (!cancelled) setRecords(data.records);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taxonId]);

  if (failed)
    return (
      <p className="mt-3 text-sm text-ink-700">
        {t("recordsUnavailable")}{" "}
        <Link
          href={{ pathname: "/reports", query: { taxonId } }}
          className="text-leaf-700 underline underline-offset-2 hover:text-forest-900"
        >
          {t("recordsInList")}
        </Link>
      </p>
    );

  if (records === null)
    return (
      <ul className="mt-3 space-y-1.5 text-sm" aria-busy="true">
        {Array.from({ length: expected }, (_, i) => (
          <li key={i} aria-hidden="true" className="min-h-11 rounded border border-ink-900/10" />
        ))}
      </ul>
    );

  if (records.length === 0) return null;

  return (
    <ul className="mt-3 space-y-1.5 text-sm">
      {records.map((r) => (
        <li
          key={r.id}
          className="flex items-center justify-between gap-3 rounded border border-ink-900/10 px-3"
        >
          <Link
            href={`/reports/${r.id}`}
            className="inline-flex min-h-11 items-center font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900"
          >
            {new Date(r.observedAt).toLocaleDateString(locale, {
              timeZone: "Asia/Taipei",
            })}
          </Link>
          <span className="tabular-nums text-ink-700">
            {r.lat.toFixed(3)}, {r.lng.toFixed(3)}
            {r.isObscured && <span className="ml-1.5 text-amber-700">≈</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
