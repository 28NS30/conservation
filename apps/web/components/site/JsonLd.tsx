import { serializeJsonLd } from "@/lib/jsonLd";

/**
 * Structured data for search engines: schema.org, as JSON-LD.
 *
 * A server component, so it costs no JavaScript in the browser; the script
 * element is data and never runs. Next's guide puts it in the page, not in
 * <head>, and search engines read it from either. The builders are in
 * lib/structuredData.ts, and the escaping that keeps a string from closing
 * the element is lib/jsonLd.ts.
 */
export default function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
