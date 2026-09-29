import type { Metadata } from "next";
import CollectionHub, {
  collectionMetadata,
} from "@/components/collections/CollectionHub";

/**
 * The wildlife collection: every live animal reported, native or invasive,
 * with the invasive ones marked. See CollectionHub for what the three
 * collection pages share.
 */

// Counts are cheap but not worth recomputing per request, as on the map.
export const revalidate = 300;

export function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  return collectionMetadata(params, "wildlife");
}

export default function WildlifePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return <CollectionHub params={params} collection="wildlife" />;
}
