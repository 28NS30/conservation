"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { createMap, type MapHandle } from "@/lib/map";
import {
  LOCATION_PRECISION,
  type LocationPrecision,
} from "@conservation/shared";

/**
 * A circle of `radiusKm` around a point, as a real polygon in geographic
 * coordinates.
 *
 * Not a `circle-radius` paint property: that is measured in screen pixels, so it
 * describes an area only by coincidence of zoom. The first version drew a fixed
 * 46px disc next to a caption reading "generalised to about 10 km", which looked
 * authoritative about a distance it was not measuring. On the one page whose job
 * is being honest about location, the shape has to be the actual footprint.
 */
function circlePolygon(lng: number, lat: number, radiusKm: number, steps = 64) {
  const latKm = 110.574;
  const lngKm = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ring = Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * 2 * Math.PI;
    return [
      lng + (radiusKm / lngKm) * Math.cos(a),
      lat + (radiusKm / latKm) * Math.sin(a),
    ];
  });
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [ring] },
  };
}

/**
 * Where one report is, on a map.
 *
 * The detail page printed "24.6360, 120.8833" and nothing else — six decimal
 * places of nothing, on a site whose entire premise is that location is the
 * interesting part. This is also the page people share, so it is the one that
 * most needs to show rather than state.
 *
 * Read-only by design (`static`): this is an illustration of a single record,
 * not an instrument. Panning it would invite the reader to go looking for
 * neighbouring records, which is what /map is for.
 *
 * IMPORTANT: the caller must pass the coordinates from `reports_public`, never
 * from `reports`. For a sensitive species those differ by up to 50 km, and this
 * component cannot tell them apart — it draws exactly what it is handed. The
 * `precision` only controls how the location is drawn, and is not a safety net
 * for passing the wrong numbers.
 */
export default function ReportMap({
  lat,
  lng,
  precision,
  maptilerKey,
}: {
  lat: number;
  lng: number;
  /** From reports_public. Anything but `exact` is drawn as its real footprint. */
  precision?: LocationPrecision | null;
  maptilerKey?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const handleRef = useRef<MapHandle | null>(null);

  // `suppressed` never reaches this page (those reports 404), and `exact` gets a
  // pin. Everything else is drawn at the radius the schema actually applied.
  const km = precision ? LOCATION_PRECISION[precision].approxKm : 0;
  const radiusKm = Number.isFinite(km) ? km : 0;

  useEffect(() => {
    if (!container.current || handleRef.current) return;
    let cancelled = false;

    void (async () => {
      const h = await createMap(container.current!, {
        maptilerKey,
        center: [lng, lat],
        zoom: 13,
        navigation: false,
        static: true,
        // Nothing can pan this, and maxBounds would fight the fitBounds below.
        bounded: false,
        // addSource/addLayer throw if the style has not settled, so the obscured
        // circle goes through onReady rather than running straight after the
        // promise resolves. Must stay idempotent — onReady can fire more than
        // once as the style loads.
        onReady: (map) => {
          if (!radiusKm || map.getSource("area")) return;
          // A pin asserts a point. An obscured record is a circle of
          // uncertainty, so it is drawn as one — claiming precision here would
          // undo the reason the coordinate was generalised in the first place.
          const poly = circlePolygon(lng, lat, radiusKm);
          map.addSource("area", { type: "geojson", data: poly });
          map.addLayer({
            id: "area-fill",
            type: "fill",
            source: "area",
            paint: { "fill-color": "#e0a34f", "fill-opacity": 0.15 },
          });
          map.addLayer({
            id: "area-line",
            type: "line",
            source: "area",
            paint: {
              "line-color": "#e0a34f",
              "line-opacity": 0.55,
              "line-width": 1,
            },
          });
          // Frame the footprint itself, so the zoom always matches the claim.
          const ring = poly.geometry.coordinates[0];
          const xs = ring.map((c) => c[0]);
          const ys = ring.map((c) => c[1]);
          map.fitBounds(
            [
              [Math.min(...xs), Math.min(...ys)],
              [Math.max(...xs), Math.max(...ys)],
            ],
            { padding: 24, duration: 0 },
          );
        },
      });
      if (cancelled) return h.destroy();
      handleRef.current = h;

      // A marker is a DOM overlay, not a style layer, so it needs no wait.
      if (!radiusKm) {
        new h.ml.Marker({ color: "#cf7238" })
          .setLngLat([lng, lat])
          .addTo(h.map);
      }
    })();

    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, [lat, lng, radiusKm, maptilerKey]);

  return (
    <div
      ref={container}
      // See LocationPicker: MapLibre 6 does not class its own container, so
      // without `relative` the absolutely-positioned canvas escapes the page.
      className="relative mt-2 h-48 w-full overflow-hidden rounded-lg sm:h-56"
    />
  );
}
