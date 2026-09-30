import type { AbstractIntlMessages } from "next-intl";

/**
 * The message namespaces a browser needs: the ones read by code that runs
 * there.
 *
 * NextIntlClientProvider serialises the messages it is given into every page,
 * and given none it passes the whole catalogue: about 70 KB, most of the HTML
 * of a report page, for a reporter who may be on one bar of signal at the
 * roadside. The about, privacy, terms and home pages' text, among others, is
 * only ever rendered on the server, so it stays there. The forum's is added
 * only where the forum is (app/[locale]/(site)/community/layout.tsx and the
 * forum's part of /me).
 *
 * A namespace read by a client component and missing here shows the reader a
 * message key instead of words. test/client-messages.test.mjs walks every
 * client module, and every module they import, and holds each namespace they
 * read to this list.
 */
export const CLIENT_NAMESPACES = [
  "admin",
  "categories",
  "collections",
  "detail",
  "errors",
  "list",
  "login",
  "map",
  "me",
  "nav",
  "offline",
  "precision",
  "report",
  "species",
] as const;

/** The namespaces only the forum's client components read. */
export const FORUM_NAMESPACES = ["forum"] as const;

/** `messages`, cut down to the client namespaces and any `extra` ones. */
export function clientMessages(
  messages: AbstractIntlMessages,
  extra: readonly string[] = [],
): AbstractIntlMessages {
  const keep = new Set<string>([...CLIENT_NAMESPACES, ...extra]);
  return Object.fromEntries(Object.entries(messages).filter(([ns]) => keep.has(ns)));
}
