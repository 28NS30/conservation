"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { GeoJSONSource, Map as MLMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { circlePolygon, createMap, polygonBounds, type MapHandle } from "@/lib/map";
import { useMapStrings } from "@/lib/mapStrings";
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

/**
 * The radius past which a device fix is rough enough to say so, in metres.
 *
 * A phone with a GPS lock claims 5 to 30 m. Past 100 m it is guessing from
 * Wi-Fi or a cell tower, and the pin can sit on the wrong side of a river or
 * on the wrong road: the form then draws the circle the device claims and
 * asks the reporter to put the pin where they actually were.
 */
export const ROUGH_FIX_M = 100;

/** Whether a claimed accuracy is rough enough to show (see ROUGH_FIX_M). */
export const isRoughFix = (accuracyM: number | null | undefined): accuracyM is number =>
  accuracyM != null && accuracyM > ROUGH_FIX_M;

const NO_CIRCLE = { type: "FeatureCollection" as const, features: [] };

export default function LocationPicker({
  value,
  onChange,
  maptilerKey,
  accuracyM = null,
}: {
  value: LatLng | null;
  onChange: (v: LatLng) => void;
  maptilerKey?: string;
  /**
   * The radius the device claimed for `value`, when the device set it. Past
   * ROUGH_FIX_M it is drawn as a circle and the camera frames the circle, so
   * the reporter sees how far off the pin may be.
   */
  accuracyM?: number | null;
}) {
  const t = useTranslations("report");
  const hintId = useId();
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<MapHandle | null>(null);
  const marker = useRef<Marker | null>(null);
  /**
   * MapLibre's words in the page's language, and two of them made specific:
   * the canvas is named for what it is for, and the pin says it can be moved
   * by keyboard. Read when the map is built, like the camera.
   */
  const shared = useMapStrings();
  const strings = useMemo(
    () => ({ ...shared, "Map.Title": t("pickerMap"), "Marker.Title": t("pickerPin") }),
    [shared, t],
  );
  const stringsRef = useRef(strings);
  useEffect(() => {
    stringsRef.current = strings;
  }, [strings]);
  /** The map exists, so the centre button has something to read. */
  const [ready, setReady] = useState(false);
  /** The centre button was pressed too far out, and zoomed in instead. */
  const [aimHint, setAimHint] = useState(false);
  /**
   * Puts the pin at the middle of the map, under the crosshair: the way to
   * place it with no pointer at all. Clicking and dragging were the only ways,
   * so a keyboard user whose browser could not give a position could not file
   * a report (WCAG 2.1.1).
   */
  const placeAtCentre = useRef<(() => void) | null>(null);
  /**
   * The point last put down at the centre, so the effect that follows `value`
   * leaves the camera where it is when that point arrives. The pin is already
   * in the middle of the view, at the zoom the reporter chose to aim with, and
   * zooming back to 14 would undo the aiming. A point rather than a flag, so
   * one that never arrives (Enter twice on the same spot) cannot hold the
   * camera still for the next GPS fix. Touch placement never sets it.
   */
  const placedAtCentre = useRef<LatLng | null>(null);
  /** Redraws the accuracy circle; null until the style has loaded. */
  const drawAccuracy = useRef<(() => void) | null>(null);
  const accuracyRef = useRef(accuracyM);
  useEffect(() => {
    accuracyRef.current = accuracyM;
  }, [accuracyM]);
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
  /** The latest value, for the map once it has loaded; see the effect below. */
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

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
        strings: stringsRef.current,
        // The circle a rough fix claims (ROUGH_FIX_M), under the pin. A
        // polygon of the real radius rather than a pixel disc, as on the
        // record page, so it means the same thing at every zoom.
        onReady: (map: MLMap) => {
          if (map.getSource("accuracy")) return;
          map.addSource("accuracy", { type: "geojson", data: NO_CIRCLE });
          map.addLayer({
            id: "accuracy-fill",
            type: "fill",
            source: "accuracy",
            paint: { "fill-color": "#e08a4f", "fill-opacity": 0.18 },
          });
          map.addLayer({
            id: "accuracy-line",
            type: "line",
            source: "accuracy",
            paint: { "line-color": "#eda471", "line-width": 2 },
          });
          drawAccuracy.current = () => {
            const src = map.getSource("accuracy") as GeoJSONSource | undefined;
            const v = valueRef.current;
            const r = accuracyRef.current;
            src?.setData(v && isRoughFix(r) ? circlePolygon(v.lng, v.lat, r / 1000) : NO_CIRCLE);
          };
          drawAccuracy.current();
        },
      });
      if (cancelled) {
        h.destroy();
        return;
      }
      handle.current = h;

      // For the end-to-end specs, which check that a tap lands where it was
      // aimed with the crosshair over the map. Never in a real production
      // build; see the same handle in HeatmapView.
      if (
        process.env.NODE_ENV !== "production" ||
        process.env.NEXT_PUBLIC_E2E === "1"
      ) {
        (window as unknown as { __pickerMap?: MLMap }).__pickerMap = h.map;
      }

      // Until a location is picked, show the whole island. At a fixed zoom the
      // east coast fell off the right edge of the column, so anyone reporting
      // from Hualien or Taitung had to pan before they could tap. Once a
      // location exists the effect below takes over and zooms in.
      //
      // The value as it is NOW, not as it was at the first render: the map
      // takes seconds to load, and a GPS fix or a photo's place set meanwhile
      // got no pin, and the island stayed in view. And a resize (turning the
      // phone) fitted the whole island over a pin already placed.
      const fit = () => {
        if (!valueRef.current)
          h.map.fitBounds(TAIWAN_MAIN_BOUNDS, { padding: 12, duration: 0 });
      };
      fit();
      h.map.on("resize", fit);

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
          // MapLibre makes a draggable pin a button that arrow keys move, and
          // names it from `strings`; its drag events cover both, so a pin
          // moved by keyboard reaches the form exactly as a dragged one does.
          m.on("dragend", () => {
            const p = m.getLngLat();
            // Moved by hand, so the camera stays where the reporter has it:
            // framing it at zoom 14 threw a keyboard user, nudging the pin a
            // step at a time, to street level after the first key.
            placedAtCentre.current = { lat: p.lat, lng: p.lng };
            onChangeRef.current({ lat: p.lat, lng: p.lng });
          });
          marker.current = m;
          return;
        }
        marker.current.setLngLat([lng, lat]);
      };

      const now = valueRef.current;
      if (now) {
        place.current(now.lng, now.lat);
        frame(h.map, now, accuracyRef.current, 0);
      }

      // Tapping the map is far easier than dragging a pin on a phone.
      h.map.on("click", (e) => {
        place.current?.(e.lngLat.lng, e.lngLat.lat);
        onChangeRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });

      // The keyboard's way in. The canvas already takes focus, and MapLibre
      // already pans it with the arrow keys and zooms it with + and -, so the
      // crosshair is aimed by moving the map under it; Enter, or the button
      // under the map, puts the pin there. Nothing here changes what a tap or
      // a drag does.
      placeAtCentre.current = () => {
        const c = h.map.getCenter();
        // At the whole island's zoom the centre is a point in the Central
        // Range, about 3 km a pixel. Zoom in on the crosshair first, and say
        // so; the next press puts the pin down.
        if (h.map.getZoom() < AIM_ZOOM) {
          h.map.easeTo({ center: c, zoom: AIM_ZOOM, duration: 300 });
          setAimHint(true);
          return;
        }
        setAimHint(false);
        placedAtCentre.current = { lat: c.lat, lng: c.lng };
        place.current?.(c.lng, c.lat);
        onChangeRef.current({ lat: c.lat, lng: c.lng });
      };
      const canvas = h.map.getCanvas();
      canvas.setAttribute("aria-describedby", hintId);
      canvas.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        placeAtCentre.current?.();
      });
      setReady(true);
    })();

    return () => {
      cancelled = true;
      handle.current?.destroy();
      handle.current = null;
      marker.current = null;
      place.current = null;
      placeAtCentre.current = null;
      drawAccuracy.current = null;
    };
    // `value` is read through valueRef when the map is ready; later changes are
    // handled by the effect below, which moves the marker instead of rebuilding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maptilerKey]);

  // Keep the pin in sync when the value changes from outside (GPS, EXIF).
  // `place` rather than the marker directly: the first such change is also the
  // first pin, since there is none until a location exists.
  useEffect(() => {
    drawAccuracy.current?.();
    if (!value || !place.current || !handle.current) return;
    place.current(value.lng, value.lat);
    const aimed = placedAtCentre.current;
    placedAtCentre.current = null;
    if (aimed && aimed.lat === value.lat && aimed.lng === value.lng) return;
    frame(handle.current.map, value, accuracyM, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng, accuracyM]);

  const outside = value && !isInTaiwanBounds(value.lng, value.lat);

  return (
    <div>
      {/* An outer wrapper purely to hang the overlays on. It does not go
          inside the container below, whose children belong to MapLibre and
          whose `relative` is answering a different question.
          data-location-picker is for globals.css, which draws the canvas's
          focus ring inside it: the container clips anything outside. */}
      <div className="relative" data-location-picker>
        <div
          ref={container}
          // `relative` is load-bearing, not cosmetic. MapLibre 6 does not add a
          // `.maplibregl-map` class to the container it is given, so the stock
          // `.maplibregl-map { position: relative }` rule matches nothing. The
          // canvas inside is `position: absolute`, so without a positioned
          // ancestor it escapes to the viewport and paints over the header.
          // `peer` is for the keyboard hint below, shown while the canvas
          // inside has keyboard focus.
          className="peer relative h-56 w-full overflow-hidden rounded-lg sm:h-64"
        />
        {/*
          The crosshair: where Enter and the button below put the pin. Drawn,
          never hit: `pointer-events-none`, so a tap on it reaches the map and
          lands exactly where it would have without it, and a finger on the
          pin beneath it still drags the pin. A gap at its middle so the point
          it marks stays visible. Light strokes on a dark halo, to read on the
          dark basemap and on a pale one alike.
        */}
        <svg
          aria-hidden="true"
          viewBox="0 0 32 32"
          className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2"
          fill="none"
          strokeLinecap="round"
          data-crosshair
        >
          <path d="M16 3v9M16 20v9M3 16h9M20 16h9" stroke="#0b1410" strokeWidth="5" />
          <path d="M16 3v9M16 20v9M3 16h9M20 16h9" stroke="#f6efe0" strokeWidth="2" />
        </svg>
        {!value && (
          // Says what to do, over the thing to do it to. `pointer-events-none`
          // so it cannot swallow the tap it is asking for — including the tap
          // that lands underneath it. At the top rather than the middle,
          // where it would hide the crosshair.
          <div className="pointer-events-none absolute inset-0 grid place-items-start justify-center pt-3">
            <span className="rounded-full bg-bark-950 px-3 py-1.5 text-sm font-medium text-parchment-50">
              {t("tapToMark")}
            </span>
          </div>
        )}
        {/* What the keys do, for the canvas's aria-describedby and, while the
            canvas has keyboard focus, on screen. Hidden otherwise: a phone
            has no arrow keys, and this would be one more line to read. */}
        <p
          id={hintId}
          className="pointer-events-none absolute bottom-2 left-2 right-10 hidden rounded-lg bg-bark-950 px-3 py-1.5 text-sm text-parchment-50 peer-has-[canvas:focus-visible]:block"
        >
          {t("pickerKeys")}
        </p>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => placeAtCentre.current?.()}
          disabled={!ready}
          className="inline-flex min-h-11 items-center rounded-full border border-forest-900/30 bg-paper-100 px-4 text-sm font-medium text-forest-900 hover:bg-paper-200 disabled:opacity-60"
        >
          {t("pinAtCentre")}
        </button>
        {/* A status, so a pin put down by keyboard is heard as well as seen:
            the canvas gives a screen reader nothing back. Always rendered,
            so the region exists before its first words do. */}
        {/* ink, not parchment: parchment is the map's palette, and this line
            sits on cream under the picker, where it measured 2.90:1. */}
        <p role="status" className="text-sm tabular-nums text-ink-600">
          {aimHint && !value && t("pinZoomFirst")}
          {value && (
            <>
              {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
              {outside && (
                <span className="ml-2 text-ember-700">⚠ {t("outsideTaiwan")}</span>
              )}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Bring the pin into view: at street zoom, or, for a rough fix, framing the
 * whole circle the device claimed, so its edge is on screen and not a guess.
 */
/**
 * The least zoom at which the centre button puts a pin down: about 10 m a
 * pixel, enough to aim at a stretch of road.
 */
const AIM_ZOOM = 13;

function frame(map: MLMap, at: LatLng, accuracyM: number | null, duration: number) {
  if (isRoughFix(accuracyM)) {
    map.fitBounds(polygonBounds(circlePolygon(at.lng, at.lat, accuracyM / 1000)), {
      padding: 16,
      maxZoom: 14,
      duration,
    });
    return;
  }
  if (duration === 0) map.jumpTo({ center: [at.lng, at.lat], zoom: 14 });
  else map.easeTo({ center: [at.lng, at.lat], zoom: 14, duration });
}

/**
 * Why the browser gave no position.
 *
 * `denied` is its own case because it is the one that asking again cannot
 * fix: once someone has tapped "Don't allow", the browser refuses at once
 * every time, and "try again" sent them round the same loop for ever. What
 * helps is saying where the setting is, which the form does.
 */
export type LocateError = "denied" | "unavailable" | "timeout" | "unsupported";

/** GeolocationPositionError's codes: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT. */
const LOCATE_ERRORS: Record<number, LocateError> = {
  1: "denied",
  2: "unavailable",
  3: "timeout",
};

/**
 * Ask the browser for the current position. Resolves null if unavailable or
 * denied, and `error` then says which.
 */
export function useGeolocate() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LocateError | null>(null);
  const locate = () =>
    new Promise<Fix | null>((resolve) => {
      if (!("geolocation" in navigator)) {
        setError("unsupported");
        return resolve(null);
      }
      setBusy(true);
      setError(null);
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
        (err) => {
          setBusy(false);
          setError(LOCATE_ERRORS[err.code] ?? "unavailable");
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
      );
    });
  return { locate, busy, error };
}
