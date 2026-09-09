"use client";

import { useEffect, useRef } from "react";
import { TURNSTILE_SITE_KEY, turnstileEnabled } from "@/lib/turnstile";

/**
 * The Cloudflare Turnstile challenge on the submission form.
 *
 * This was the missing half of the anti-abuse design. The server has always
 * verified a token — `verifyTurnstile` in lib/abuse.ts — but nothing ever
 * rendered a widget, so no token was ever produced. That is harmless while
 * TURNSTILE_SECRET_KEY is unset, because the check short-circuits to `true` for
 * local development. The moment the key is set in production the same code path
 * reaches `if (!token) return false`, and every submission is rejected with 403
 * challenge_failed. Turning on bot protection would have silently broken the
 * one thing the site exists to do.
 *
 * Renders nothing when NEXT_PUBLIC_TURNSTILE_SITE_KEY is absent, which keeps
 * local development working without a Cloudflare account and matches what the
 * server does with the secret.
 */

const SITE_KEY = TURNSTILE_SITE_KEY;
const SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      language?: string;
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** True when a challenge will actually be rendered, so the form can require it. */
export { turnstileEnabled };

export default function Turnstile({
  onToken,
  locale,
  theme = "dark",
  onReady,
}: {
  /** Called with a token when solved, and with null when it expires or errors. */
  onToken: (token: string | null) => void;
  locale?: string;
  /** The form sits on a dark panel; the offline queue banner does not. */
  theme?: "light" | "dark" | "auto";
  /**
   * Hands back a `reset`, which discards the solved token and mints another.
   *
   * The offline queue needs this and the form does not: a token is single-use,
   * and one flush can carry several queued reports, so each needs its own.
   */
  onReady?: (api: { reset: () => void }) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Kept in a ref so a changing callback identity cannot re-render the widget,
  // which would reset a challenge the user has already solved.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (!SITE_KEY || !container.current) return;
    let cancelled = false;

    const render = () => {
      if (cancelled || !container.current || widgetId.current) return;
      const api = window.turnstile;
      if (!api) return;
      widgetId.current = api.render(container.current, {
        sitekey: SITE_KEY,
        theme,
        language: locale?.startsWith("zh") ? "zh-tw" : "en",
        callback: (token) => onTokenRef.current(token),
        // A token is single-use and short-lived. Clearing it on expiry is what
        // stops the form submitting a stale one and getting a 403 the user
        // cannot explain.
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
      });
      onReadyRef.current?.({
        reset: () => {
          if (widgetId.current) window.turnstile?.reset(widgetId.current);
        },
      });
    };

    // Wait for the API object, not for the script's load event. With
    // render=explicit the script fires `load` before window.turnstile is
    // populated, so rendering on load found nothing and silently drew no
    // widget — the script tag was present and the challenge simply absent.
    let waited = 0;
    const poll = window.setInterval(() => {
      if (cancelled || widgetId.current) return window.clearInterval(poll);
      if (window.turnstile) {
        window.clearInterval(poll);
        render();
      } else if ((waited += 100) > 10_000) {
        window.clearInterval(poll);
        console.error(
          "[turnstile] API did not load; submission will be blocked",
        );
      }
    }, 100);

    if (!document.querySelector(`script[src="${SCRIPT}"]`)) {
      const el = document.createElement("script");
      el.src = SCRIPT;
      el.async = true;
      el.defer = true;
      document.head.appendChild(el);
    }

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      if (widgetId.current) {
        window.turnstile?.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [locale, theme]);

  if (!SITE_KEY) return null;
  return <div ref={container} className="mt-1" />;
}
