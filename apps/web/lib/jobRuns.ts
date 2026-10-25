import "server-only";
import { sql } from "@/lib/db";
import {
  JOBS,
  JOB_RUN_AGES,
  JOB_RUN_FINISH,
  JOB_RUN_START,
  errorDetail,
  jobDetail,
  type JobName,
} from "@/lib/monitoring";

/**
 * A row in `job_runs` (0036) for each run of a scheduled job: written when it
 * starts, completed when it ends.
 *
 * Nothing here may stop a job. Before 0036 is applied, or with the database
 * refusing writes, the job runs exactly as it did before and the failure is
 * logged once per run. A job that is killed at its time limit never reaches
 * the second write, so its row stays unfinished, which is how one shows up.
 *
 * Only ever called after the route has checked CRON_SECRET, so nobody outside
 * can add rows.
 */
async function start(job: JobName): Promise<number | null> {
  try {
    const [row] = await sql.unsafe<{ id: number }[]>(JOB_RUN_START, [job]);
    return row.id;
  } catch (e) {
    console.error(`[job-runs] ${job}: start not recorded:`, (e as Error).message);
    return null;
  }
}

async function finish(id: number | null, ok: boolean, detail: string): Promise<void> {
  if (id === null) return;
  try {
    await sql.unsafe(JOB_RUN_FINISH, [id, ok, jobDetail(detail)]);
  } catch (e) {
    console.error("[job-runs] end not recorded:", (e as Error).message);
  }
}

/**
 * Run a job's work between the two writes. A run is good when the route
 * answers 2xx; its detail is that answer, which every job keeps to counts.
 */
export async function withJobRun(job: JobName, work: () => Promise<Response>): Promise<Response> {
  const id = await start(job);
  try {
    const res = await work();
    await finish(id, res.ok, await res.clone().text());
    return res;
  } catch (e) {
    await finish(id, false, errorDetail(e));
    throw e;
  }
}

/**
 * Seconds since each job last finished well, for /api/health. A job with no
 * good run has no key; null if the table cannot be read (0036 not applied).
 */
export async function secondsSinceGoodRun(): Promise<Partial<Record<JobName, number>> | null> {
  try {
    const rows = await sql.unsafe<{ job: JobName; seconds: number }[]>(JOB_RUN_AGES, [[...JOBS]]);
    return Object.fromEntries(rows.map((r) => [r.job, r.seconds]));
  } catch (e) {
    console.error("[health] job_runs:", (e as Error).message);
    return null;
  }
}
