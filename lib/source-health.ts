/**
 * Per-source health: whether each data source ACTUALLY worked on its recent real runs (lookups and
 * the daily scan), not just whether a key is configured. Every connector run records its outcome
 * here; GET /api/health/sources reads it back.
 *
 *   ok / no-data    → the source answered (no-data = it answered "nothing for this company")
 *   error           → the source failed (auth, rate limit, timeout, outage…)
 *   not-applicable  → not counted; the company simply has no identifier for that source
 *
 * Kept in memory and persisted to DATA_DIR/source-health.json (atomic tmp+rename) so it survives
 * restarts. Only client-safe text is stored (runOne has already redacted errors).
 */
import fs from "fs";
import path from "path";
import type { SignalResult } from "./connectors/types";

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "source-health.json");
const RECENT = 20; // outcomes kept per source
const STALE_MS = 1000 * 60 * 60 * 26; // a daily scan should touch every source within ~a day

export interface Outcome {
  at: string;
  status: "ok" | "no-data" | "error";
  ticker: string;
  error?: string;
  tookMs?: number;
}

type Store = Record<string, Outcome[]>;
let store: Store | null = null;

function load(): Store {
  if (store) return store;
  try {
    store = JSON.parse(fs.readFileSync(FILE, "utf-8")) as Store;
  } catch {
    store = {};
  }
  return store;
}

function persist(s: Store) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, FILE);
  } catch {
    /* health tracking is best-effort; never break a lookup over it */
  }
}

export function recordOutcome(ticker: string, r: SignalResult): void {
  if (r.status === "not-applicable") return;
  const s = load();
  const list = (s[r.connectorId] ??= []);
  list.push({ at: r.fetchedAt, status: r.status, ticker: ticker.toUpperCase(), error: r.status === "error" ? r.error : undefined, tookMs: r.tookMs });
  if (list.length > RECENT) list.splice(0, list.length - RECENT);
  persist(s);
}

export type HealthState = "working" | "degraded" | "failing" | "no-recent-runs";

export interface SourceHealth {
  state: HealthState;
  lastRunAt?: string;
  lastOkAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  recent: { runs: number; ok: number; noData: number; errors: number };
}

/** Summarize one source's recent outcomes. */
export function summarize(outcomes: Outcome[] | undefined, now = Date.now()): SourceHealth {
  const list = outcomes ?? [];
  const last = list.at(-1);
  const lastOk = list.findLast((o) => o.status !== "error");
  const lastErr = list.findLast((o) => o.status === "error");
  const errors = list.filter((o) => o.status === "error").length;
  const recent = { runs: list.length, ok: list.filter((o) => o.status === "ok").length, noData: list.filter((o) => o.status === "no-data").length, errors };

  // failing = the last 3 runs all errored; degraded = errors mixed in among the last 5.
  const hasError = (n: number) => list.slice(-n).some((o) => o.status === "error");
  const allError = (n: number) => list.slice(-n).every((o) => o.status === "error");
  let state: HealthState;
  if (!last || now - new Date(last.at).getTime() > STALE_MS) state = "no-recent-runs";
  else if (allError(3)) state = "failing";
  else state = hasError(5) ? "degraded" : "working";

  return { state, lastRunAt: last?.at, lastOkAt: lastOk?.at, lastErrorAt: lastErr?.at, lastError: lastErr?.error, recent };
}

export function getAllHealth(): Store {
  return load();
}

/** Test hook. */
export function _resetHealthForTests() {
  store = {};
}
