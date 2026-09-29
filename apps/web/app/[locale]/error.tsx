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
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center px-6 py-12">
      <span aria-hidden className="block h-1 w-14 bg-ember-500" />
      <h1 className="mt-5 text-2xl font-semibold text-ink-900">{t("title")}</h1>
      <p className="mt-2 text-[17px] leading-relaxed text-ink-800">{t("body")}</p>
      {error.digest && (
        <p className="mt-3 font-mono text-xs text-ink-600">{error.digest}</p>
      )}
      <div className="mt-7 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="inline-flex min-h-12 items-center bg-ember-500 px-6 font-display text-[17px] font-bold uppercase tracking-[0.06em] text-ink-950 transition hover:bg-ember-400">
          {t("retry")}
        </button>
        <Link href="/" className="inline-flex min-h-12 items-center border-2 border-forest-900 px-6 font-display text-[17px] font-bold uppercase tracking-[0.06em] text-forest-900 transition hover:bg-forest-900/5">
          {t("backHome")}
        </Link>
      </div>
    </main>
  );
}
