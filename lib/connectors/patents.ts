/**
 * Patent filings (USPTO Open Data Portal — PatentsView data). Thesis: grant cadence
 * and subject matter reveal R&D direction and moat-building — a structural, long-term
 * signal; an acceleration can foreshadow a new product line.
 *
 * NOTE (2026): PatentsView was decommissioned at search.patentsview.org and migrated
 * into the USPTO Open Data Portal (ODP). The machine endpoint is now
 * https://api.uspto.gov/api/v1/patentsview/patents and requires an ODP API key
 * (X-API-KEY). Set USPTO_API_KEY (or legacy PATENTSVIEW_API_KEY). Without a key —
 * or if ODP rejects the request — the connector degrades gracefully to "no-data".
 */
import { postJson, classifyFailure } from "./http";
import { result, type Connector, type Evidence, type Metric, type Timeseries } from "./types";

const meta = {
  id: "patents",
  label: "Patent Filings",
  category: "patents",
  tier: "free",
} as const;

const ODP_PATENTS_URL = "https://api.uspto.gov/api/v1/patentsview/patents";

interface PatentHit {
  patent_id: string;
  patent_title: string;
  patent_date: string;
}

export const patentsConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Recent granted-patent volume and topics by assignee (USPTO Open Data Portal / PatentsView).",
  requiredIdentifiers: ["patentAssignees"],
  async fetch(entity, ctx) {
    const start = Date.now();
    const assignees = entity.identifiers.patentAssignees ?? [];
    if (assignees.length === 0) {
      return result(meta, { status: "not-applicable", note: "No patent assignee names mapped." });
    }
    const key = process.env.USPTO_API_KEY || process.env.PATENTSVIEW_API_KEY;
    if (!key) {
      return result(meta, {
        status: "no-data",
        note: "Set USPTO_API_KEY (free ODP account at data.uspto.gov) to enable patent data.",
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
      const data = await postJson<{ patents: PatentHit[] | null; total_hits?: number; count?: number }>(
        ODP_PATENTS_URL,
        body,
        { signal: ctx.signal, headers: { "X-API-KEY": key }, timeoutMs: 15_000 }
      );
      const patents = data.patents ?? [];
      const total = data.total_hits ?? data.count ?? patents.length;
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
        name: "Patents granted / year (sampled)",
        points: [...byYear.entries()].sort().map(([y, v]) => ({ t: `${y}-01-01`, v })),
      };
      const years = [...byYear.keys()].sort();
      const latest = years[years.length - 1];
      const prev = years[years.length - 2];
      const latestCount = byYear.get(latest) ?? 0;
      const prevCount = prev ? byYear.get(prev) ?? 0 : undefined;

      const metrics: Metric[] = [
        { name: "Granted (5yr)", value: total },
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
        headline: `${total} patents granted since ${sinceYear}; ${latestCount} in ${latest}.`,
        metrics,
        timeseries: [ts],
        evidence,
        tookMs: Date.now() - start,
      });
    } catch (e) {
      const f = classifyFailure(e);
      return result(meta, {
        ...f,
        note:
          f.status === "no-data"
            ? f.note
            : "USPTO ODP request failed (the portal now requires an account-linked API key).",
        tookMs: Date.now() - start,
      });
    }
  },
};
