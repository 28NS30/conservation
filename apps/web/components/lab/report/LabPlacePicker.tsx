"use client";

import { useEffect, useRef, useState } from "react";
import type { Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { TAIWAN_MAIN_BOUNDS } from "@conservation/shared";
import { createMap, type MapHandle } from "@/lib/map";
import type { LatLng } from "@/lib/lab/reportFlow";

/**
 * The map that asks where, and shows nothing until it is told.
 *
 * NO PIN UNTIL A PLACE IS CHOSEN. Today's picker drops a marker on the centre
 * of Taiwan the moment it loads and treats it as the answer, so a reporter who
 * never touches the map files their sighting in the middle of Nantou — the
 * `location-default` defect, and the reason a location that was never set looks
 * exactly like one that was. Here the map opens on the whole island with
 * nothing on it and one line of instruction, and the marker is created the
 * first time there is something true to mark.
 *
 * The map itself is the live `createMap`, which is the only sanctioned way to
 * build one in this app: it carries the positioned container, the ResizeObserver
 * that MapLibre needs in a flex layout, the missing-image resolver, and the
 * fallback style that keeps a failed basemap fetch from leaving the map with no
 * style at all. Reusing it also means this picker draws the same basemap the
 * direction's own map page draws, on the same cached module and the same style
 * URL, so it adds no new kind of request to the page.
 *
 * The pin's colour comes from the direction's `--map-select-ring`, read through
 * `var()` in the element's own inline style rather than passed to MapLibre as a
 * hex. A marker that named a colour would be the one place in the lab where
 * swapping the theme file changed nothing.
 */
export default function LabPlacePicker({
  value,
  onPick,
  overlay,
  unavailableLabel,
  height = "h-80",
}: {
  value: LatLng | null;
  onPick: (value: LatLng) => void;
  /** 點地圖標出位置 — shown only while there is nothing to show. */
  overlay: React.ReactNode;
  unavailableLabel: React.ReactNode;
  className?: string;
  height?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<MapHandle | null>(null);
  const marker = useRef<Marker | null>(null);
  const pick = useRef(onPick);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!container.current || handle.current) return;
    let cancelled = false;

    void (async () => {
      let created: MapHandle;
      try {
        created = await createMap(container.current!, {
          navigation: false,
          // fitBounds needs the camera free; maxBounds would override it.
          bounded: false,
        });
      } catch {
        if (!cancelled) setFailed(true);
        return;
      }
      if (cancelled) {
        created.destroy();
        return;
      }
      handle.current = created;

      // The whole island, refitted on resize. At a fixed zoom the east coast
      // falls off the right edge of a 420px column, so anybody reporting from
      // Hualien has to pan before they can tap.
      const fit = () =>
        created.map.fitBounds(TAIWAN_MAIN_BOUNDS, { padding: 12, duration: 0 });
      fit();
      created.map.on("resize", fit);

      created.map.on("click", (event) => {
        created.map.off("resize", fit);
        pick.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      });
    })();

    return () => {
      cancelled = true;
      handle.current?.destroy();
      handle.current = null;
      marker.current = null;
    };
  }, []);

  // The marker exists only once there is a place. Created on first use and
  // moved afterwards, so nothing is ever drawn at a coordinate nobody chose.
  useEffect(() => {
    const live = handle.current;
    if (!live || !value) return;

    if (!marker.current) {
      const pin = document.createElement("div");
      pin.style.width = "20px";
      pin.style.height = "20px";
      pin.style.borderRadius = "50%";
      pin.style.background = "var(--map-select-ring)";
      pin.style.boxShadow = "0 0 0 3px var(--map-select-halo)";
      marker.current = new live.ml.Marker({ element: pin })
        .setLngLat([value.lng, value.lat])
        .addTo(live.map);
    } else {
      marker.current.setLngLat([value.lng, value.lat]);
    }

    // Under reduced motion the camera jumps. A 400ms ease across an island is
    // exactly the kind of movement that makes somebody put the phone down.
    const still =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const camera = { center: [value.lng, value.lat] as [number, number], zoom: 14 };
    if (still) live.map.jumpTo(camera);
    else live.map.easeTo({ ...camera, duration: 400 });
  }, [value]);

  if (failed)
    return (
      <p className="t-body rule-strong border-l-4 pl-4 text-(--fg)">
        {unavailableLabel}
      </p>
    );

  return (
    <div className={`rounded-(--radius-sign) relative w-full overflow-hidden ${height}`}>
      {/* `relative` on the container is load-bearing: MapLibre 6 does not add
          its own class to the element it is handed, so the stock
          `position: relative` rule matches nothing and the absolutely
          positioned canvas escapes to the nearest positioned ancestor. */}
      <div ref={container} className="relative h-full w-full" />
      {value ? null : (
        // At the top, not the bottom: MapLibre's own attribution sits bottom
        // right and is a licence condition, so an instruction line down there
        // either covers it or is covered by it.
        <p
          data-surface="field"
          className="t-body pointer-events-none absolute inset-x-0 top-0 z-10 bg-(--ground) px-4 py-2 text-center text-(--fg)"
        >
          {overlay}
        </p>
      )}
    </div>
  );
}
