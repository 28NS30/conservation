"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { browserSupabase } from "@/lib/supabase/client";
import { withBase } from "@/lib/basePath";
import { NEXT_COOKIE, NEXT_COOKIE_MAX_AGE, NEXT_COOKIE_PATH } from "@/lib/signInNext";
import { sendFailure, verifyFailure, type SignInFailure as Failure } from "@/lib/signInErrors";

/** Long enough that a slow mail relay is not mistaken for a failure. */
const RESEND_SECONDS = 60;

/**
 * Supabase's email codes are 6 digits by default and configurable up to 10, so
 * the field takes up to 10: a project set longer than the copy says still works.
 */
const CODE_MIN = 6;
const CODE_MAX = 10;

/**
 * Sign in with a code from an email, or with Google when the project has it on.
 *
 * Passwordless on purpose: the project never handles, stores or transmits a
 * password.
 *
 * THE CODE, NOT JUST THE LINK. The email used to carry only a link, and the
 * link fails in three ordinary ways: opened on a different device from the
 * one that asked (it is bound to this browser), opened twice, or opened first
 * by the school's mail scanner, which spends it before the student ever sees
 * it. A 6-digit code typed into this page has none of those problems. Which of
 * the two the email contains is Supabase's template, not this code, so the page
 * accepts both and says so: until the template carries the code, the link still
 * works through /auth/callback exactly as before.
 *
 * A real <form> for each step, because the page was once a bare input and a
 * button with a click handler: Enter did nothing, the input had no label, and
 * a screen reader was offered an unnamed text box.
 */
export default function SignInForm({
  next,
  google,
  callbackError,
}: {
  /** Where to go afterwards, already checked by `safeNextPath`. */
  next: string;
  /** Whether the project has the Google provider switched on right now. */
  google: boolean;
  /** The callback sent the reader back because a link did not work. */
  callbackError: boolean;
}) {
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  /** The address the last email actually went to, or null while choosing one. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<Failure | null>(null);
  const [busy, setBusy] = useState<"send" | "verify" | "google" | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const shown = useRef(sentTo);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  // Each step replaces the other's form, so focus would otherwise fall back to
  // the top of the page. Not on first load: the email field is the page's
  // only job, but moving focus unasked skips the explanation above it.
  useEffect(() => {
    if (shown.current === sentTo) return;
    shown.current = sentTo;
    (sentTo ? codeRef : emailRef).current?.focus();
  }, [sentTo]);

  const callbackUrl = () => `${window.location.origin}${withBase("/auth/callback")}`;

  async function send(address: string) {
    setBusy("send");
    setError(null);
    rememberNext(next);
    const { error } = await browserSupabase().auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: callbackUrl() },
    });
    setBusy(null);
    if (error) {
      setError(sendFailure(error.status));
      return;
    }
    setCode("");
    setSentTo(address);
    setWait(RESEND_SECONDS);
  }

  async function verify() {
    if (!sentTo) return;
    setBusy("verify");
    setError(null);
    const { error } = await browserSupabase().auth.verifyOtp({
      email: sentTo,
      token: code,
      type: "email",
    });
    if (error) {
      setBusy(null);
      setError(verifyFailure(error.status));
      return;
    }
    forgetNext();
    // A full load rather than a client transition: every server-rendered part
    // of the page, the header included, has to be drawn again as signed in.
    // `replace`, so Back does not return to a form that has done its job.
    window.location.replace(next);
  }

  async function continueWithGoogle() {
    setBusy("google");
    setError(null);
    rememberNext(next);
    // On success this navigates away to Google; the promise only settles here
    // when it could not start.
    const { error } = await browserSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (error) {
      setBusy(null);
      setError("googleFailed");
    }
  }

  const control = "min-h-12 w-full rounded-lg px-3 text-base";
  const primary = `${control} bg-ember-500 font-semibold text-bark-950 disabled:bg-paper-200 disabled:text-ink-600`;
  const quiet =
    "inline-flex min-h-11 items-center rounded-lg border border-ink-900/15 px-3 text-sm text-ink-700 disabled:text-ink-500";

  const alert = (key: Failure | null) =>
    key && (
      <p role="alert" className="text-sm leading-relaxed text-amber-800">
        {t(key)}
      </p>
    );

  return (
    <div className="space-y-6">
      {callbackError && !sentTo && (
        <p
          role="alert"
          className="rounded-lg border border-amber-700/30 bg-amber-600/10 px-3 py-2.5 text-sm leading-relaxed text-amber-800"
        >
          {t("linkExpired")}
        </p>
      )}

      {sentTo ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
          className="space-y-4"
        >
          {/* role="status", not alert: this is the expected outcome, and an
              assertive interruption is for things that went wrong. */}
          <div role="status" className="space-y-1.5 text-sm leading-relaxed">
            <p className="font-semibold text-ink-900 [overflow-wrap:anywhere]">{t("sentTo", { email: sentTo })}</p>
            <p id="login-code-help" className="text-ink-700">
              {t("codeHelp")}
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="login-code" className="block text-sm text-ink-700">
              {t("codeLabel")}
            </label>
            <input
              ref={codeRef}
              id="login-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-describedby="login-code-help"
              value={code}
              // Digits only, so a code pasted with spaces or a dash still works.
              // No maxLength: the browser would cut "1 2 3 4 5 6" to its
              // first ten characters, five digits, before this could clean it.
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_MAX))}
              className={`${control} border border-ink-900/12 bg-paper-100/70 font-mono tracking-[0.3em] text-ink-900`}
            />
          </div>

          {alert(error)}

          <button
            type="submit"
            disabled={busy !== null || code.length < CODE_MIN}
            className={primary}
          >
            {busy === "verify" ? t("verifying") : t("verify")}
          </button>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void send(sentTo)}
              disabled={busy !== null || wait > 0}
              className={quiet}
            >
              {wait > 0 ? t("resendIn", { seconds: wait }) : t("resend")}
            </button>
            <button
              type="button"
              // Keeps the address in the box: the commonest reason to be here
              // is a typo in it, and clearing the field makes that harder to
              // fix rather than easier.
              onClick={() => {
                setError(null);
                setSentTo(null);
              }}
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-ink-700 underline underline-offset-2"
            >
              {t("changeEmail")}
            </button>
          </div>
        </form>
      ) : (
        <>
          {google && (
            <div className="space-y-2">
              <button
                type="button"
                data-sign-in="google"
                onClick={() => void continueWithGoogle()}
                disabled={busy !== null}
                className={`${control} inline-flex items-center justify-center gap-3 border border-ink-900/20 bg-white font-medium text-ink-900 disabled:text-ink-600`}
              >
                <GoogleMark />
                {busy === "google" ? t("googleStarting") : t("google")}
              </button>
              <p className="text-sm leading-relaxed text-ink-600">{t("googleSchool")}</p>
              <p className="flex items-center gap-3 pt-2 text-sm text-ink-600" aria-hidden>
                <span className="h-px flex-1 bg-ink-900/12" />
                {t("or")}
                <span className="h-px flex-1 bg-ink-900/12" />
              </p>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(email.trim());
            }}
            className="space-y-3"
          >
            <label htmlFor="login-email" className="block text-sm text-ink-700">
              {t("emailLabel")}
            </label>
            <input
              ref={emailRef}
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
            {alert(error)}
            <button
              type="submit"
              disabled={busy !== null || !email.includes("@")}
              className={primary}
            >
              {busy === "send" ? t("sending") : t("send")}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

/**
 * Remember where to return to, for the two ways back that pass through the
 * callback: the email's link, and Google. See lib/signInNext.ts.
 */
function rememberNext(next: string) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${NEXT_COOKIE}=${encodeURIComponent(next)}; Path=${withBase(NEXT_COOKIE_PATH)}; Max-Age=${NEXT_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/** Signed in with the code, so the link's return path is no longer wanted. */
function forgetNext() {
  document.cookie = `${NEXT_COOKIE}=; Path=${withBase(NEXT_COOKIE_PATH)}; Max-Age=0; SameSite=Lax`;
}

/** Google's "G", as its sign-in branding guidelines ask the button to carry. */
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-5 shrink-0">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
