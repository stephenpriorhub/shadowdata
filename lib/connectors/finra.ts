/**
 * FINRA daily short-sale volume (Reg SHO, free, no key).
 * Source: cdn.finra.org/equity/regsho/daily/CNMSshvolYYYYMMDD.txt — one pipe-delimited file per
 * trading day covering every symbol, published after the close (weekends/holidays → 403).
 *
 * What it is: the share of OFF-EXCHANGE (FINRA TRF/ADF/ORF-reported) volume that was executed as a
 * short sale. It is NOT short interest and not consolidated volume; market-maker hedging makes ~40-50%
 * the normal baseline. The useful read is the ratio moving versus its own recent average.
 *
 * Each file is ~0.5 MB (~12k symbols). We parse it once into a symbol → [short, total] map and cache
 * it on the volume per day, so one download serves every ticker that day.
 */
import { getText, HttpError, classifyFailure } from "./http";
import { getCached, setCached } from "../store";
import { result, type Connector, type Metric, type Timeseries } from "./types";

const meta = {
  id: "finra-short",
  label: "Short Volume (FINRA)",
  category: "short-volume",
  tier: "free",
} as const;

const DAY = 1000 * 60 * 60 * 24;
const NS = "finra-shvol";
const KEEP = 1000 * 60 * 60 * 24 * 400; // published days never change
const TRADING_DAYS = 20;
const LOOKBACK_CAL_DAYS = 35;

type DayMap = Record<string, [short: number, total: number]>;

export const fileUrl = (ymd: string) => `https://cdn.finra.org/equity/regsho/daily/CNMSshvol${ymd}.txt`;

/** FINRA writes class shares with a slash (BF/B); tickers here use a dot or dash. */
export function finraSymbol(ticker: string): string {
  return ticker.toUpperCase().replace(/[.-]/g, "/");
}

export function parseFile(text: string): DayMap {
  const out: DayMap = {};
  for (const line of text.split("\n")) {
    const [date, sym, short, , total] = line.split("|");
    if (!sym || !/^\d{8}$/.test(date)) continue; // header / footer record-count line
    const s = Number(short);
    const t = Number(total);
    if (Number.isFinite(s) && Number.isFinite(t)) out[sym] = [s, t];
  }
  return out;
}

const memo = new Map<string, Promise<DayMap | null>>();

/** One day's parsed file, or null when FINRA has no file for that date (weekend/holiday/not yet out). */
async function loadDay(ymd: string, signal: AbortSignal): Promise<DayMap | null> {
  const cached = getCached<DayMap>(NS, ymd, KEEP);
  if (cached) return cached;
  let p = memo.get(ymd);
  if (!p) {
    p = (async () => {
      try {
        const map = parseFile(await getText(fileUrl(ymd), { signal, timeoutMs: 10_000 }));
        if (Object.keys(map).length > 0) setCached(NS, ymd, map);
        return map;
      } catch (e) {
        // 403/404 = no file for this date. Don't cache: the latest day may just not be published yet.
        if (e instanceof HttpError && (e.status === 403 || e.status === 404)) return null;
        throw e;
      } finally {
        memo.delete(ymd);
      }
    })();
    memo.set(ymd, p);
  }
  return p;
}

const ymdOf = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const isoOf = (ymd: string) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

/** Candidate weekday dates, newest first (holidays simply come back as no file). */
export function candidateDays(now: Date): string[] {
  const days: string[] = [];
  for (let i = 0; i < LOOKBACK_CAL_DAYS; i++) {
    const d = new Date(now.getTime() - i * DAY);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(ymdOf(d));
  }
  return days;
}

export const finraShortConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Daily share of off-exchange volume executed short (FINRA Reg SHO files). Not short interest.",
  requiredIdentifiers: [],
  async fetch(entity, ctx) {
    const start = Date.now();
    const sym = finraSymbol(entity.ticker);
    try {
      const days = candidateDays(ctx.now);
      const maps = await Promise.all(days.map((d) => loadDay(d, ctx.signal)));
      const series: { ymd: string; short: number; total: number }[] = [];
      days.forEach((ymd, i) => {
        const row = maps[i]?.[sym];
        if (row && row[1] > 0) series.push({ ymd, short: row[0], total: row[1] });
      });
      series.reverse(); // oldest → newest
      const recent = series.slice(-TRADING_DAYS);
      if (recent.length === 0) {
        return result(meta, {
          status: "no-data",
          note: `FINRA reported no off-exchange volume for ${sym} in the last ${LOOKBACK_CAL_DAYS} days.`,
          tookMs: Date.now() - start,
        });
      }

      const ratio = (r: { short: number; total: number }) => (r.short / r.total) * 100;
      const latest = recent[recent.length - 1];
      const prior = recent.slice(0, -1);
      const latestPct = ratio(latest);
      const avgPct = prior.length ? prior.reduce((a, r) => a + ratio(r), 0) / prior.length : undefined;
      const diffPts = avgPct === undefined ? undefined : latestPct - avgPct;
      const asOf = isoOf(latest.ymd);

      const ts: Timeseries = { name: "Short % of off-exchange volume", points: recent.map((r) => ({ t: isoOf(r.ymd), v: +ratio(r).toFixed(1) })) };
      const metrics: Metric[] = [
        {
          name: `Short % (${asOf})`,
          value: +latestPct.toFixed(1),
          unit: "%",
          trend: diffPts === undefined ? undefined : diffPts > 5 ? "up" : diffPts < -5 ? "down" : "flat",
        },
        ...(avgPct === undefined ? [] : [{ name: `Prior ${prior.length}-day avg`, value: +avgPct.toFixed(1), unit: "%" }]),
        { name: "Short volume", value: Math.round(latest.short).toLocaleString() },
        { name: "Off-exchange volume", value: Math.round(latest.total).toLocaleString() },
      ];

      return result(meta, {
        status: "ok",
        headline:
          diffPts === undefined
            ? `${latestPct.toFixed(1)}% of off-exchange volume was short on ${asOf}.`
            : `${latestPct.toFixed(1)}% short on ${asOf}, ${Math.abs(diffPts).toFixed(1)} pts ${diffPts >= 0 ? "above" : "below"} its ${prior.length}-day average (${avgPct!.toFixed(1)}%).`,
        note: "Off-exchange (FINRA-reported) volume only. Not short interest; ~40-50% is a normal baseline.",
        metrics,
        timeseries: [ts],
        evidence: [{ summary: `FINRA Reg SHO daily short volume, ${asOf}`, url: fileUrl(latest.ymd), sourceDate: asOf }],
        primaryLink: { label: "FINRA short sale volume", url: "https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files" },
        tookMs: Date.now() - start,
      });
    } catch (e) {
      return result(meta, { ...classifyFailure(e, meta.label), tookMs: Date.now() - start });
    }
  },
};
