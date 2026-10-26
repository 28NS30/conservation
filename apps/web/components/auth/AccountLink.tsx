"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "@/i18n/navigation";
import NavLink from "@/components/site/NavLink";
import SignInLink from "@/components/auth/SignInLink";
import { storedSessionUserId } from "@/lib/supabase/storedSession";

type Props = {
  /** "My reports", for someone signed in on this browser. */
  mineLabel: string;
  /** "Sign in", for everyone else. */
  signInLabel: string;
  overlay?: boolean;
  size?: "compact" | "normal" | "large";
};

/**
 * Whether this browser holds a session: the Supabase auth cookie, read here
 * rather than asked of Supabase. Nothing is verified, and nothing needs to
 * be: the link only decides between two doors, and /me checks who is there
 * before it shows anything (lib/supabase/server.ts). An expired access token
 * still counts, because the proxy renews it on the way into /me.
 */
function signedInHere(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return false;
  return storedSessionUserId(document.cookie, url) !== null;
}

/** document.cookie has no change event; see the pathname below. */
const subscribe = () => () => {};

/**
 * The header's account link: "My reports" once signed in, "Sign in" before.
 *
 * Decided in the browser so that every public page is the same page for
 * everyone. The header used to ask Supabase on the server, on every page,
 * and reading the request's cookies made the whole site render per request:
 * private, no-store, never served from the CDN, with the prerendered species
 * pages and every page's `revalidate` thrown away. Anonymous visitors, who
 * are nearly everyone, waited on a render and two database counts for a
 * page that was identical for all of them.
 *
 * The server's HTML, and the first render in the browser, say "Sign in", so
 * there is nothing to mismatch on hydration and a page without JavaScript
 * still has a way in. Someone signed in sees it change to "My reports" as the
 * page hydrates.
 *
 * The pathname is read so that the link is asked again on every navigation:
 * signing out is a server action that redirects within the app, and the
 * header, in the layout, would otherwise keep saying "My reports".
 */
export default function AccountLink({ mineLabel, signInLabel, overlay, size }: Props) {
  usePathname();
  const signedIn = useSyncExternalStore(subscribe, signedInHere, () => false);
  return signedIn ? (
    <NavLink href="/me" label={mineLabel} overlay={overlay} size={size} />
  ) : (
    <SignInLink label={signInLabel} overlay={overlay} size={size} />
  );
}
