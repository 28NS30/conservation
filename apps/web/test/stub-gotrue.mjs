/**
 * A stand-in for Supabase Auth (GoTrue), so CI can run the signed-in paths.
 *
 * CI points the app at http://127.0.0.1:54321 and, until this existed, nothing
 * listened there. Every test that needed Supabase Auth to answer skipped, so a
 * green run said nothing about whether the proxy's session renewal reached the
 * page under `next start`, or where /login sends someone already signed in —
 * the one place an open redirect needed no click at all. This answers the
 * handful of endpoints the app and the tests call, the way GoTrue does, and
 * nothing else. Locally the tests run against the real local stack instead,
 * which is where this stand-in's answers were checked against GoTrue's.
 *
 *   node apps/web/test/stub-gotrue.mjs      # listens where NEXT_PUBLIC_SUPABASE_URL points
 *
 * It refuses any address that is not this machine. It keeps everything in
 * memory and checks no keys: it exists only where there is nothing to protect.
 *
 * One deliberate difference from GoTrue: a user whose address begins "hang-"
 * gets no answer from /user, ever. That is how the tests show a page does not
 * wait on a Supabase that has stopped answering (lib/supabase/server.ts). It
 * says it is a stand-in in /health, so tests that rely on that can tell.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const STUB_NAME = "stub-gotrue";

const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);

export async function startStubGoTrue({ host = "127.0.0.1", port = 0 } = {}) {
  /** id → user */
  const users = new Map();
  /** access token → user id */
  const access = new Map();
  /** refresh token → user id; a token is deleted once spent */
  const refresh = new Map();

  const now = () => Math.floor(Date.now() / 1000);
  const session = (user) => {
    const accessToken = `stub-access-${randomUUID()}`;
    const refreshToken = `stub-refresh-${randomUUID()}`;
    access.set(accessToken, user.id);
    refresh.set(refreshToken, user.id);
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now() + 3600,
      refresh_token: refreshToken,
      user,
    };
  };
  const refuse = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const path = url.pathname.replace(/^\/auth\/v1/, "");
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const body = req.method === "POST" || req.method === "PUT" ? await json(req) : {};

    if (req.method === "GET" && path === "/health")
      return send(res, 200, { name: STUB_NAME, version: "0", description: "A stand-in for GoTrue" });

    if (req.method === "GET" && path === "/settings")
      return send(res, 200, { external: { email: true, google: false }, disable_signup: false });

    if (req.method === "POST" && path === "/admin/users") {
      const user = {
        id: randomUUID(),
        aud: "authenticated",
        role: "authenticated",
        email: String(body.email ?? "").toLowerCase(),
        email_confirmed_at: body.email_confirm ? new Date().toISOString() : null,
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        identities: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      users.set(user.id, { ...user, password: body.password });
      return send(res, 200, user);
    }

    const adminUser = /^\/admin\/users\/([^/]+)$/.exec(path);
    if (req.method === "DELETE" && adminUser) {
      users.delete(adminUser[1]);
      return send(res, 200, {});
    }

    if (req.method === "POST" && path === "/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const found = [...users.values()].find(
          (u) => u.email === String(body.email ?? "").toLowerCase() && u.password === body.password,
        );
        if (!found) return refuse(res, 400, "invalid_credentials", "Invalid login credentials");
        return send(res, 200, session(publicUser(found)));
      }
      if (grant === "refresh_token") {
        const id = refresh.get(body.refresh_token);
        if (!id || !users.has(id))
          return refuse(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
        refresh.delete(body.refresh_token);
        return send(res, 200, session(publicUser(users.get(id))));
      }
      return refuse(res, 400, "validation_failed", "Unsupported grant type");
    }

    if (req.method === "GET" && path === "/user") {
      const user = users.get(access.get(bearer));
      if (!user) return refuse(res, 403, "bad_jwt", "invalid JWT");
      if (user.email.startsWith("hang-")) return; // never answers
      return send(res, 200, publicUser(user));
    }

    if (req.method === "POST" && path === "/logout") {
      access.delete(bearer);
      res.statusCode = 204;
      return res.end();
    }

    return refuse(res, 404, "not_found", `The stand-in does not answer ${req.method} ${path}`);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return {
    url: `http://${host}:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

function publicUser({ password: _password, ...user }) {
  return user;
}

/** Errors in the shape the local GoTrue (v2.194) answers with: `{ code, error_code, msg }`. */
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function json(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321");
  if (!LOCAL.has(target.hostname)) {
    console.error(`Refusing to stand in for ${target.origin}: not this machine.`);
    process.exit(1);
  }
  const host = target.hostname === "localhost" ? "127.0.0.1" : target.hostname.replace(/^\[|\]$/g, "");
  const { url } = await startStubGoTrue({ host, port: Number(target.port) || 80 });
  console.log(`${STUB_NAME} listening at ${url}`);
}
