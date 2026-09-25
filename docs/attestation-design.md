> ## Read this first — what this document is, and how much to trust it
>
> This is a **research artifact**, not a reviewed engineering plan. It was produced
> by a multi-agent research pass over Apple's and Google's own documentation, with
> the least-certain claims adversarially re-checked against primary sources. It is
> committed because throwing it away would mean paying for it twice, and because
> §7 is more honest about its own gaps than most designs are.
>
> **What I verified myself, rather than taking from the research:**
>
> - The claim that the Turnstile fail-open is a *live hole* is **false**, and it
>   appeared twice. Production answers `403 challenge_failed` to a tokenless
>   submission — I sent one, with an unresolvable photo path so it could not reach
>   an insert on either branch. The key is set and the gate enforces. Both
>   occurrences are struck through below. The *principle* it was arguing from —
>   endpoint strength is min-over-branches — is sound and load-bearing.
> - The seven iOS assertion vectors are real. They come from
>   `veehaitch/devicecheck-appattest`'s test resources, and the research proved
>   authenticity by chain-verifying them to Apple's published root with `openssl`
>   rather than assuming it. That matters: the signature construction in §5.2
>   contradicts a plausible reading of Apple's prose, and the evidence is why it
>   should be believed over the prose.
> - `packages/shared` is 613 lines and does use `new URLSearchParams()`
>   (`src/index.ts:199`), so `docs/app-and-site.md`'s "no DOM global anywhere —
>   checked, not assumed" is not exact.
>
> **What I have NOT verified:** the Apple and Google verification steps themselves,
> the migration SQL, and the file-by-file plan. Nothing here has been compiled or
> run. Treat §2 and §3 as a starting point to review, not as code to transcribe.
>
> **One bias to keep in mind:** a sibling research agent in the same run reported
> that `apps/web/AGENTS.md` contains an instruction to route edits around the
> permission system. It does not — that file is 678 bytes and contains only the
> Next.js block. The agent was describing an instruction it had itself inherited.
> These agents are careful and were right about a great deal; they were also
> confidently wrong about a checkable fact. Check the checkable things.
>
> Everything below this line is the research output, unedited except for the two
> struck-through corrections.

---

# IMPLEMENTATION DESIGN — server-side device attestation for `POST /api/reports`

Repo: `/Users/neo/conservation`, branch `write-down-what-production-is` (df3550b). Everything below was checked against the real files; line numbers are as of that commit.

**Three adversarial corrections are load-bearing and are applied throughout. Do not re-derive them from the researchers' original text:**

1. **The assertion signature is verified with `nonce` as the MESSAGE, not as a pre-computed digest.** The signed value is `SHA256(SHA256(authenticatorData || clientDataHash))`. Confirmed on 7 device-captured assertions whose attestation chain verifies to Apple's real root. The "double hash always fails" claim is inverted and would cause someone to delete the signature check.
2. **`apple_validation_category_01` is `1` only on Apple-internal builds.** A real App Store app reports `4`, TestFlight `2`. Enforcing the sample's `1` rejects 100% of genuine users. These extensions are also iOS 27+ only. v1 parses and logs; it never rejects.
3. **Moving the verifier out of `lib/abuse.ts` is hygiene, not a control.** ~~The live hole is that `route.ts:68` lets the client pick its branch and `abuse.ts:19` returns `true` when `TURNSTILE_SECRET_KEY` is unset.~~ **Corrected: not a live hole.** Production answers `403 challenge_failed` to a tokenless submission — measured, see the preamble — so the key is set and that branch is unreachable there. `route.ts:68` also has no branch for a client to pick today. The underlying principle stands and is why the rest of this design is shaped as it is: **endpoint strength is min-over-branches**, so the moment a second branch exists, the weakest one defines the endpoint. Endpoint strength is min-over-branches; the weakest branch today is *no token at all*. That is fixed here, in §3 and §6, or none of this work buys anything.

---

## 1. THE SHAPE

### 1.1 Trust tiers (the policy this all resolves to)

| Tier | Proof | Rate-limit subject | Report authority |
|---|---|---|---|
| **A — attested** | App Attest assertion, or Play Integrity standard token | `device:<keyId>` (iOS) / `install:<installId>` + IP (Android) | Today's status logic unchanged |
| **B — challenged** | Turnstile, verified (web form) | `user:<id>` or `ip:<ip>` | Today's status logic unchanged |
| **C — none** | — | — | 403 |

There is no client-settable "attestation unsupported" flag. Apple states the server "can no longer require assertions" for devices where `DCAppAttestService.isSupported` is false ([Establishing your app's integrity](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity)), but if the client declares that, it is a bypass for everyone. **Recommendation:** such devices fall back to tier B by opening the web form in the system browser. This costs a browser hop for a small minority and creates no new branch. It is a product decision — flagged in §7.

### 1.2 Endpoints

```
POST /api/attest/challenge          new
POST /api/attest/ios/register       new   (ONE-TIME ATTESTATION)
POST /api/reports                   changed (PER-REQUEST ASSERTION)
GET  /api/health                    changed (reports gate state)
```

Android has **no** challenge and **no** registration step. Play Integrity standard requests carry `requestHash`, not a server nonce, and Google states "Standard requests are automatically protected against replay attacks" ([standard](https://developer.android.com/google/play/integrity/standard)). Forcing symmetry would push Android onto classic requests, which Google says "should be made less frequently... as an occasional one-off" — off-label for a primary submission path. **The two platforms are deliberately asymmetric.**

#### `POST /api/attest/challenge`

```jsonc
// request
{ "purpose": "attest" | "assert" }        // ios only; android never calls this
// 201
{ "challenge": "<43-char base64url of 32 random bytes>", "expiresAt": "<iso8601>" }
```

The challenge string **is** its own primary key. There is no separate id the client could point at someone else's row. TTL: `attest` 10 min, `assert` 2 min. Rate-limited `attest-challenge:${ip}`, 300/60s, mirroring `uploads/sign/route.ts:37`.

#### `POST /api/attest/ios/register` — the one-time attestation

```jsonc
// request
{
  "keyId":       "<base64, decodes to 32 bytes>",
  "attestation": "<base64 CBOR attestation object>",
  "challenge":   "<the string issued with purpose='attest'>"
}
// 201 { "ok": true }
// 403 { "error": "attestation_failed" }
```

The server accepts **no** app id, team id, environment or aaguid from the client. All four are deployment constants.

#### `POST /api/reports` — the per-request assertion

The proof travels in **headers**, not the body, because `route.ts:38` does `await req.json()` and a body-carried assertion would be hashing a body containing itself:

```
X-Attest-Platform:   ios | android
X-Attest-Key-Id:     <base64 keyId>                  (ios)
X-Attest-Assertion:  <base64 CBOR {signature, authenticatorData}>   (ios)
X-Attest-Client-Data:<the exact clientData bytes, base64>           (ios)
X-Attest-Token:      <play integrity token>          (android)
X-Attest-Install-Id: <uuid the app generated at first launch>       (android)
```

Body stays as today plus an optional `attestation` marker (§3.5). The digest is computed over a **canonical field subset**, never the raw body — decided once, stated in code.

### 1.3 Flow — iOS

```
first launch
  app: DCAppAttestService.isSupported ? generateKey() : fall back to web form
  app: POST /api/attest/challenge {purpose:"attest"}        -> C_attest
  app: clientDataHash = SHA256(utf8(C_attest))
       attestKey(keyId, clientDataHash: clientDataHash)
  app: POST /api/attest/ios/register {keyId, attestation, challenge: C_attest}
  app: store keyId in Keychain. NOTHING ELSE.
  srv: verify 11 steps, consume challenge atomically, insert attested_keys row

every submission
  app: POST /api/attest/challenge {purpose:"assert"}        -> C_assert
  app: digest = base64url(SHA256(utf8(canonicalSubmission(fields))))
       clientData = canonicalClientData(C_assert, digest)   // exact byte string
       generateAssertion(keyId, clientDataHash: SHA256(utf8(clientData)))
  app: POST /api/reports  + headers above
  srv: verify 6 steps, advance counter atomically, consume C_assert, insert report
```

### 1.4 Flow — Android

```
report composer opens (NOT app launch)
  app: StandardIntegrityManager.prepareIntegrityToken(cloudProjectNumber) -> provider (cached in memory)

every submission
  app: digest = base64url(SHA256(utf8(canonicalSubmission(fields))))
  app: provider.request(requestHash = digest) -> token
  app: POST /api/reports + X-Attest-Token, X-Attest-Install-Id
  srv: POST playintegrity.googleapis.com/v1/<pkg>:decodeIntegrityToken
       check in Google's stated order, claim token hash in ledger, insert report
```

Warm-up is on composer-open, not cold start: `prepareIntegrityToken` calls are counted in the same 10,000/day bucket as classic requests ("Shared between classic requests and standard token preparations", [setup](https://developer.android.com/google/play/integrity/setup)). Warm-up-on-launch is the likely first quota wall, and exhaustion yields `TOO_MANY_REQUESTS (-8)` — no token at all, i.e. a total submission outage under a fail-closed server.

### 1.5 What is stored where

**Client (iOS)** — `keyId` only, in Keychain. Never the private key (it is in the Secure Enclave and unexportable), never a bearer token, never a cached assertion. Apple: keys "don't survive app reinstallation, device migration, or restoration of a device from a backup", and on any `attestKey` error other than `serverUnavailable` the app discards the key and generates a new one — so re-enrolment must work, and a user may legitimately hold several keys over time.

**Client (Android)** — a locally generated install UUID, plus the in-memory token provider. Nothing persistent that matters.

**Server** — see §2. Notably: **no long-lived session token is ever issued.** Attestation happens exactly once and produces a database row, not a credential. The commonest architectural failure here is attesting once and then trusting a bearer token per submission, which throws away the hardware binding and replaces it with a stealable secret.

### 1.6 The canonical serialisation (`packages/shared`)

`packages/shared` has one dependency (zod) and no Node builtin or DOM global — verified. So it returns a **string**, and each side hashes it with its own SHA-256.

```ts
/** The exact bytes both sides hash. Never JSON.stringify of a parsed object:
 *  zod strips unknown keys, key order is not guaranteed, and float→string
 *  rendering differs between Hermes and V8. */
export function canonicalSubmission(r: {
  clientNonce: string; category: string; lng: number; lat: number;
  observedAt: string; taxonId?: number; taxonUnknown?: boolean;
  accuracyM?: number; notes?: string; contactEmail?: string; photoPaths: string[];
}): string {
  const f = (k: string, v: string | null) =>
    `${k}=${v === null ? "" : JSON.stringify(v)}\n`;
  return "conservation-submission-v1\n"
    + f("clientNonce",  r.clientNonce)
    + f("category",     r.category)
    + f("lng",          r.lng.toFixed(6))
    + f("lat",          r.lat.toFixed(6))
    + f("observedAt",   r.observedAt)
    + f("taxonId",      r.taxonId == null ? null : String(r.taxonId))
    + f("taxonUnknown", r.taxonUnknown ? "1" : "0")
    + f("accuracyM",    r.accuracyM == null ? null : String(r.accuracyM))
    + f("notes",        r.notes ?? null)
    + f("contactEmail", r.contactEmail ?? null)
    + f("photoPaths",   r.photoPaths.join("\u0000"));
}
```

`lng`/`lat` fixed at 6 decimal places (~11 cm) kills the float-rendering divergence. `JSON.stringify` on a *string* is deterministic across engines. `photoPaths` order is significant.

The digest is `base64url(SHA256(utf8(canonicalSubmission(...))))` — 43 chars, **no padding**, no `+` or `/`. That is deliberate: Play Integrity's `requestHash` is documented as ≤500 bytes on one page and ≤500 characters on another, and whether Play normalises the string is unconfirmed. base64url-unpadded sidesteps every character that could be normalised.

**The server recomputes this from `parsed.data` after zod validation and before the insert, and compares.** If it does not match, the proof is for a different report.

`clientData` for iOS assertions — a second fixed string, not JSON:

```ts
export function canonicalClientData(challenge: string, digest: string): string {
  return `conservation-assert-v1\n${challenge}\n${digest}\n`;
}
```

The client sends these bytes verbatim in `X-Attest-Client-Data`. The server verifies the signature **over the received bytes** (it cannot reconstruct them and get the same hash reliably), then parses them and checks that line 2 is an outstanding unconsumed `assert` challenge and line 3 equals the server-recomputed digest. Both checks, or the assertion proves "a genuine install signed something" rather than "a genuine install submitted this report".

---

## 2. MIGRATION 0014

```sql
-- The one barrier in front of protected-species coordinates was a browser
-- challenge, and the app has no browser.
--
-- `POST /api/reports` verifies a Cloudflare Turnstile token and answers 403
-- `challenge_failed` without one. That works for the web form and cannot work
-- for the iOS and Android apps, which are becoming the primary way people
-- submit. The replacement is Apple's App Attest and Google's Play Integrity:
-- the device proves, cryptographically, that the request comes from a genuine
-- install of this app on a genuine device.
--
-- Both schemes need server-side state, and it is the state — not the
-- cryptography — that stops replay. Without it:
--
--   * an attestation object captured once registers a key forever, because the
--     nonce inside Apple's certificate only proves the object matches SOME
--     challenge this server once issued;
--   * an assertion captured once is a permanent submission token, because the
--     signature stays valid and nothing records that its counter was already
--     spent;
--   * a Play Integrity token can be presented twice, because Google's own
--     wording is that it "prevents integrity tokens from being reused MANY
--     times" and the allowance is unpublished.
--
-- So: three tables, and three functions that do their compare-and-set in a
-- single statement. That last part is not a style preference. This runs on
-- Vercel, where two invocations of the same submission are ordinary — the
-- offline queue retries — and a SELECT-then-UPDATE lets both copies read the
-- old value and both pass. `bump_rate_limit` in 0003 is shaped this way for
-- the same reason, and the wrong version is indistinguishable from the right
-- one under any single-threaded test.
--
-- Expiry is a predicate inside the consume statement, never a scheduled job.
-- The crons in the root `vercel.json` are not deployed: Vercel reads config
-- from the project root directory, which for this project is `apps/web`, and
-- `apps/web/vercel.json` contains only `{"regions":["hnd1"]}`. A challenge
-- table reaped by a cron that does not run is a table where every challenge
-- ever issued stays valid forever, which is exactly the replay defence
-- evaporating in silence.

-- ---------------------------------------------------------------------------
-- One-time challenges
-- ---------------------------------------------------------------------------
-- The challenge string IS the primary key. There is no separate id the client
-- could send to point at a row it does not hold: knowing the row key is the
-- same thing as holding the challenge.
create table if not exists attest_challenges (
  challenge   text        primary key,
  purpose     text        not null check (purpose in ('attest','assert')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz
);

-- For the opportunistic reap on the issuance path (see below), and nothing else.
create index if not exists attest_challenges_expiry on attest_challenges (expires_at);

/** Spend a challenge. Single statement, so two concurrent replays cannot both win. */
create or replace function consume_attest_challenge(c text, p text)
returns boolean
language plpgsql set search_path = public as $$
begin
  update attest_challenges
     set consumed_at = now()
   where challenge = c
     and purpose = p
     and consumed_at is null
     and expires_at > now();
  return found;
end $$;

/**
 * Best-effort reap, called on the issuance path rather than by a cron.
 *
 * Bounded so it can never turn challenge issuance into a long transaction, and
 * it deletes only rows that are a day past expiry — correctness never depends
 * on it running, because `consume_attest_challenge` checks `expires_at` itself.
 */
create or replace function reap_attest_challenges(limit_rows int default 500)
returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  with doomed as (
    select challenge from attest_challenges
     where expires_at < now() - interval '1 day'
     limit limit_rows
  )
  delete from attest_challenges a using doomed d where a.challenge = d.challenge;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Attested App Attest keys (iOS)
-- ---------------------------------------------------------------------------
-- One row per (install, key). Apple: "Be prepared to store multiple (key,
-- receipt) pairs for each user", because keys do not survive reinstallation,
-- device migration or restore from backup.
create table if not exists attested_keys (
  key_id             text        primary key,
  -- The attested public key, DER SubjectPublicKeyInfo. This is what every
  -- later assertion is checked against; it is the whole point of the table.
  public_key         bytea       not null,
  -- Apple: "make sure that the public key doesn't already have an association
  -- with another user." A unique index on the key itself, so one compromised
  -- device cannot register itself as many independent installs.
  public_key_sha256  bytea       not null,
  -- Apple: development and production pairs are not interchangeable, and a
  -- development key is mintable by anyone with an Xcode build carrying the
  -- same bundle id. Stored so the production path can refuse one outright
  -- rather than relying on the aaguid check having been right once.
  environment        text        not null check (environment in ('development','production')),
  app_id             text        not null,
  -- Apple: "When attestation succeeds, independently verify and store the
  -- receipt immediately." It cannot be recovered later, and it is the input to
  -- the per-device fraud metric (receipt field 17) that is the only defence
  -- against one genuine device farming many keys. Stored now; the metric is a
  -- later work item.
  receipt            bytea,
  -- Apple's assertion step 5: strictly greater than the previous value.
  sign_count         bigint      not null default 0,
  -- Observed, not enforced. iOS 27+ only, and the value a real App Store build
  -- reports (4) is not the value in Apple's own published sample (1, an
  -- Apple-internal build). Recorded so an accept-list can be established from
  -- what this app's real install base actually emits.
  validation_category int,
  bundle_version      text,
  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz,
  revoked_at         timestamptz,
  revoked_reason     text
);

create unique index if not exists attested_keys_pubkey on attested_keys (public_key_sha256);
create index if not exists attested_keys_seen on attested_keys (last_seen_at desc nulls last);

/**
 * Advance a key's signature counter, or refuse.
 *
 * `new_count > sign_count` — strictly greater. `>=` permits unlimited replay of
 * one captured assertion, which is the difference between a counter and a
 * decoration. Zero rows means rejected.
 */
create or replace function advance_attested_key(k text, new_count bigint)
returns boolean
language plpgsql set search_path = public as $$
begin
  update attested_keys
     set sign_count = new_count, last_seen_at = now()
   where key_id = k
     and revoked_at is null
     and new_count > sign_count;
  return found;
end $$;

-- ---------------------------------------------------------------------------
-- Play Integrity token ledger (Android)
-- ---------------------------------------------------------------------------
-- Google's replay protection is "prevents integrity tokens from being reused
-- many times", and "many" is not "twice" — the allowance is unpublished. So a
-- single replay may decode perfectly. This is our own single-use ledger.
--
-- Note the second, subtler reason it must exist: a repeat decrypt does not
-- error, it returns an EMPTY device verdict and UNEVALUATED app and licensing
-- verdicts. A verifier that does not require positive values would read that as
-- "no signal" and pass it.
create table if not exists integrity_tokens (
  token_sha256 bytea       primary key,
  seen_at      timestamptz not null default now()
);
create index if not exists integrity_tokens_seen on integrity_tokens (seen_at);

/** Claim a token. First caller gets true; every later caller gets false. */
create or replace function claim_integrity_token(h bytea)
returns boolean
language plpgsql set search_path = public as $$
begin
  insert into integrity_tokens (token_sha256) values (h) on conflict do nothing;
  return found;
end $$;

/** Same bounded, best-effort reap. Tokens are useless once past the freshness window. */
create or replace function reap_integrity_tokens(limit_rows int default 500)
returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  with doomed as (
    select token_sha256 from integrity_tokens
     where seen_at < now() - interval '1 day' limit limit_rows
  )
  delete from integrity_tokens t using doomed d where t.token_sha256 = d.token_sha256;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Provenance on the report, without publishing it
-- ---------------------------------------------------------------------------
-- NOT a new value in `reports.source`. That column is
-- `check (source in ('user','gbif'))` and `reports_public` selects it
-- explicitly (0001:139, 0001:237-244) — 0001 calls that view "structural:
-- there is no column-level grant to forget". Putting the submitting platform
-- into the public view would attach a per-record device-class fingerprint to a
-- wildlife coordinate for no public benefit.
alter table reports
  add column if not exists attested_via text
    check (attested_via in ('ios','android'));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- NOTHING is granted on any of the three tables, to any role. They are reached
-- only by the app's own connection as the migration-running role.
--
--   * web_anon    — NO grant. It reads `reports_public` and `taxa` and nothing
--                   else (0004:88-90). An attested key's public key and a
--                   device's challenge history are not public surface.
--   * anon        — NO grant. 0013 revoked all table privileges and set
--   * authenticated  `alter default privileges ... revoke all on tables`, so
--                   these arrive closed. The REQUIRED_SCHEMA check
--                   "0013 the REST API is closed" asserts no table in `public`
--                   is granted to either role, so a grant added here would go
--                   red in /api/health — deliberately.
--
-- RLS on all three anyway, matching every table this project owns: a table with
-- RLS off is one `grant` away from being open again.
alter table attest_challenges enable row level security;
alter table attested_keys     enable row level security;
alter table integrity_tokens  enable row level security;
-- No policies. Nothing but the owner has any business reading these.
```

---

## 3. FILE-BY-FILE PLAN

### 3.1 New: `apps/web/lib/attest/` (the verifier lives here, not in `abuse.ts`)

| File | Contents |
|---|---|
| `cbor.ts` | Strict, definite-length-only CBOR decoder. Rejects indefinite lengths, duplicate map keys, tags, and trailing bytes. `decode(buf)` and `decodeAt(buf, offset) -> {value, end}` — the second is required because the attestation extensions map sits at `authData[164..]` and must be decoded at an offset. |
| `der.ts` | TLV walk. `extensionByOid(cert.raw, "1.2.840.113635.100.8.2") -> Buffer \| null`, implemented as a real walk of TBSCertificate → `[3] extensions` → SEQUENCE OF Extension → match `extnID`. **Not** `raw.indexOf(oidBytes)`: the attacker supplies the certificate, so they can plant those 9 bytes in a subject field followed by a chosen 32-byte value and make the check compare against their own nonce. |
| `appleRoot.ts` | `readFileSync` at module scope of `Apple_App_Attestation_Root_CA.pem`, plus an exported `verifyChain(x5c, now, root = APPLE_ROOT)` so tests can inject a synthetic root. |
| `Apple_App_Attestation_Root_CA.pem` | Downloaded once from https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem. SHA-256 fingerprint `1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32`. Apple's private PKI — it is **not** in Node's or the OS trust store, so it must ship. |
| `ios.ts` | `verifyAttestation()`, `verifyAssertion()`. Pure; no network. |
| `android.ts` | `verifyIntegrityToken()`, with the decode call injected as a parameter defaulting to the real one. |
| `googleAuth.ts` | RS256 service-account assertion → token exchange → module-scope cache. |
| `config.ts` | Reads env **once per request**, throws a typed `AttestConfigError` on anything missing. Never returns a permissive default. |
| `index.ts` | `requireProof()` — the single dispatch. |

**`requireProof` is the control.** `route.ts:68` is replaced by one call:

```ts
export type Proof =
  | { ok: true; tier: "attested"; platform: "ios" | "android"; subject: string }
  | { ok: true; tier: "challenged"; subject: string }
  | { ok: false; status: 403 | 503; code: "challenge_failed" | "attestation_failed"
                 | "attestation_unknown_key" | "attestation_replayed"
                 | "challenge_unavailable" | "attestation_unavailable" };

export async function requireProof(
  req: Request, input: ReportSubmission, ip: string, reporterId: string | null,
): Promise<Proof>
```

Its body is an **exhaustive switch on which proof cryptographically verified**, never on a client-declared platform, header or route:

```
const platform = req.headers.get("x-attest-platform");
switch (platform) {
  case "ios":     return verifyIosAssertion(...);      // never falls through to turnstile
  case "android": return verifyPlayIntegrity(...);
  case null:      return verifyTurnstileBranch(...);   // web
  default:        return { ok: false, status: 403, code: "attestation_failed" };
}
```

No `turnstileOk || attestOk` anywhere. The header selects *which verifier runs*, and every branch terminates in a verified result or a denial — a client that sends `X-Attest-Platform: ios` with no assertion gets 403, it does not fall back to the Turnstile branch. Combined with §3.2 this makes the client's branch choice irrelevant to the minimum.

### 3.2 Changed: `apps/web/lib/abuse.ts` — close the two fail-opens

This is not optional. As it stands, an implementer can do everything else in this document perfectly and the endpoint is still open, because `abuse.ts:19` returns `true` on a deployment with no `TURNSTILE_SECRET_KEY`.

```ts
/** True when this is the real production deployment. NOT NODE_ENV: the test
 *  suite runs `next build && next start`, so NODE_ENV is "production" in CI. */
const isProduction = () => process.env.VERCEL_ENV === "production";

export type TurnstileOutcome = "pass" | "fail" | "unavailable";

export async function verifyTurnstile(
  token: string | undefined, ip: string | null,
): Promise<TurnstileOutcome> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Local dev and CI still work. Production cannot silently lose its gate.
    if (isProduction()) throw new Error("TURNSTILE_SECRET_KEY is required in production");
    return "pass";
  }
  if (!token) return "fail";

  try {
    const res = await fetch(TURNSTILE_VERIFY, {
      method: "POST", body, signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return "unavailable";       // an HTML 5xx page is not a pass
    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? "pass" : "fail";
  } catch {
    return "unavailable";                     // was: return true
  }
}
```

The route maps `"unavailable"` to **503 `challenge_unavailable`**, not 200.

**Why this is better than the fail-open it replaces, not just stricter.** The comment at `abuse.ts:32` says "A Cloudflare outage should not take submissions down with it", and it is right about the goal. But `flush.ts` already writes off every 4xx except 429 and *retries* everything ≥500. So a 503 means a queued report is retried on the next flush; the old `return true` meant a Cloudflare outage silently admitted every bot for its duration. 503 loses nothing and closes the hole. The `res.json()` call was also inside the `try`: a Cloudflare 429/5xx **HTML** page made `.json()` throw and returned `true`. That is reachable from outside, not only during an outage.

`withinRateLimit`, `SUBMIT_LIMITS` and `screenSubmission` stay in `abuse.ts` untouched.

### 3.3 Changed: `apps/web/app/api/reports/route.ts`

New order (today: json → zod → auth → rate limit → turnstile):

```
1  json                                            unchanged
2  zod                                             unchanged
3  withinRateLimit(`attest-verify:${ip}`, 30, 60)  NEW — a cheap pre-limit. Verification
                                                   does ECDSA work and, on Android, an
                                                   outbound Google call; neither should be
                                                   unbounded before any limit applies.
4  supabase.auth.getUser()                         moved up
5  requireProof(req, input, ip, reporterId)        NEW — replaces line 68
      -> 403/503 on failure
6  subject = reporterId ? `user:${id}`
           : proof.tier === "attested" ? `device:${proof.subject}`
           : `ip:${ip}`                            CHANGED
7  SUBMIT_LIMITS burst + daily on subject          unchanged logic
8  photo stat / screen / taxon / insert            unchanged
   + attested_via = proof.tier === "attested" ? proof.platform : null
```

**Step 6 is not cosmetic.** `lib/request.ts:5-7` already says the IP "is a rate-limiting signal, not an authentication one — it is spoofable". `SUBMIT_LIMITS.burst` is 6 per 120s (`abuse.ts:55`), and Taiwanese mobile carriers NAT large numbers of subscribers behind one address. On a phone-first product, the sixth unrelated reporter on a carrier gets a 429 on launch day. The attested key is both a better rate-limit subject and a harder one to rotate.

### 3.4 New: `apps/web/app/api/attest/challenge/route.ts`, `apps/web/app/api/attest/ios/register/route.ts`

As specified in §1.2. `challenge/route.ts` also calls `reap_attest_challenges()` and `reap_integrity_tokens()` on roughly 1-in-50 requests (`Math.random() < 0.02`) — the reap is bounded and best-effort, and correctness never depends on it.

### 3.5 Changed: `packages/shared/src/index.ts`

Add beside `turnstileToken` (line 294):

```ts
    /**
     * Present when the submission carries a device-attestation proof. The proof
     * itself travels in headers — the digest binds the fields below, and a body
     * that contained its own signature could not be hashed.
     *
     * This field is a marker, not a credential. The server decides which
     * verifier runs from the X-Attest-Platform header and never from here.
     */
    attestation: z.object({ platform: z.enum(["ios", "android"]) }).optional(),
```

and **one** refine:

```ts
  .refine((r) => !(r.turnstileToken && r.attestation), {
    message: "a submission carries one proof, not two",
    path: ["attestation"],
  })
```

Plus `canonicalSubmission()` and `canonicalClientData()` from §1.6.

**Not an XOR.** Two concrete reasons: `apps/web/test/report-species.test.mjs:28-42` POSTs with no token at all and every local submission is tokenless (legal, because `abuse.ts:19` passes when the key is unset); and `packages/shared` ships to the browser bundle and to Expo, so it cannot read a server secret to decide whether a proof is required. "Is this shaped right" (400) and "are you allowed" (403) stay separate, which is the existing contract. **The at-least-one rule lives in `requireProof`, which is one function a source-level test can police.**

### 3.6 Changed: error contract

`apps/web/test/report-errors.test.mjs:38-44` scrapes every `error: "code"` literal from `route.ts` and asserts each resolves through `errorKey()` to a real string in both catalogues. Adding codes without this goes red.

- `lib/report/errors.ts`: add `"attestation_failed"` and `"unavailable"` to the `ErrorKey` union (line 42-49); map `attestation_failed`, `attestation_unknown_key`, `attestation_replayed` → `"attestation_failed"`, and `challenge_unavailable`, `attestation_unavailable` → `"unavailable"`; both slot to `"form"`.
- `messages/en.json` and `messages/zh-TW.json` under `report.errors`:
  - `attestation_failed`: "This device couldn't be verified. Try again, or report from the website."
  - `unavailable`: "We couldn't complete the security check just now. Your report is saved and will be sent again shortly."

**Do not reuse `challenge_failed`.** It already has sentences, so nothing goes red — but `flush.ts:143` treats 403 `challenge_failed` as retryable-forever, and the sentence is "The browser check didn't pass" shown inside an app with no browser. That is invisible to tests and visible to every rejected user.

### 3.7 Changed: `apps/web/lib/schemaStatus.ts`, `scripts/preflight.ts`

`REQUIRED_SCHEMA` gains:

```ts
{
  name: "0014 attested keys and challenges exist",
  sql: `select (to_regclass('public.attested_keys') is not null
            and to_regclass('public.attest_challenges') is not null
            and exists (select 1 from pg_proc where proname = 'advance_attested_key')
            and exists (select 1 from pg_proc where proname = 'consume_attest_challenge')) as ok`,
},
```

`preflight.ts:26-30` table list gains `'attest_challenges','attested_keys','integrity_tokens'`; the count string goes 8/8 → 11/11.

Without this, a deployment whose code calls `consume_attest_challenge` against a database without it throws, and `route.ts:241-249` turns that into `500 insert_failed` — "your report did not send" rather than "the database is behind".

### 3.8 Changed: `apps/web/app/api/health/route.ts`

Add a `gates` object computed server-side at request time:

```ts
gates: {
  turnstile: process.env.TURNSTILE_SECRET_KEY ? "enforced" : "skipped",
  attest: process.env.ATTEST_ENFORCE ?? "off",
  appleAppId: Boolean(process.env.APPLE_APP_ATTEST_APP_ID),
  appleEnv: process.env.APPLE_APP_ATTEST_ENV ?? null,
  androidPackage: Boolean(process.env.ANDROID_PACKAGE_NAME),
}
```

`scripts/verify-deploy.mjs` asserts `gates.turnstile === "enforced"` and, once §8 phase 3 lands, `gates.attest === "on"` and `gates.appleEnv === "production"` — **by reading the deployed endpoint, not by inferring from local env**. Project memory records that this check has misfired twice by inferring.

### 3.9 New: `apps/web/test/attest-fail-closed.test.mjs`

A source-level tripwire, in the idiom of `offline-challenge.test.mjs:11-16` ("deliberately blunt: a regression here is silent in every environment a test can run in"). CI has no Apple or Google credentials, so a verifier that returns true when unconfigured passes every runnable test.

Reads every `.ts` under `lib/attest/` and asserts:
1. No `return true` inside a `catch { ... }`.
2. No `if (!process.env.X) return` shape that yields a permissive value.
3. No `||` between two verification results anywhere in `lib/attest/index.ts`.
4. `route.ts` calls `requireProof(` and does **not** call `verifyTurnstile(` directly.
5. `abuse.ts` contains `VERCEL_ENV === "production"` within 10 lines of the `TURNSTILE_SECRET_KEY` read.
6. `lib/attest/ios.ts` contains `.verify(` and does **not** contain `checkIssued`.

### 3.10 Changed: `apps/web/test/offline-challenge.test.mjs`

Its first case asserts `/verifyTurnstile\(input\.turnstileToken/` appears in `route.ts` (lines 31-37). Refactoring line 68 breaks it. Replace with an assertion that `requireProof(` is called in `route.ts` and that `lib/attest/index.ts` reaches `verifyTurnstile` on the web branch. Keep every other case. The Expo queue must reproduce `flush.ts:107-111`'s skip-not-spend rule for an unobtainable proof — an attestation can be unavailable for transient reasons (no network for the challenge, warm-up not finished), and `flush.ts:36-41` documents what happened last time a transient failure was treated as permanent.

### 3.11 Changed: `.env.example`

Written in the `CRON_SECRET` idiom (lines 30-34, "REQUIRED IN PRODUCTION... it fails safe, silently"), **not** the Turnstile idiom (lines 26-28, which documents a fail-open):

```bash
# Apple App Attest. REQUIRED IN PRODUCTION once ATTEST_ENFORCE is on: with these
# unset the app path refuses every submission rather than admitting one. Get the
# prefix from developer.apple.com/account/resources/identifiers/list.
APPLE_APP_ATTEST_APP_ID=          # <10-digit Team ID>.<CFBundleIdentifier>
APPLE_APP_ATTEST_ENV=production   # production | development — a DEPLOYMENT constant.
                                  # The production build must reject development keys:
                                  # a dev-environment attestation is mintable by anyone
                                  # with an Xcode build of the same bundle id.
APPLE_APP_ATTEST_DEV_AAGUID=      # only read when ENV=development. Apple's two docs
                                  # disagree ("appattestdevelop" vs "appattestsandbox").
                                  # Set it from what your own debug build emits.

# Google Play Integrity. Same rule: unset means the Android path refuses everything.
ANDROID_PACKAGE_NAME=
ANDROID_CERT_SHA256_DIGEST=       # base64url, from appIntegrity.certificateSha256Digest
ANDROID_MIN_VERSION_CODE=1
PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON=

# off | log | on. "off" means the app path is CLOSED, not that the check is skipped.
# "log" verifies and records but admits a failed proof at reduced authority
# (pending + coarse precision). "on" answers 403.
ATTEST_ENFORCE=off
```

---

## 4. HAND-ROLL OR DEPEND

**Do not use any published App Attest or Play Integrity package.** All five surveyed have confirmed defects:

| Package | Defect |
|---|---|
| `app-attest-server@1.0.2` | `src/AttestationValidator.js:39-40` calls `credCert.verify(...)` and **discards the boolean**. Node's `verify()` returns `false`, it does not throw — a self-signed chain is accepted. Also depends on `sqlite3` (native). |
| `appattest-checker-node` | Compares 9 bytes of the 16-byte aaguid against `"appattest"`. `"appattestdevelop".slice(0,9) === "appattest"`, so development attestations pass the production check. Stale since 2024-10-13. |
| `node-app-attest` | Skips certificate validity dates entirely; omits the two extension steps; `verifyAssertion` does not validate that `signCount` was supplied, so `signCount: undefined` makes `nextSignCount <= undefined` false and **silently disables the counter check**; declines the challenge-match step. Signature is `params: any`. |
| `app-attest-gate` | Six days old, zero stars, wraps `node-app-attest` and inherits all of it. Its state machine is the right shape and worth reading as a reference. |
| `@n3arby/play-integrity-verifier` | 54 lines. Guards with `if (result.appIntegrity?.packageName && ...)`, so an absent field skips the check. Never checks `requestHash`, freshness, `appRecognitionVerdict` or `deviceRecognitionVerdict`. |

`npm audit` is clean and GitHub has zero advisories for all of them. At 100–170 downloads/month that means nobody has looked.

Also excluded: `@simplewebauthn/server` and `fido2-lib` implement WebAuthn's `apple` anonymous attestation format for passkeys, not `apple-appattest` from `DCAppAttestService` — different format, different root, different flow.

### iOS — hand-roll, zero production dependencies

**Node built-ins used:**

| Built-in | Role |
|---|---|
| `crypto.randomBytes(32)` | Challenge generation. Apple: "at least 16 bytes in length to ensure sufficient entropy". |
| `crypto.createHash("sha256")` | Every hash: `clientDataHash`, `nonce`, rpIdHash, the X9.62 point hash, the digest. |
| `crypto.X509Certificate` | `.raw` (DER for the extension walk), `.publicKey`, `.validFromDate` / `.validToDate` (explicit date checks), `.verify(issuerPublicKey)`, `.ca`. |
| `crypto.verify("sha256", msg, key, sig)` | ECDSA P-256. Default `dsaEncoding: "der"` is correct — App Attest signatures are DER SEQUENCEs (70–72 bytes); `ieee-p1363` fails. |
| `crypto.timingSafeEqual` | Nonce and keyId comparisons. |
| `crypto.createPublicKey` | Rebuilding the stored SPKI for assertion verification. |

**Never `X509Certificate.checkIssued()`.** Verified: it returns **TRUE** for a self-signed certificate on which only the CN `"Apple App Attestation CA 1"` was copied. A naive `leaf.issuer === candidate.subject` also returns true. Only `.verify(issuerPublicKey)` returns false. A chain check built on either accepts a wholly attacker-minted chain — attacker key, attacker nonce extension, attacker aaguid — and then every subsequent step passes.

**Also verified: `.verify()` checks the signature only.** It returned `true` for Apple's own sample leaf, which expired 2026-04-23. `notBefore`/`notAfter` must be checked explicitly, once, at attestation — App Attest leaves are ~3 days valid (Apple's sample: Apr 20 → Apr 23 2026), which is a useful freshness bound. **Do not re-check the leaf on every assertion**: that would break every install about three days after enrolment.

**CBOR: hand-roll (~130 lines).** Two reasons no library covers: (a) the input is attacker-controlled and needs to reject indefinite lengths, duplicate map keys, tags and trailing bytes *simultaneously*, which no decoder exposes as a single flag; (b) the extensions map sits at `authData[164..]` and needs decode-at-offset with bytes-consumed. Supported types: uint, negint, byte string, text string, array, map. That is the entire subset App Attest uses. If the team prefers a dependency: `cbor2@2.3.0` (one dep, `@cto.af/wtf8`, pure JS) or `cbor@10.0.12` (one dep, `nofilter`). **Never `cbor-x`** despite being the most downloaded: it ships `cbor-extract` with `binding.gyp` and prebuilt `.node` binaries.

**ASN.1: hand-roll (~80 lines).** Node exposes **no** generic extension accessor — the full `X509Certificate.prototype` is `ca, checkEmail, checkHost, checkIP, checkIssued, checkPrivateKey, fingerprint, fingerprint256, fingerprint512, infoAccess, issuer, issuerCertificate, keyUsage, publicKey, raw, serialNumber, signatureAlgorithm, signatureAlgorithmOid, subject, subjectAltName, toJSON, toLegacyObject, toString, validFrom, validFromDate, validTo, validToDate, verify`. The OID must be reached by a real walk of `cert.raw`. Alternative: `@peculiar/asn1-apple` has an `AppAttestNonce` schema matching the observed DER exactly (`30 24 A1 22 04 20 <32 bytes>` — note the `[1]` context wrapper; Apple's prose says only "extract the single octet string", so an implementation that takes the first top-level OCTET STRING finds none).

**Do not use `@peculiar/x509`'s `X509ChainBuilder` for verification.** Verified in its source: `findIssuer` verifies with `signatureOnly: true` (dates never checked) and `build()` walks upward until no issuer is found and returns whatever it got — it never asserts the terminal certificate is your pinned root. It is fine as a **devDependency** for generating test fixtures.

### Android — hand-roll the auth, no crypto at all

There is no cryptography on this path: Google decrypts and verifies, and the job is checking returned fields. Google: "you must decrypt the integrity token on Google's servers" — standard tokens **cannot** be decrypted locally. The comparison table marks local decryption ❌ for standard, ✔️ for classic, and the Play Console's self-managed-key control sits under "Classic requests". An implementation built from the classic JWE sample (`A256KW`/`A256GCM`/`ES256`) will simply never decrypt, and the tempting "fix" — switch to classic — imports the 5-tokens-per-minute-per-instance throttle and hands you the nonce ledger.

**Service-account auth, hand-rolled (~50 lines):** build the RS256 assertion with `crypto.createSign("RSA-SHA256")`, POST it to `https://oauth2.googleapis.com/token` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, cache the returned opaque bearer token at module scope until 60s before expiry. Note the distinction that bites hand-rollers: **the assertion you sign is a JWT; the access token you get back is opaque.** Scope: `https://www.googleapis.com/auth/playintegrity`.

Alternative if the team prefers: `google-auth-library@11.1.0` — verified no `optionalDependencies`, no `gypfile`, all-JS deps (`jws`, `gaxios`, `base64-js`, `gcp-metadata`, `ecdsa-sig-formatter`, `google-logging-utils`). `@googleapis/playintegrity` on top of it is 15 MB and 45 transitive packages (8.7 MB of it `web-streams-polyfill` via `gaxios`/`node-fetch`, redundant on Node 20+) for one HTTP POST. Skip it.

**Node is v26.7.0 here; `engines.node` is `>=20`. Everything above is available.** Nothing uses a native module. The route must **not** be `export const runtime = "edge"` — `X509Certificate` does not exist there.

---

## 5. WHAT CAN BE BUILT AND TESTED TODAY

Roughly 90% of the verifier, with no Apple or Google account.

### 5.1 iOS attestation — Apple's own published vector

Apple publishes a complete worked sample in the [Attestation Object Validation Guide](https://developer.apple.com/documentation/devicecheck/attestation-object-validation-guide): a real attestation object for `1234567890` / `com.example.myapp`, challenge `"example_server_challenge"`, chaining to the real Apple root. Fetch it via `https://developer.apple.com/tutorials/data/documentation/devicecheck/attestation-object-validation-guide.json` (the HTML is JS-rendered). Confirmed contents, independently decoded:

```
attestationObject   5906 bytes, CBOR map(3), 0 trailing
  fmt      "apple-appattest"
  attStmt  { x5c: [1057B leaf, 583B intermediate], receipt: 3977B (starts 30 80 — BER
                                                    indefinite-length CMS, not DER) }
  authData 226 bytes:
    [0..32)    rpIdHash   = SHA256("1234567890.com.example.myapp")
                          = 9EZtaPketsEGIMt+Y8coMkRoXuHWRntUFg51MXIFfwM=
    [32]       flags      = 0x40   (AT set, ED CLEAR — see below)
    [33..37)   counter    = 0
    [37..53)   aaguid     = 61 70 70 61 74 74 65 73 74 00 00 00 00 00 00 00
    [53..55)   credIdLen  = 32
    [55..87)   credentialId = zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=
    [87..164)  COSE_Key   = 77 bytes, a5 {1:2, 3:-7, -1:1, -2:x(32), -3:y(32)}
    [164..226) extensions = a2 { apple_bundle_version_01: "1",
                                 apple_validation_category_01: h'01000000' }
  leaf validity  Apr 20 18:13:12 2026 → Apr 23 18:13:12 2026 (3 days; already expired)
```

**Use it as a parser fixture with an injectable clock. Do NOT use it as a nonce oracle.** Apple's sample client passed the **raw** challenge as `clientDataHash`, while Apple's client-side page shows `let hash = Data(SHA256.hash(data: challenge))`. Proven three ways: `SHA256(authData || b"example_server_challenge")` = `h7fQbZOkKU5G8BHma2zEAPC6sgcpl2xhlYC0KuYL/24=` = the published nonce = the 32 octets in credCert OID `1.2.840.113635.100.8.2`, and receipt field 4 "Client Hash" is literally `b"example_server_challenge"`. `SHA256(authData || SHA256(challenge))` matches nothing.

**We freeze `clientDataHash = SHA256(utf8(challenge))`** — Apple's prose and Apple's client API doc. Consequence, and it must be written in the test file so nobody "fixes" it: **a correct implementation of our contract will not reproduce Apple's published nonce.** The fixture test asserts the parser and the chain; the nonce assertion in that test is written against the raw-challenge form and labelled as pinning Apple's sample, not our contract. **Never add a fallback that tries both forms.** That is fine for equality but trains the codebase toward "try variants until something matches", and any such fallback that tolerates an absent challenge destroys replay protection.

Two further errata in Apple's guide that will make correct code look broken:
- It prints an "Expected public key SHA256 hash from credCert" of `inGjK2JbaAEhAsYwCns2zTyZDzsJ3OKx3Q2nnxk+mkY=`, which matches neither the keyId nor the SPKI-DER, whole-cert, or compressed-point hash. The correct value is `zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=` = SHA256 of the 65-byte uncompressed point = keyId = credentialId.
- It labels a value "Expected clientDataHash" that is actually the 250-byte `authData || clientDataHash` composite.
- It says `apple_bundle_version_01` should be `"1.0"`; the sample encodes `"1"`.

### 5.2 iOS assertion — the only real vectors that exist

Apple publishes **no** assertion sample (`/documentation/devicecheck/assertion-object-validation-guide` returns 404). Seven device-captured assertions exist in `veehaitch/devicecheck-appattest`'s test resources (`ios-14.2`, `14.3`, `14.3-beta-2`, `14.3-beta-3`, `14.4`, `14.4-beta-1`, `14.4-beta-2`). Authenticity was **proven**, not assumed: for `ios-14.4`, `openssl verify -CAfile Apple_App_Attestation_Root_CA.pem -untrusted intermediate.pem leaf.pem` → OK, and the leaf's SPKI is byte-identical to the key that verifies the assertion. Only a real Secure Enclave could have produced those signatures.

**The regression vector. Write this test first.**

```js
// ios-14.4, clientData = "wurzelpfropf", challenge = "wurzel"
authenticatorData(37B hex) =
  456512ea7e269476ab93e1b7971685592ff73f894ac0ec2fd54808a08bfb6c8f4000000001
publicKey PEM = MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEiMA0oZCqfbxaBhUBxlQoA5Qlghm
                LPxzFRnPKO5rSC0FSgmelT1/boEafr7RrtpkKOWvwT5SknUMgyBx6skCjmA==
signature b64 = MEQCIEnoFP9BHrz1QrLzhjI3dEPJ1gP0pVDYFNEr7HWLx7OoAiAYzsGxltK4XpOO
                YrrG04V6TJXKN/xqQa+nmoVEab0tPA==
clientDataHash = i+ZcylFa0JfJU5Z9GNY12G3XihQu09B3UmvtEca+xns=
nonce          = kkxfktIPCKCe4RPcxFAU3VN1iVpKedSbBUjuhcWzcRg=
digest signed  = Wv9lTX8BPGIh2dyDYo1zXVaChL4X6nPkUWFu6EAic3w=
```

```js
const clientDataHash = crypto.createHash("sha256").update(clientData).digest();
const nonce = crypto.createHash("sha256")
  .update(Buffer.concat([authenticatorData, clientDataHash])).digest();
const ok = crypto.verify("sha256", nonce, publicKey, signature);  // nonce is the MESSAGE
```

**TRUE on 7/7.** `crypto.verify("sha256", Buffer.concat([authenticatorData, clientDataHash]), ...)` is **FALSE on 7/7**. Also false: `clientDataHash||authenticatorData`; `authenticatorData||clientData` unhashed; `authenticatorData||SHA256(challenge)`; and the correct form with `dsaEncoding: "ieee-p1363"`. Corroborated by `AssertionValidator.kt` in the same library (`SHA256withECDSA` + `update(nonce)` + `verify(sig)`, which is ECDSA over `SHA256(nonce)`).

Caveat to state in the test file: all seven are iOS 14.2–14.4 (Jan 2021). A change to this construction is very unlikely — it would break every deployed verifier, and Apple's wording is unchanged — but it is **not proven on a modern OS** from any source I could reach. One capture from your own device settles it in five minutes (§7).

Two more findings from those samples, both applied in the design:
- **ECDSA malleability:** `(r, n−s)` re-encoded is a different byte string that still verifies on 7/7. Any replay-dedup keyed on signature bytes is trivially bypassed. Anti-replay rests on the counter and the one-time challenge, never on signature uniqueness.
- **Use the raw received `authenticatorData` bytes.** All seven are 37 bytes. Any normalisation or re-serialisation before hashing breaks the nonce.

### 5.3 Synthetic negatives

With `@peculiar/x509` + `@peculiar/asn1-schema` (devDependencies only) and `node:crypto` P-256 keys, mint a test root → intermediate → leaf carrying a custom extension at OID `1.2.840.113635.100.8.2`, hand-build a **226-byte** `authData` (all seven fields, not five), CBOR-encode the object, and pass the test root to the injectable `verifyChain` parameter. One test per negative, all local:

wrong challenge · challenge already consumed · challenge expired · self-signed leaf (does not reach the root) · **expired leaf** · **expired intermediate** · **production config rejects a chain rooted at the test root** · extension nonce ≠ computed nonce · OID bytes planted in a subject field (the byte-scan attack) · keyId ≠ SHA256(uncompressed point) · rpIdHash of a different App ID · counter ≠ 0 · aaguid `appattestdevelop` while `APPLE_APP_ATTEST_ENV=production` · credentialId ≠ keyId · credIdLen lying (not 32) · trailing bytes after `extensions` · truncated `authData` (< 164 bytes) · duplicate CBOR map keys · indefinite-length CBOR · **public key already registered to a different keyId** · assertion counter equal (must reject) · assertion counter lower · assertion whose digest is of a different report · assertion whose clientData challenge is not outstanding · assertion verified against a public key supplied in the request body rather than the stored one for that keyId.

### 5.4 Android — no account needed for the verdict layer

Inject the decode call. Feed verdict JSON verbatim from Google's docs and assert rejection for: `testingDetails.isTestingResponse: true` · wrong `requestDetails.requestPackageName` · wrong `requestHash` · `timestampMillis` outside the window · `appRecognitionVerdict` `UNRECOGNIZED_VERSION` / `UNEVALUATED` / `UNKNOWN` · wrong `appIntegrity.packageName` · digest absent from `certificateSha256Digest` · `versionCode` below the floor · `appLicensingVerdict` `UNLICENSED` / `UNEVALUATED` · `deviceRecognitionVerdict` `[]` / `["MEETS_BASIC_INTEGRITY"]` / `["MEETS_VIRTUAL_INTEGRITY"]` / `{}` / key absent · a **multi-label** array `["MEETS_DEVICE_INTEGRITY","MEETS_STRONG_INTEGRITY"]` (must pass — a `verdict[0] === ...` check would fail here and pass every single-element fixture) · a made-up future label · a replayed token (ledger says no) · `legacyDeviceRecognitionVerdict` present and ignored.

The **authenticating** layer — minting the service-account token and the real decode — needs an account and is untested until §5.6.

### 5.5 SQL concurrency — real, today

`apps/web/test/helpers.mjs:12-19` opens `postgres(DATABASE_URL, {max: 4, prepare: false})`, so two concurrent connections are available. One challenge, two simultaneous `consume_attest_challenge` calls, assert exactly one `true`. Same for `advance_attested_key` with the same `new_count`, and `claim_integrity_token` with the same hash. **Not** inside `inRollback` — rollback hides the race. Clean up by id in an `after()` hook, the way `report-species.test.mjs:19-54` cleans up by nonce.

Project memory: the local DB is ahead of main (0011), which makes exactly four unrelated tests fail. That is not a regression. And do not test against `next dev` — build and start like CI, or the result is noise.

### 5.6 What genuinely needs the paid accounts and hardware

**Apple first** — it is pure local cryptography with no server dependency, and the Expo dev-build pipeline on physical hardware is already the stated day-one task (`docs/app-and-site.md:179-183`).

| # | Needs | Settles |
|---|---|---|
| 1 | Apple Developer Program ($99), one physical iPhone, a custom dev build | Whether the sandbox aaguid is `appattestdevelop` or `appattestsandbox` (print `authData[37..53]`); the `clientDataHash` contract end-to-end; **the assertion signature construction on a modern OS** (capture one `generateAssertion` and run both readings — five minutes); whether assertion `authenticatorData` is 37 bytes or carries extensions, per OS version |
| 2 | A TestFlight build, then an App Store build | The real `apple_validation_category_01` values (expected 2 and 4, **not** 1); whether `apple_bundle_version_01` is `CFBundleVersion` or `CFBundleShortVersionString`; that TestFlight emits **production** aaguids regardless of the `appattest-environment` entitlement |
| 3 | Google Play Console ($25), a linked Cloud project, a service account, an internal-test-track build, one physical Android device | That `decodeIntegrityToken` authenticates with the hand-rolled JWT; that a Play-installed build returns `PLAY_RECOGNIZED`; the real `certificateSha256Digest` encoding as Play Console shows it; whether `locationSpoofingRiskVerdict` is available under Change responses; that a repeat decode of one token really does clear the verdicts |
| 4 | Two weeks of measure-only traffic | The Taiwan pass rate, from Play Console's Play Integrity report filtered to Taiwan, and the App Attest failure-reason histogram. **Any number quoted before this is a guess.** |

---

## 6. FAILURE POLICY

**The rule: `requireProof` returns a verified success or it denies. There is no third outcome that admits a submission at full authority.** Every branch is explicit; the `default` is 403.

| Condition | Response | Why |
|---|---|---|
| No proof of any kind | 403 `challenge_failed` | This is the *actual* hole today. `turnstileToken` is `.optional()` (shared:294) and `abuse.ts:19` passes when the secret is unset, so a tokenless POST is admitted on any deployment missing the env var. |
| `X-Attest-Platform` present but the proof is missing or malformed | 403 `attestation_failed` | The header selects the verifier, never a bypass. No fall-through to Turnstile. |
| Apple chain does not reach the pinned root | 403 | The self-signed-certificate attack. Nothing else in the scheme means anything without this. |
| Nonce mismatch, rpIdHash mismatch, counter ≠ 0, wrong aaguid, keyId mismatch | 403 | Each stops a named forgery; see §2 header. |
| Challenge unknown, expired, or already consumed | 403 `attestation_replayed` | Replay. |
| **keyId the server has never seen** | 403 `attestation_unknown_key`. **Never auto-register.** | Auto-registering on first sight turns the assertion path into an unauthenticated enrolment path — the attacker skips attestation entirely. The client's correct response is to re-run registration. |
| **Counter went backwards or stayed equal** | 403 `attestation_replayed`, and increment a counter-regression metric | `advance_attested_key` returned zero rows. Apple: "greater than the value from the previous assertion". `>=` permits unlimited replay of one captured assertion. A sustained regression on one keyId means the key is being used from two places — alert, and consider `revoked_at`. |
| Key's stored `environment` ≠ this deployment's | 403 | A sandbox-registered key must not be honoured by production. |
| Digest ≠ server-recomputed digest | 403 `attestation_failed` | The proof is for a different report. Without this the assertion authorises arbitrary content. |
| **Apple unreachable** | — | **Cannot happen.** App Attest verification is pure local cryptography against a pinned root. There is no outage to tolerate and therefore no argument for failing open. |
| **Apple config missing** (`APPLE_APP_ATTEST_APP_ID` unset with `ATTEST_ENFORCE=on`) | 500, logged loudly, request denied | Not a permissive default. Assert the enforced state in `/api/health` + verify-deploy rather than inferring it from local env. |
| **Google unreachable / decode 5xx / timeout** | 503 `attestation_unavailable`. **Do not retry with the same token.** | A repeat decrypt is not idempotent: it returns an empty device verdict and `UNEVALUATED` app/licensing verdicts. A naive retry converts a legitimate submission into a hard integrity failure that looks exactly like an attack in the logs. This is the single most likely cause of mysterious false rejections. Surface a distinct client error asking for a fresh token; the offline queue's `>= 500` path already retries. |
| Google returns `testingDetails.isTestingResponse: true` in production | 403, logged at error level | Play Console can statically override verdicts per tester email. Those payloads are otherwise indistinguishable from a genuine pass, so anyone ever added to that list holds a permanent bypass. |
| `UNEVALUATED` / `UNKNOWN` / `*_UNSPECIFIED` / `{}` / key absent / `[]` | 403 | These are the failure case *by design*. `UNEVALUATED` is returned "because a necessary requirement was missed, such as the device not being trustworthy enough" — it is downstream of a device that already looks bad. Optional-chaining defaults (`?? true`) invert the meaning of the whole verdict. |
| `MEETS_BASIC_INTEGRITY` alone, or `MEETS_VIRTUAL_INTEGRITY` | 403 | Basic "can be locked or unlocked... may not be certified"; virtual is an emulator by definition. An unlocked bootloader means the app's own code can be instrumented, so the `requestHash` it computes is no longer trustworthy. |
| `playProtectVerdict` anything, `appAccessRiskVerdict` anything | Log only, never block | These describe the user's device hygiene and the wrong threat model, and are empty for mundane reasons (non-phone form factor, outdated Play Store, Android < 6, library < 1.4.0). Enforcing produces rejections nobody can explain, which is how a verifier gets switched off. |
| `recentDeviceActivity` LEVEL_3/LEVEL_4 | Accept, but force `status = 'pending'` | >50 token requests from one device in an hour is orders of magnitude above any citizen-reporting rate. This is the one attack all the other checks pass: a genuine, unrooted, Play-installed device acting as a token mint. |
| Extensions absent (`apple_validation_category_01` etc.) | **Pass**, log | iOS 27+ only; most of a realistic 2026 fleet emits none. Safe because `authData` is covered by the credCert nonce at attestation and by the assertion signature — provided the signature is verified over the **exact parsed bytes**. Caveat stated plainly: on a mixed fleet this is a hardening signal for new devices, not the barrier. |

### Why fail-closed here, when `verifyTurnstile` fails open

Three reasons, and none of them is "stricter is better":

1. **There is no outage to tolerate on the iOS path.** Apple verification is local cryptography against a PEM in the repo. The Turnstile fail-open buys availability during a Cloudflare outage; App Attest has no equivalent purchase to make.
2. **The Google path's transient failure has a better answer than "allow".** 503 + the existing offline-queue retry (`flush.ts` retries everything ≥500) preserves the report *and* the gate. "Accept during a Google outage" is indistinguishable from "have no Android verifier" for the duration, and an attacker who can induce or wait for a 5xx chooses when that is.
3. **Endpoint strength is min-over-branches.** A fail-open in the app branch is not merely a weak app branch — under any composition it becomes a bypass of the web branch too. That is precisely why §3.2 closes the Turnstile fail-opens at the same time: leaving `abuse.ts:19` as it is would make every line of this document decorative.

### The one case where a softer answer is defensible — argued, not smuggled

**Measure-only mode (`ATTEST_ENFORCE=log`).** Google's explicit sequencing is "implement the API without enforcement. Once you know what verdicts your current install base is returning, you can estimate the impact of any enforcement you're planning" ([overview](https://developer.android.com/google/play/integrity/overview)). During that window a **failed** proof still admits the report — but at **reduced authority**, not full trust:

- `status = 'pending'` (it goes to the moderation queue, not the public map),
- `precision_override = UNIDENTIFIED_PRECISION` (the coordinate is coarsened before anything can read it),
- rate-limited on `ip:${ip}`, not on the unproven device identity,
- logged with the exact failure reason.

That is a real tier, not a hole: a pangolin sighting from an honest reporter on a rooted phone is still a record worth keeping, and the right response is to distrust its precision rather than discard it. It is also time-boxed by §8. It is **not** a switch that admits a failed proof at full authority, and `ATTEST_ENFORCE=off` means the app path is **closed**, not skipped.

---

## 7. WHAT I AM NOT SURE OF

| # | Question | Blocks | How to settle |
|---|---|---|---|
| 1 | **Does the assertion signature construction still hold on a current OS?** All seven empirical samples are iOS 14.2–14.4 (Jan 2021). I judge a change very unlikely (it would break every deployed verifier; Apple's wording and the reference implementation are unchanged) but I could not prove it on iOS 17/18/26 from any source. | Nothing today — the implementation is written to the proven form and the unit test uses the proven vector. It blocks *confidence*, not code. | Capture one real `generateAssertion` output on the dev build and run both readings. Five minutes. **Do this before anything ships.** |
| 2 | **Which aaguid does the development environment actually emit?** Apple's "Validating apps..." says `appattestdevelop`; "Preparing to use the App Attest service" says `appattestsandbox`. Both are exactly 16 bytes, so length cannot disambiguate, and no Apple page reconciles them. | Only the development path. Production is unaffected: `"appattest"+7×0x00` is confirmed byte-for-byte and the production build rejects **both** candidates. | Run a debug build on a real device against the sandbox and print `authData[37..53]`. Until then `APPLE_APP_ATTEST_DEV_AAGUID` is a single explicit constant, never a set. |
| 3 | **Do assertion `authenticatorData` extensions exist, and under what key names?** Apple lists assertion steps 7–8 as `validationCategory` / `bundleVersion` — **different names** from the attestation side's `apple_validation_category_01` / `apple_bundle_version_01` — while the same page says the assertion's authenticator data contains "only the first few fields, including RP ID and counter". No assertion sample exists. | Nothing: v1 parses past byte 37 (never gating on the ED flag), reads **both** spellings, logs whatever it finds, and never rejects. | Decode a real assertion's `authenticatorData` on each OS in the support matrix and check whether anything follows byte 37. |
| 4 | **Which `validation_category` values does this app actually emit?** The table is confirmed (0 invalid, 1 platform, 2 TestFlight, 3 development, 4 App Store, 5 enterprise/ad-hoc, 6 Developer ID, 7–9 restricted, 10 unmatched) and matches XNU's `CS_VALIDATION_CATEGORY_*` exactly, but no Apple page states the App Attest numbering is the same enum, and Apple publishes no `rawValue` on `LightweightCodeRequirements.ValidationCategory`. | Enforcement only. Never gate on it before this is measured — Apple's own sample says `1`, which no third-party App Store build ever emits. | Harvest observed values from a real TestFlight build and a real App Store build. Then enforce `{4}` (plus `{2}` while shipping betas) behind a kill switch. WWDC26 session 201 frames these as risk signals, not blockers — "avoid blocking users without broader assessment". |
| 5 | **Is `locationSpoofingRiskVerdict` GA, and how is it opted into?** It is in the live discovery document (revision 20260924) with `LOW/MEDIUM/HIGH_RISK_DEVICE/NETWORK`, and appears in **no** prose source — not the verdicts page (updated 2026-05-01), not setup, not the Nov 2025 blog post. For a geolocated wildlife database this is the single most relevant signal imaginable. | Nothing in v1. Do not design enforcement around it. | Open Play Console → Protected with Play → Play Integrity API → Change responses and read the toggles. **Check before the response-configuration decision is finalised** — enabling it later changes production payloads immediately. |
| 6 | **How many times can a Play token be decoded before verdicts clear?** Docs say only "reused many times". | Whether our ledger is defence-in-depth or the actual defence, and whether any decode retry is ever safe. Design assumes the pessimistic answer (own ledger, never retry). | Decode one token N times in a staging project and record where the verdicts collapse. |
| 7 | **Can an internal-test-track or internal-app-sharing build return `PLAY_RECOGNIZED`?** Play Console help says to publish to the internal test track for testing, which strongly implies yes for that track; internal app sharing uses a different signing path and I could not confirm it from Google. | Whether Android CI can do end-to-end verification at all, or whether every integration test must go through Play Console test responses. | Publish to the internal test track and read a real verdict. |
| 8 | **Does the Expo/RN toolchain expose `prepareIntegrityToken` and `request(requestHash)` at library 1.5.0+?** Google documents Kotlin/Java, Unity, Unreal and Native only. A config plugin stuck on an older library quietly changes which fields the server can rely on (1.4.0+ for app access risk on standard requests, 1.5.0+ for the `GET_INTEGRITY` remediation dialog). | The whole Android client. | Client-side investigation, not covered here. **Do it before committing to the Android schedule.** |
| 9 | **What IAM permission does the service account need beyond existing in the linked project?** Docs say only "Create a service account within the Google Cloud project that's linked to your app" and use the `playintegrity` scope; unlike the Play Developer API, no Play Console user grant is mentioned. | A likely 403 during first integration that will look like a code bug. | First real decode call. |
| 10 | **What freshness window, and what happens to a report queued overnight?** Google's sample uses `ALLOWED_WINDOW_MILLIS` without giving a value. Proposal: 5 min for Play, 2 min for the assert challenge. Neither is sourced. | Offline-queue correctness. The Expo queue must mint challenge + proof **immediately before POSTing**, never at enqueue time — the web queue already pins this for Turnstile (`offline-challenge.test.mjs:73-84`). | A decision, plus a test that the Expo queue does not carry a stale proof. |
| 11 | **How stale can a standard verdict be?** "Some automatic caching and refreshing by Google Play" versus classic's "All verdicts recomputed on each request", with no published TTL. So `timestampMillis` bounds the age of the **token**, not necessarily of the underlying signals, and I cannot say how long after a device is rooted a standard request might still report `MEETS_DEVICE_INTEGRITY`. | The main residual argument for an occasional classic request on the most sensitive submissions. | No authoritative source found. Ask Google, or accept the residual. |
| 12 | **Can a visible Turnstile widget be rendered in an RN WebView for the `isSupported === false` fallback?** Unverified. | The fallback design in §1.1. If it cannot, those users open the web form in the system browser instead — the recommended answer anyway. | An afternoon's client work. |
| 13 | **Does Play normalise `requestHash`?** Docs say "included in the integrity token verbatim" but the field is typed as an opaque string and the 500 limit is stated once as bytes and once as characters. | Nothing, because base64url-unpadded avoids every character that could be normalised. Flagged so nobody "simplifies" the encoding later. | Round-trip a hash containing `+`, `/` and `=` before freezing the contract, if you ever change the encoding. |
| 14 | **Should the receipt / fraud-risk metric be in v1?** Receipt field 17 is the number of attested keys per device over 30 days — the only defence against one genuine device farming installs, which is the one attack the entire chain-plus-counter design passes. It needs an APNs-style JWT, environment-correct server-to-server POSTs, and refreshes bounded by receipt fields 19 and 21 (the sample spans 90 days). | Nothing: the attestation/assertion path is independently sound. **But the receipt must be stored at attestation time regardless — it cannot be recovered later.** Column is in 0014. | A product decision on whether one-compromised-device-serving-many-clients is in scope. |
| 15 | **What is the real Taiwanese pass rate?** Google publishes no figures; the only official statement is "Fewer devices are in the higher trust tiers". | The enforcement threshold. | §8 phase 2, filtered to Taiwan. Any percentage quoted before that — including any in this document — would be a guess. |

---

## 8. ROLLOUT

The web form must not move. Every phase below is additive until phase 4.

**Phase 0 — nothing user-visible, lands first, on its own PR.**
Migration 0014, `lib/attest/*` with all fixtures and negatives, the SQL concurrency tests, `attest-fail-closed.test.mjs`, `schemaStatus` + `preflight` entries, `.env.example`. `ATTEST_ENFORCE` unset (= `off`), so `/api/attest/*` returns 404 and `route.ts` is untouched by the app path. Full green CI with no credentials.

**Phase 0b — the Turnstile hardening, separately reviewable.**
`abuse.ts` returns `"pass" | "fail" | "unavailable"`; `route.ts` maps `unavailable` → 503 `challenge_unavailable`; the production env guard; `/api/health` `gates`; `verify-deploy` asserts `gates.turnstile === "enforced"` against the deployed endpoint. **Ship this even if the app slips.** ~~It closes a live hole that exists today~~ — it does not; production enforces today. It closes a way for the gate to *become* absent without anyone noticing, and it is the branch that sets the endpoint's minimum. The production env guard half has already shipped as #71; the `"pass" | "fail" | "unavailable"` split has **not**, because mapping an outage to 503 changes the deliberate outage fail-open, and that is the team's decision, not a hardening.

Deploy phase 0b and confirm `gates.turnstile === "enforced"` on production **before** phase 1, because it is the assumption everything after depends on. Note: production previews are behind Vercel SSO and cannot be handed to the owner — use the gated flag on main.

**Phase 1 — `requireProof` wired in, app path still closed.**
`route.ts:68` becomes `requireProof(...)`. With `X-Attest-Platform` absent — which is every existing client — it takes the Turnstile branch and behaves exactly as today. `offline-challenge.test.mjs` updated. The web form is unchanged from the user's side. This is the riskiest refactor in the plan, so it ships with no new behaviour attached to it.

**Phase 2 — measure-only, app-side (`ATTEST_ENFORCE=log`).**
App builds ship to TestFlight and the Play internal test track. `/api/attest/*` opens. Every proof is verified and recorded; a **failed** proof still admits the report but as `pending` with `precision_override` and IP-keyed limits (§6). Run at least two weeks. What you are reading:
- Play Console → Protected with Play → Monitor Play Integrity API, filtered to Taiwan, by app version and Android OS version.
- Our own histogram of App Attest failure reasons by iOS version, and the observed `validation_category` / `bundle_version` values.
- Re-enrolment rate per install (alert on abnormal rates; Apple notes `attestKey` is itself rate-limited — keep app-wide calls under roughly 100/second).

Settle open questions 1–4, 7, 15 here.

**Phase 3 — enforce, gradually (`ATTEST_ENFORCE=on`).**
Turn on for iOS first (local crypto, measured failure modes, no third-party availability dependency), then Android. Roll by app version: the client sends its version, and `ATTEST_ENFORCE=on` applies only at or above a minimum `versionCode` / build, so an older install still in the wild keeps working. `verify-deploy` now asserts `gates.attest === "on"` and `gates.appleEnv === "production"`.

Google's caution applies at every step: "Changes to integrity responses take effect immediately, including for apps and SDKs in production" — **deploy the server parser before flipping any Play Console response configuration.**

**Phase 4 — the web form's future.**
`docs/app-and-site.md:35` says "The web form, if it keeps one, keeps Turnstile" and leaves the "if" open. If the form is retired, `verifyTurnstile` and its remaining complexity go with it and the endpoint has exactly one branch. If it stays, it stays as tier B: accepted, IP-limited, same status logic. **Either way, it is never an alternative satisfier of the attested path** — a request passes by presenting the proof its branch requires and verifying it, or it gets 403. Not `turnstileOk || attestOk`, ever, in any refactor.

**Kill switch.** `ATTEST_ENFORCE=log` reverts phase 3 to phase 2 without a deploy. It does **not** admit a failed proof at full trust; it admits it as `pending` with a coarsened coordinate. That is the whole point of having built the reduced-authority tier rather than a boolean.