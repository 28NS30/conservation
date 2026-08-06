"use client";

/**
 * Last-resort boundary: catches failures in the root layout itself, where the
 * i18n provider may not exist. Deliberately dependency-free and bilingual by
 * hand — there is no translation context to rely on at this point.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-Hant-TW">
      <body style={{ background: "#0b1410", color: "#ece2cd", fontFamily: "system-ui", padding: "3rem 1rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 600 }}>網站發生錯誤</h1>
        <p style={{ fontSize: ".85rem", color: "#94a3b8", marginTop: ".5rem" }}>Something went wrong.</p>
        {error.digest && <p style={{ fontSize: ".7rem", color: "#475569", marginTop: ".5rem" }}>{error.digest}</p>}
        <button
          onClick={reset}
          style={{ marginTop: "1.25rem", background: "#10b981", color: "#0b1410", border: 0, borderRadius: 999, padding: ".45rem 1.1rem", fontSize: ".8rem", fontWeight: 600 }}
        >
          重試 · Retry
        </button>
      </body>
    </html>
  );
}
