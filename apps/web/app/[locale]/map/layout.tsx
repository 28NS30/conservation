import MapHints from "@/components/map/MapHints";

/**
 * Exists only to put the map's resource hints outside the Suspense boundary
 * that loading.tsx creates, so they reach the first HTML flush rather than the
 * streamed page that follows the statistics query.
 */
export default function MapLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MapHints />
      {children}
    </>
  );
}
