import postgres from "postgres";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load the repo-root .env without needing a --env-file flag on every invocation.
const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "For local dev: npm run db:up, then copy .env.example to .env",
  );
  process.exit(1);
}

export const sql = postgres(url, {
  max: 8,
  // TaiCOL/GBIF imports send wide multi-row inserts; give them room.
  prepare: false,
  // taxa.id and friends are bigserial. postgres.js returns int8 as a *string* by
  // default to avoid precision loss — safe, but it silently breaks `===` against
  // numbers in JS and JSON round-trips. Our ids are far below 2^53, so parse them
  // as numbers and keep the type annotations honest.
  types: {
    bigint: {
      to: 20,
      from: [20],
      serialize: (v: number | string | bigint) => String(v),
      parse: (v: string) => Number(v),
    },
  },
  onnotice: () => {},
});

/**
 * Fetch JSON with bounded retries. Both upstreams are public goods — be gentle.
 *
 * Long sequential imports against GBIF reliably hit transient ECONNRESET, so the
 * backoff is generous and jittered rather than tight.
 */
export async function fetchJson<T>(
  url: string,
  { retries = 6, timeoutMs = 60_000 }: { retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            "user-agent":
              "conservation-tw/0.1 (citizen science map; https://github.com/)",
            accept: "application/json",
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return (await res.json()) as T;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      // Exponential backoff with jitter, capped at 30s: ~1s, 2s, 4s, 8s, 16s, 30s.
      const delay = Math.min(1000 * 2 ** attempt, 30_000);
      await new Promise((r) => setTimeout(r, delay + Math.random() * 500));
    }
  }
  throw lastErr;
}

/** Run `worker` over `items` with bounded concurrency, preserving input order. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}

export function progress(done: number, total: number, label: string): void {
  const pct = total ? Math.floor((done / total) * 100) : 0;
  process.stdout.write(`\r  ${label}: ${done.toLocaleString()}/${total.toLocaleString()} (${pct}%)   `);
  if (done >= total) process.stdout.write("\n");
}
