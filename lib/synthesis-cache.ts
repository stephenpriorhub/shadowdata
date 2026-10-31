/**
 * Server-built, once-per-day AI thesis. The client only names a ticker; the signals come
 * from the latest server-side snapshot (written by /api/signals or the daily cron scan), so
 * a signed-in user can't feed arbitrary text to Claude or run up the bill by re-asking.
 *
 * One Claude call per ticker per America/New_York calendar day, shared by every user.
 * Concurrent requests for the same ticker share the in-flight call.
 */
import { getCached, getSnapshots, setCached } from "./store";
import { resolveEntity } from "./entity-resolver";
import { synthesize, type Synthesis } from "./synthesis";

const NS = "synthesis";
const CACHE_TTL = 1000 * 60 * 60 * 36; // the key already rolls daily; TTL just bounds stale files
const SNAPSHOT_MAX_AGE = 1000 * 60 * 60 * 24;
const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

export interface DailySynthesis {
  synthesis: Synthesis;
  day: string; // YYYY-MM-DD, America/New_York
  generatedAt: string;
  basedOn: string; // takenAt of the snapshot the thesis was built from
}

export class SynthesisUnavailable extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Calendar day in America/New_York (the cache key's day boundary). */
export function etDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function normalizeTicker(raw: unknown): string | null {
  const t = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return TICKER_RE.test(t) ? t : null;
}

const inflight = new Map<string, Promise<DailySynthesis>>();

export async function getDailySynthesis(ticker: string, now = new Date()): Promise<DailySynthesis> {
  const day = etDay(now);
  const key = `${ticker}_${day}`;
  const cached = getCached<DailySynthesis>(NS, key, CACHE_TTL);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    const snap = getSnapshots(ticker).at(-1);
    if (!snap || now.getTime() - new Date(snap.takenAt).getTime() > SNAPSHOT_MAX_AGE) {
      throw new SynthesisUnavailable("No recent signals for this ticker — run the lookup first.", 409);
    }
    if (!snap.signals.some((s) => s.status === "ok")) {
      throw new SynthesisUnavailable("No source returned data for this ticker, so there is nothing to synthesize.", 409);
    }
    const entity = await resolveEntity(ticker);
    const synthesis = await synthesize(entity, snap.signals);
    const out: DailySynthesis = { synthesis, day, generatedAt: new Date().toISOString(), basedOn: snap.takenAt };
    setCached(NS, key, out);
    return out;
  })();
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}
