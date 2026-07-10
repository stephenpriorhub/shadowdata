/**
 * Patent filings (USPTO Open Data Portal — Patent File Wrapper Search API). Thesis:
 * grant cadence and subject matter reveal R&D direction and moat-building — a
 * structural, long-term signal; an acceleration can foreshadow a new product line.
 *
 * NOTE (2026): PatentsView was decommissioned (search.patentsview.org is gone) and
 * migrated into the USPTO Open Data Portal. The live, key-authenticated endpoint is
 * the File Wrapper Search: POST https://api.uspto.gov/api/v1/patent/applications/search
 * with header X-API-KEY. Query is Lucene-style over applicationMetaData fields. Set
 * USPTO_API_KEY (free ODP account at data.uspto.gov). Without a key — or if ODP
 * rejects the request — the connector degrades gracefully to "no-data".
 */
import { postJson, classifyFailure } from "./http";
import { result, type Connector, type DetailSection, type Evidence, type Metric, type Timeseries } from "./types";

const meta = {
  id: "patents",
  label: "Patent Filings",
  category: "patents",
  tier: "free",
} as const;

const ODP_SEARCH_URL = "https://api.uspto.gov/api/v1/patent/applications/search";

interface SearchResponse {
  count: number;
  patentFileWrapperDataBag?: {
    applicationMetaData?: {
      inventionTitle?: string;
      grantDate?: string;
      patentNumber?: string;
      firstApplicantName?: string;
    };
  }[];
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}

export const patentsConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Granted-patent volume and topics by assignee (USPTO Open Data Portal / File Wrapper Search).",
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

    const applicantClause =
      "(" +
      assignees.map((a) => `applicationMetaData.firstApplicantName:${quote(a)}`).join(" OR ") +
      ")";
    const headers = { "X-API-KEY": key };
    const search = (body: object) =>
      postJson<SearchResponse>(ODP_SEARCH_URL, body, { signal: ctx.signal, headers, timeoutMs: 15_000 });

    try {
      const thisYear = ctx.now.getFullYear();
      const years = [thisYear - 4, thisYear - 3, thisYear - 2, thisYear - 1, thisYear];

      // Per-year granted-patent counts (accurate trend) + most-recent grants (evidence), concurrently.
      const [yearCounts, recent] = await Promise.all([
        Promise.all(
          years.map(async (y) => {
            const r = await search({
              q: `${applicantClause} AND applicationMetaData.grantDate:[${y}-01-01 TO ${y}-12-31]`,
              pagination: { offset: 0, limit: 1 },
            });
            return { year: y, count: r.count ?? 0 };
          })
        ),
        search({
          q: `${applicantClause} AND applicationMetaData.grantDate:[${thisYear - 5}-01-01 TO ${thisYear}-12-31]`,
          sort: [{ field: "applicationMetaData.grantDate", order: "desc" }],
          fields: [
            "applicationMetaData.inventionTitle",
            "applicationMetaData.grantDate",
            "applicationMetaData.patentNumber",
          ],
          pagination: { offset: 0, limit: 5 },
        }),
      ]);

      const total = yearCounts.reduce((s, y) => s + y.count, 0);
      if (total === 0) {
        return result(meta, {
          status: "no-data",
          note: `No patents granted to ${assignees.join(", ")} in the last 5 years.`,
          tookMs: Date.now() - start,
        });
      }

      const ts: Timeseries = {
        name: "Patents granted / year",
        points: yearCounts.map((y) => ({ t: `${y.year}-01-01`, v: y.count })),
      };
      const latest = yearCounts[yearCounts.length - 1];
      const prev = yearCounts[yearCounts.length - 2];
      const trend =
        !prev ? undefined : latest.count > prev.count ? "up" : latest.count < prev.count ? "down" : "flat";

      const metrics: Metric[] = [
        { name: "Granted (5yr)", value: total },
        { name: `Granted (${latest.year})`, value: latest.count, trend },
        { name: "Prior year", value: prev ? prev.count : "—" },
      ];

      const evidence: Evidence[] = (recent.patentFileWrapperDataBag ?? [])
        .map((w) => w.applicationMetaData ?? {})
        .filter((m) => m.patentNumber)
        .map((m) => ({
          summary: `${m.inventionTitle ?? "(untitled)"} (US${m.patentNumber})`,
          url: `https://patents.google.com/patent/US${(m.patentNumber ?? "").replace(/\s/g, "")}`,
          sourceDate: m.grantDate,
        }));

      const detail: DetailSection[] = [
        { kind: "bars", title: "Patents granted per year", unit: "patents", items: yearCounts.map((y) => ({ label: String(y.year), value: y.count })) },
        {
          kind: "links",
          title: "Most recent grants",
          links: evidence.filter((e) => e.url).map((e) => ({ label: e.summary, url: e.url! , sublabel: e.sourceDate })),
        },
      ];

      return result(meta, {
        status: "ok",
        headline: `${total.toLocaleString()} patents granted in 5 years; ${latest.count.toLocaleString()} in ${latest.year}.`,
        metrics,
        timeseries: [ts],
        evidence,
        detail,
        tookMs: Date.now() - start,
      });
    } catch (e) {
      const f = classifyFailure(e);
      return result(meta, {
        ...f,
        note: f.status === "no-data" ? f.note : "USPTO ODP request failed.",
        tookMs: Date.now() - start,
      });
    }
  },
};
