"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import NavLink from "@/components/site/NavLink";
import { browserPath } from "./signInHref";

type Props = {
  label: string;
  overlay?: boolean;
  size?: "compact" | "normal" | "large";
};

/**
 * The header's "Sign in", which brings you back to the page you were on.
 *
 * There was no way in at all: /login was linked only from /me, and /me is only
 * in the header once you are signed in. The forum and moderation both need an
 * account, so the door has to be where people look for it.
 *
 * It carries the page you are on as `?next=`, query string included, so
 * signing in from a filtered list or a thread returns you to that list or
 * thread rather than to the home page.
 *
 * The query string is read inside its own Suspense boundary, because
 * `useSearchParams` hands everything up to the nearest one to the client on a
 * statically rendered page. The fallback is the same link without the query,
 * so the header's server HTML still has a working sign-in link in it.
 */
export default function SignInLink(props: Props) {
  return (
    <Suspense fallback={<SignInNavLink {...props} search="" />}>
      <WithSearch {...props} />
    </Suspense>
  );
}

function WithSearch(props: Props) {
  return <SignInNavLink {...props} search={useSearchParams().toString()} />;
}

function SignInNavLink({ label, overlay, size, search }: Props & { search: string }) {
  const pathname = usePathname();
  const locale = useLocale();
  // On the sign-in page itself, the link is just "you are here".
  const query =
    pathname === "/login"
      ? undefined
      : { next: `${browserPath(locale, pathname)}${search ? `?${search}` : ""}` };
  return <NavLink href="/login" query={query} label={label} overlay={overlay} size={size} />;
}
