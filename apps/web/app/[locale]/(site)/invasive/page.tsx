import type { Metadata } from "next";
import CollectionHub, {
  collectionMetadata,
} from "@/components/collections/CollectionHub";

/**
 * The invasive collection: every record of an animal TaiCOL tags invasive,
 * alive or dead, and the list of those animals. See CollectionHub for what the
 * three collection pages share.
 */

// Counts are cheap but not worth recomputing per request, as on the map.
export const revalidate = 300;

export function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  return collectionMetadata(params, "invasive");
}

export default function InvasivePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return <CollectionHub params={params} collection="invasive" />;
}
