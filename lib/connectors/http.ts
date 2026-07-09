/**
 * Shared fetch helpers for connectors. Every call is time-bounded and never
 * throws for an expected failure — connectors translate failure into a
 * SignalResult with status "error"/"no-data" so one dead source never breaks
 * the whole response (graceful-degradation principle from the brain writers).
 */

const DEFAULT_UA =
  process.env.SEC_USER_AGENT ||
  "OxfordHub AltEdge (sprior@monumenttradersalliance.com)";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface GetOpts {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Combine an external abort signal with a per-request timeout. */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  // AbortSignal.any merges — aborts when either fires.
  return AbortSignal.any([signal, timeout]);
}

export async function getJson<T = unknown>(url: string, opts: GetOpts = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": DEFAULT_UA, Accept: "application/json", ...opts.headers },
    cache: "no-store",
    signal: withTimeout(opts.signal, opts.timeoutMs ?? 12_000),
  });
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

export async function getText(url: string, opts: GetOpts = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": DEFAULT_UA, ...opts.headers },
    cache: "no-store",
    signal: withTimeout(opts.signal, opts.timeoutMs ?? 12_000),
  });
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} for ${url}`);
  return await res.text();
}

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  opts: GetOpts = {}
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": DEFAULT_UA,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...opts.headers,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: withTimeout(opts.signal, opts.timeoutMs ?? 12_000),
  });
  if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

/** Percent change helper (null-safe). Returns null when prev is 0/undefined. */
export function pctChange(current: number, prev: number | undefined): number | undefined {
  if (prev === undefined || prev === 0) return undefined;
  return ((current - prev) / prev) * 100;
}

export function trendOf(changePct: number | undefined): "up" | "down" | "flat" | undefined {
  if (changePct === undefined) return undefined;
  if (changePct > 5) return "up";
  if (changePct < -5) return "down";
  return "flat";
}
