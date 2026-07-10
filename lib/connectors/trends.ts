/**
 * Search interest (Google Trends via SearchApi.io). Thesis: search-query interest is
 * a real-time proxy for consumer demand and attention. A sustained rise is a
 * long-term demand signal; a sharp spike is a short-term catalyst (launch, news).
 *
 * Uses SEARCHAPI_KEY. Cached 12h per term to conserve SearchApi quota.
 */
import { getJson, classifyFailure } from "./http";
import { getCached, setCached } from "../store";
import { result, type Connector, type Metric, type Timeseries } from "./types";

const meta = {
  id: "trends",
  label: "Search Interest (Google Trends)",
  category: "web",
  tier: "premium",
} as const;

const CACHE_NS = "trends";
const CACHE_TTL = 1000 * 60 * 60 * 12; // 12h

interface TrendsPoint {
  timestamp?: string;
  values?: { extracted_value?: number }[];
}

async function fetchTrends(term: string, key: string, signal: AbortSignal): Promise<TrendsPoint[]> {
  const cached = getCached<TrendsPoint[]>(CACHE_NS, term, CACHE_TTL);
  if (cached) return cached;
  const url =
    `https://www.searchapi.io/api/v1/search?engine=google_trends` +
    `&q=${encodeURIComponent(term)}&data_type=TIMESERIES&api_key=${encodeURIComponent(key)}`;
  const data = await getJson<{ interest_over_time?: { timeline_data?: TrendsPoint[] } }>(url, {
    signal,
    timeoutMs: 15_000,
  });
  const tl = data.interest_over_time?.timeline_data ?? [];
  setCached(CACHE_NS, term, tl);
  return tl;
}

export const trendsConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Relative Google search interest over time for the company/brand (0-100 index).",
  requiredIdentifiers: ["brandTerms"],
  async fetch(entity, ctx) {
    const start = Date.now();
    const term = entity.identifiers.brandTerms?.[0] || entity.companyName;
    const key = process.env.SEARCHAPI_KEY;
    if (!key) {
      return result(meta, { status: "no-data", note: "Set SEARCHAPI_KEY to enable Google Trends.", tookMs: Date.now() - start });
    }
    try {
      const tl = await fetchTrends(term, key, ctx.signal);
      const points = tl
        .map((p) => ({
          t: p.timestamp ? new Date(parseInt(p.timestamp, 10) * 1000).toISOString().slice(0, 10) : null,
          v: p.values?.[0]?.extracted_value ?? null,
        }))
        .filter((p): p is { t: string; v: number } => !!p.t && p.v !== null);

      if (points.length < 2) {
        return result(meta, { status: "no-data", note: `No Google Trends data for "${term}".`, tookMs: Date.now() - start });
      }

      const ts: Timeseries = { name: `Search interest: "${term}"`, points };
      const vals = points.map((p) => p.v);
      const last4 = vals.slice(-4).reduce((a, b) => a + b, 0) / Math.min(4, vals.length);
      const prior4 = vals.slice(-8, -4);
      const prior4avg = prior4.length ? prior4.reduce((a, b) => a + b, 0) / prior4.length : undefined;
      const changePct = prior4avg && prior4avg > 0 ? ((last4 - prior4avg) / prior4avg) * 100 : undefined;
      const peak = Math.max(...vals);

      const metrics: Metric[] = [
        {
          name: "Interest (recent avg)",
          value: Math.round(last4),
          unit: "/100",
          changePct,
          trend: changePct === undefined ? undefined : changePct > 10 ? "up" : changePct < -10 ? "down" : "flat",
        },
        { name: "Peak (period)", value: peak, unit: "/100" },
        { name: "Latest", value: vals[vals.length - 1], unit: "/100" },
      ];

      return result(meta, {
        status: "ok",
        headline:
          changePct === undefined
            ? `Search interest for "${term}" averaging ${Math.round(last4)}/100 recently.`
            : `Search interest ${changePct >= 0 ? "up" : "down"} ${Math.abs(changePct).toFixed(0)}% vs the prior month.`,
        metrics,
        timeseries: [ts],
        evidence: [{ summary: `Google Trends query: "${term}"`, url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(term)}` }],
        tookMs: Date.now() - start,
      });
    } catch (e) {
      return result(meta, { ...classifyFailure(e), tookMs: Date.now() - start });
    }
  },
};
