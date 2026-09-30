/**
 * Who is signed in on this browser, read from the stored session alone.
 *
 * For a report being saved on the phone (components/report/ReportForm.tsx),
 * which must name the account it was made under and must not wait for the
 * network to do it. supabase-js's getSession() refreshes an access token more
 * than an hour old, and with no signal it retried for about 25 seconds and then
 * answered "nobody", so the report was saved with no account and filed under
 * whoever signed in next (review of the security fixes, 30 September 2026).
 *
 * The stored session is enough to say whose it is: an expired access token is
 * still the same person's. Nothing is verified here, and nothing needs to be:
 * the server holds the report to the account it names (app/api/reports), so a
 * wrong answer can only make a report wait or be filed anonymously.
 *
 * No imports, so the unit tests can load it directly.
 */

/** The auth cookie's name: `sb-<first label of the API host>-auth-token`. */
function cookieName(supabaseUrl: string): string | null {
  try {
    return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
}

function base64UrlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/**
 * The signed-in account's id; null when no session is stored (signed out);
 * undefined when one is stored but cannot be read.
 *
 * `cookies` is `document.cookie`. @supabase/ssr stores the session as JSON,
 * base64url-encoded behind a `base64-` prefix, split into `.0`, `.1`… chunks
 * when it is long.
 */
export function storedSessionUserId(cookies: string, supabaseUrl: string): string | null | undefined {
  const name = cookieName(supabaseUrl);
  if (!name) return undefined;
  const jar = new Map<string, string>();
  for (const part of cookies.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  let value = jar.get(name);
  if (value === undefined) {
    const chunks: string[] = [];
    for (let n = 0; jar.has(`${name}.${n}`); n++) chunks.push(jar.get(`${name}.${n}`)!);
    if (chunks.length === 0) return null;
    value = chunks.join("");
  }
  try {
    let text = decodeURIComponent(value);
    if (text.startsWith("base64-")) text = base64UrlDecode(text.slice("base64-".length));
    const session = JSON.parse(text) as { user?: { id?: unknown }; access_token?: unknown };
    if (typeof session.user?.id === "string") return session.user.id;
    if (typeof session.access_token === "string") {
      const claims = JSON.parse(base64UrlDecode(session.access_token.split(".")[1] ?? "")) as { sub?: unknown };
      if (typeof claims.sub === "string") return claims.sub;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
