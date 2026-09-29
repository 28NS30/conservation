/**
 * Sign-in and account deletion, held to what the security audit of 29
 * September 2026 found: a password sign-up anyone could make on a site that
 * never uses passwords, an email quota any script could spend, and a deleted
 * account its reports could still be traced back to.
 *
 *   node --test test/auth-hardening.test.mjs
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { passwordSession, refusesPasswordSessions } from "../lib/supabase/proxy.ts";
import { sendFailure } from "../lib/signInErrors.ts";

const WEB = join(import.meta.dirname, "..");
const ROOT = join(WEB, "..", "..");
const read = (...p) => readFileSync(join(WEB, ...p), "utf8");

/** An unsigned token with these claims: passwordSession reads, it does not verify. */
const token = (claims) =>
  ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

describe("a session opened with a password is not one this site recognises", () => {
  test("a password sign-in is recognised from its token", () => {
    assert.equal(passwordSession(token({ amr: [{ method: "password", timestamp: 1 }] })), true);
    assert.equal(
      passwordSession(token({ amr: [{ method: "totp", timestamp: 2 }, { method: "password", timestamp: 1 }] })),
      true,
    );
  });

  test("an emailed code, a link or Google is not", () => {
    for (const method of ["otp", "magiclink", "oauth"])
      assert.equal(passwordSession(token({ amr: [{ method, timestamp: 1 }] })), false, method);
  });

  test("a token it cannot read is not called a password session", () => {
    for (const t of [undefined, null, "", "abc", "a.b.c", token({}), token({ amr: "password" })])
      assert.equal(passwordSession(t), false, String(t));
  });

  test("refused in production only: local tests sign in with passwords", () => {
    const before = process.env.VERCEL_ENV;
    try {
      process.env.VERCEL_ENV = "production";
      assert.equal(refusesPasswordSessions(), true);
      process.env.VERCEL_ENV = "preview";
      assert.equal(refusesPasswordSessions(), false);
      delete process.env.VERCEL_ENV;
      assert.equal(refusesPasswordSessions(), false);
    } finally {
      if (before === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = before;
    }
  });

  test("the proxy ends such a session, and the server refuses one that gets past", () => {
    const proxy = read("lib", "supabase", "proxy.ts");
    assert.match(proxy, /refusesPasswordSessions\(\) && passwordSession\(got\.data\.session\?\.access_token\)/);
    assert.match(proxy, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
    const server = read("lib", "supabase", "server.ts");
    assert.match(server, /settledBy\(sessionUser\(supabase\), deadline\)/);
    assert.match(server, /return passwordSession\(session\.session\?\.access_token\) \? null : user;/);
  });

  test("the report route asks who is signed in the same way", () => {
    const route = read("app", "api", "reports", "route.ts");
    assert.match(route, /await sessionUser\(supabase\)/);
    assert.doesNotMatch(route, /auth\.getUser\(\)/);
  });

  test("the owner's moderator SQL refuses an account with a password", () => {
    const doc = readFileSync(join(ROOT, "docs", "owner-setup.md"), "utf8");
    assert.match(doc, /and coalesce\(encrypted_password, ''\) = ''/);
    assert.match(doc, /and email_confirmed_at is not null/);
  });
});

describe("a sign-in email needs the browser check", () => {
  test("the form sends a Turnstile token with the request, and resets it after", () => {
    const form = read("components", "auth", "SignInForm.tsx");
    assert.match(form, /captchaToken: captcha/);
    assert.match(form, /resetCaptcha\.current\?\.\(\);/);
    assert.match(form, /needsCaptcha/);
  });

  test("a refused check has its own sentence, in both languages", () => {
    assert.equal(sendFailure(400, "captcha_failed"), "captcha");
    for (const l of ["en", "zh-TW"])
      assert.equal(typeof JSON.parse(read("messages", `${l}.json`)).login.captcha, "string", l);
  });
});

describe("a deleted account leaves nothing that leads back to it", () => {
  const actions = read("app", "[locale]", "(site)", "me", "actions.ts");

  test("its own confirmations are unlinked, before its reports lose their reporter", () => {
    const unlink = actions.indexOf("update moderation_actions m");
    const reports = actions.indexOf("set reporter_id = null, contact_email = null");
    assert.ok(unlink > 0, "moderation_actions are not unlinked");
    assert.ok(unlink < reports, "the reporter is gone before its confirmations can be found");
  });

  test("forum metadata is unlinked, except under a legal hold", () => {
    assert.match(actions, /update forum_post_meta pm\s+set author_id = null/);
    assert.match(actions, /p\.legal_hold or t\.legal_hold/);
  });
});
