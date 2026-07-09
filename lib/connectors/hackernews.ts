/**
 * Hacker News mindshare (HN Algolia API — free, no key). Thesis: HN volume and
 * points are a proxy for technical/early-adopter attention; a spike often precedes
 * broader awareness. Short-term buzz signal, and a long-term mindshare gauge.
 */
import { getJson, classifyFailure } from "./http";
import { result, type Connector, type Evidence, type Metric, type Timeseries } from "./types";

const meta = {
  id: "hackernews",
  label: "Hacker News Buzz",
  category: "dev-chatter",
  tier: "free",
} as const;

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  points: number | null;
  num_comments: number | null;
  created_at: string;
}

const DAY = 1000 * 60 * 60 * 24;

export const hackernewsConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Story volume, points and comment activity mentioning the company on Hacker News.",
  requiredIdentifiers: ["brandTerms"],
  async fetch(entity, ctx) {
    const start = Date.now();
    const term = entity.identifiers.brandTerms?.[0] || entity.companyName;
    if (!term) return result(meta, { status: "not-applicable" });
    try {
      // Last 180 days of stories mentioning the brand.
      const since = Math.floor((ctx.now.getTime() - 180 * DAY) / 1000);
      const url =
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(term)}` +
        `&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=100`;
      const data = await getJson<{ hits: AlgoliaHit[] }>(url, { signal: ctx.signal });
      const hits = data.hits ?? [];
      if (hits.length === 0) {
        return result(meta, {
          status: "no-data",
          note: `No Hacker News stories mentioning "${term}" in the last 180 days.`,
          tookMs: Date.now() - start,
        });
      }

      const now = ctx.now.getTime();
      const last30 = hits.filter((h) => now - new Date(h.created_at).getTime() <= 30 * DAY);
      const prior30 = hits.filter((h) => {
        const age = now - new Date(h.created_at).getTime();
        return age > 30 * DAY && age <= 60 * DAY;
      });
      const totalPoints = hits.reduce((s, h) => s + (h.points ?? 0), 0);

      // Monthly story counts for a sparkline.
      const buckets = new Map<string, number>();
      for (const h of hits) {
        const key = h.created_at.slice(0, 7);
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      const ts: Timeseries = {
        name: "HN stories / month",
        points: [...buckets.entries()]
          .sort()
          .map(([t, v]) => ({ t: `${t}-01`, v })),
      };

      const metrics: Metric[] = [
        { name: "Stories (180d)", value: hits.length },
        {
          name: "Stories (last 30d)",
          value: last30.length,
          trend: last30.length > prior30.length ? "up" : last30.length < prior30.length ? "down" : "flat",
        },
        { name: "Total points", value: totalPoints },
      ];

      const evidence: Evidence[] = hits
        .slice()
        .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
        .slice(0, 5)
        .map((h) => ({
          summary: `${h.title ?? "(untitled)"} — ${h.points ?? 0} pts, ${h.num_comments ?? 0} comments`,
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          sourceDate: h.created_at,
        }));

      return result(meta, {
        status: "ok",
        headline: `${hits.length} HN stories in 180d (${last30.length} in the last 30), ${totalPoints.toLocaleString()} total points.`,
        metrics,
        timeseries: [ts],
        evidence,
        tookMs: Date.now() - start,
      });
    } catch (e) {
      return result(meta, { ...classifyFailure(e), tookMs: Date.now() - start });
    }
  },
};
