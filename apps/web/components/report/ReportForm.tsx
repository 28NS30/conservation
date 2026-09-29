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
  MAX_CREDIT_NAME,
  CONSENT_VERSION,
  PARTNER_SHARING_PAGES,
  type Category,
  type ContributorLicense,
  type ReportPage,
} from "@conservation/shared";
import { preparePhoto, type PreparedPhoto } from "@/lib/image";
import { browserSupabase, PHOTO_BUCKET } from "@/lib/supabase/client";
import { enqueue } from "@/lib/offline/queue";
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
  PHOTO_UPLOAD_FAILED,
  type ErrorKey,
  type ErrorSlot,
} from "@/lib/report/errors";
import { Link } from "@/i18n/navigation";
import LocationPicker, { useGeolocate, type LatLng } from "./LocationPicker";

type Photo = PreparedPhoto & { previewUrl: string; id: string };
type Phase = "editing" | "submitting" | "done" | "queued" | "error";

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
  const [timeEdited, setTimeEdited] = useState(false);
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState("");
  // The contributor terms (/terms), answered on every report. CC BY 4.0 is the
  // default the team chose (plan question 10); the partner box starts unticked
  // because sharing an exact location is a separate decision (PDPA Art. 7).
  const [license, setLicense] = useState<ContributorLicense>("cc-by-4.0");
  const [creditName, setCreditName] = useState("");
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
   */
  const [queueFailed, setQueueFailed] = useState(false);
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

        // The time IS applied, where the coordinate is only offered, and the
        // asymmetry is deliberate. A photograph taken somewhere else is an
        // ordinary thing — a picture from last week's trip, a screenshot — and
        // filing it at the wrong place puts a wrong dot on a public map. A
        // photograph taken at another TIME is the same photograph, and the time
        // it was taken is simply when the animal was seen. Someone who
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
    [photos.length, location, timeEdited, fail],
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
    accuracyM: accuracyM ?? undefined,
    observedAt: new Date(observedAt).toISOString(),
    taxonId: species?.id,
    taxonUnknown: unsure || undefined,
    notes: notes.trim() || undefined,
    contactEmail: email.trim() || undefined,
    license,
    // CC0 asks no credit, and its form hides the field; a name typed before
    // switching is not sent.
    creditName: license === "cc-by-4.0" ? creditName.trim() || undefined : undefined,
    sharePartners: asksPartners ? sharePartners : undefined,
    consentVersion: CONSENT_VERSION,
    // In the payload rather than added at send time, so a test saved on the
    // phone offline is still sent as a test.
    test: test || undefined,
  });

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
    // Abandon anything in flight. Its photos may already be in the bucket and
    // its row may already be stored; the queue re-sends under the same nonce,
    // so the server answers that with the row it has rather than a second one.
    liveSend.current += 1;
    inFlight.current?.abort();
    setError(null);
    setQueueFailed(false);
    setPhase("submitting");
    try {
      await enqueue({
        id: nonce.current,
        payload: entered(location, category),
        photos: photos.map((p) => p.blob),
      });
      window.dispatchEvent(new Event("conservation:queue-changed"));
      setPhase("queued");
    } catch (queueErr) {
      // `t` is the `report` namespace and this key lives in `offline`, so
      // the old call rendered the literal string "report.queueFailed" to
      // the one person whose report had just failed to save anywhere at all.
      console.error("[report] could not queue:", queueErr);
      setQueueFailed(true);
      setPhase("error");
    }
  }

  async function submit() {
    setError(null);
    setQueueFailed(false);
    // Unreachable through the button, which is disabled without both, and the
    // sentence above it already says which requirement is unmet.
    if (!location || !category) return;

    const mine = ++liveSend.current;
    const stillMine = () => liveSend.current === mine;
    const controller = new AbortController();
    inFlight.current = controller;
    setSendNumber(mine);
    setPhase("submitting");
    try {
      let paths: string[] = [];

      if (photos.length) {
        const signRes = await fetch(withBase("/api/uploads/sign"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          // Say what is being uploaded rather than leaning on the default.
          // `stripAndDownscale` always writes WebP through a canvas, so this
          // is the truth here — and stating it is what lets the key match the
          // bytes for a client whose canvas cannot.
          body: JSON.stringify({
            count: photos.length,
            contentType: photos[0].blob.type || "image/webp",
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

        const storage = browserSupabase().storage.from(PHOTO_BUCKET);
        // The result was thrown away. supabase-js resolves with `{ error }`
        // rather than rejecting, so a photograph that never reached the bucket
        // looked exactly like one that did — and the report was then filed with
        // a path pointing at nothing. flush.ts has always checked this.
        const results = await Promise.all(
          uploads.map((u, i) =>
            storage.uploadToSignedUrl(u.path, u.token, photos[i].blob),
          ),
        );
        if (!stillMine()) return;
        const bad = results.find((r) => r.error);
        if (bad) {
          console.error("[report] photo upload:", bad.error);
          throw new ReportError(PHOTO_UPLOAD_FAILED);
        }
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
      const networkish = offline || e instanceof TypeError;

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
      <p role="alert" className={`mt-2 ${ALERT}`}>
        {t(`errors.${error.key}`)}
      </p>
    ) : null;

  // A function, not a value: the editing phase renders neither card, and
  // resolving a message it will not show is work done on every keystroke.
  const another = () => (
    <button
      type="button"
      onClick={onReportAnother}
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
  const cameraInput = (
    <input
      type="file"
      accept="image/*"
      capture="environment"
      className="sr-only"
      onChange={(e) => {
        void addFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );
  const libraryInput = (
    <input
      type="file"
      accept="image/*"
      multiple
      className="sr-only"
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

        Two inputs, because one could not do both. The old single input carried
        `capture="environment"`, and on a phone that opens the camera and
        nothing else, so a photo taken a minute earlier in the camera app could
        not be attached at all. The tile takes a photo; the line under it
        chooses one already taken.
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
            <span className="text-lg font-semibold">{t("photoTake")}</span>
            {cameraInput}
          </label>
        ) : (
          <div className="flex flex-wrap gap-3">
            {photos.map((p) => (
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
                    setPhotos((prev) => prev.filter((x) => x.id !== p.id));
                  }}
                  // 20px was under any target guideline, and it sits at the
                  // corner of a thumbnail with the "+" tile 8px away. The disc is
                  // 24px and a pseudo-element carries the rest of the 44px hit
                  // area inwards and downwards, over the photograph it belongs
                  // to, so growing it cannot steal a tap from the next tile.
                  className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-paper-200 text-sm text-ink-800 ring-1 ring-ink-900/15 after:absolute after:-bottom-5 after:-left-5 after:right-0 after:top-0 after:content-['']"
                  aria-label={t("removePhoto")}
                >
                  ×
                </button>
              </div>
            ))}

            {photos.length < MAX_PHOTOS && (
              <label className="grid h-24 w-24 cursor-pointer place-items-center rounded-lg border-2 border-dashed border-ink-900/25 text-2xl text-ink-600 hover:border-forest-900/50 hover:text-forest-900 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ember-400">
                <span aria-hidden>+</span>
                <span className="sr-only">{t("photoTake")}</span>
                {cameraInput}
              </label>
            )}
          </div>
        )}

        {photos.length < MAX_PHOTOS && (
          <p className="mt-2">
            <label className="inline-flex min-h-11 cursor-pointer items-center text-base font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ember-400">
              {t("photoLibrary")}
              {libraryInput}
            </label>
          </p>
        )}

        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          {preparing ? t("photoProcessing") : t("photoHelp")}
        </p>

        {heldForReview && (
          <p className="mt-2 text-sm leading-relaxed text-ink-800">
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
          }}
          maptilerKey={maptilerKey}
        />
        {/* "Tap to adjust" is about a pin that exists. Before one does, the
            instruction is to make one — the old text told a reporter with
            nothing chosen to adjust something that was not there. */}
        <p className="mt-1.5 text-sm text-ink-600">
          {location ? t("tapToAdjust") : t("needLocation")}
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

      <section>
        <SpeciesPicker
          page={page}
          value={species}
          onChange={setSpecies}
          unsure={unsure}
          onUnsure={setUnsure}
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
            max={toLocalInput(new Date())}
            onChange={(e) => {
              setObservedAt(e.target.value);
              setTimeEdited(true);
              setTimeFromPhoto(false);
            }}
            className="min-h-12 w-full rounded-lg border border-ink-900/20 bg-paper-100 px-3 py-2 text-base text-ink-900"
          />
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
            className="w-full rounded-lg border border-ink-900/20 bg-paper-100 px-3 py-2 text-base text-ink-900"
          />
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="min-h-12 w-full rounded-lg border border-ink-900/20 bg-paper-100 px-3 py-2 text-base text-ink-900"
          />
          <p className="mt-1 text-sm text-ink-600">{t("emailHelp")}</p>
        </div>
      </section>

      {/* How the record may be used: the contributor terms, per report. */}
      <fieldset className="space-y-4 rounded-lg border border-ink-900/15 bg-paper-100 px-4 py-4">
        <legend className="px-1 text-base font-semibold text-forest-900">
          {t("shareTitle")}
        </legend>
        <p className="text-sm leading-relaxed text-ink-700">{t("shareIntro")}</p>
        <div className="space-y-2" role="radiogroup" aria-label={t("licenceLabel")}>
          {(
            [
              ["cc-by-4.0", "licenceBy", "licenceByHint"],
              ["cc0-1.0", "licenceZero", "licenceZeroHint"],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="flex min-h-11 cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="license"
                value={value}
                checked={license === value}
                onChange={() => setLicense(value)}
                className="mt-1 size-5 accent-leaf-600"
              />
              <span>
                <span className="block text-base text-ink-900">{t(label)}</span>
                <span className="block text-sm text-ink-600">{t(hint)}</span>
              </span>
            </label>
          ))}
        </div>
        {license === "cc-by-4.0" && (
          <div>
            <label htmlFor="creditName" className="mb-1 block text-base font-semibold text-forest-900">
              {t("creditLabel")}{" "}
              <span className="text-sm font-normal text-ink-600">({t("optional")})</span>
            </label>
            <input
              id="creditName"
              type="text"
              maxLength={MAX_CREDIT_NAME}
              value={creditName}
              onChange={(e) => setCreditName(e.target.value)}
              autoComplete="nickname"
              className="min-h-12 w-full rounded-lg border border-ink-900/20 bg-paper-50 px-3 py-2 text-base text-ink-900"
            />
            <p className="mt-1 text-sm text-ink-600">{t("creditHint")}</p>
          </div>
        )}
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
          {tOffline("queueFailed")}
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
      <div className="space-y-2">
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
    </div>
  );
}
