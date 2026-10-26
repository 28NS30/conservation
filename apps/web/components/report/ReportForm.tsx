"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Turnstile, { turnstileEnabled } from "./Turnstile";
import { withBase } from "@/lib/basePath";
import SpeciesPicker, { type SpeciesHit } from "./SpeciesPicker";
import { useTranslations, useLocale } from "next-intl";
import {
  CATEGORIES,
  REPORT_PAGES,
  MAX_PHOTOS,
  MAX_NOTES,
  CONSENT_VERSION,
  PARTNER_SHARING_PAGES,
  type Category,
  type ContributorLicense,
  type ReportPage,
} from "@conservation/shared";
import { preparePhoto, type PreparedPhoto } from "@/lib/image";
import { storedSessionUserId } from "@/lib/supabase/storedSession";
import { uploadPhoto } from "@/lib/report/upload";
import { fitForUpload } from "@/lib/report/photoEncoding";
import { checkFields, observedInstant, sendableAccuracy } from "@/lib/report/fieldChecks";
import { notesConcerns } from "@/lib/report/notesCheck";
import { enqueue } from "@/lib/offline/queue";
import { isBlocked } from "@/lib/offline/db";
import { recordSent } from "@/lib/offline/sent";
import {
  loadDraftFields,
  saveDraftFields,
  dropDraftFields,
  loadDraftPhotos,
  saveDraftPhotos,
  dropDraftPhotos,
  purgeDraftPhotos,
} from "@/lib/offline/drafts";
import { guardLeaving } from "@/lib/report/leaveGuard";
import { speciesLabel } from "@/lib/speciesNames";
import { useOnline } from "@/lib/offline/online";
import { outcomeOf } from "@/lib/report/outcome";
import { awaitingVerification } from "@/lib/report/verification";
import {
  sendControls,
  SEND_PATIENCE_MS,
  TOKEN_PATIENCE_MS,
} from "@/lib/report/sendState";
import {
  ReportError,
  describeFailure,
  PHOTO_UNREADABLE,
  isNetworkFailure,
  type ErrorKey,
  type ErrorSlot,
} from "@/lib/report/errors";
import { Link } from "@/i18n/navigation";
import LocationPicker, { useGeolocate, type LatLng } from "./LocationPicker";
import PhotoSuggestions, { type PhotoSuggestionsState } from "./PhotoSuggestions";
import type { PhotoIdentification } from "@/lib/report/photoSuggestion";

type Photo = PreparedPhoto & { previewUrl: string; id: string };
type Phase = "editing" | "submitting" | "done" | "queued" | "error";

/**
 * What the form keeps of itself while it is being filled in, in this tab's
 * sessionStorage (lib/offline/drafts.ts). The photographs are kept apart,
 * in IndexedDB, under `nonce`.
 */
type DraftFields = {
  nonce: string;
  category: Category | null;
  species: SpeciesHit | null;
  speciesFromPhoto: boolean;
  unsure: boolean;
  location: LatLng | null;
  accuracyM: number | null;
  locationFromPhoto: boolean;
  observedAt: string;
  timeEdited: boolean;
  timeFromPhoto: boolean;
  notes: string;
  email: string;
  /** The model's suggestions, so a restored photo is not asked about twice. */
  photoIdea: PhotoSuggestionsState | null;
};

/**
 * How long an identification waits for its challenge. Long enough for a
 * reporter to tick a box if Cloudflare asks for one; after it the form says
 * the model is unavailable, and that is all.
 */
const IDENTIFY_TOKEN_WAIT_MS = 30_000;

/** Where 路殺社 takes reports. A link only: nothing is sent there for anyone. */
const TAIRON_URL = "https://roadkill.tw";

type ReportFormProps = {
  /**
   * Which of the three report pages this is. It decides the stored category —
   * outright on the invasive and wildlife pages, by the one question the
   * roadkill page asks — and which species the picker offers. The server holds
   * the submission to the same page, so the two cannot disagree.
   */
  page: ReportPage;
  maptilerKey?: string;
  /**
   * Preselected from a species page's "report this species" link, so that
   * naming the animal and starting the report are one act. Looked up in the
   * database by the page, and only for a species this page offers, so an
   * unknown, retired or out-of-scope ?taxonId= arrives here as undefined
   * rather than as a name the server would refuse.
   *
   * The only thing ever preselected, and only because the reporter chose it
   * on the page they came from.
   */
  initialSpecies?: SpeciesHit;
  /**
   * A moderator trying the whole path (`?test=1`, linked from /admin). The
   * report is sent as a test, which the server accepts from moderators only
   * and never shows publicly (migration 0018). Said at the top of the form,
   * so nobody files a real sighting by mistake from a test link.
   */
  test?: boolean;
};

/**
 * The category a page files before anything is answered: its only one, or
 * nothing at all when the page has a question to ask.
 *
 * The roadkill page asks dead or hurt, and there is no default. There used to
 * be — the form opened on "roadkill, dead" — and a default on condition is how
 * a live sighting from the header's report button, or an injured animal whose
 * reporter did not notice the second choice, was stored as a dead one.
 */
function initialCategoryFor(page: ReportPage): Category | null {
  const categories: readonly Category[] = REPORT_PAGES[page].categories;
  return categories.length === 1 ? categories[0] : null;
}

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
 *
 * The props survive, which is the point of passing them through: someone who
 * arrived from a species page is starting their second report of the same
 * animal, on the same page, and asking again would be the duplication the
 * link exists to remove.
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
  page,
  maptilerKey,
  initialSpecies,
  test = false,
  onReportAnother,
}: ReportFormProps & {
  /** Discard this form and mount a fresh one. See ReportForm above. */
  onReportAnother: () => void;
}) {
  const t = useTranslations("report");
  const locale = useLocale();
  const tOffline = useTranslations("offline");
  const online = useOnline();
  const [category, setCategory] = useState<Category | null>(() =>
    initialCategoryFor(page),
  );
  const conditions: readonly Category[] = REPORT_PAGES[page].categories;
  const asksCondition = conditions.length > 1;
  // What the reporter says it is. `unsure` is a judgement, not an empty field:
  // it separates "nobody could name this" from "nobody has looked yet".
  const [species, setSpecies] = useState<SpeciesHit | null>(
    initialSpecies ?? null,
  );
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
  /**
   * Whether the time on screen came from the photograph rather than from the
   * clock, so the field can say so. Tracked separately from `timeEdited`
   * because a reporter who types a time and then adds a second photo has
   * answered this question already.
   */
  const [timeFromPhoto, setTimeFromPhoto] = useState(false);
  /**
   * The latest time the field offers, from this device's clock and only once
   * it is running here. Rendered on the server it was the server's clock, in
   * UTC, and hydration does not patch an attribute: the field opened eight
   * hours "in the future" and invalid, and a copy kept for offline use could
   * be days old.
   */
  const [maxTime, setMaxTime] = useState<string | undefined>(undefined);
  /**
   * The pinned send bar, measured so that a field scrolled into view lands
   * above it (globals.css). Offline it holds three lines and runs to about
   * 180 px, and a fixed 7rem left the focused field, 使用目前位置 included,
   * underneath it.
   */
  const sendBar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = sendBar.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const measure = () =>
      root.style.setProperty("--send-bar-height", `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    measure();
    return () => {
      observer.disconnect();
      root.style.removeProperty("--send-bar-height");
    };
  }, []);
  useEffect(() => {
    const tick = () => setMaxTime(toLocalInput(new Date()));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
  const [timeEdited, setTimeEdited] = useState(false);
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState("");
  // The contributor terms (/terms), answered on every report. Every report is
  // open data under CC0: the team asked for no credit and no choice, "just let
  // everyone use everyone's data openly" (30 September 2026). The partner box
  // starts unticked, because sharing an exact location is a separate decision
  // (PDPA Art. 7).
  const license: ContributorLicense = "cc0-1.0";
  const [sharePartners, setSharePartners] = useState(false);
  const asksPartners = PARTNER_SHARING_PAGES.includes(page);
  const [phase, setPhase] = useState<Phase>("editing");
  /**
   * What failed, as a sentence to look up and a place to put it.
   *
   * Never a string: every path into this state used to carry either a
   * snake_case code from the API or an English sentence built in the client,
   * and both were rendered verbatim to a Taiwanese reporter. The codes still
   * exist — `console.error` gets them — but nothing reaches the screen that was
   * not written for a person.
   */
  const [error, setError] = useState<{ key: ErrorKey; slot: ErrorSlot } | null>(
    null,
  );

  /** Show a failure where the reporter can do something about it. */
  const fail = useCallback((code: string | undefined, detail?: unknown) => {
    // The identifier, once, for whoever reads a bug report. Not for the screen.
    console.error("[report] submission failed:", code, detail ?? "");
    setError(describeFailure(code));
  }, []);

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
    /** Whether the row reached `reports_public`; see lib/report/outcome.ts. */
    visible: boolean;
    /** A moderator's test, never shown publicly. */
    test: boolean;
    photoCount: number;
  } | null>(null);
  const [exifOffer, setExifOffer] = useState<LatLng | null>(null);
  /**
   * What the model thinks the first photo shows, asked as soon as it is added
   * (team feedback, 30 September 2026), and whether the species on the form
   * was chosen from those suggestions. That second thing goes with the report:
   * a species named from a photograph is blurred at least as hard as every row
   * sharing its binomial, as when the model names it (app/api/reports).
   */
  const [photoIdea, setPhotoIdea] = useState<PhotoSuggestionsState>({ status: "idle" });
  const [speciesFromPhoto, setSpeciesFromPhoto] = useState(false);
  const photoAsked = useRef(false);
  /**
   * The challenge in front of the model (app/api/identify), its own widget
   * and not the send button's: a token is single-use, and the one for sending
   * has to be there when the reporter presses send. Mounted for one
   * identification and keyed by it, so each gets a challenge of its own, and
   * taken away once it has answered. Invisible unless Cloudflare needs a tick.
   */
  const [identifyChallenge, setIdentifyChallenge] = useState<number | null>(null);
  const identifyRound = useRef(0);
  const identifyAnswer = useRef<((token: string | null) => void) | null>(null);
  /** The place on the map was read from the photo, and the form says so. */
  const [locationFromPhoto, setLocationFromPhoto] = useState(false);
  const [preparing, setPreparing] = useState(false);
  // null until the challenge is solved. Only meaningful when a site key is
  // configured; without one no widget renders and the server does not ask.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  /** Mint a replacement after a spent token. See the catch in submit(). */
  const resetTurnstile = useRef<(() => void) | null>(null);
  /**
   * The one failure with nowhere else to go: the report could not even be
   * saved on the device, so there is no queue to point at and no retry that
   * would behave differently. Its own flag rather than an error code, because
   * it is the browser's storage refusing, not anything the server said.
   * `held` when what refused is a tab of an older build holding the database
   * (lib/offline/db.ts), which the reporter can do something about.
   */
  const [queueFailed, setQueueFailed] = useState<"failed" | "held" | null>(null);
  /** The browser refused or could not produce a fix. Says so under the map. */
  const [locationError, setLocationError] = useState(false);

  /**
   * How long the reporter has been kept waiting, in the two places a wait can
   * strand a report: a challenge that never solves, and a send that never
   * answers. Each only ever turns on, from a timer; what it means is decided
   * in lib/report/sendState.ts, which ignores a slow token once one arrives.
   */
  const [tokenSlow, setTokenSlow] = useState(false);
  const [sendNumber, setSendNumber] = useState(0);
  const [slowSend, setSlowSend] = useState<number | null>(null);
  /**
   * The send that is still allowed to finish. Saving on the phone mid-send
   * moves this on, so the abandoned send's answer — if one ever comes — is
   * dropped rather than landing on top of the "saved" card. The queue then
   * sends under the same nonce, and the server keeps one report either way.
   */
  const liveSend = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  // Generated once per form instance so a double-tap cannot create two reports.
  // When a submission is queued this same value becomes the queue item's id, so
  // every later retry reuses it and the server's duplicate check holds.
  const nonce = useRef<string>(crypto.randomUUID());
  const { locate, busy: locating } = useGeolocate();

  /*
   * THE DRAFT (lib/offline/drafts.ts). Android often discards the tab while
   * the camera app is open, and a link, a back swipe or the language switch
   * dropped the form too: the reporter came back to an empty one, with the
   * animal still in front of them. So the form keeps itself as it is filled
   * in — the fields in this tab's sessionStorage, the photographs in
   * IndexedDB under the nonce — and opens with the draft, saying so.
   *
   * The nonce comes back with it. A tab killed after the server had stored
   * the report but before the answer arrived then sends the same report
   * again under the same nonce, and the server answers with the row it has.
   */
  const draftKey = test ? `${page}:test` : page;
  /** The form opened with a draft, and says so until it is sent or cleared. */
  const [restored, setRestored] = useState(false);
  /**
   * Nothing is saved over the draft until it is back: the effects below
   * would otherwise write the empty form over it on the first render, and
   * an empty photo list deletes the photographs. Two flags, because the
   * fields come back at once and the photographs when IndexedDB answers.
   */
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [photosLoaded, setPhotosLoaded] = useState(false);
  /** Cleared on purpose; nothing writes it back on the way out. */
  const dropped = useRef(false);

  // Read after hydration, never during render: the page is rendered on the
  // server, which has no draft, and a first render that differed from the
  // server's would not hydrate.
  //
  // The fields first, without waiting for the photographs. Both used to be
  // read before anything was set, and a tab of an older build holding the
  // database (lib/offline/db.ts) kept the photographs, and so the whole
  // draft, from ever coming back, and no draft was saved after it either.
  useEffect(() => {
    let live = true;
    void purgeDraftPhotos();
    void (async () => {
      const saved = loadDraftFields<DraftFields>(draftKey);
      if (saved) {
        nonce.current = saved.nonce;
        if (saved.category && conditions.includes(saved.category)) setCategory(saved.category);
        // A species chosen on the page the reporter just came from is the
        // newer answer; see `initialSpecies`.
        if (!initialSpecies) {
          setSpecies(saved.species);
          setSpeciesFromPhoto(saved.speciesFromPhoto);
          setUnsure(saved.unsure);
        }
        setLocation(saved.location);
        setAccuracyM(saved.accuracyM);
        setLocationFromPhoto(saved.locationFromPhoto);
        setObservedAt(saved.observedAt);
        setTimeEdited(saved.timeEdited);
        setTimeFromPhoto(saved.timeFromPhoto);
        setNotes(saved.notes);
        setEmail(saved.email);
        if (saved.photoIdea) setPhotoIdea(saved.photoIdea);
        // Never the partner-sharing consent (sharePartners), which is not in
        // the draft. Consent under the personal data law is given, not
        // restored: a box ticked again by a reload is one nobody ticked here.
        setRestored(true);
      }
      setDraftLoaded(true);

      const kept = saved ? await loadDraftPhotos(saved.nonce) : [];
      if (!live) return;
      if (kept.length) {
        // Asked about before the page went, so not asked again.
        photoAsked.current = true;
        // Ahead of anything added while they were being read.
        setPhotos((prev) =>
          [
            ...kept.map((p) => ({ ...p, previewUrl: URL.createObjectURL(p.blob) })),
            ...prev,
          ].slice(0, MAX_PHOTOS),
        );
      }
      setPhotosLoaded(true);
    })();
    return () => {
      live = false;
    };
    // Once, as the form opens: the draft is what it starts from, not
    // something it follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Something here that leaving would lose. Wider than the photo, the place
   * and the notes: a condition answered, an address typed, a time corrected.
   * Not a species the page was opened with, which the link put there.
   */
  const hasEntries =
    photos.length > 0 ||
    location !== null ||
    notes.trim() !== "" ||
    email.trim() !== "" ||
    (species !== null && species.id !== initialSpecies?.id) ||
    unsure ||
    timeEdited ||
    (asksCondition && category !== null);
  /** Still being filled in: not sent, and not saved as a report. */
  const open = phase !== "done" && phase !== "queued";

  const draftNow = useCallback(
    (): DraftFields => ({
      nonce: nonce.current,
      category,
      species,
      speciesFromPhoto,
      unsure,
      location,
      accuracyM,
      locationFromPhoto,
      observedAt,
      timeEdited,
      timeFromPhoto,
      notes,
      email,
      photoIdea: photoIdea.status === "done" ? photoIdea : null,
    }),
    [
      category,
      species,
      speciesFromPhoto,
      unsure,
      location,
      accuracyM,
      locationFromPhoto,
      observedAt,
      timeEdited,
      timeFromPhoto,
      notes,
      email,
      photoIdea,
    ],
  );

  /** Write the fields down now, rather than after the pause below. */
  const saveNow = useCallback(() => {
    if (!draftLoaded || !open || dropped.current) return;
    if (hasEntries) saveDraftFields(draftKey, draftNow());
    else dropDraftFields(draftKey);
  }, [draftLoaded, open, hasEntries, draftKey, draftNow]);
  const saveNowRef = useRef(saveNow);
  useEffect(() => {
    saveNowRef.current = saveNow;
  }, [saveNow]);

  // As it is typed, after a pause; and at once when the page is hidden — the
  // camera app opening is exactly that — or the form goes away.
  useEffect(() => {
    const id = window.setTimeout(saveNow, 400);
    return () => window.clearTimeout(id);
  }, [saveNow]);
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") saveNowRef.current();
    };
    const onPageHide = () => saveNowRef.current();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      saveNowRef.current();
    };
  }, []);

  // The photographs whenever they change. They change rarely, and each is a
  // few hundred KB that is not worth holding back.
  useEffect(() => {
    if (!photosLoaded || !open || dropped.current) return;
    void saveDraftPhotos(
      nonce.current,
      photos.map((p) => ({
        id: p.id,
        blob: p.blob,
        width: p.width,
        height: p.height,
        gps: p.gps,
        takenAt: p.takenAt,
      })),
    );
  }, [photosLoaded, open, photos]);

  /** Forget the draft: sent, saved as a report, or cleared by the reporter. */
  const forgetDraft = useCallback(() => {
    dropped.current = true;
    dropDraftFields(draftKey);
    void dropDraftPhotos(nonce.current);
  }, [draftKey]);
  useEffect(() => {
    if (!open) forgetDraft();
  }, [open, forgetDraft]);

  /*
   * Asking before the page goes, while there is something to lose: the
   * browser's own question when the tab is reloaded or closed, the form's on
   * a link to another page of the site, and the language switch's, which
   * navigates without a link (lib/report/leaveGuard.ts). The draft means
   * leaving no longer loses the report on this tab; asking is for the
   * reporter who did not mean to leave, and who would otherwise come back
   * to it only if they came back to this page.
   *
   * Capture phase, so the question comes before the router's own click
   * handler has started the navigation. Links that ask for themselves — the
   * species picker's way to the wildlife page — are marked and left alone,
   * and a link opening a new tab loses nothing.
   */
  const leaveGuarded = hasEntries && open;
  useEffect(() => {
    if (!leaveGuarded) return;
    /** When the reporter last said yes to leaving, so they are not asked twice. */
    let agreedAt = 0;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      saveNowRef.current();
      if (Date.now() - agreedAt < 2000) return;
      e.preventDefault();
      // Still what some browsers read to decide whether to ask.
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      if (link.closest("[data-asks-before-leaving]")) return;
      const to = new URL(link.href, window.location.href);
      if (to.origin !== window.location.origin) return;
      if (to.pathname === window.location.pathname && to.search === window.location.search) return;
      saveNowRef.current();
      if (window.confirm(t("leaveConfirm"))) {
        agreedAt = Date.now();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    const standDown = guardLeaving(() => {
      saveNowRef.current();
      return true;
    });
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      standDown();
    };
  }, [leaveGuarded, t]);

  useEffect(() => {
    if (!turnstileEnabled || turnstileToken || !online) return;
    const id = window.setTimeout(() => setTokenSlow(true), TOKEN_PATIENCE_MS);
    return () => window.clearTimeout(id);
  }, [turnstileToken, online]);

  useEffect(() => {
    if (phase !== "submitting") return;
    const n = sendNumber;
    const id = window.setTimeout(() => setSlowSend(n), SEND_PATIENCE_MS);
    return () => window.clearTimeout(id);
  }, [phase, sendNumber]);

  /**
   * A fresh token for one identification, or null if none came: no widget
   * could load, Cloudflare refused, or the reporter left a box unticked for
   * IDENTIFY_TOKEN_WAIT_MS. Without a site key there is no challenge, and
   * nothing to wait for.
   */
  const identifyToken = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        const timer = window.setTimeout(() => answer(null), IDENTIFY_TOKEN_WAIT_MS);
        function answer(token: string | null) {
          window.clearTimeout(timer);
          if (identifyAnswer.current === answer) identifyAnswer.current = null;
          setIdentifyChallenge(null);
          resolve(token);
        }
        identifyAnswer.current = answer;
        identifyRound.current += 1;
        setIdentifyChallenge(identifyRound.current);
      }),
    [],
  );

  /**
   * Ask the model about a photo, once per report, with a signal. Offline it
   * is not asked at all: the queue sends the report later, and the model
   * looks at it then, as it always did.
   *
   * Anything that goes wrong here, the challenge included, leaves the form
   * saying the model is unavailable, and nothing else: the report is filed
   * exactly as it would be without a suggestion.
   */
  const identifyPhoto = useCallback(
    async (blob: Blob) => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      setPhotoIdea({ status: "working" });
      try {
        const [imageBase64, challenge] = await Promise.all([
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
          turnstileEnabled ? identifyToken() : Promise.resolve(null),
        ]);
        if (turnstileEnabled && !challenge) throw new Error("identify: no challenge token");
        const res = await fetch(withBase("/api/identify"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ imageBase64, page, turnstileToken: challenge ?? undefined }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error(`identify ${res.status}`);
        const data = (await res.json()) as PhotoIdentification;
        setPhotoIdea({ status: "done", suggestions: data.suggestions, outsidePage: data.outsidePage });
      } catch (e) {
        console.error("[report] identify:", e);
        setPhotoIdea({ status: "failed" });
      }
    },
    [page, identifyToken],
  );

  const addFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setPreparing(true);
      setError(null);
      try {
        const room = MAX_PHOTOS - photos.length;
        const picked = Array.from(files).slice(0, room);
        // Each file on its own: one unreadable file (a HEIC on a desktop, a
        // truncated download) used to throw away every photo picked with it.
        const settled = await Promise.allSettled(picked.map(preparePhoto));
        const prepared = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        const unreadable = settled.find((r) => r.status === "rejected");

        // Counted against what is on the form now, not when the pick began.
        // The inputs are disabled while a pick is prepared, and this holds the
        // cap even so: past it, the server refuses the whole report.
        setPhotos((prev) => [
          ...prev,
          ...prepared.slice(0, Math.max(0, MAX_PHOTOS - prev.length)).map((p) => ({
            ...p,
            id: crypto.randomUUID(),
            previewUrl: URL.createObjectURL(p.blob),
          })),
        ]);
        if (unreadable) fail(PHOTO_UNREADABLE, unreadable.reason);

        // The first photo of the report goes to the model now, not only after
        // the report is sent.
        if (prepared[0] && !photoAsked.current) {
          photoAsked.current = true;
          void identifyPhoto(prepared[0].blob);
        }

        // The photo's own place fills the location, as its time fills the time:
        // the team asked that the location come from the photo rather than be
        // entered separately (30 September 2026). It is shown on the map with
        // a line saying where it came from, so a picture taken somewhere else
        // is one tap to correct. Over a place already chosen it is offered,
        // not applied: the reporter has answered that question.
        const withGps = prepared.find((p) => p.gps);
        if (withGps?.gps) {
          if (!location) {
            setLocation(withGps.gps);
            setAccuracyM(null);
            setLocationFromPhoto(true);
            setLocationError(false);
          } else {
            setExifOffer(withGps.gps);
          }
        }

        // The time is applied too, and over the form's default of "now" as
        // well as an empty field, where the place is only offered once one is
        // chosen. A photograph taken somewhere else is an ordinary thing — a
        // picture from last week's trip, a screenshot — and filing it at the
        // wrong place puts a wrong dot on a public map. A photograph taken at
        // another TIME is the same photograph, and the time it was taken is
        // simply when the animal was seen. Someone who
        // photographs a dead animal at 07:32 on a mountain road and files it at
        // 19:40 when they reach signal would otherwise have the record moved
        // half a day, which on a dataset about when animals are found is enough
        // to move a dawn peak into the evening.
        //
        // Not over a time the reporter typed themselves.
        const withTime = prepared.find((p) => p.takenAt);
        if (withTime?.takenAt && !timeEdited) {
          setObservedAt(toLocalInput(withTime.takenAt));
          setTimeFromPhoto(true);
        }
      } catch (e) {
        // A file the browser will not decode: a HEIC from an older iPhone, a
        // truncated download. Nothing about the network, so it is answered
        // beside the picker rather than at the bottom of the form.
        fail(PHOTO_UNREADABLE, e);
      } finally {
        setPreparing(false);
      }
    },
    [photos.length, location, timeEdited, fail, identifyPhoto],
  );

  /**
   * The report as the reporter entered it, for sending or for saving.
   *
   * One builder for both, so a saved report and a sent one cannot say
   * different things. Never a Turnstile token: a token is single-use and dies
   * in about five minutes, so the queue mints its own when it sends
   * (test/offline-challenge.test.mjs).
   */
  const entered = (where: LatLng, what: Category) => ({
    category: what,
    page,
    lng: where.lng,
    lat: where.lat,
    accuracyM: sendableAccuracy(accuracyM),
    // Checked before anything calls this (fieldsOk), so the fallback is never
    // what is sent.
    observedAt: observedInstant(observedAt) ?? new Date().toISOString(),
    taxonId: species?.id,
    taxonUnknown: unsure || undefined,
    taxonFromPhoto: species && speciesFromPhoto ? true : undefined,
    notes: notes.trim() || undefined,
    contactEmail: email.trim() || undefined,
    license,
    sharePartners: asksPartners ? sharePartners : undefined,
    consentVersion: CONSENT_VERSION,
    // In the payload rather than added at send time, so a test saved on the
    // phone offline is still sent as a test.
    test: test || undefined,
  });

  /**
   * The typed fields, against the server's own rules, before anything is sent
   * or saved. A problem is shown beside its field, which is focused.
   */
  function fieldsOk(): boolean {
    const problem = checkFields({
      observedAt,
      email,
    });
    if (!problem) return true;
    setError(problem);
    const id = { time: "observedAt", contact: "email", credit: "email" }[problem.slot];
    document.getElementById(id)?.focus();
    return false;
  }

  /**
   * Who is signed in on this device now, for a report being saved on it.
   *
   * Read from the browser's own stored session, never from the page: the
   * report pages are kept for offline use and served to whoever opens them
   * next. And never over the network: supabase-js refreshes an old session
   * before it answers, which with no signal took about 25 seconds and then
   * said nobody (lib/supabase/storedSession.ts). Undefined only when a stored
   * session cannot be read, and the server then files it as it always did.
   */
  function signedInAs(): string | undefined {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return undefined;
    const id = storedSessionUserId(document.cookie, url);
    return id === null ? "anonymous" : id;
  }

  /**
   * Keep the report on this phone, to be sent from the queue later.
   *
   * Reached four ways: the main button when the phone is offline, the two
   * "save on this phone" buttons that appear when a challenge or a send has
   * kept the reporter waiting too long, and a send that failed for want of a
   * network. Needs no token and no connection — that is the point of it.
   */
  async function saveOnPhone() {
    if (!location || !category) return;
    if (!fieldsOk()) return;
    // Abandon anything in flight. Its photos may already be in the bucket and
    // its row may already be stored; the queue re-sends under the same nonce,
    // so the server answers that with the row it has rather than a second one.
    liveSend.current += 1;
    inFlight.current?.abort();
    setError(null);
    setQueueFailed(null);
    setPhase("submitting");
    try {
      await enqueue({
        id: nonce.current,
        payload: { ...entered(location, category), filedBy: signedInAs() },
        photos: photos.map((p) => p.blob),
        label: species ? speciesLabel(species, locale) : null,
      });
      setPhase("queued");
    } catch (queueErr) {
      // `t` is the `report` namespace and this key lives in `offline`, so
      // the old call rendered the literal string "report.queueFailed" to
      // the one person whose report had just failed to save anywhere at all.
      console.error("[report] could not queue:", queueErr);
      setQueueFailed(isBlocked(queueErr) ? "held" : "failed");
      setPhase("error");
    }
  }

  async function submit() {
    setError(null);
    setQueueFailed(null);
    // Unreachable through the button, which is disabled without both, and the
    // sentence above it already says which requirement is unmet.
    if (!location || !category) return;
    if (!fieldsOk()) return;

    const mine = ++liveSend.current;
    const stillMine = () => liveSend.current === mine;
    const controller = new AbortController();
    inFlight.current = controller;
    setSendNumber(mine);
    setPhase("submitting");
    try {
      let paths: string[] = [];

      if (photos.length) {
        // A draft from the build before may hold a photo the bucket no
        // longer takes; it is written again rather than refused.
        const blobs = await Promise.all(photos.map((p) => fitForUpload(p.blob)));
        if (!stillMine()) return;
        const signRes = await fetch(withBase("/api/uploads/sign"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          // Say what is being uploaded rather than leaning on the default:
          // `stripAndDownscale` writes WebP where the browser can and JPEG
          // where it cannot, and stating it is what lets the key match the
          // bytes.
          body: JSON.stringify({
            count: blobs.length,
            contentType: blobs[0].type || "image/webp",
          }),
        });
        if (!signRes.ok) {
          // The server's own code, not a sentence assembled here: `sign_failed`
          // and `rate_limited` mean different things to the reporter, and the
          // status alone erased that distinction.
          const body = await signRes.json().catch(() => ({}));
          throw new ReportError(body.error ?? "sign_failed", signRes.status);
        }
        const { uploads } = (await signRes.json()) as {
          uploads: { path: string; token: string }[];
        };
        if (!stillMine()) return;

        // Rejects with NETWORK when a photo never reached the bucket, which
        // saves the report on the phone below, and PHOTO_UPLOAD_FAILED when
        // Storage refused it (lib/report/upload.ts).
        await Promise.all(
          uploads.map((u, i) => uploadPhoto(u.path, u.token, blobs[i])),
        );
        if (!stillMine()) return;
        paths = uploads.map((u) => u.path);
      }

      const res = await fetch(withBase("/api/reports"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ...entered(location, category),
          photoPaths: paths,
          clientNonce: nonce.current,
          turnstileToken: turnstileToken ?? undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!stillMine()) return;
      if (!res.ok) throw new ReportError(data.error ?? "unknown", res.status);

      // Written down on this phone, so it can be found again from /me by
      // someone who has no account (lib/offline/sent.ts). Not a test.
      if (!test && data.test !== true)
        void recordSent({
          id: String(data.id ?? ""),
          sentAt: Date.now(),
          page,
          category,
          label: species ? speciesLabel(species, locale) : null,
        });

      setResult({
        id: data.id,
        status: data.status,
        awaitingIdentification: data.awaitingIdentification,
        // An older deployment answering a newer client omits this; treating a
        // missing field as visible keeps today's behaviour for every report
        // that is not withheld, which is all but a handful.
        visible: data.visible !== false,
        test: data.test === true,
        photoCount: photos.length,
      });
      setPhase("done");
    } catch (e) {
      // Abandoned for the queue while it was in flight: the reporter has
      // already been told it is saved, and this is the abort arriving.
      if (!stillMine()) return;

      // Network failure (or an outright offline browser) means the report is not
      // lost — it goes to the queue and is sent when connectivity returns. Any
      // other failure is a real rejection and should be shown as one.
      const offline =
        typeof navigator !== "undefined" && navigator.onLine === false;
      const networkish = offline || isNetworkFailure(e);

      if (networkish) {
        await saveOnPhone();
        return;
      }

      const code = e instanceof ReportError ? e.code : "unknown";
      fail(code, e);

      // The token is spent. Turnstile issues single-use tokens, so after any
      // rejection the one in state is dead: pressing send again produced
      // `challenge_failed` however sound the second attempt was, and the
      // reporter was told their browser had failed a check it had passed.
      // Clearing it disables the button until the widget mints another, which
      // it starts doing the moment it is reset.
      setTurnstileToken(null);
      resetTurnstile.current?.();
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
      className="border-l-4 border-ink-600 pl-3 text-sm leading-relaxed text-ink-800"
    >
      {t("noDispatch")}
    </p>
  );

  /**
   * What happens to a report from the invasive page, said before anyone asks.
   *
   * Invasive animals invite a particular wrong assumption: that reporting one
   * sets off a removal, or that the reporter is expected to do something about
   * it. Neither is true, and the answer must never suggest catching, moving or
   * harming the animal — a reporter who tries to catch a "sacred ibis" that is
   * a protected egret has been told to by us. So it says what we do (keep it,
   * have it checked, blur it until then) and that nothing more is asked of
   * them. No agency or number: those wait for the owner (Q7 in the plan).
   */
  const invasiveNext = () => (
    <div role="note" className="border-l-4 border-leaf-600 pl-3">
      <p className="text-sm font-semibold text-forest-900">
        {t("receipt.invasiveNextTitle")}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-ink-800">
        {t("receipt.invasiveNextBody")}
      </p>
    </div>
  );

  /**
   * 路殺社's own record of the same animal (plan, stage 9 step 37).
   *
   * TaiRON keeps Taiwan's roadkill record and has no way for another site to
   * send it reports; its partners type records into TaiRON's own site. So this
   * is a link and an explanation, nothing more: the reporter can add the same
   * animal there themselves, with their own account, and nothing is sent or
   * stored on their behalf. Whether a later bulk transfer should skip records
   * the reporter filed there too is for when TaiRON has agreed to one.
   */
  const taironNote = () => (
    <div className="rounded-lg border border-forest-900/15 bg-paper-50 p-4">
      <p className="text-sm font-semibold text-forest-900">
        {t("receipt.taironTitle")}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-ink-800">
        {t("receipt.taironBody")}
      </p>
      <a
        href={TAIRON_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900"
      >
        {t("receipt.taironLink")}
        <span aria-hidden>↗</span>
        <span className="sr-only">{t("newTab")}</span>
      </a>
    </div>
  );

  /** Marked on everything the reporter is shown about an unchecked record. */
  const unverifiedTag = () => (
    <p className="mt-2 inline-flex items-center rounded-full border border-ink-900/20 bg-paper-50 px-3 py-1 text-sm font-medium text-ink-800">
      {t("receipt.notVerified")}
    </p>
  );

  /**
   * The failure, beside the control that produced it.
   *
   * Everything used to land in one box under the last field: a photograph that
   * failed to upload was reported half a screen below the photographs, and a
   * species that no longer exists was reported nowhere near the picker that
   * chose it. `role="alert"` because it appears in response to an action the
   * reporter just took and is the answer to it.
   *
   * The rule is ember and the words are ink. A filled ember panel is what the
   * success card is, and the palette has no red, so a failure drawn as one
   * would have been the good news in the same clothes.
   */
  const ALERT =
    "border-l-4 border-ember-700 pl-3 text-sm leading-relaxed text-ink-800";

  const errorIn = (slot: ErrorSlot) =>
    error?.slot === slot ? (
      <p id={`${slot}-error`} role="alert" className={`mt-2 ${ALERT}`}>
        {t(`errors.${error.key}`)}
      </p>
    ) : null;

  /**
   * The help and error lines a field is described by, for `aria-describedby`.
   * An alert is announced once, when it appears; a reader who comes back to
   * the field later heard only its label, not what was wrong with it, nor the
   * line under it saying what the email is for.
   */
  const describedBy = (...ids: (string | false)[]) =>
    ids.filter(Boolean).join(" ") || undefined;
  const errorId = (slot: ErrorSlot) => error?.slot === slot && `${slot}-error`;

  // A function, not a value: the editing phase renders neither card, and
  // resolving a message it will not show is work done on every keystroke.
  const another = () => (
    <button
      type="button"
      onClick={() => {
        forgetDraft();
        onReportAnother();
      }}
      className="inline-flex min-h-11 items-center text-sm font-medium text-ink-800 underline decoration-ink-900/30 underline-offset-2 hover:text-ink-950"
    >
      {t("receipt.another")}
    </button>
  );

  /**
   * What the page says after the report has left the form, sent or saved.
   *
   * Repeated on both cards rather than shown only beside the choices: a saved
   * report is the case where waiting for a response is most plausible and
   * least warranted, because it has not even left the phone yet.
   */
  const afterwards = () => (
    <>
      {category === "injured" && <div className="mt-3">{noDispatchNote()}</div>}
      {page === "invasive" && <div className="mt-3">{invasiveNext()}</div>}
      {page === "roadkill" && <div className="mt-4">{taironNote()}</div>}
    </>
  );

  const unverified =
    category !== null && awaitingVerification({ category, taxonSource: null });

  if (phase === "queued") {
    return (
      <div
        role="status"
        className="rounded-xl border border-forest-900/20 bg-paper-100 p-5"
      >
        <h2 className="text-lg font-semibold text-forest-900">
          {tOffline("queuedTitle")}
        </h2>
        {unverified && unverifiedTag()}
        <p className="mt-2 text-sm leading-relaxed text-ink-800">
          {tOffline("queuedBody")}
        </p>
        {afterwards()}
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
      result.visible,
      result.test,
    );
    return (
      <div
        role="status"
        className="rounded-xl border border-ember-500/30 bg-ember-500/10 p-5"
      >
        <h2 className="text-lg font-semibold text-ember-700">
          {t(`receipt.${outcome.title}`)}
        </h2>
        {unverified && unverifiedTag()}
        {outcome.body && (
          <p className="mt-2 text-sm leading-relaxed text-ink-800">
            {t(`receipt.${outcome.body}`)}
          </p>
        )}
        {afterwards()}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1">
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
              className="inline-flex min-h-11 items-center text-sm font-medium text-ember-700 underline underline-offset-2"
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
    category !== null && CATEGORIES[category].classifiable && photos.length === 0;
  /** The most serious thing noticed in the notes, if anything. */
  const notesConcern = notesConcerns(notes)[0] ?? null;

  const busy = phase === "submitting";
  const controls = sendControls({
    online,
    turnstileEnabled,
    hasToken: turnstileToken !== null,
    hasLocation: location !== null,
    preparing,
    needsCondition: category === null,
    busy,
    tokenSlow,
    sendSlow: busy && slowSend === sendNumber,
  });
  // The first unmet requirement, in the order someone meets them.
  const blocker = controls.blocker ? t(controls.blocker) : null;
  const saving = controls.primary === "save";

  // sr-only, not hidden. `hidden` is display:none, and a display:none input is
  // not focusable at all: the photo picker could not be reached by keyboard,
  // and the focus-within ring on its label could never fire.
  //
  // One picker. There used to be a camera tile (`capture="environment"`) and a
  // library link beside it; on a computer the tile only ever opened the file
  // picker, and the team asked for uploading alone on the website (30
  // September 2026). On a phone this same picker offers the camera too.
  const photoInput = (
    <input
      type="file"
      accept="image/*"
      multiple
      className="sr-only"
      disabled={preparing}
      aria-invalid={error?.slot === "photo" || undefined}
      aria-describedby={describedBy(
        "photo-help",
        heldForReview && "photo-warning",
        errorId("photo"),
      )}
      onChange={(e) => {
        void addFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );

  const chip = (pressed: boolean) =>
    `inline-flex min-h-12 items-center justify-center rounded-lg border-2 px-4 text-base font-medium transition ${
      pressed
        ? "border-forest-900 bg-forest-900 text-paper-50"
        : "border-ink-900/20 bg-paper-100 text-ink-900 hover:border-forest-900/50"
    }`;

  return (
    <div className="space-y-8">
      {restored && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-x-2 rounded-lg border border-forest-900/20 bg-paper-100 px-4 py-1 text-sm text-ink-800"
        >
          <span>{t("draftRestored")}</span>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={() => {
              forgetDraft();
              onReportAnother();
            }}
            className="inline-flex min-h-11 items-center font-medium text-forest-900 underline underline-offset-2 hover:text-ink-950"
          >
            {t("draftClear")}
          </button>
        </p>
      )}
      {test && (
        <section
          role="note"
          aria-labelledby="test-report-title"
          className="rounded-lg border-2 border-dashed border-forest-900/40 bg-paper-100 p-4"
        >
          <h2 id="test-report-title" className="text-base font-semibold text-forest-900">
            {t("testMode.title")}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-800">
            {t("testMode.body")}
          </p>
          <Link
            href={`/report/${page}`}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900"
          >
            {t("testMode.realInstead")}
          </Link>
        </section>
      )}
      {/*
        The photo first. It is what the reporter is already holding their phone
        up to do, and what it knows (when it was taken, and where) fills the
        questions below it before they are asked. The owner chose this shape in
        the design lab (components/lab/report/PhotoFirstFlow.tsx): the camera at
        the top, every question visible under it, the condition still asked
        before the species.

        One input without `capture`: on a phone it offers the camera and the
        photos already taken, and on a computer it chooses a file. (A
        `capture` input opened the camera and nothing else, so a photo taken a
        minute earlier could not be attached.)
      */}
      <section aria-labelledby="photos-label">
        <h2 id="photos-label" className="mb-2 text-base font-semibold text-forest-900">
          {t("photos")}{" "}
          <span className="text-sm font-normal text-ink-600">
            ({photos.length}/{MAX_PHOTOS})
          </span>
        </h2>

        {photos.length === 0 ? (
          // focus-within is what makes these reachable by keyboard: each input
          // is sr-only, so focusing it shows nothing, and the label is the only
          // visible affordance.
          <label className="flex min-h-44 w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-forest-900/40 bg-paper-100 px-4 py-6 text-forest-900 hover:border-forest-900/70 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ember-400">
            <svg
              aria-hidden="true"
              viewBox="0 0 48 48"
              className="h-12 w-12"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinejoin="round"
            >
              <path d="M4 14h9l4-5h14l4 5h9v26H4z" />
              <circle cx="24" cy="26" r="8" />
            </svg>
            <span className="text-lg font-semibold">{t("photoAdd")}</span>
            {photoInput}
          </label>
        ) : (
          <div className="flex flex-wrap gap-3">
            {photos.map((p, n) => (
              <div key={p.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.previewUrl}
                  alt=""
                  className="h-24 w-24 rounded-lg object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(p.previewUrl);
                    setPhotos((prev) => {
                      const left = prev.filter((x) => x.id !== p.id);
                      // Every photo taken off: the suggestions were about one
                      // of them, and the next photo is asked about afresh.
                      if (left.length === 0) {
                        photoAsked.current = false;
                        setPhotoIdea({ status: "idle" });
                      }
                      return left;
                    });
                  }}
                  // 20px was under any target guideline, and it sits at the
                  // corner of a thumbnail with the "+" tile 8px away. The disc is
                  // 24px and a pseudo-element carries the rest of the 44px hit
                  // area inwards and downwards, over the photograph it belongs
                  // to, so growing it cannot steal a tap from the next tile.
                  className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-paper-200 text-sm text-ink-800 ring-1 ring-ink-900/15 after:absolute after:-bottom-5 after:-left-5 after:right-0 after:top-0 after:content-['']"
                  // Numbered: with three photos on the form a screen reader
                  // heard three identical buttons and no way to tell them apart.
                  aria-label={t("removePhoto", { n: n + 1 })}
                >
                  ×
                </button>
              </div>
            ))}

            {photos.length < MAX_PHOTOS && (
              <label className="grid h-24 w-24 cursor-pointer place-items-center rounded-lg border-2 border-dashed border-ink-900/25 text-2xl text-ink-600 hover:border-forest-900/50 hover:text-forest-900 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ember-400">
                <span aria-hidden>+</span>
                <span className="sr-only">{t("photoAdd")}</span>
                {photoInput}
              </label>
            )}
          </div>
        )}

        <p id="photo-help" className="mt-2 text-sm leading-relaxed text-ink-600">
          {preparing ? t("photoProcessing") : t("photoHelp")}
        </p>

        {heldForReview && (
          <p id="photo-warning" className="mt-2 text-sm leading-relaxed text-ink-800">
            {t("noPhotoWarning")}
          </p>
        )}
        {errorIn("photo")}
      </section>

      {/* Location */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-forest-900">
            {t("location")}
          </h2>
          <button
            type="button"
            onClick={async () => {
              const p = await locate();
              if (p) {
                setLocation({ lat: p.lat, lng: p.lng });
                setAccuracyM(p.accuracyM);
                setExifOffer(null);
                setLocationFromPhoto(false);
                setLocationError(false);
              } else {
                // Was 點地圖可調整位置 — "tap the map to adjust", the helper
                // text for a pin that already exists. Told to someone who has
                // just been refused a fix and has no pin at all, it names the
                // wrong action and does not say that anything failed.
                setLocationError(true);
              }
            }}
            className="inline-flex min-h-11 items-center rounded-full border border-forest-900/30 bg-paper-100 px-4 text-sm font-medium text-forest-900 hover:bg-paper-200"
          >
            {locating ? t("locating") : t("useMyLocation")}
          </button>
        </div>

        {exifOffer && (
          // Was sky: a hue from the default palette that nothing else on the
          // site uses, and it set its text at 1.02–1.28:1 on cream — invisible
          // rather than merely low-contrast, on the one strip that asks whether
          // to take a location out of a photograph.
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-900/12 bg-paper-100 px-3 py-2 text-sm text-ink-800">
            <span>{t("exifOffer")}</span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded bg-ember-500/15 px-3 font-medium text-ember-700"
                onClick={() => {
                  setLocation(exifOffer);
                  setAccuracyM(null);
                  setExifOffer(null);
                  setLocationFromPhoto(true);
                }}
              >
                {t("exifUse")}
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center px-3 text-ink-700"
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
            setLocationFromPhoto(false);
          }}
          maptilerKey={maptilerKey}
        />
        {/* "Tap to adjust" is about a pin that exists. Before one does, the
            instruction is to make one — the old text told a reporter with
            nothing chosen to adjust something that was not there. */}
        <p className="mt-1.5 text-sm text-ink-600">
          {location ? t(locationFromPhoto ? "locationFromPhoto" : "tapToAdjust") : t("needLocation")}
          {accuracyM != null && (
            <span className="ml-1.5 tabular-nums text-ink-600">
              · {t("accuracy", { m: accuracyM })}
            </span>
          )}
        </p>
        {locationError && (
          <p role="alert" className="mt-1.5 text-sm text-ember-700">
            {t("locationError")}
          </p>
        )}
      </section>

      {/*
        The roadkill page's one question, asked before the species so that an
        injured animal is never filed by inference from what it was, and after
        the photo and the place, which are what someone standing beside it
        does first. Required, with no default:
        the two answers are two stored categories — an injured animal implies
        someone should respond and a dead one does not — and nothing may be
        chosen for the reporter. The header used to open a form already set to
        "roadkill, dead", so a live animal could be filed dead without anyone
        having said so.
      */}
      {asksCondition && (
        <section aria-labelledby="condition-label">
          <h2
            id="condition-label"
            className="mb-2 text-base font-semibold text-forest-900"
          >
            {t("conditionLabel")}{" "}
            <span className="text-sm font-normal text-ink-600">
              {t("required")}
            </span>
          </h2>
          <div role="group" aria-labelledby="condition-label" className="grid grid-cols-2 gap-2">
            {conditions.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={category === k}
                onClick={() => setCategory(k)}
                className={chip(category === k)}
              >
                {t(`condition.${k}`)}
              </button>
            ))}
          </div>
          {category === "injured" && (
            <div className="mt-3">{noDispatchNote()}</div>
          )}
        </section>
      )}

      {/* Its one link, to the wildlife page, asks for itself before leaving
          (SpeciesPicker), so the form's own question stays out of its way. */}
      <section data-asks-before-leaving>
        {!species && !unsure && (
          <PhotoSuggestions
            state={photoIdea}
            onPick={(hit) => {
              setSpecies(hit);
              setSpeciesFromPhoto(true);
              setUnsure(false);
            }}
          />
        )}
        {/* Beside the line saying the model is looking, so that a box
            Cloudflare asks to be ticked is where the reporter is reading.
            Draws nothing otherwise, and nothing without a site key. */}
        {identifyChallenge !== null && online && (
          <Turnstile
            key={identifyChallenge}
            onToken={(token) => identifyAnswer.current?.(token)}
            locale={locale}
            theme="light"
            appearance="interaction-only"
          />
        )}
        <SpeciesPicker
          page={page}
          value={species}
          onChange={(hit) => {
            setSpecies(hit);
            setSpeciesFromPhoto(false);
          }}
          unsure={unsure}
          onUnsure={setUnsure}
          hasEntries={hasEntries}
        />
        {errorIn("species")}
      </section>

      {/* Details */}
      <section className="space-y-4">
        <div>
          <label
            htmlFor="observedAt"
            className="mb-1 block text-base font-semibold text-forest-900"
          >
            {t("observedAt")}
            {timeFromPhoto && (
              <span className="ms-2 text-sm font-normal text-ink-600">
                {t("observedFromPhoto")}
              </span>
            )}
          </label>
          <input
            id="observedAt"
            type="datetime-local"
            value={observedAt}
            max={maxTime}
            onChange={(e) => {
              setObservedAt(e.target.value);
              setTimeEdited(true);
              setTimeFromPhoto(false);
            }}
            aria-invalid={error?.slot === "time" || undefined}
            aria-describedby={describedBy(errorId("time"))}
            className="min-h-12 w-full rounded-lg border border-ink-900/20 bg-paper-100 px-3 py-2 text-base text-ink-900"
          />
          {errorIn("time")}
        </div>

        <div>
          <label
            htmlFor="notes"
            className="mb-1 block text-base font-semibold text-forest-900"
          >
            {t("notes")}{" "}
            <span className="text-sm font-normal text-ink-600">({t("optional")})</span>
          </label>
          <textarea
            id="notes"
            rows={3}
            maxLength={MAX_NOTES}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-describedby={notesConcern ? "notes-hint notes-warning" : "notes-hint"}
            className="w-full rounded-lg border border-ink-900/20 bg-paper-100 px-3 py-2 text-base text-ink-900"
          />
          {/*
            Said before anything is typed, because the notes are public on
            every record shown at its exact place, and that is every report
            naming an invasive animal. The warning under it is what the form
            noticed in what was typed; it never stops the report, and the
            server's own screen still holds one whose notes give a location.
          */}
          <p id="notes-hint" className="mt-1 text-sm text-ink-600">
            {t("notesPublic")}
          </p>
          {notesConcern && (
            <p id="notes-warning" role="status" className={`mt-2 ${ALERT}`}>
              {t(`notesWarning.${notesConcern}`)}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="email"
            className="mb-1 block text-base font-semibold text-forest-900"
          >
            {t("email")}{" "}
            <span className="text-sm font-normal text-ink-600">({t("optional")})</span>
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-invalid={error?.slot === "contact" || undefined}
            aria-describedby={describedBy("email-help", errorId("contact"))}
            className="min-h-12 w-full rounded-lg border border-ink-900/20 bg-paper-100 px-3 py-2 text-base text-ink-900"
          />
          <p id="email-help" className="mt-1 text-sm text-ink-600">{t("emailHelp")}</p>
          {errorIn("contact")}
        </div>
      </section>

      {/* How the record may be used: the contributor terms, per report. */}
      <fieldset className="space-y-4 rounded-lg border border-ink-900/15 bg-paper-100 px-4 py-4">
        <legend className="px-1 text-base font-semibold text-forest-900">
          {t("shareTitle")}
        </legend>
        <p className="text-sm leading-relaxed text-ink-700">{t("shareIntro")}</p>
        {asksPartners && (
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={sharePartners}
              onChange={(e) => setSharePartners(e.target.checked)}
              className="mt-1 size-5 accent-leaf-600"
            />
            <span>
              <span className="block text-base text-ink-900">{t("sharePartners")}</span>
              <span className="block text-sm text-ink-600">{t("sharePartnersHint")}</span>
            </span>
          </label>
        )}
        <p className="text-sm">
          <Link href="/terms" className="text-leaf-700 underline underline-offset-2 hover:text-forest-900">
            {t("termsLink")}
          </Link>
        </p>
      </fieldset>

      {errorIn("form")}
      {queueFailed && (
        <p role="alert" className={ALERT}>
          {queueFailed === "held" ? tOffline("queueHeld") : tOffline("queueFailed")}
        </p>
      )}

      {/*
        Directly above the button it gates, so it reads as part of sending
        rather than as an unexplained box. Renders nothing without a site key.

        Not at all while offline: its script comes from Cloudflare and cannot
        load, and an empty box saying nothing is worse than no box. Unmounted
        and mounted again with the connection, so it fetches the script afresh
        when the signal comes back (see the onerror in Turnstile.tsx).
      */}
      {online && (
        <Turnstile
          onToken={setTurnstileToken}
          locale={locale}
          theme="light"
          onReady={(api) => {
            resetTurnstile.current = api.reset;
          }}
        />
      )}

      {/*
          Say what is missing, rather than leaving a dead button.

          The picker drops a pin on Taiwan's centre before anything is chosen, so
          the form looks complete while `location` is still null — the button
          greys out and nothing on screen explains why. That is a dead end on the
          one page whose entire job is collecting a report.

          Its own group, rather than two children of `space-y-8` with a negative
          margin pulling them together. `-mb-1` did not merely tighten the gap:
          it cancelled the parent's spacing outright, and at 390px the button's
          box rose into the sentence explaining why the button was disabled. The
          group owns the relationship, and `aria-describedby` states it to a
          screen reader, which previously heard a disabled button and no reason.
      */}
      {/*
          Pinned while the form is on screen, as the owner chose in the design
          lab: on one long page the way out has to be in the same place however
          far down you are. `sticky`, so it settles into its place at the end of
          the form rather than covering the page after it, and a direct child of
          the form's own box, because a sticky element only travels within its
          parent. globals.css keeps focused fields clear of it
          (scroll-padding-bottom), and the safe-area inset keeps the button above
          an iPhone's home bar.
      */}
      <div
        ref={sendBar}
        id="report-send-bar"
        className="sticky bottom-0 z-10 -mx-5 space-y-2 border-t border-ink-900/10 bg-paper-50/95 px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-sm sm:-mx-8 sm:px-8"
      >
        {blocker && (
          <p id="submit-blocker" className="text-center text-sm text-ink-700">
            {blocker}
          </p>
        )}
        {saving && (
          <p className="text-center text-sm leading-relaxed text-ink-800">
            {t("offlineHint")}
          </p>
        )}

        <button
          type="button"
          onClick={saving ? saveOnPhone : submit}
          aria-describedby={blocker ? "submit-blocker" : undefined}
          disabled={controls.disabled}
          className="min-h-12 w-full rounded-xl bg-ember-500 px-4 py-3 text-base font-semibold text-ink-950 transition hover:bg-ember-400 disabled:cursor-not-allowed disabled:bg-paper-200 disabled:text-ink-700"
        >
          {busy
            ? saving
              ? t("saving")
              : t("submitting")
            : saving
              ? t("saveOnPhone")
              : t("submit")}
        </button>
      </div>

      {/*
        The way out of a wait that may not end: a challenge that never
        solves, or a send on one bar of signal that never answers. Beside the
        main button rather than instead of it, so someone halfway through a
        challenge, or whose send is about to land, is not moved onto the
        other path by a timer.
      */}
      {controls.backup && (
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={saveOnPhone}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-forest-900 px-4 text-base font-semibold text-forest-900 hover:bg-forest-900/5"
          >
            {controls.backup === "slow" ? t("backupSlow") : t("backupNoToken")}
          </button>
          <p className="mt-2 text-sm leading-relaxed text-ink-700">
            {t("backupHint")}
          </p>
        </div>
      )}
    </div>
  );
}
