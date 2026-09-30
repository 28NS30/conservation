import type { Band } from "@/lib/report/classifyPolicy";

/**
 * What POST /api/identify answers, for the report form (lib/report/identify.ts
 * builds it on the server). Types only, so the browser bundle takes nothing.
 */

export type PhotoSuggestion = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  commonNameEn: string | null;
  taicolId: string | null;
  isInvasive: boolean | null;
  reportCount: number;
  /** The model's probability for the species, 0–1. */
  score: number;
};

export type PhotoIdentification = {
  band: Band;
  /** At most five, best first; empty when the model could not tell. */
  suggestions: PhotoSuggestion[];
  /**
   * On the invasive page, the model's best answer when it is NOT invasive:
   * the page cannot offer it, and the reporter should hear that the animal
   * may be native before they pick an invasive look-alike.
   */
  outsidePage: { scientificName: string; commonNameZh: string | null; commonNameEn: string | null } | null;
};

