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
import { outcomeOf } from "@/lib/report/outcome";
import { Link } from "@/i18n/navigation";
import LocationPicker, { useGeolocate, type LatLng } from "./LocationPicker";

type Photo = PreparedPhoto & { previewUrl: string; id: string };
type Phase = "editing" | "submitting" | "done" | "queued" | "error";

type ReportFormProps = {
  maptilerKey?: string;
  /**
   * Preselected from the front page's category doors, so that choosing one there
   * and arriving here is a single act rather than the same question twice.
   * Validated against CATEGORY_KEYS by the page, never trusted raw.
   */
  initialCategory?: Category;
};

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * A keyed host, so that "report another" is a new form rather than a cleared one.
 *
 * Clearing the fields in place would keep the bits that are not fields: the
 * submission nonce, which the API's duplicate check keys on — a second report
 * filed under the first one's nonce is answered with the first one's id and
 * never stored — and the solved Turnstile token, which is single-use. Bumping
 * the key throws both away with the rest of the state, which is what starting
 * again actually means.
 */
export default function ReportForm(props: ReportFormProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <ReportFormFields
      key={attempt}
      {...props}
      onReportAnother={() => setAttempt((n) => n + 1)}
    />
  );
}

function ReportFormFields({
  maptilerKey,
  initialCategory,
  onReportAnother,
}: ReportFormProps & {
  /** Discard this form and mount a fresh one. See ReportForm above. */
  onReportAnother: () => void;
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
  /**
   * The server's whole answer, not just the id.
   *
   * `status` used to be dropped on the floor and the card said "已發布至地圖" to
   * everyone. Most reports are `pending` — anything the classifier would have to
   * look at arrives without a photo far more often than not — so most reporters
   * were told their report was on the map when it was not. `photoCount` is taken
   * here rather than read from `photos` at render time because it is part of the
   * answer being explained, and the photo list is state the reporter can still
   * change afterwards.
   */
  const [result, setResult] = useState<{
    id: string;
    status: string;
    awaitingIdentification: boolean;
    photoCount: number;
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
        status: data.status,
        awaitingIdentification: data.awaitingIdentification,
        photoCount: photos.length,
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

  /**
   * What reporting a hurt animal here does, and does not, set in motion.
   *
   * Nothing on this page said it. Someone who picks 還活著，但受傷 is by
   * definition standing next to a suffering animal, and the form's silence
   * reads as a dispatch: they submit, they wait, and nobody comes, because
   * nobody was ever going to. Saying so is not a nicety — it is the difference
   * between an animal that gets help from somewhere else and one that does not.
   *
   * SEAM — THE REFERRAL SENTENCE GOES HERE. What this cannot yet say is who to
   * call instead, because the owner has not supplied a channel: which agency,
   * which number, which hours, and whether it differs by county. That is
   * decision 1 in docs/redesign/briefs/W0a.md and it is the only thing missing.
   * When the answer arrives, add `report.referral` to both catalogues and a
   * second <p> below this one; nothing else here has to change. Inventing a
   * hotline in the meantime would be worse than the silence this replaces —
   * a wrong number costs an hour that the animal does not have.
   */
  const noDispatchNote = () => (
    <p
      role="note"
      className="border-l-4 border-ink-600 pl-3 text-sm leading-relaxed text-ink-700"
    >
      {t("noDispatch")}
    </p>
  );

  // A function, not a value: the editing phase renders neither card, and
  // resolving a message it will not show is work done on every keystroke.
  const another = () => (
    <button
      type="button"
      onClick={onReportAnother}
      className="inline-flex min-h-6 items-center text-xs text-ink-600 underline decoration-ink-900/25 underline-offset-2 hover:text-ink-900"
    >
      {t("receipt.another")}
    </button>
  );

  if (phase === "queued") {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-600/10 p-5">
        <h2 className="text-base font-semibold text-amber-800">
          {tOffline("queuedTitle")}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-amber-800/80">
          {tOffline("queuedBody")}
        </p>
        {/* Repeated on the cards, not only beside the choice. A queued report
            is the case where waiting for a response is most plausible and
            least warranted: it has not even left the phone yet. */}
        {category === "injured" && <div className="mt-3">{noDispatchNote()}</div>}
        <div className="mt-4">{another()}</div>
      </div>
    );
  }

  if (phase === "done" && result) {
    // What the server actually said, rather than a congratulation that fits one
    // of the two cases. See lib/report/outcome.ts.
    const outcome = outcomeOf(
      result.status,
      result.awaitingIdentification,
      result.photoCount,
    );
    return (
      <div className="rounded-xl border border-ember-500/30 bg-ember-500/10 p-5">
        <h2 className="text-base font-semibold text-ember-700">
          {t(`receipt.${outcome.title}`)}
        </h2>
        {outcome.body && (
          <p className="mt-2 text-sm leading-relaxed text-ink-700">
            {t(`receipt.${outcome.body}`)}
          </p>
        )}
        {category === "injured" && <div className="mt-3">{noDispatchNote()}</div>}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          {/*
            Offered only where there is something to open. The old card always
            linked to /reports/{id}, and that page reads `reports_public`, which
            by design excludes every pending report — so the majority of
            reporters were handed a link to a 404 as their receipt. `Link` from
            @/i18n/navigation, not a bare <a>, or an English reader is bounced
            out of /en and back into Chinese.
          */}
          {outcome.link && (
            <Link
              href={`/reports/${result.id}`}
              className="inline-flex min-h-6 items-center text-xs text-ember-700 underline underline-offset-2"
            >
              {t(`receipt.${outcome.link}`)}
            </Link>
          )}
          {another()}
        </div>
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
            {category === "injured" && (
              <div className="mt-3">{noDispatchNote()}</div>
            )}
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
            <span className="ml-1.5 tabular-nums text-ink-500">
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

          Its own group, rather than two children of `space-y-6` with a negative
          margin pulling them together. `-mb-1` did not merely tighten the gap:
          it cancelled the parent's spacing outright, and at 390px the button's
          box rose into the sentence explaining why the button was disabled. The
          group owns the relationship, and `aria-describedby` states it to a
          screen reader, which previously heard a disabled button and no reason.
      */}
      <div className="space-y-2">
        {blocker && (
          <p id="submit-blocker" className="text-center text-xs text-ink-500">
            {blocker}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          aria-describedby={blocker ? "submit-blocker" : undefined}
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
    </div>
  );
}
