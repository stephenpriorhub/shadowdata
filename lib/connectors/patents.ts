/**
 * Patent filings (USPTO via PatentsView Search API). Thesis: grant cadence and
 * subject matter reveal R&D direction and moat-building — a structural, long-term
 * signal. An acceleration can foreshadow a new product line.
 *
 * PatentsView now requires a free API key (X-Api-Key). Without PATENTSVIEW_API_KEY
 * the connector degrades gracefully to "no-data" with a note on how to unlock it.
 */
import { postJson } from "./http";
import { result, type Connector, type Evidence, type Metric, type Timeseries } from "./types";

const meta = {
  id: "patents",
  label: "Patent Filings",
  category: "patents",
  tier: "free",
} as const;

interface PatentHit {
  patent_id: string;
  patent_title: string;
  patent_date: string;
}

export const patentsConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Recent granted-patent volume and topics by assignee (USPTO / PatentsView).",
  requiredIdentifiers: ["patentAssignees"],
  async fetch(entity, ctx) {
    const start = Date.now();
    const assignees = entity.identifiers.patentAssignees ?? [];
    if (assignees.length === 0) {
      return result(meta, { status: "not-applicable", note: "No patent assignee names mapped." });
    }
    const key = process.env.PATENTSVIEW_API_KEY;
    if (!key) {
      return result(meta, {
        status: "no-data",
        note: "Set PATENTSVIEW_API_KEY (free at patentsview.org/apis) to enable patent data.",
        tookMs: Date.now() - start,
      });
    }
    try {
      const sinceYear = ctx.now.getFullYear() - 5;
      const body = {
        q: {
          _and: [
            { _gte: { patent_date: `${sinceYear}-01-01` } },
            {
              _or: assignees.map((a) => ({
                _text_phrase: { "assignees.assignee_organization": a },
              })),
            },
          ],
        },
        f: ["patent_id", "patent_title", "patent_date"],
        o: { size: 100 },
        s: [{ patent_date: "desc" }],
      };
      const data = await postJson<{ patents: PatentHit[] | null; total_hits: number }>(
        "https://search.patentsview.org/api/v1/patent/",
        body,
        { signal: ctx.signal, headers: { "X-Api-Key": key } }
      );
      const patents = data.patents ?? [];
      if (patents.length === 0) {
        return result(meta, {
          status: "no-data",
          note: `No patents granted to ${assignees.join(", ")} since ${sinceYear}.`,
          tookMs: Date.now() - start,
        });
      }

      const byYear = new Map<string, number>();
      for (const p of patents) {
        const y = p.patent_date.slice(0, 4);
        byYear.set(y, (byYear.get(y) ?? 0) + 1);
      }
      const ts: Timeseries = {
        name: "Patents granted / year",
        points: [...byYear.entries()].sort().map(([y, v]) => ({ t: `${y}-01-01`, v })),
      };
      const years = [...byYear.keys()].sort();
      const latest = years[years.length - 1];
      const prev = years[years.length - 2];
      const latestCount = byYear.get(latest) ?? 0;
      const prevCount = prev ? byYear.get(prev) ?? 0 : undefined;

      const metrics: Metric[] = [
        { name: "Granted (5yr, sampled)", value: data.total_hits ?? patents.length },
        {
          name: `Granted (${latest})`,
          value: latestCount,
          trend:
            prevCount === undefined ? undefined : latestCount > prevCount ? "up" : latestCount < prevCount ? "down" : "flat",
        },
        { name: "Most recent", value: patents[0].patent_date },
      ];

      const evidence: Evidence[] = patents.slice(0, 5).map((p) => ({
        summary: `${p.patent_title} (US${p.patent_id})`,
        url: `https://patents.google.com/patent/US${p.patent_id}`,
        sourceDate: p.patent_date,
      }));

      return result(meta, {
        status: "ok",
        headline: `${data.total_hits ?? patents.length} patents granted since ${sinceYear}; ${latestCount} in ${latest}.`,
        metrics,
        timeseries: [ts],
        evidence,
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
