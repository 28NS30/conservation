"use client";

import { useTranslations } from "next-intl";
import { isInTaiwanBounds } from "@conservation/shared";
import Button from "@/components/lab/ui/Button";
import Notice from "@/components/lab/ui/Notice";
import PageTitle from "@/components/lab/ui/PageTitle";
import type { LabCopy } from "@/lib/lab/copy";
import LabPlacePicker from "./LabPlacePicker";
import type { ReportFlow } from "./useReportFlow";

/** A fix this tight is the reporter standing at the spot, so the flow moves on. */
const GOOD_FIX_M = 50;

/**
 * Where was it? Nothing is defaulted, and the photo's own coordinate is offered
 * rather than applied.
 *
 * The order on screen is the order of how likely each one is to be right. The
 * device's fix first, because the overwhelmingly common case is somebody
 * standing over the animal. Then the photo's place, when there is one — offered,
 * never applied, because a photo can be taken in one place and reported from
 * another, and a coordinate that appeared without being chosen is a coordinate
 * nobody checked. Then the map, filling what is left.
 *
 * A fix of 50 m or better advances on its own: that is a person at the spot,
 * and asking them to confirm a thing they already did is a tap for nothing.
 * Anything coarser stays put and prints its own radius, so the reporter can
 * decide whether it is good enough, which is a judgement only they can make.
 */
export default function PlaceStep({
  copy,
  flow,
  onAdvance,
  titleId,
  heading = "h1",
  mapHeight,
}: {
  copy: LabCopy;
  flow: ReportFlow;
  /** Called only for a fix good enough that confirming it would be a tap for nothing. */
  onAdvance?: () => void;
  titleId: string;
  heading?: "h1" | "h2";
  mapHeight?: string;
}) {
  const live = useTranslations("report");
  const { place, photos } = flow.state;
  const photoGps = photos.find((photo) => photo.gps)?.gps ?? null;
  const coarse =
    place?.source === "device" &&
    place.accuracyM !== null &&
    place.accuracyM > GOOD_FIX_M;
  const outside = place !== null && !isInTaiwanBounds(place.lng, place.lat);

  return (
    <div>
      {heading === "h1" ? (
        <PageTitle id={titleId} size="title">
          {copy.report.placeTitle}
        </PageTitle>
      ) : (
        <h2 id={titleId} className="t-head text-(--fg)">
          {copy.report.placeTitle}
        </h2>
      )}

      <div className="mt-8 flex flex-wrap gap-4">
        <Button
          variant="secondary"
          onClick={async () => {
            const fixed = await flow.useCurrentPlace();
            if (
              fixed &&
              fixed.accuracyM !== null &&
              fixed.accuracyM <= GOOD_FIX_M
            )
              onAdvance?.();
          }}
        >
          {flow.locating ? live("locating") : copy.report.placeUseCurrent}
        </Button>
        {photoGps ? (
          <Button
            variant="tertiary"
            onClick={() => flow.usePhotoPlace(photoGps)}
          >
            {copy.report.placeUsePhoto}
          </Button>
        ) : null}
      </div>

      {flow.placeError === "denied" ? (
        <Notice tone="error" live className="mt-6">
          {copy.report.placeDenied}
        </Notice>
      ) : null}

      <div className="mt-6">
        <LabPlacePicker
          value={place}
          onPick={(picked) =>
            flow.setPlace({ ...picked, accuracyM: null, source: "map" })
          }
          overlay={copy.report.placeTapMap}
          unavailableLabel={copy.report.placeMapUnavailable}
          {...(mapHeight ? { height: mapHeight } : {})}
        />
      </div>

      {/* No coordinate is ever printed. The map is where a place belongs, at
          whatever precision the database decides to publish; a lat/lng in text
          is a number somebody can copy out of a record that was meant to be
          blurred. */}
      {place ? (
        <p className="t-body mt-4 text-(--fg)">
          {copy.report.placeSet}
          {coarse && place.accuracyM !== null ? (
            <span className="text-(--fg-quiet)">
              {" · "}
              {copy.report.placeAccuracy.replace("{m}", String(place.accuracyM))}
            </span>
          ) : null}
        </p>
      ) : null}

      {outside ? (
        <Notice className="mt-4">{live("outsideTaiwan")}</Notice>
      ) : null}
    </div>
  );
}
