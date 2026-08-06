"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Route-level error boundary. Without this an unhandled error falls through to
 * Next's default page, which is unstyled, unlocalised, and shows a stack trace
 * shape that means nothing to a member of the public.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");

  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold text-parchment-100">{t("title")}</h1>
      <p className="mt-2 text-sm text-parchment-400">{t("body")}</p>
      {error.digest && (
        <p className="mt-2 font-mono text-[11px] text-parchment-500">{error.digest}</p>
      )}
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-ember-500 px-4 py-1.5 text-xs font-semibold text-bark-950 hover:bg-ember-400"
        >
          {t("retry")}
        </button>
        <Link
          href="/"
          className="rounded-full border border-parchment-200/15 px-4 py-1.5 text-xs text-parchment-300 hover:bg-bark-800"
        >
          {t("backHome")}
        </Link>
      </div>
    </main>
  );
}
