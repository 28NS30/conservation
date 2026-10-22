import type { Category, ReportPage } from "@conservation/shared";
import { offlineDb, readExisting, SENT_STORE } from "./db.ts";

/**
 * The reports this device has sent, so that /me can list them for someone who
 * never signed in.
 *
 * Reporting needs no account, and for now only the team can sign in at all, so
 * for almost every reporter a report left the phone and was never seen again:
 * the receipt on the form is gone with the next report, and the queue's own
 * receipts last a day. This keeps the one thing needed to find a report again
 * — its id — with when it went, from which page, and what the form called it.
 * Nothing the server does not already show the holder of the id: /me asks the
 * server only whether each is public, held, or gone (app/api/receipts).
 *
 * Kept on the device and nowhere else. Cleared with the offline copies on sign
 * out (components/offline/ForgetOfflineCopies.tsx), and by the reporter from
 * /me. Never a moderator's test, which is not a contribution.
 */
export type SentReport = {
  /** The report's id on the server. */
  id: string;
  sentAt: number;
  page: ReportPage;
  category: Category;
  /** The species as the form showed it, or null when none was named. */
  label: string | null;
};

/** Enough for anyone's reports from one phone, and a bound on the store. */
const KEEP = 200;

/**
 * Remember a sent report. Never throws: a report that reached the server is
 * sent, whatever this device can or cannot write down about it.
 */
export async function recordSent(report: SentReport): Promise<void> {
  if (!report.id) return;
  try {
    const conn = await offlineDb();
    await conn.put(SENT_STORE, report);
    const all = (await conn.getAll(SENT_STORE)) as SentReport[];
    if (all.length > KEEP) {
      const oldest = all.sort((a, b) => a.sentAt - b.sentAt).slice(0, all.length - KEEP);
      for (const r of oldest) await conn.delete(SENT_STORE, r.id);
    }
  } catch (e) {
    console.error("[sent] could not remember a sent report:", e);
  }
}

/** Newest first. Empty when nothing was ever sent from here. */
export async function listSent(): Promise<SentReport[]> {
  const all = await readExisting(async (conn) => {
    if (!conn.objectStoreNames.contains(SENT_STORE)) return [];
    return (await conn.getAll(SENT_STORE)) as SentReport[];
  }, [] as SentReport[]);
  return all.sort((a, b) => b.sentAt - a.sentAt);
}

/** Forget every sent report on this device. */
export async function forgetSent(): Promise<void> {
  await readExisting(async (conn) => {
    if (conn.objectStoreNames.contains(SENT_STORE)) await conn.clear(SENT_STORE);
  }, undefined);
}
