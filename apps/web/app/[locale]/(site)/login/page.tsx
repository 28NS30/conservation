"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import PageHeader from "@/components/site/PageHeader";
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
    <main className="mx-auto w-full max-w-sm px-4 pt-16">
      <PageHeader title={t("heading")} lede={t("explain")} />

      {sent ? (
        <p className="rounded-lg border border-ember-500/30 bg-ember-500/10 px-3 py-3 text-sm text-ember-400">
          {t("sent")}
        </p>
      ) : (
        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-parchment-200/15 bg-bark-900/70 px-3 py-2 text-sm text-parchment-100"
          />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button
            type="button"
            onClick={send}
            disabled={busy || !email.includes("@")}
            className="w-full rounded-lg bg-ember-500 px-4 py-2.5 text-sm font-semibold text-bark-950 disabled:bg-bark-700 disabled:text-parchment-300"
          >
            {busy ? t("sending") : t("send")}
          </button>
        </div>
      )}
    </main>
  );
}
