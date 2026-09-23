/**
 * The repository must not be able to accept a secret.
 *
 * This is not hypothetical here. A sibling project committed a working Gmail
 * password to a public repo inside a form component, and it sat there until
 * someone read the file. The lesson taken was "do not paste secrets", which is
 * a rule about people. This is the rule about the repository: the paths a
 * secret actually arrives on are ignored, so the mistake does not have a route.
 *
 * `.gitignore` had `.env` and `.env.local`. It did not have
 * `.env.production.local` — which is where `vercel env pull` puts a production
 * pull, and one of the four files Next.js loads unprompted. A production
 * database password would have landed there untracked but NOT ignored, and the
 * next `git add -A` would have published it.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const git = (...args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });

/** `git check-ignore` exits 1 for "not ignored", which is not an error. */
function ignored(path) {
  try {
    git("check-ignore", "-q", "--no-index", path);
    return true;
  } catch (err) {
    if (err.status === 1) return false;
    throw err;
  }
}

/**
 * The tracked files whose staged contents contain `needle`.
 *
 * The index is the right thing to search: it is exactly what a push publishes,
 * and it sees a staged-but-uncommitted secret, which is the moment you still
 * want to be told. Narrowing with `git grep` rather than reading all 700-odd
 * files turns four seconds into a tenth of one; `-I` drops binaries, which
 * cannot hold a credential in a form anything would read back.
 */
function candidates(needle) {
  try {
    return git("grep", "--cached", "-I", "-l", "-F", "-e", needle, "-z")
      .split("\0")
      .filter(Boolean);
  } catch (err) {
    if (err.status === 1) return []; // git grep: no matches
    throw err;
  }
}

/** A tracked file's staged contents, or null if it is binary or unreadable. */
function blob(file) {
  try {
    return git("show", `:${file}`);
  } catch {
    return null;
  }
}

describe("secrets cannot reach the repository", () => {
  // Every name Next.js loads on its own, plus the two `vercel env pull` writes,
  // plus the same set one workspace down — apps/web is where `vercel` is run,
  // because that is the Vercel root directory.
  const MUST_BE_IGNORED = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
    ".env.production",
    ".env.production.local",
    ".env.test",
    ".env.test.local",
    "apps/web/.env",
    "apps/web/.env.local",
    "apps/web/.env.production.local",
    "scripts/.env",
    "supabase/.env",
  ];

  for (const path of MUST_BE_IGNORED) {
    test(`${path} is ignored`, () => {
      assert.equal(
        ignored(path),
        true,
        `${path} is not ignored. A secret written there would be committed by ` +
          `\`git add -A\`. Widen .gitignore rather than deleting this case.`,
      );
    });
  }

  test(".env.example is NOT ignored", () => {
    // The template is the one env file that belongs in git: it is what tells a
    // new contributor which variables exist. A blanket `.env*` without the
    // negation would silently stop it being updatable.
    assert.equal(ignored(".env.example"), false);
    assert.doesNotThrow(() => git("ls-files", "--error-unmatch", ".env.example"));
  });

  test("no tracked file holds a Postgres URL for a real host", () => {
    // The host decides this, not the password. `.env.example` and the CI
    // workflow both carry postgres:postgres@127.0.0.1 and postgres:postgres@
    // localhost — the docker-compose and GitHub-service credential, which is
    // the same on every machine in the world and is what those files are FOR.
    // A check on "does it have a password" calls both of them leaks; a check
    // on "does it point somewhere real" calls neither, and still catches
    // `...@aws-0-ap-northeast-1.pooler.supabase.com`, which is the shape a
    // production URL actually has.
    const LOOPBACK = /^(localhost|127(\.\d+){3}|\[::1\]|0\.0\.0\.0|host\.docker\.internal|db|postgres)$/;
    const PLACEHOLDER = /^(\[?(your|password|pass|secret|changeme|xxx+|\*+|\.{3}|<.*>).*)$/i;

    const offenders = [];
    for (const file of candidates("postgres")) {
      const body = blob(file);
      if (body === null) continue;
      for (const m of body.matchAll(
        /postgres(?:ql)?:\/\/([^\s:@/]+):([^\s:@/]+)@([^\s:@/?]+)/g,
      )) {
        const [, , password, host] = m;
        if (LOOPBACK.test(host)) continue;
        if (PLACEHOLDER.test(decodeURIComponent(password))) continue;
        offenders.push(`${file}: points at ${host}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `a database URL for a real host is in git:\n${offenders.join("\n")}\n` +
        `Remove it, then rotate that password — it is public from the moment ` +
        `it is pushed, and deleting the line does not remove it from history.`,
    );
  });

  test("no tracked file holds a key in Supabase's newer formats", () => {
    // The JWT check above cannot see these, and that is the point of having
    // both. Supabase now issues opaque keys alongside the legacy JWTs, and
    // this project has all four live:
    //
    //   sb_publishable_…   public by design, harmless, must NOT be flagged
    //   sb_secret_…        bypasses RLS exactly as service_role does
    //   sbp_…              a personal access token: full Management API
    //                      access to every project on the account
    //
    // `sb_secret_` is the one the JWT decoder would have sailed straight past,
    // because it is not a JWT and has no `role` claim to read. `sbp_` is here
    // because one was leaked from this repo's own tooling, and the cheapest
    // place to catch the next one is before it is committed.
    const PATTERNS = [
      ["sb_secret_", /\bsb_secret_[A-Za-z0-9_-]{8,}/g],
      ["sbp_", /\bsbp_[0-9a-f]{32,}/g],
    ];
    const offenders = [];
    for (const [needle, re] of PATTERNS) {
      for (const file of candidates(needle)) {
        const body = blob(file);
        if (body === null) continue;
        for (const hit of body.match(re) ?? [])
          offenders.push(`${file}: ${hit.slice(0, needle.length + 4)}…`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `a Supabase secret is in git:\n${offenders.join("\n")}\n` +
        `Remove it, then rotate it — it is public from the moment it is pushed, ` +
        `and deleting the line does not remove it from history.`,
    );
  });

  test("...but a publishable key is not a secret and is not flagged", () => {
    // A check that cries wolf gets deleted. `sb_publishable_` is the browser
    // key: it is meant to ship, and flagging it would teach somebody to
    // silence this file.
    const fake = "sb_publishable_" + "x".repeat(24);
    assert.doesNotMatch(fake, /\bsb_secret_[A-Za-z0-9_-]{8,}/);
    assert.doesNotMatch(fake, /\bsbp_[0-9a-f]{32,}/);
  });

  test("no tracked file holds a service_role key", () => {
    // A Supabase service_role JWT bypasses RLS entirely: with one, `web_anon`'s
    // lack of `select` on `reports` — the whole location-privacy boundary —
    // stops meaning anything. It belongs in the Vercel environment and nowhere
    // else, never in a NEXT_PUBLIC_* name, never in git.
    const offenders = [];
    for (const file of candidates("eyJ")) {
      const body = blob(file);
      if (body === null) continue;
      // A real JWT's payload decodes to JSON naming the role. Matching the
      // literal string "service_role" would flag this test and the docs.
      //
      // `iss: "supabase-demo"` is exempt, and this exemption is the whole
      // reason the check decodes rather than greps. `.env.example` carries a
      // service_role key for `http://127.0.0.1:54321` — the local Supabase CLI
      // stack. That key is printed in Supabase's own documentation, is signed
      // with a secret everybody has, and grants nothing anywhere but a
      // developer's own laptop. It is the correct contents of that file. A
      // grep would have called it a leak, someone would have "fixed" it, and
      // the next person to run the stack locally would be stuck.
      //
      // The claim that matters is `ref`: a key minted for a real project
      // names it, and the demo key names nothing.
      for (const jwt of body.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\./g) ?? []) {
        let payload;
        try {
          payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
        } catch {
          continue;
        }
        if (payload?.role !== "service_role") continue;
        if (payload?.iss === "supabase-demo" && !payload?.ref) continue;
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, [], `service_role key in: ${offenders.join(", ")}`);
  });
});
