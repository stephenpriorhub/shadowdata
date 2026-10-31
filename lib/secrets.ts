/**
 * Constant-time secret comparison, shared by every token/key gate in the app
 * (cron, hub service token, GrokBot feed key). Plain `===` leaks how many leading
 * characters matched through response timing.
 */
import crypto from "crypto";

/** True only when `given` exactly equals `expected`. Empty/missing values never match. */
export function secretMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  // Hash both sides so the comparison is fixed-length and doesn't reveal the expected length.
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** True when `given` matches any of the configured (non-empty) secrets. */
export function secretMatchesAny(given: string | null | undefined, expected: (string | undefined)[]): boolean {
  // Check every candidate (no short-circuit) so timing doesn't reveal which one is set.
  let ok = false;
  for (const e of expected) if (secretMatches(given, e)) ok = true;
  return ok;
}
