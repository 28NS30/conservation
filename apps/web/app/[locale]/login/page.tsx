"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { browserSupabase } from "@/lib/supabase/client";

/**
 * Magic-link sign-in.
 *
 * Deliberately passwordless: the project never handles, stores, or transmits a
 * password. Accounts are optional — reporting works fully anonymously — so this
 * exists for report history, attribution, and moderator access.
 */
export default function LoginPage() {
  const t = useTranslations("login");
  const nav = useTranslations("nav");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    const { error } = await browserSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-sm px-4 pt-16">
      <Link href="/" className="text-xs text-slate-400 hover:text-slate-200">
        {nav("backToMap")}
      </Link>
      <h1 className="mb-1 mt-3 text-lg font-semibold text-slate-50">{t("heading")}</h1>
      <p className="mb-6 text-xs text-slate-400">{t("explain")}</p>

      {sent ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200">{t("sent")}</p>
      ) : (
        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-white/15 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
          />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button
            type="button"
            onClick={send}
            disabled={busy || !email.includes("@")}
            className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
          >
            {busy ? t("sending") : t("send")}
          </button>
        </div>
      )}
    </main>
  );
}
