"use client";

import { useCallback, useRef, useState } from "react";
import Turnstile, { turnstileEnabled } from "./Turnstile";
import { withBase } from "@/lib/basePath";
import SpeciesPicker, { type SpeciesHit } from "./SpeciesPicker";
import { useTranslations, useLocale } from "next-intl";
import {
  CATEGORIES,
  REPORT_GROUPS,
  REPORT_GROUP_KEYS,
  groupOf,
  MAX_PHOTOS,
  MAX_NOTES,
  type Category,
} from "@conservation/shared";
import { preparePhoto, type PreparedPhoto } from "@/lib/image";
import { browserSupabase, PHOTO_BUCKET } from "@/lib/supabase/client";
import { enqueue } from "@/lib/offline/queue";
import LocationPicker, { useGeolocate, type LatLng } from "./LocationPicker";

type Photo = PreparedPhoto & { previewUrl: string; id: string };
type Phase = "editing" | "submitting" | "done" | "queued" | "error";

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ReportForm({
  maptilerKey,
  initialCategory,
}: {
  maptilerKey?: string;
  /**
   * Preselected from the front page's category doors, so that choosing one there
   * and arriving here is a single act rather than the same question twice.
   * Validated against CATEGORY_KEYS by the page, never trusted raw.
   */
  initialCategory?: Category;
}) {
  const t = useTranslations("report");
  const locale = useLocale();
  const tOffline = useTranslations("offline");
  const [category, setCategory] = useState<Category>(
    initialCategory ?? "roadkill",
  );
  // Derived, never stored: the group is a view of the category, so the two can
  // never disagree — including when ?category=injured arrives from a link.
  const group = groupOf(category);
  // What the reporter says it is. `unsure` is a judgement, not an empty field:
  // it separates "nobody could name this" from "nobody has looked yet".
  const [species, setSpecies] = useState<SpeciesHit | null>(null);
  const [unsure, setUnsure] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [location, setLocation] = useState<LatLng | null>(null);
  /**
   * The radius the device claimed, in metres, and only when the device set the
   * coordinate. A pin the reporter dragged, or one read out of a photo's EXIF,
   * has no accuracy to report — so every other way of setting the location
   * clears this rather than leaving a stale number attached to a new point.
   */
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [observedAt, setObservedAt] = useState(toLocalInput(new Date()));
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("editing");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    awaitingIdentification: boolean;
  } | null>(null);
  const [exifOffer, setExifOffer] = useState<LatLng | null>(null);
  const [preparing, setPreparing] = useState(false);
  // null until the challenge is solved. Only meaningful when a site key is
  // configured; without one no widget renders and the server does not ask.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  // Generated once per form instance so a double-tap cannot create two reports.
  // When a submission is queued this same value becomes the queue item's id, so
  // every later retry reuses it and the server's duplicate check holds.
  const nonce = useRef<string>(crypto.randomUUID());
  const { locate, busy: locating } = useGeolocate();

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setPreparing(true);
      setError(null);
      try {
        const room = MAX_PHOTOS - photos.length;
        const picked = Array.from(files).slice(0, room);
        const prepared = await Promise.all(picked.map(preparePhoto));

        setPhotos((prev) => [
          ...prev,
          ...prepared.map((p) => ({
            ...p,
            id: crypto.randomUUID(),
            previewUrl: URL.createObjectURL(p.blob),
          })),
        ]);

        // Offer the photo's own GPS rather than applying it: the picture may have
        // been taken somewhere other than where it is being reported.
        const withGps = prepared.find((p) => p.gps);
        if (withGps?.gps && !location) setExifOffer(withGps.gps);
      } catch (e) {
        setError(`${t("photoFailed")}: ${(e as Error).message}`);
      } finally {
        setPreparing(false);
      }
    },
    [photos.length, location, t],
  );

  async function submit() {
    setError(null);
    if (!location) return setError(t("needLocation"));

    setPhase("submitting");
    try {
      let paths: string[] = [];

      if (photos.length) {
        const signRes = await fetch(withBase("/api/uploads/sign"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ count: photos.length }),
        });
        if (!signRes.ok)
          throw new Error(`upload signing failed (${signRes.status})`);
        const { uploads } = (await signRes.json()) as {
          uploads: { path: string; token: string }[];
        };

        const storage = browserSupabase().storage.from(PHOTO_BUCKET);
        await Promise.all(
          uploads.map((u, i) =>
            storage.uploadToSignedUrl(u.path, u.token, photos[i].blob),
          ),
        );
        paths = uploads.map((u) => u.path);
      }

      const res = await fetch(withBase("/api/reports"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          lng: location.lng,
          lat: location.lat,
          accuracyM: accuracyM ?? undefined,
          observedAt: new Date(observedAt).toISOString(),
          taxonId: species?.id,
          taxonUnknown: unsure || undefined,
          notes: notes.trim() || undefined,
          contactEmail: email.trim() || undefined,
          photoPaths: paths,
          clientNonce: nonce.current,
          turnstileToken: turnstileToken ?? undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error ?? `submission failed (${res.status})`);

      setResult({
        id: data.id,
        awaitingIdentification: data.awaitingIdentification,
      });
      setPhase("done");
    } catch (e) {
      // Network failure (or an outright offline browser) means the report is not
      // lost — it goes to the queue and is sent when connectivity returns. Any
      // other failure is a real rejection and should be shown as one.
      const offline =
        typeof navigator !== "undefined" && navigator.onLine === false;
      const networkish = offline || e instanceof TypeError;

      if (networkish) {
        try {
          await enqueue({
            id: nonce.current,
            payload: {
              category,
              lng: location!.lng,
              lat: location!.lat,
              accuracyM: accuracyM ?? undefined,
              observedAt: new Date(observedAt).toISOString(),
              taxonId: species?.id,
              taxonUnknown: unsure || undefined,
              notes: notes.trim() || undefined,
              contactEmail: email.trim() || undefined,
            },
            photos: photos.map((p) => p.blob),
          });
          window.dispatchEvent(new Event("conservation:queue-changed"));
          setPhase("queued");
          return;
        } catch (queueErr) {
          setError(`${t("queueFailed")}: ${(queueErr as Error).message}`);
          setPhase("error");
          return;
        }
      }

      setError((e as Error).message);
      setPhase("error");
    }
  }

  if (phase === "queued") {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-600/10 p-5">
        <h2 className="text-base font-semibold text-amber-800">
          {tOffline("queuedTitle")}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-amber-800/80">
          {tOffline("queuedBody")}
        </p>
      </div>
    );
  }

  if (phase === "done" && result) {
    return (
      <div className="rounded-xl border border-ember-500/30 bg-ember-500/10 p-5">
        <h2 className="text-base font-semibold text-ember-700">
          {t("thanks")}
        </h2>
        <p className="mt-1 text-sm text-ink-600">{t("received")}</p>
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          {result.awaitingIdentification ? t("identifying") : t("published")}
        </p>
        <a
          href={`/reports/${result.id}`}
          className="mt-4 inline-block text-xs text-ember-700 underline"
        >
          {t("viewReport")}
        </a>
      </div>
    );
  }

  const heldForReview =
    CATEGORIES[category].classifiable && photos.length === 0;

  // The first unmet requirement, in the order someone meets them.
  const blocker = preparing
    ? t("preparingPhotos")
    : !location
      ? t("needLocation")
      : turnstileEnabled && !turnstileToken
        ? t("needChallenge")
        : null;

  return (
    <div className="space-y-6">
      {/* Category */}
      {/*
        Three choices, not four. The team's list asks for invasive species,
        wildlife sighting, and roadkill-or-injured; the last covers two stored
        categories because an injured animal needs a response and a dead one
        does not, so the distinction survives as a sub-choice rather than as a
        fourth button competing with the other three.
      */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-ink-700">{t("type")}</h2>
        <div className="flex flex-wrap gap-1.5">
          {REPORT_GROUP_KEYS.map((g) => {
            const first = REPORT_GROUPS[g].categories[0];
            return (
              <button
                key={g}
                type="button"
                // Which one is chosen was conveyed by fill colour alone, so a
                // screen reader announced identical buttons and no state.
                aria-pressed={group === g}
                onClick={() => setCategory(first)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition ${
                  group === g
                    ? "border-ink-900 bg-ink-900 text-paper-50"
                    : "border-ink-900/12 bg-paper-100/70 text-ink-600 hover:bg-paper-200"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: CATEGORIES[first].color }}
                />
                {t(`group.${g}`)}
              </button>
            );
          })}
        </div>

        {REPORT_GROUPS[group].categories.length > 1 && (
          <div className="mt-3">
            <h3 className="mb-1.5 text-xs font-medium text-ink-600">
              {t("conditionLabel")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {REPORT_GROUPS[group].categories.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={category === k}
                  onClick={() => setCategory(k)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    category === k
                      ? "border-ink-900/70 bg-paper-200 font-medium text-ink-900"
                      : "border-ink-900/12 bg-paper-100/70 text-ink-600 hover:bg-paper-200"
                  }`}
                >
                  {t(`condition.${k}`)}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <SpeciesPicker
        group={group}
        value={species}
        onChange={setSpecies}
        unsure={unsure}
        onUnsure={setUnsure}
      />

      {/* Photos */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-ink-700">
          {t("photos")}{" "}
          <span className="font-normal text-ink-500">
            ({photos.length}/{MAX_PHOTOS})
          </span>
        </h2>

        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.previewUrl}
                alt=""
                className="h-20 w-20 rounded-lg object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(p.previewUrl);
                  setPhotos((prev) => prev.filter((x) => x.id !== p.id));
                }}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-paper-200 text-xs text-ink-700 ring-1 ring-white/20"
                aria-label={t("removePhoto")}
              >
                ×
              </button>
            </div>
          ))}

          {photos.length < MAX_PHOTOS && (
            // focus-within is what makes this reachable by keyboard: the input
            // itself is `hidden`, so focusing it shows nothing at all, and the
            // only visible affordance is this label. Tabbing to the photo picker
            // used to give no indication whatsoever.
            <label className="grid h-20 w-20 cursor-pointer place-items-center rounded-lg border border-dashed border-ink-900/20 text-2xl text-ink-500 hover:border-ink-900/30 hover:text-ink-600 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ember-400">
              +
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                // sr-only, not hidden. `hidden` is display:none, and a
                // display:none input is not focusable at all — the photo picker
                // could not be reached by keyboard, and the focus-within ring on
                // the label above could never fire because nothing inside it was
                // ever focused. sr-only keeps it invisible but in the tab order.
                className="sr-only"
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
          {preparing ? t("photoProcessing") : t("photoHelp")}
        </p>

        {heldForReview && (
          <p className="mt-2 text-[11px] text-amber-700">
            {t("noPhotoWarning")}
          </p>
        )}
      </section>

      {/* Location */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-700">{t("location")}</h2>
          <button
            type="button"
            onClick={async () => {
              const p = await locate();
              if (p) {
                setLocation({ lat: p.lat, lng: p.lng });
                setAccuracyM(p.accuracyM);
                setExifOffer(null);
              } else {
                setError(t("tapToAdjust"));
              }
            }}
            className="rounded-full border border-ink-900/12 bg-paper-100/70 px-3 py-1.5 text-xs text-ink-600 hover:bg-paper-200"
          >
            {locating ? t("locating") : t("useMyLocation")}
          </button>
        </div>

        {exifOffer && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-200">
            <span>{t("exifOffer")}</span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                className="rounded bg-sky-400/20 px-2 py-1 font-medium"
                onClick={() => {
                  setLocation(exifOffer);
                  setAccuracyM(null);
                  setExifOffer(null);
                }}
              >
                {t("exifUse")}
              </button>
              <button
                type="button"
                className="px-1 text-sky-300/70"
                onClick={() => setExifOffer(null)}
              >
                {t("exifSkip")}
              </button>
            </span>
          </div>
        )}

        <LocationPicker
          value={location}
          onChange={(v) => {
            setLocation(v);
            setAccuracyM(null);
          }}
          maptilerKey={maptilerKey}
        />
        <p className="mt-1.5 text-[11px] text-ink-500">
          {t("tapToAdjust")}
          {accuracyM != null && (
            <span className="ml-1.5 tabular-nums text-ink-400">
              · {t("accuracy", { m: accuracyM })}
            </span>
          )}
        </p>
      </section>

      {/* Details */}
      <section className="space-y-3">
        <div>
          <label
            htmlFor="observedAt"
            className="mb-1 block text-sm font-medium text-ink-700"
          >
            {t("observedAt")}
          </label>
          <input
            id="observedAt"
            type="datetime-local"
            value={observedAt}
            max={toLocalInput(new Date())}
            onChange={(e) => setObservedAt(e.target.value)}
            className="w-full rounded-lg border border-ink-900/12 bg-paper-100/70 px-3 py-2 text-sm text-ink-800"
          />
        </div>

        <div>
          <label
            htmlFor="notes"
            className="mb-1 block text-sm font-medium text-ink-700"
          >
            {t("notes")}{" "}
            <span className="font-normal text-ink-500">({t("optional")})</span>
          </label>
          <textarea
            id="notes"
            rows={3}
            maxLength={MAX_NOTES}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-ink-900/12 bg-paper-100/70 px-3 py-2 text-sm text-ink-800"
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="mb-1 block text-sm font-medium text-ink-700"
          >
            {t("email")}{" "}
            <span className="font-normal text-ink-500">({t("optional")})</span>
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-ink-900/12 bg-paper-100/70 px-3 py-2 text-sm text-ink-800"
          />
          <p className="mt-1 text-[11px] text-ink-500">{t("emailHelp")}</p>
        </div>
      </section>

      {error && (
        <p className="rounded-lg border border-rose-700/30 bg-rose-600/10 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}

      {/* Directly above the button it gates, so it reads as part of submitting
          rather than as an unexplained box. Renders nothing without a site key. */}
      <Turnstile onToken={setTurnstileToken} locale={locale} />

      {/*
          Say what is missing, rather than leaving a dead button.

          The picker drops a pin on Taiwan's centre before anything is chosen, so
          the form looks complete while `location` is still null — the button
          greys out and nothing on screen explains why. That is a dead end on the
          one page whose entire job is collecting a report.
      */}
      {blocker && (
        <p className="-mb-1 text-center text-xs text-ink-500">{blocker}</p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={
          phase === "submitting" ||
          preparing ||
          !location ||
          (turnstileEnabled && !turnstileToken)
        }
        className="w-full rounded-xl bg-ember-500 px-4 py-3 text-sm font-semibold text-bark-950 transition disabled:cursor-not-allowed disabled:bg-paper-200 disabled:text-ink-600"
      >
        {phase === "submitting" ? t("submitting") : t("submit")}
      </button>
    </div>
  );
}
