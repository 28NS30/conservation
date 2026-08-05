import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-3xl font-semibold text-slate-700">404</p>
      <h1 className="mt-2 text-lg font-semibold text-slate-100">{t("notFoundTitle")}</h1>
      <p className="mt-2 text-sm text-slate-400">{t("notFoundBody")}</p>
      <div className="mt-5 flex gap-2">
        <Link href="/" className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400">
          {t("backHome")}
        </Link>
        <Link href="/species" className="rounded-full border border-white/15 px-4 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
          {t("browseSpecies")}
        </Link>
      </div>
    </main>
  );
}
