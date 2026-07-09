/**
 * Web / public-attention interest (Wikipedia pageviews API — free, reliable, no key).
 * Thesis: pageview volume for a company's article is a clean proxy for public
 * attention/demand; a sustained rise is a long-term interest signal, a sharp spike
 * a short-term catalyst. (Google Trends / SimilarWeb are richer paid upgrades —
 * see the disabled premium connectors.)
 */
import { getJson } from "./http";
import { result, type Connector, type Metric, type Timeseries } from "./types";

const meta = {
  id: "web",
  label: "Web Interest",
  category: "web",
  tier: "free",
} as const;

const DAY = 1000 * 60 * 60 * 24;

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export const webConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Public-attention trend from daily Wikipedia pageviews for the company's article.",
  requiredIdentifiers: ["wikipediaTitle"],
  async fetch(entity, ctx) {
    const start = Date.now();
    const title = entity.identifiers.wikipediaTitle;
    if (!title) {
      return result(meta, {
        status: "not-applicable",
        note: "No Wikipedia article mapped to this company.",
      });
    }
    try {
      const end = new Date(ctx.now.getTime() - DAY); // yesterday (today is often incomplete)
      const startDate = new Date(ctx.now.getTime() - 120 * DAY);
      const article = encodeURIComponent(title.replace(/ /g, "_"));
      const url =
        `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/` +
        `${article}/daily/${yyyymmdd(startDate)}/${yyyymmdd(end)}`;
      const data = await getJson<{ items: { timestamp: string; views: number }[] }>(url, {
        signal: ctx.signal,
      });
      const items = data.items ?? [];
      if (items.length === 0) {
        return result(meta, { status: "no-data", tookMs: Date.now() - start });
      }

      // Weekly aggregation for a readable sparkline.
      const weekly = new Map<string, number>();
      for (const it of items) {
        const d = new Date(
          `${it.timestamp.slice(0, 4)}-${it.timestamp.slice(4, 6)}-${it.timestamp.slice(6, 8)}`
        );
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const key = monday.toISOString().slice(0, 10);
        weekly.set(key, (weekly.get(key) ?? 0) + it.views);
      }
      const ts: Timeseries = {
        name: "Weekly pageviews",
        points: [...weekly.entries()].sort().map(([t, v]) => ({ t, v })),
      };

      const daily = items.map((i) => i.views);
      const last30 = daily.slice(-30).reduce((a, b) => a + b, 0);
      const prior30 = daily.slice(-60, -30).reduce((a, b) => a + b, 0);
      const changePct = prior30 > 0 ? ((last30 - prior30) / prior30) * 100 : undefined;

      const metrics: Metric[] = [
        { name: "Views (last 30d)", value: last30, changePct, trend: changePct === undefined ? undefined : changePct > 10 ? "up" : changePct < -10 ? "down" : "flat" },
        { name: "Avg / day", value: Math.round(last30 / 30) },
        { name: "Peak day", value: Math.max(...daily).toLocaleString() },
      ];

      return result(meta, {
        status: "ok",
        headline:
          changePct === undefined
            ? `${last30.toLocaleString()} pageviews in the last 30 days.`
            : `Pageviews ${changePct >= 0 ? "up" : "down"} ${Math.abs(changePct).toFixed(0)}% vs the prior 30 days.`,
        metrics,
        timeseries: [ts],
        evidence: [
          {
            summary: `Wikipedia: ${title}`,
            url: `https://en.wikipedia.org/wiki/${article}`,
          },
        ],
        tookMs: Date.now() - start,
      });
    } catch (e) {
      return result(meta, {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
        tookMs: Date.now() - start,
      });
    }
  },
};
