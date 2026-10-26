"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { MapStrings } from "@/lib/map";

/**
 * MapLibre's own words, in the page's language, for createMap's `strings`.
 *
 * MapLibre names its canvas, its zoom buttons, its attribution toggle and its
 * markers itself, in English, unless it is handed a dictionary. Nobody had
 * handed it one, so on every Chinese page a screen reader heard "Map, region",
 * "Zoom in" and "Map marker". The words live in the catalogues with the rest
 * of the site's (map.maplibre), so the two languages are checked like every
 * other string; this only puts them under the keys MapLibre looks them up by.
 *
 * The scale bar's units are left as MapLibre writes them: m and km are what
 * Taiwan's road signs use too.
 *
 * A hook rather than something createMap reads for itself, because the
 * catalogue reaches the browser through React context and createMap is not a
 * component. Memoised on the translator, which next-intl keeps stable, so a
 * caller can list it among an effect's dependencies without rebuilding its map.
 */
export function useMapStrings(): MapStrings {
  const t = useTranslations("map.maplibre");
  return useMemo(
    () => ({
      "Map.Title": t("map"),
      "Marker.Title": t("marker"),
      "NavigationControl.ZoomIn": t("zoomIn"),
      "NavigationControl.ZoomOut": t("zoomOut"),
      "NavigationControl.ResetBearing": t("resetBearing"),
      "AttributionControl.ToggleAttribution": t("toggleAttribution"),
      "AttributionControl.MapFeedback": t("mapFeedback"),
      "Popup.Close": t("popupClose"),
      "FullscreenControl.Enter": t("fullscreenEnter"),
      "FullscreenControl.Exit": t("fullscreenExit"),
      "GeolocateControl.FindMyLocation": t("findMyLocation"),
      "GeolocateControl.LocationNotAvailable": t("locationNotAvailable"),
      "CooperativeGesturesHandler.WindowsHelpText": t("gesturesWindows"),
      "CooperativeGesturesHandler.MacHelpText": t("gesturesMac"),
      "CooperativeGesturesHandler.MobileHelpText": t("gesturesMobile"),
    }),
    [t],
  );
}
