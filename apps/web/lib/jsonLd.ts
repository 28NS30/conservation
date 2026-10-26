/**
 * JSON for a `<script type="application/ld+json">`, safe to put in HTML.
 *
 * JSON.stringify is not enough. The browser ends a script element at the
 * first `</script` whatever is inside it, so a species name, a description or
 * any other string that ever held one would close the element and run what
 * followed as markup. Every `<`, `>` and `&` is written as its \u escape,
 * which is the same string to a JSON parser and is never markup to an HTML
 * one, and so are U+2028 and U+2029, which older JavaScript parsers treated
 * as line ends. This is the escape Next's own JSON-LD guide recommends,
 * widened to the other characters that matter.
 *
 * No imports, so test/structured-data.test.mjs runs this exact function.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
