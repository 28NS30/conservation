import { createHmac } from "node:crypto";

/**
 * Best-effort client IP for rate limiting.
 *
 * Behind Vercel, `x-forwarded-for` is set by the platform and the left-most entry
 * is the real client. This is a rate-limiting signal, not an authentication one —
 * it is spoofable in a self-hosted setup without a trusted proxy.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * The network an address stands for when counting: an IPv4 address itself, an
 * IPv6 address's /64 in full form.
 *
 * One household or phone network hands a device a whole /64, so counting each
 * IPv6 address separately would let one sender rotate through billions of
 * budgets. Taking the first four groups of the written form was not enough:
 * `2001:db8::1` and `2001:db8::2` share a /64 but not four written groups, so
 * the "::" is expanded first. An IPv4 address written as IPv6
 * (`::ffff:203.0.113.7`) counts as the IPv4 address. Anything that is not an
 * address (a header set by hand, "unknown") is counted as itself.
 */
export function networkOf(ip: string): string {
  let a = ip.trim().toLowerCase().replace(/%.*$/, "").replace(/^\[|\]$/g, "");
  if (!a.includes(":")) return a;
  // A trailing dotted IPv4 part stands for the last two groups.
  const dotted = a.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const [, head, b1, b2, b3, b4] = dotted;
    const hex = (x: string, y: string) => ((Number(x) << 8) | Number(y)).toString(16);
    a = `${head}${hex(b1, b2)}:${hex(b3, b4)}`;
  }
  const halves = a.split("::");
  if (halves.length > 2) return a;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return a;
  const groups = [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...right].map(
    (g) => g.replace(/^0+(?=.)/, ""),
  );
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return a;
  if (groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff") {
    const n = (parseInt(groups[6], 16) << 16) | parseInt(groups[7], 16);
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/**
 * The key a client address is counted under: never the address itself.
 *
 * rate_limits kept raw IP addresses (`submit-daily:ip:203.0.113.7`) with the
 * time of each report, which ties an anonymous report to where it was sent
 * from, and nothing ever deleted them outside the forum's retention job
 * (security audit, 29 September 2026). Now the address is an HMAC under a
 * server secret, so a row names no address even to someone reading the table,
 * and the cleanup job deletes rows once their longest window has passed.
 *
 * An IPv6 address counts as its /64 (networkOf, above).
 *
 * RATE_LIMIT_KEY when set; otherwise another secret the server already holds.
 */
export function addressKey(ip: string): string {
  const grouped = networkOf(ip);
  const secret =
    process.env.RATE_LIMIT_KEY ||
    process.env.CRON_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  return createHmac("sha256", secret).update(grouped).digest("base64url").slice(0, 22);
}

