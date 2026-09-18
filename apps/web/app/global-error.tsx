"use client";

/**
 * Last-resort boundary: catches failures in the root layout itself, where the
 * i18n provider may not exist. Deliberately dependency-free and bilingual by
 * hand — there is no translation context to rely on at this point.
 *
 * For the same reason the colours are literals rather than Tailwind classes or
 * `var(--color-*)`: this page may render without globals.css. Each one is
 * named in a comment so the palette can be followed back to app/globals.css,
 * which is the only thing keeping these six values from drifting out of it.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-Hant-TW">
      {/* bark-950 ground, parchment-100 text */}
      <body style={{ background: "#0b1410", color: "#ece2cd", fontFamily: "system-ui", padding: "3rem 1rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 600 }}>網站發生錯誤</h1>
        {/* parchment-400 */}
        <p style={{ fontSize: ".85rem", color: "#9d9179", marginTop: ".5rem" }}>Something went wrong.</p>
        {/* parchment-500 */}
        {error.digest && <p style={{ fontSize: ".7rem", color: "#8b8270", marginTop: ".5rem" }}>{error.digest}</p>}
        <button
          onClick={reset}
          /* ember-500 on bark-950 */
          style={{ marginTop: "1.25rem", background: "#cf7238", color: "#0b1410", border: 0, borderRadius: 999, padding: ".45rem 1.1rem", fontSize: ".8rem", fontWeight: 600 }}
        >
          重試 · Retry
        </button>
      </body>
    </html>
  );
}
