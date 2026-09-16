import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_URL } from "./helpers.mjs";

/**
 * The magic-link callback has to be reachable.
 *
 * It lives at app/auth/callback, outside [locale], and Supabase sends people to
 * exactly that URL. The locale proxy rewrote it to /zh-TW/auth/callback, which
 * does not exist, so every sign-in link in production landed on a 404. Nothing
 * failed and nothing logged: the site has no users yet, so nobody had tried.
 */
const opts = { redirect: "manual" };

describe("sign-in callback", () => {
  test("is answered by its handler, not by the locale router", async () => {
    const res = await fetch(`${BASE_URL}/auth/callback`, opts);
    assert.notEqual(res.status, 404, "the callback must not 404");
    assert.equal(res.status, 307);
    assert.match(
      res.headers.get("location") ?? "",
      /\/login\?error=missing_code$/,
      "with no code it sends the reader back to sign in, saying why",
    );
  });

  test("a bad code is refused by the exchange, not by routing", async () => {
    const res = await fetch(`${BASE_URL}/auth/callback?code=not-a-real-code`, opts);
    assert.equal(res.status, 307);
    assert.match(res.headers.get("location") ?? "", /error=exchange_failed/);
  });

  test("the login page sends links to the path that works", () => {
    // If either end moves, the two must move together.
    const login = readFileSync(
      join(import.meta.dirname, "..", "app", "[locale]", "(site)", "login", "page.tsx"),
      "utf8",
    );
    assert.match(login, /\/auth\/callback/);
    const proxy = readFileSync(join(import.meta.dirname, "..", "proxy.ts"), "utf8");
    assert.match(proxy, /\(\?!api\|auth\//, "the proxy matcher must exclude auth/");
  });
});
