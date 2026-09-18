/**
 * Where a page number lands in a result set.
 *
 * Pure, and separate from any page, because the arithmetic is where paging goes
 * wrong: an off-by-one in `offset` repeats or skips a row at every boundary and
 * looks entirely plausible on screen. Two callers already need it and the
 * directory, the report list and the record lists will all be asking the same
 * question.
 *
 * Out-of-range numbers are clamped rather than refused. A directory route sits
 * under a loading.tsx, and calling redirect() or notFound() beneath one answers
 * 200 with the skeleton — so ?page=99 has to render the last page, not bounce.
 * It is also simply the kinder answer to a stale bookmark.
 */
export type PageWindow = {
  /** The requested page, clamped into range. Always 1 or more. */
  page: number;
  /** Rows to skip in the query. */
  offset: number;
  /** 1-based position of the first row on this page; 0 when there are none. */
  from: number;
  /** 1-based position of the last row on this page; 0 when there are none. */
  to: number;
  total: number;
  perPage: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
};

export function pageWindow(
  requested: string | number | undefined | null,
  total: number,
  perPage: number,
): PageWindow {
  const size = Math.max(1, Math.floor(perPage));
  const count = Math.max(0, Math.floor(total) || 0);
  // One page when there is nothing, so an empty result still has a page 1 to
  // be on rather than a page 0 nobody can link to.
  const totalPages = Math.max(1, Math.ceil(count / size));

  // Anything unparseable is page 1: ?page=abc is a mistyped link, like a bad
  // ?category=, and the reader gets the start of the list rather than an error.
  const asked = Math.floor(Number(requested));
  const page = Number.isFinite(asked)
    ? Math.min(Math.max(asked, 1), totalPages)
    : 1;

  const offset = (page - 1) * size;
  const from = count === 0 ? 0 : offset + 1;
  const to = Math.min(offset + size, count);

  return {
    page,
    offset,
    from,
    to,
    total: count,
    perPage: size,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}
