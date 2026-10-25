import { offlineDb, readExisting, DRAFT_STORE } from "./db.ts";

/**
 * A report still being filled in, kept so that losing the page does not lose it.
 *
 * Android often discards a tab while the camera app is open, and the reporter
 * comes back to an empty form with the animal still in front of them; a link,
 * a back swipe or the language switch dropped everything too. So the form
 * keeps what has been entered as it goes, and puts it back when it opens.
 *
 * Two halves, because the two kinds of thing want different places:
 *
 *   - The typed fields go to sessionStorage, keyed by page. It belongs to the
 *     tab, survives a reload and a discarded tab coming back, and is gone when
 *     the tab is closed — which on a shared school computer is what should
 *     happen to someone's half-written report.
 *   - The photographs are blobs, too big for sessionStorage, so they go to the
 *     `drafts` store in IndexedDB under the draft's id, which is the form's
 *     submission nonce. The fields name that id, so a draft only ever gets its
 *     own photographs back, whichever other tab is filling in the same page.
 *
 * A draft older than DRAFT_TTL_MS is dropped, in both halves: by then it is not
 * the report someone was in the middle of. And the photographs of a tab that
 * was closed have no fields left pointing at them, so they are swept by age.
 *
 * On a page that had to leave the database at version 1, because a tab of an
 * older build had it open (db.ts), there is no `drafts` store: the fields still
 * come back, and the photographs quietly do not.
 */
export const DRAFT_TTL_MS = 24 * 3600 * 1000;

const FIELDS_PREFIX = "report-draft:";

/** One photograph of a draft, as the form holds it, minus its preview URL. */
export type DraftPhoto = {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  gps: { lat: number; lng: number } | null;
  takenAt: Date | null;
};

type StoredFields<T> = { savedAt: number; fields: T };
type StoredPhotos = { id: string; savedAt: number; photos: DraftPhoto[] };

/** The fields saved for this page, if any are recent enough. */
export function loadDraftFields<T>(key: string, now = Date.now()): T | null {
  try {
    const raw = sessionStorage.getItem(FIELDS_PREFIX + key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredFields<T>;
    if (!stored?.fields || now - stored.savedAt > DRAFT_TTL_MS) {
      sessionStorage.removeItem(FIELDS_PREFIX + key);
      return null;
    }
    return stored.fields;
  } catch {
    return null;
  }
}

export function saveDraftFields<T>(key: string, fields: T): void {
  try {
    const stored: StoredFields<T> = { savedAt: Date.now(), fields };
    sessionStorage.setItem(FIELDS_PREFIX + key, JSON.stringify(stored));
  } catch {
    // Storage full or refused (a private window on an old iPhone). The draft
    // is a convenience; the form goes on working without it.
  }
}

export function dropDraftFields(key: string): void {
  try {
    sessionStorage.removeItem(FIELDS_PREFIX + key);
  } catch {
    // As above.
  }
}

/** Keep a draft's photographs, replacing whatever it had. */
export async function saveDraftPhotos(id: string, photos: DraftPhoto[]): Promise<void> {
  try {
    const conn = await offlineDb();
    if (!conn.objectStoreNames.contains(DRAFT_STORE)) return;
    if (photos.length === 0) await conn.delete(DRAFT_STORE, id);
    else await conn.put(DRAFT_STORE, { id, savedAt: Date.now(), photos } satisfies StoredPhotos);
  } catch (e) {
    console.error("[draft] could not keep the photos:", e);
  }
}

/** A draft's photographs, if they are still here. */
export async function loadDraftPhotos(id: string, now = Date.now()): Promise<DraftPhoto[]> {
  try {
    const conn = await offlineDb();
    if (!conn.objectStoreNames.contains(DRAFT_STORE)) return [];
    const stored = (await conn.get(DRAFT_STORE, id)) as StoredPhotos | undefined;
    if (!stored || now - stored.savedAt > DRAFT_TTL_MS) return [];
    return stored.photos;
  } catch {
    return [];
  }
}

export async function dropDraftPhotos(id: string): Promise<void> {
  try {
    const conn = await offlineDb();
    if (conn.objectStoreNames.contains(DRAFT_STORE)) await conn.delete(DRAFT_STORE, id);
  } catch {
    // Swept by age later.
  }
}

/** Drop every draft's photographs older than DRAFT_TTL_MS. */
export async function purgeDraftPhotos(now = Date.now()): Promise<void> {
  try {
    const conn = await offlineDb();
    if (!conn.objectStoreNames.contains(DRAFT_STORE)) return;
    for (const d of (await conn.getAll(DRAFT_STORE)) as StoredPhotos[])
      if (now - d.savedAt > DRAFT_TTL_MS) await conn.delete(DRAFT_STORE, d.id);
  } catch {
    // Tried again the next time a report page opens.
  }
}

/**
 * Forget every draft on this device: the photographs, and this tab's fields.
 * For signing out, where the next person on a shared computer should not find
 * someone else's half-written report.
 */
export async function forgetDrafts(): Promise<void> {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(FIELDS_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    // Nothing to forget, or no access to it.
  }
  await readExisting(async (conn) => {
    if (conn.objectStoreNames.contains(DRAFT_STORE)) await conn.clear(DRAFT_STORE);
  }, undefined);
}
