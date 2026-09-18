"use client";

import { useRef } from "react";
import Button from "@/components/lab/ui/Button";
import Notice from "@/components/lab/ui/Notice";
import PageTitle from "@/components/lab/ui/PageTitle";
import Skeleton from "@/components/lab/ui/Skeleton";
import type { LabCopy } from "@/lib/lab/copy";
import type { ReportFlow } from "./useReportFlow";

/**
 * Screen one, and the reason the whole flow is shaped the way it is.
 *
 * The first thing the form asks for is the thing the reporter is already
 * holding their phone up to do. Today's page opens with 你看到了什麼？ and three
 * category pills, which asks a stranger to classify an animal before they have
 * told us anything about it — and the owner has now rejected that opening
 * twice.
 *
 * Nothing else is on this screen. One tile, one row, one help line. The
 * "continue without a photo" way out is the pinned button, where every other
 * screen's way forward is: a second text button in the body would be a second
 * place to look for the same thing.
 *
 * Both controls are real `<input type="file">` elements behind their labels, so
 * the camera opens, the library opens, and the keyboard reaches them. Touching
 * either one starts fetching MapLibre, because the next screen is the map and a
 * shutter press is the longest free head start the flow will ever get.
 */
export default function PhotoStep({
  copy,
  flow,
  titleId,
  heading = "h1",
}: {
  copy: LabCopy;
  flow: ReportFlow;
  titleId: string;
  /** `h2` when this is a section of the photo-first page rather than a screen. */
  heading?: "h1" | "h2";
}) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const { photos } = flow.state;
  const full = photos.length >= 4;

  const take = (
    <input
      ref={camera}
      type="file"
      accept="image/*"
      capture="environment"
      className="sr-only"
      onClick={flow.warmMap}
      onChange={(event) => {
        if (event.target.files) void flow.addFiles(event.target.files);
        event.target.value = "";
      }}
    />
  );

  const choose = (
    <input
      ref={library}
      type="file"
      accept="image/*"
      multiple
      className="sr-only"
      onClick={flow.warmMap}
      onChange={(event) => {
        if (event.target.files) void flow.addFiles(event.target.files);
        event.target.value = "";
      }}
    />
  );

  return (
    <div>
      {heading === "h1" ? (
        <PageTitle id={titleId} size="title">
          {copy.report.photoTitle}
        </PageTitle>
      ) : (
        <h2 id={titleId} className="t-head text-(--fg)">
          {copy.report.photoTitle}
        </h2>
      )}

      {photos.length > 0 ? (
        <div className="mt-8">
          {/* 4:3, the shape a phone camera actually produces, so the hero does
              not crop the animal out of the photo it was taken for. */}
          <div
            data-surface="plate"
            className="rounded-(--radius-sign) relative aspect-4/3 w-full overflow-hidden bg-(--ground)"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photos[0].url}
              alt=""
              className="h-full w-full object-cover"
            />
          </div>
          <ul className="mt-4 flex flex-wrap gap-4">
            {photos.map((photo) => (
              <li key={photo.id} className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt=""
                  className="rounded-(--radius-sign) h-18 w-18 object-cover"
                />
                <button
                  type="button"
                  onClick={() => flow.removePhoto(photo.id)}
                  className="lab-underline t-body inline-flex min-h-11 items-center text-(--fg) underline decoration-2 underline-offset-4"
                >
                  {copy.report.photoRemove}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <label className="rounded-(--radius-sign) mt-8 flex h-50 w-full cursor-pointer flex-col items-center justify-center gap-4 border-2 border-(--fg) text-(--fg) focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--focus)">
          <svg
            aria-hidden="true"
            viewBox="0 0 48 48"
            className="h-12 w-12"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <path d="M4 14h9l4-5h14l4 5h9v26H4z" />
            <circle cx="24" cy="26" r="8" />
          </svg>
          <span className="t-lead t-label font-bold">{copy.report.photoTake}</span>
          {take}
        </label>
      )}

      <p className="mt-6">
        <label className="lab-underline t-body inline-flex min-h-11 cursor-pointer items-center text-(--fg) underline decoration-2 underline-offset-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--focus)">
          {photos.length > 0
            ? full
              ? copy.report.photoAdd
              : copy.report.photoAddAnother
            : copy.report.photoLibrary}
          {choose}
        </label>
      </p>

      {photos.length > 0 ? (
        <p className="mt-4">
          <Button
            variant="secondary"
            onClick={() => camera.current?.click()}
            disabled={full}
            disabledReason={full ? copy.report.photoAddAnother : undefined}
            id="lab-photo-take-more"
          >
            {copy.report.photoTake}
          </Button>
          {take}
        </p>
      ) : null}

      {flow.photoBusy ? (
        <Skeleton className="mt-6" label={copy.common.loading} lines={1} />
      ) : null}

      {flow.photoError === "unreadable" ? (
        <Notice tone="error" live className="mt-6">
          {copy.report.photoUnreadable}
        </Notice>
      ) : null}

      <p className="t-body mt-6 text-(--fg-quiet)">{copy.report.photoHelp}</p>
    </div>
  );
}
