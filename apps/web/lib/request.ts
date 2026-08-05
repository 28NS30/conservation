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
