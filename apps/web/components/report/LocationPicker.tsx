"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createMap, type MapHandle } from "@/lib/map";
import {
  isInTaiwanBounds,
  TAIWAN_MAIN_BOUNDS,
  TAIWAN_CENTER,
} from "@conservation/shared";

export type LatLng = { lat: number; lng: number };

/**
 * A device fix, with the radius the device claims for it.
 *
 * Kept separate from LatLng because only one of the two ways to set a location
 * has an accuracy at all: the browser reports one, and a pin the reporter
 * dragged onto a map does not. Attaching a number to the second would be
 * inventing a measurement.
 */
export type Fix = LatLng & { accuracyM: number | null };

export default function LocationPicker({
  value,
  onChange,
  maptilerKey,
}: {
  value: LatLng | null;
  onChange: (v: LatLng) => void;
  maptilerKey?: string;
}) {
  const t = useTranslations("report");
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<MapHandle | null>(null);
  const marker = useRef<Marker | null>(null);
  /**
   * Puts the pin down, creating it the first time.
   *
   * Held in a ref because both the effect that builds the map and the effect
   * that follows `value` need it, and it closes over the map handle.
   */
  const place = useRef<((lng: number, lat: number) => void) | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!container.current || handle.current) return;
    let cancelled = false;

    void (async () => {
      const h = await createMap(container.current!, {
        maptilerKey,
        center: value ? [value.lng, value.lat] : TAIWAN_CENTER,
        zoom: value ? 14 : 7,
        navigation: false,
        // fitBounds below needs the camera free; maxBounds would override it.
        bounded: false,
      });
      if (cancelled) {
        h.destroy();
        return;
      }
      handle.current = h;

      // Until a location is picked, show the whole island. At a fixed zoom the
      // east coast fell off the right edge of the column, so anyone reporting
      // from Hualien or Taitung had to pan before they could tap. Once a
      // location exists the effect below takes over and zooms in.
      if (!value) {
        const fit = () =>
          h.map.fitBounds(TAIWAN_MAIN_BOUNDS, { padding: 12, duration: 0 });
        fit();
        h.map.on("resize", fit);
      }

      /**
       * No pin until there is something to pin.
       *
       * One was dropped on Taiwan's geographic centre the moment the map
       * loaded, before the reporter had chosen anything — so the form looked
       * answered while `location` was still null, the submit button was greyed
       * out for no visible reason, and anyone who did not notice the difference
       * between "a pin" and "my pin" was one tap away from filing a sighting
       * somewhere in Nantou. The picker now shows what it knows, which at that
       * moment is nothing.
       */
      place.current = (lng, lat) => {
        if (!marker.current) {
          const m = new h.ml.Marker({ color: "#e11d48", draggable: true })
            .setLngLat([lng, lat])
            .addTo(h.map);
          m.on("dragend", () => {
            const p = m.getLngLat();
            onChangeRef.current({ lat: p.lat, lng: p.lng });
          });
          marker.current = m;
          return;
        }
        marker.current.setLngLat([lng, lat]);
      };

      if (value) place.current(value.lng, value.lat);

      // Tapping the map is far easier than dragging a pin on a phone.
      h.map.on("click", (e) => {
        place.current?.(e.lngLat.lng, e.lngLat.lat);
        onChangeRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
    })();

    return () => {
      cancelled = true;
      handle.current?.destroy();
      handle.current = null;
      marker.current = null;
      place.current = null;
    };
    // `value` is the initial centre only; later changes are handled by the effect
    // below, which moves the existing marker instead of rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maptilerKey]);

  // Keep the pin in sync when the value changes from outside (GPS, EXIF).
  // `place` rather than the marker directly: the first such change is also the
  // first pin, since there is none until a location exists.
  useEffect(() => {
    if (!value || !place.current || !handle.current) return;
    place.current(value.lng, value.lat);
    handle.current.map.easeTo({
      center: [value.lng, value.lat],
      zoom: 14,
      duration: 400,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  const outside = value && !isInTaiwanBounds(value.lng, value.lat);

  return (
    <div>
      {/* An outer wrapper purely to hang the overlay on. It does not go inside
          the container below, whose children belong to MapLibre and whose
          `relative` is answering a different question. */}
      <div className="relative">
        <div
          ref={container}
          // `relative` is load-bearing, not cosmetic. MapLibre 6 does not add a
          // `.maplibregl-map` class to the container it is given, so the stock
          // `.maplibregl-map { position: relative }` rule matches nothing. The
          // canvas inside is `position: absolute`, so without a positioned
          // ancestor it escapes to the viewport and paints over the header.
          className="relative h-56 w-full overflow-hidden rounded-lg sm:h-64"
        />
        {!value && (
          // Says what to do, over the thing to do it to. `pointer-events-none`
          // so it cannot swallow the tap it is asking for — including the tap
          // that lands underneath it.
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="rounded-full bg-bark-950 px-3 py-1.5 text-xs font-medium text-parchment-50">
              {t("tapToMark")}
            </span>
          </div>
        )}
      </div>
      {value && (
        <p className="mt-1.5 text-[11px] text-parchment-400 tabular-nums">
          {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          {outside && (
            <span className="ml-2 text-amber-700">⚠ {t("outsideTaiwan")}</span>
          )}
        </p>
      )}
    </div>
  );
}

/** Ask the browser for the current position. Resolves null if unavailable or denied. */
export function useGeolocate() {
  const [busy, setBusy] = useState(false);
  const locate = () =>
    new Promise<Fix | null>((resolve) => {
      if (!("geolocation" in navigator)) return resolve(null);
      setBusy(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setBusy(false);
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            // Metres, 95% confidence, per the Geolocation spec. Rounded: the
            // fractional part of a claimed radius is noise.
            accuracyM: Number.isFinite(pos.coords.accuracy)
              ? Math.round(pos.coords.accuracy)
              : null,
          });
        },
        () => {
          setBusy(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
      );
    });
  return { locate, busy };
}
