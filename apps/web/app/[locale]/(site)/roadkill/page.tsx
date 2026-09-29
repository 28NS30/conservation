import type { Metadata } from "next";
import CollectionHub, {
  collectionMetadata,
} from "@/components/collections/CollectionHub";

/**
 * The roadkill collection: every animal found dead or injured. See
 * CollectionHub for what the three collection pages share.
 */

// Counts are cheap but not worth recomputing per request, as on the map.
export const revalidate = 300;

export function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  return collectionMetadata(params, "roadkill");
}

export default function RoadkillPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return <CollectionHub params={params} collection="roadkill" />;
}
