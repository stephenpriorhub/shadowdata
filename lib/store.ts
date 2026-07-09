/**
 * App-side persistence on the Railway volume (DATA_DIR), mirroring the
 * promo-analyzer reviews-store pattern. Two caches:
 *   1. resolved entities  — so ticker→identifier LLM resolution is paid once.
 *   2. signal snapshots    — the running per-ticker history that a future phase
 *      will distill into the brain (NO brain writes in v1; this just accrues).
 */
import fs from "fs";
import path from "path";
import type { ResolvedEntity, SignalResult } from "./connectors/types";

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");
const ENTITIES_FILE = path.join(DATA_DIR, "entities.json");
const SNAPSHOTS_DIR = path.join(DATA_DIR, "snapshots");

// Resolved entities go stale (org renames, new apps). Re-resolve after this.
const ENTITY_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readEntities(): Record<string, ResolvedEntity> {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(ENTITIES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(ENTITIES_FILE, "utf-8")) as Record<string, ResolvedEntity>;
  } catch {
    return {};
  }
}

function writeEntities(map: Record<string, ResolvedEntity>) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(ENTITIES_FILE, JSON.stringify(map, null, 2), "utf-8");
}

export function getCachedEntity(ticker: string): ResolvedEntity | null {
  const e = readEntities()[ticker.toUpperCase()];
  if (!e) return null;
  if (Date.now() - new Date(e.resolvedAt).getTime() > ENTITY_TTL_MS) return null;
  return e;
}

export function saveEntity(entity: ResolvedEntity): void {
  const map = readEntities();
  map[entity.ticker.toUpperCase()] = entity;
  writeEntities(map);
}

/** Manual override of resolved identifiers (user corrections from the UI). */
export function overrideIdentifiers(
  ticker: string,
  identifiers: Partial<ResolvedEntity["identifiers"]>
): ResolvedEntity | null {
  const map = readEntities();
  const key = ticker.toUpperCase();
  const e = map[key];
  if (!e) return null;
  e.identifiers = { ...e.identifiers, ...identifiers };
  e.resolvedAt = new Date().toISOString();
  writeEntities(map);
  return e;
}

export interface Snapshot {
  ticker: string;
  takenAt: string;
  signals: SignalResult[];
}

/** Append a point-in-time snapshot of a ticker's signals (append-only, per ticker). */
export function appendSnapshot(ticker: string, signals: SignalResult[]): void {
  ensureDir(SNAPSHOTS_DIR);
  const file = path.join(SNAPSHOTS_DIR, `${ticker.toUpperCase()}.json`);
  let history: Snapshot[] = [];
  if (fs.existsSync(file)) {
    try {
      history = JSON.parse(fs.readFileSync(file, "utf-8")) as Snapshot[];
    } catch {
      history = [];
    }
  }
  history.push({ ticker: ticker.toUpperCase(), takenAt: new Date().toISOString(), signals });
  // Keep the last 90 snapshots per ticker so the file can't grow unbounded.
  if (history.length > 90) history = history.slice(-90);
  fs.writeFileSync(file, JSON.stringify(history, null, 2), "utf-8");
}

export function getSnapshots(ticker: string): Snapshot[] {
  const file = path.join(SNAPSHOTS_DIR, `${ticker.toUpperCase()}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Snapshot[];
  } catch {
    return [];
  }
}
