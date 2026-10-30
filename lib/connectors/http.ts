/**
 * Shared fetch helpers for connectors. Every call is time-bounded and never
 * throws for an expected failure — connectors translate failure into a
 * SignalResult with status "error"/"no-data" so one dead source never breaks
 * the whole response (graceful-degradation principle from the brain writers).
 */

const DEFAULT_UA =
  process.env.SEC_USER_AGENT ||
  "OxfordHub ShadowData (sprior@monumenttradersalliance.com)";

/**
 * HttpError deliberately carries NO URL in its message: upstream URLs can hold API keys
 * in the query string (SearchApi `api_key=`). The redacted URL is kept for server logs.
 */
export class HttpError extends Error {
  constructor(public status: number, message: string, public safeUrl?: string) {
    super(message);
  }
}

const SECRET_PARAM = /([?&](?:api[_-]?key|apikey|key|token|access_token|secret|client_secret|sig|signature)=)[^&#\s"']*/gi;

/** Strip query strings / secret params and known secret env values from any text. */
export function redact(text: string): string {
  let out = String(text).replace(SECRET_PARAM, "$1[REDACTED]");
  // Drop remaining query strings from URLs entirely.
  out = out.replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/g, "$1?[query redacted]");
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || v.length < 8) continue;
    if (!/(KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL)/.test(k)) continue;
    out = out.split(v).join("[REDACTED]");
  }
  return out;
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return "unknown-host"; }
}

export type ErrorCategory = "rate_limited" | "auth" | "not_found" | "unavailable" | "timeout" | "bad_response" | "internal";

export function categorize(status?: number): ErrorCategory {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status && status >= 500) return "unavailable";
  return "bad_response";
}

/** Client-safe one-liner: "<Source>: HTTP 429 (rate_limited)". Never includes upstream text. */
export function safeErrorText(source: string, category: ErrorCategory, status?: number): string {
  return `${source}: ${status ? `HTTP ${status} ` : ""}(${category})`;
}

/** Full detail, redacted, server-side only. */
export function logSourceError(source: string, e: unknown): void {
  const status = e instanceof HttpError ? e.status : undefined;
  const url = e instanceof HttpError ? e.safeUrl : undefined;
  const msg = e instanceof Error ? e.message : String(e);
  console.error(redact(`[source-error] ${source} status=${status ?? "-"} url=${url ?? "-"} msg=${msg}`));
}

async function failIfNotOk(res: Response, url: string): Promise<void> {
  if (res.ok) return;
  // Read (and redact) a little of the body for server logs only; never surfaced to clients.
  let body = "";
  try { body = (await res.text()).slice(0, 300); } catch {}
  const safeUrl = redact(url);
  console.error(redact(`[upstream] ${res.status} ${hostOf(url)} ${safeUrl} body=${body}`));
  throw new HttpError(res.status, `${res.status} ${res.statusText} from ${hostOf(url)}`, safeUrl);
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
  await failIfNotOk(res, url);
  return (await res.json()) as T;
}

export async function getText(url: string, opts: GetOpts = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": DEFAULT_UA, ...opts.headers },
    cache: "no-store",
    signal: withTimeout(opts.signal, opts.timeoutMs ?? 12_000),
  });
  await failIfNotOk(res, url);
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
  await failIfNotOk(res, url);
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

/**
 * Turn a thrown fetch failure into a client-safe SignalResult fragment. Only the source
 * name, HTTP status and a short category reach the client; full redacted detail is logged.
 * 404 stays a quiet "no-data" (mapped-but-wrong identifier).
 */
export function classifyFailure(e: unknown, source = "Source"): {
  status: "no-data" | "error";
  note?: string;
  error?: string;
} {
  logSourceError(source, e);
  if (e instanceof HttpError) {
    if (e.status === 404) return { status: "no-data", note: "Source has no record for the mapped identifier." };
    return { status: "error", error: safeErrorText(source, categorize(e.status), e.status) };
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort|timed?\s?out/i.test(msg)) return { status: "error", error: safeErrorText(source, "timeout") };
  if (/ENOTFOUND|EAI_AGAIN|fetch failed|ECONN|ENETUNREACH/i.test(msg))
    return { status: "no-data", note: safeErrorText(source, "unavailable") };
  return { status: "error", error: safeErrorText(source, "internal") };
}
