"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import exifr from "exifr";
import { preparePhoto } from "@/lib/image";
import { loadMapLibre } from "@/lib/map";
import { useGeolocate } from "@/components/report/LocationPicker";
import type { Condition, SpeciesAnswer } from "@conservation/shared";
import {
  EMPTY_FLOW,
  type FlowState,
  type LatLng,
  type Photo,
  type Place,
} from "@/lib/lab/reportFlow";

/** No more than four photos per report, as the live form already allows. */
const MAX_PHOTOS = 4;

/**
 * Everything both proofs do, so that the only difference between them is the
 * shape of the screen.
 *
 * The parts that are real are real: `preparePhoto` is the live pipeline, which
 * reads EXIF GPS before destroying it and hands back a downscaled WebP, so the
 * photo on screen is the photo that would be uploaded and the "use the photo's
 * place" offer is a genuine coordinate. `useGeolocate` is the live hook. The
 * species search hits the live endpoint. What is NOT real is the ending: no
 * request is ever made to /api/reports, because the question the owner is
 * answering is about the shape of the flow and a prototype that writes rows is
 * a prototype that has to be cleaned up afterwards.
 */
export type PhotoError = "unreadable" | "limit" | null;
export type PlaceError = "denied" | null;

/**
 * EXIF capture time, so the send screen can say 今天 07:32（照片時間）rather
 * than stamping the moment the form was filled in.
 *
 * Clamped to a plausible window. A camera with a flat clock battery reports
 * 1980, and a record dated before the project existed is worse than one dated
 * now, because it silently lands outside every year filter on the map.
 */
async function readTakenAt(file: File): Promise<number | null> {
  try {
    const parsed = (await exifr.parse(file, ["DateTimeOriginal"])) as
      | { DateTimeOriginal?: unknown }
      | undefined;
    const taken = parsed?.DateTimeOriginal;
    if (!(taken instanceof Date)) return null;
    const at = taken.getTime();
    if (!Number.isFinite(at)) return null;
    if (at < Date.UTC(1990, 0, 1) || at > Date.now() + 86_400_000) return null;
    return at;
  } catch {
    // No EXIF, or a container exifr cannot read. Not worth telling anyone: the
    // photo is fine and the time simply falls back to now.
    return null;
  }
}

export function useReportFlow() {
  const [state, setState] = useState<FlowState>(EMPTY_FLOW);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<PhotoError>(null);
  const [placeError, setPlaceError] = useState<PlaceError>(null);
  const { locate, busy: locating } = useGeolocate();

  // Object URLs outlive React state, so they are revoked from one place: when a
  // photo is removed, and when the flow leaves the screen. A leaked blob URL
  // pins the decoded bitmap in memory, which on the phones this is for is the
  // difference between four photos and a reload.
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const live = urls.current;
    return () => {
      for (const url of live) URL.revokeObjectURL(url);
      live.clear();
    };
  }, []);

  /**
   * Start fetching MapLibre the moment a photo control is touched.
   *
   * The place step is next and it is the only screen with a map on it, so the
   * module has the length of a camera roll or a shutter press to arrive. It is
   * the same `loadMapLibre()` the live map uses, so this warms the runtime cache
   * rather than adding a request type.
   */
  const warmMap = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    void loadMapLibre().catch(() => {
      /* the picker's own failure path says so on screen */
    });
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const chosen = Array.from(files);
    if (chosen.length === 0) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      for (const file of chosen) {
        let full = false;
        setState((prev) => {
          full = prev.photos.length >= MAX_PHOTOS;
          return prev;
        });
        if (full) {
          setPhotoError("limit");
          break;
        }
        try {
          const [prepared, takenAt] = await Promise.all([
            preparePhoto(file),
            readTakenAt(file),
          ]);
          const url = URL.createObjectURL(prepared.blob);
          urls.current.add(url);
          const photo: Photo = {
            id: `${Date.now()}-${urls.current.size}`,
            url,
            width: prepared.width,
            height: prepared.height,
            gps: prepared.gps,
            takenAt,
          };
          setState((prev) =>
            prev.photos.length >= MAX_PHOTOS
              ? prev
              : { ...prev, photos: [...prev.photos, photo] },
          );
        } catch {
          setPhotoError("unreadable");
        }
      }
    } finally {
      setPhotoBusy(false);
    }
  }, []);

  const removePhoto = useCallback((id: string) => {
    setState((prev) => {
      const going = prev.photos.find((photo) => photo.id === id);
      if (going) {
        URL.revokeObjectURL(going.url);
        urls.current.delete(going.url);
      }
      return { ...prev, photos: prev.photos.filter((photo) => photo.id !== id) };
    });
  }, []);

  const setPlace = useCallback((place: Place | null) => {
    setPlaceError(null);
    setState((prev) => ({ ...prev, place }));
  }, []);

  /**
   * A device fix, and the only place in the flow that sets a location without
   * being told to. Never silently: the reporter pressed the row.
   *
   * Returns the place it set, so the caller can decide whether the fix is good
   * enough to advance on without re-reading state that has not landed yet.
   * `null` means the browser refused or timed out, and the answer to that is
   * the map, not an error the reporter can do anything about.
   */
  const useCurrentPlace = useCallback(async (): Promise<Place | null> => {
    const fix = await locate();
    if (!fix) {
      setPlaceError("denied");
      return null;
    }
    const place: Place = {
      lat: fix.lat,
      lng: fix.lng,
      accuracyM: fix.accuracyM,
      source: "device",
    };
    setPlaceError(null);
    setState((prev) => ({ ...prev, place }));
    return place;
  }, [locate]);

  const usePhotoPlace = useCallback((gps: LatLng) => {
    setPlaceError(null);
    setState((prev) => ({
      ...prev,
      place: { ...gps, accuracyM: null, source: "photo" },
    }));
  }, []);

  const setCondition = useCallback((condition: Condition) => {
    setState((prev) =>
      prev.condition === condition
        ? prev
        : // Changing the answer un-acknowledges the notice, because the notice
          // belongs to "hurt" and a reporter who never saw it has not read it.
          { ...prev, condition, injuredAck: false },
    );
  }, []);

  const ackInjured = useCallback(
    () => setState((prev) => ({ ...prev, injuredAck: true })),
    [],
  );

  const setSpecies = useCallback(
    (species: SpeciesAnswer | null) =>
      setState((prev) => ({ ...prev, species })),
    [],
  );

  const setNote = useCallback(
    (note: string) => setState((prev) => ({ ...prev, note })),
    [],
  );

  const setEmail = useCallback(
    (email: string) => setState((prev) => ({ ...prev, email })),
    [],
  );

  /**
   * Start again. `keepPlace` is 同地點再一筆 — the case where somebody is
   * standing at one stretch of road with three casualties on it, which is the
   * single most common reason a reporter files twice in a row.
   */
  const reset = useCallback((keepPlace = false) => {
    setPhotoError(null);
    setPlaceError(null);
    setState((prev) => {
      for (const photo of prev.photos) {
        URL.revokeObjectURL(photo.url);
        urls.current.delete(photo.url);
      }
      return keepPlace ? { ...EMPTY_FLOW, place: prev.place } : EMPTY_FLOW;
    });
  }, []);

  return {
    state,
    photoBusy,
    photoError,
    placeError,
    locating,
    warmMap,
    addFiles,
    removePhoto,
    setPlace,
    useCurrentPlace,
    usePhotoPlace,
    setCondition,
    ackInjured,
    setSpecies,
    setNote,
    setEmail,
    reset,
  };
}

export type ReportFlow = ReturnType<typeof useReportFlow>;
