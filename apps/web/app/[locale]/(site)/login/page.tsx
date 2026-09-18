"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import PageHeader from "@/components/site/PageHeader";
import { browserSupabase } from "@/lib/supabase/client";

/** Long enough that a slow mail relay is not mistaken for a failure. */
const RESEND_SECONDS = 60;

/**
 * What the callback sent the reader back with.
 *
 * app/auth/callback redirects here with ?error= when there is no code or the
 * exchange fails — an expired or already-used link, which is the ordinary way
 * a magic link goes wrong. Nothing read it, so the reader arrived at a form
 * that looked exactly as it had before they clicked, with no account and no
 * explanation.
 *
 * Its own component inside <Suspense> because useSearchParams client-renders
 * everything up to the nearest boundary. The form is the thing worth having in
 * the initial HTML, so the part that reads the query string is kept small and
 * fenced off.
 */
function CallbackError() {
  const t = useTranslations("login");
  if (!useSearchParams().get("error")) return null;
  return (
    <p
      role="alert"
      className="mb-4 rounded-lg border border-amber-700/30 bg-amber-600/10 px-3 py-2.5 text-sm leading-relaxed text-amber-800"
    >
      {t("linkExpired")}
    </p>
  );
}

/**
 * Magic-link sign-in.
 *
 * Deliberately passwordless: the project never handles, stores, or transmits a
 * password. Accounts are optional — reporting works fully anonymously — so this
 * exists for report history, attribution, and moderator access.
 *
 * A real <form>, because the whole page was a bare input and a button with a
 * click handler: Enter did nothing, the input had no label of any kind, and a
 * screen reader was offered an unnamed text box. All three are the same
 * omission, and a form element fixes all three at once.
 */
export default function LoginPage() {
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  /** The address the last link actually went to, or null while editing. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<"failed" | "tooMany" | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function send(address: string) {
    setBusy(true);
    setError(null);
    const { error } = await browserSupabase().auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    // Supabase's message is raw English written for a developer — "For security
    // purposes, you can only request this after 47 seconds" — shown untranslated
    // to a Taiwanese reader on a page with no other English on it. The only two
    // outcomes worth distinguishing are rate limiting and everything else.
    if (error) setError(error.status === 429 ? "tooMany" : "failed");
    else {
      setSentTo(address);
      setWait(RESEND_SECONDS);
    }
  }

  const control = "min-h-11 w-full rounded-lg px-3 text-sm";

  return (
    <main className="mx-auto w-full max-w-sm px-4 pb-24 pt-16">
      <PageHeader title={t("heading")} lede={t("explain")} />

      <Suspense fallback={null}>
        <CallbackError />
      </Suspense>

      {sentTo ? (
        // role="status" rather than alert: this is the expected outcome, and
        // an assertive interruption is for things that went wrong.
        <div
          role="status"
          className="space-y-3 rounded-lg border border-ember-500/30 bg-ember-500/10 px-3 py-3 text-sm text-ember-700"
        >
          <p className="leading-relaxed">{t("sent")}</p>
          <p className="break-all text-ink-700">{t("sentTo", { email: sentTo })}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void send(sentTo)}
              disabled={busy || wait > 0}
              className="inline-flex min-h-11 items-center rounded-lg border border-ink-900/15 px-3 text-xs text-ink-700 disabled:text-ink-500"
            >
              {wait > 0 ? t("resendIn", { seconds: wait }) : t("resend")}
            </button>
            <button
              type="button"
              // Keeps the address in the box: the commonest reason to be here
              // is a typo in it, and clearing the field makes that harder to
              // fix rather than easier.
              onClick={() => setSentTo(null)}
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-xs text-ink-600 underline underline-offset-2"
            >
              {t("changeEmail")}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-amber-800">
              {t(error)}
            </p>
          )}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(email);
          }}
          className="space-y-3"
        >
          <label htmlFor="login-email" className="block text-sm text-ink-700">
            {t("emailLabel")}
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={`${control} border border-ink-900/12 bg-paper-100/70 text-ink-800 placeholder:text-ink-500`}
          />
          {error && (
            <p role="alert" className="text-xs leading-relaxed text-amber-800">
              {t(error)}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !email.includes("@")}
            className={`${control} bg-ember-500 font-semibold text-bark-950 disabled:bg-paper-200 disabled:text-ink-600`}
          >
            {busy ? t("sending") : t("send")}
          </button>
        </form>
      )}
    </main>
  );
}
