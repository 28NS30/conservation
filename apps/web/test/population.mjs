/**
 * One lock on the public records, shared by test files that run at once.
 *
 * `npm test` runs every file in a process of its own, all at the same time,
 * against one database. Most tests that insert a record do it in a transaction
 * they roll back, or leave it pending, so nothing they make is ever public. A
 * few cannot: the page under test reads on its own connection and sees only
 * what is committed. For as long as such a record exists, every other file
 * sees it too, and some files count the public records: tiles.test.mjs holds
 * the wildlife collection empty on a fixture of imported roadkill and checks a
 * tile's weights against a count in SQL, and collection-pages.test.mjs checks
 * each collection's number against the same count.
 *
 * So a test that commits a public record takes this lock alone, for as long
 * as the record exists, and a file that counts takes it shared, for as long as
 * it runs. A counting file waits until the record is gone; a test that would
 * commit one waits until the counting files are done. It is a Postgres
 * advisory lock because the database is the one thing the processes share,
 * and each hold has a connection of its own, so a process that dies lets go.
 *
 * It holds only between files that take it. credit-and-cookies and
 * pipeline-hardening commit roadkill records without it; those are in neither
 * collection the tile tests hold, but they do enter counts of every record.
 *
 * This file is not a test (the suite runs test/*.test.mjs).
 */
import postgres from "postgres";
// For its side effect: it loads DATABASE_URL from the repository's .env.
import "./helpers.mjs";

const KEY = "test: the public records";

/** Takes the lock; resolves to the function that lets go of it. */
async function hold(shared) {
  const db = postgres(process.env.DATABASE_URL, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    connection: {
      application_name: "test: population lock",
      // A holder that hangs fails whoever is waiting on it, with a lock
      // timeout, rather than leaving the run to wait for ever.
      lock_timeout: "10min",
    },
  });
  try {
    if (shared) await db`select pg_advisory_lock_shared(hashtext(${KEY}))`;
    else await db`select pg_advisory_lock(hashtext(${KEY}))`;
  } catch (e) {
    await db.end();
    throw e;
  }
  // A session's advisory locks end with the session.
  return () => db.end();
}

/** For a file that counts the public records: none appears or goes meanwhile. */
export const steadyPopulation = () => hold(true);

/** For a test that commits a public record: let go once it is deleted. */
export const changePopulation = () => hold(false);
