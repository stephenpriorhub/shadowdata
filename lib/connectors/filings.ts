/**
 * SEC filings cadence (EDGAR). Thesis: a cluster of 8-Ks is a short-term catalyst
 * flag (material events — M&A, guidance, leadership change); steady S-1/10-Q/10-K
 * cadence is baseline. Free, authoritative, no key — just a required User-Agent.
 */
import { getJson, classifyFailure } from "./http";
import { result, type Connector, type DetailSection, type Evidence, type Metric } from "./types";

const meta = {
  id: "filings",
  label: "SEC Filings",
  category: "filings",
  tier: "free",
} as const;

interface SubmissionsDoc {
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

const DAY = 1000 * 60 * 60 * 24;

export const filingsConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Recent 8-K / 10-Q / 10-K cadence from SEC EDGAR — surfaces material-event catalysts.",
  requiredIdentifiers: [],
  async fetch(entity, ctx) {
    const start = Date.now();
    if (!entity.cik) {
      return result(meta, {
        status: "not-applicable",
        note: "No SEC CIK — likely a foreign issuer or not an SEC registrant.",
      });
    }
    try {
      const cik10 = entity.cik.padStart(10, "0");
      const doc = await getJson<SubmissionsDoc>(
        `https://data.sec.gov/submissions/CIK${cik10}.json`,
        { signal: ctx.signal }
      );
      const r = doc.filings?.recent;
      if (!r || !r.form?.length) {
        return result(meta, { status: "no-data", tookMs: Date.now() - start });
      }

      const cikInt = String(parseInt(entity.cik, 10));
      const rows = r.form.map((form, i) => ({
        form,
        date: r.filingDate[i],
        accession: r.accessionNumber[i],
        doc: r.primaryDocument[i],
        desc: r.primaryDocDescription[i],
      }));

      const now = ctx.now.getTime();
      const within90 = rows.filter((x) => now - new Date(x.date).getTime() <= 90 * DAY);
      const eightKs90 = within90.filter((x) => x.form.startsWith("8-K"));
      const last = rows[0];

      const metrics: Metric[] = [
        { name: "Filings (90d)", value: within90.length },
        { name: "8-Ks (90d)", value: eightKs90.length, trend: eightKs90.length >= 3 ? "up" : undefined },
        { name: "Last filing", value: `${last.form} · ${last.date}` },
      ];

      const link = (x: (typeof rows)[number]) =>
        `https://www.sec.gov/Archives/edgar/data/${cikInt}/${x.accession.replace(/-/g, "")}/${x.doc}`;

      const evidence: Evidence[] = rows.slice(0, 6).map((x) => ({
        summary: `${x.form}${x.desc ? ` — ${x.desc}` : ""}`,
        url: link(x),
        sourceDate: x.date,
      }));

      const headline =
        eightKs90.length >= 3
          ? `Elevated event activity: ${eightKs90.length} 8-Ks in the last 90 days.`
          : `${within90.length} filings in the last 90 days (last: ${last.form} on ${last.date}).`;

      const detail: DetailSection[] = [
        {
          kind: "table",
          title: "Recent filings",
          columns: [{ label: "Form" }, { label: "Description" }, { label: "Date", align: "right" }],
          rows: rows.slice(0, 20).map((x) => ({
            cells: [x.form, x.desc || "—", x.date],
            href: link(x),
            hrefLabel: "Open ↗",
          })),
          note: "8-K = material event (M&A, guidance, leadership). A cluster is a short-term catalyst flag.",
        },
      ];

      return result(meta, {
        status: "ok",
        headline,
        metrics,
        evidence,
        detail,
        tookMs: Date.now() - start,
      });
    } catch (e) {
      return result(meta, { ...classifyFailure(e), tookMs: Date.now() - start });
    }
  },
};
