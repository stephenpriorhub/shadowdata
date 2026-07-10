/**
 * Supply chain / U.S. imports (ImportYeti official API). Thesis: bill-of-lading
 * shipment volume is a hard, hard-to-fake read on physical demand and production.
 * Rising import volume can lead reported revenue; a drop can flag a slowdown or
 * destocking. Supplier concentration is a supply-chain risk read.
 *
 * Credit-metered (1 credit per company lookup) → cached 30 days per company.
 * Auth header is `IYApiKey`. Even without the API the card links out to ImportYeti.
 */
import { getJson, classifyFailure } from "./http";
import { getCached, setCached } from "../store";
import {
  result,
  type Connector,
  type DetailSection,
  type Evidence,
  type Metric,
  type Timeseries,
} from "./types";

const meta = {
  id: "importyeti",
  label: "Supply Chain / Imports",
  category: "supply",
  tier: "premium",
} as const;

const CACHE_NS = "importyeti";
const CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days — conserve metered credits
const IY = "https://www.importyeti.com";

interface Supplier {
  supplier_name?: string;
  supplier_address_country?: string;
  key?: string; // e.g. /supplier/hon-hai-precision-industrial
  total_shipments_company?: number;
  shipments_percents_company?: number;
  shipments_12m?: number;
}
interface HsCode {
  hs_code?: string;
  description?: string;
  shipments?: number;
  shipments_12m?: number;
}
interface Lane {
  exit_port_country?: string;
  entry_port?: string;
  shipments?: number;
}
interface Bol {
  date_formatted?: string;
  Product_Description?: string;
  Shipper_Name?: string;
  Country?: string;
  HS_Code?: string;
}
interface IYData {
  title?: string;
  total_shipments?: number;
  date_range?: { start_date?: string; end_date?: string };
  time_series?: Record<string, { shipments?: number }>;
  suppliers_table?: Supplier[];
  hs_codes?: HsCode[];
  lane_permutations?: Lane[];
  recent_bols?: Bol[];
  carriers_per_country?: Record<string, unknown>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function slugify(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[.,]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** ImportYeti month keys are DD/MM/YYYY. Returns {iso, monthIndex} or null. */
function parseKey(k: string): { iso: string; month: number } | null {
  const m = k.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return { iso: `${m[3]}-${m[2]}-${m[1]}`, month: parseInt(m[2], 10) - 1 };
}

async function fetchProfile(slug: string, key: string, signal: AbortSignal): Promise<IYData | null> {
  const cached = getCached<IYData>(CACHE_NS, slug, CACHE_TTL);
  if (cached) return cached;
  const res = await getJson<{ data?: IYData }>(`https://data.importyeti.com/v1.0/company/${encodeURIComponent(slug)}`, {
    signal,
    headers: { IYApiKey: key },
    timeoutMs: 15_000,
  });
  const data = res.data ?? null;
  if (data) setCached(CACHE_NS, slug, data);
  return data;
}

export const importYetiConnector: Connector = {
  ...meta,
  enabled: true,
  description: "U.S. import bill-of-lading volume, trend, top suppliers, product mix and trade lanes from ImportYeti.",
  requiredIdentifiers: [],
  async fetch(entity, ctx) {
    const start = Date.now();
    const slug = entity.identifiers.importYetiSlug || slugify(entity.companyName);
    const link = { label: "Open ImportYeti profile", url: `${IY}/company/${slug}` };
    const key = process.env.IMPORTYETI_API_KEY;

    if (!key) {
      return result(meta, {
        status: "no-data",
        note: "Set IMPORTYETI_API_KEY to load the import profile. Link-out still available.",
        primaryLink: link,
        tookMs: Date.now() - start,
      });
    }

    try {
      const data = await fetchProfile(slug, key, ctx.signal);
      if (!data || !data.total_shipments) {
        return result(meta, {
          status: "no-data",
          note: `No U.S. import records found for "${entity.companyName}" (they may import under a different consignee name).`,
          primaryLink: link,
          tookMs: Date.now() - start,
        });
      }

      // ── Monthly time series (values are objects: {shipments,...}) ──
      const series = Object.entries(data.time_series ?? {})
        .map(([k, v]) => ({ p: parseKey(k), v: v?.shipments ?? 0 }))
        .filter((x): x is { p: { iso: string; month: number }; v: number } => !!x.p)
        .sort((a, b) => a.p.iso.localeCompare(b.p.iso));

      let monthlyTs: Timeseries | undefined;
      let yoy: number | undefined;
      const byCalendarMonth = new Array(12).fill(0);
      if (series.length) {
        monthlyTs = { name: "Monthly shipments", points: series.map((s) => ({ t: s.p.iso, v: s.v })) };
        for (const s of series) byCalendarMonth[s.p.month] += s.v;
        const last12 = series.slice(-12).reduce((a, s) => a + s.v, 0);
        const prior12 = series.slice(-24, -12).reduce((a, s) => a + s.v, 0);
        if (prior12 > 0) yoy = ((last12 - prior12) / prior12) * 100;
      }

      const suppliers = (data.suppliers_table ?? []).slice(0, 12);
      const topSupplier = suppliers[0];
      const hs = (data.hs_codes ?? []).slice().sort((a, b) => (b.shipments ?? 0) - (a.shipments ?? 0));
      const lanes = (data.lane_permutations ?? []).slice().sort((a, b) => (b.shipments ?? 0) - (a.shipments ?? 0)).slice(0, 8);
      const bols = (data.recent_bols ?? []).slice(0, 12);

      const metrics: Metric[] = [
        { name: "Total shipments", value: data.total_shipments },
        {
          name: "YoY volume",
          value: yoy === undefined ? "—" : `${yoy >= 0 ? "+" : ""}${yoy.toFixed(0)}%`,
          trend: yoy === undefined ? undefined : yoy > 5 ? "up" : yoy < -5 ? "down" : "flat",
        },
        { name: "Top supplier", value: topSupplier?.supplier_name ?? "—" },
        {
          name: "Supplier concentration",
          value: topSupplier?.shipments_percents_company ? `${topSupplier.shipments_percents_company.toFixed(0)}% top` : "—",
        },
      ];

      // ── Rich detail sections ──
      const detail: DetailSection[] = [];
      if (monthlyTs) detail.push({ kind: "timeseries", title: "Monthly import shipments", series: monthlyTs, note: `${data.date_range?.start_date ?? ""} – ${data.date_range?.end_date ?? "present"}` });
      if (series.length)
        detail.push({
          kind: "monthly",
          title: "Import frequency by calendar month (all-time)",
          months: MONTHS.map((label, i) => ({ label, value: byCalendarMonth[i] })),
          note: "Which months this company imports most — seasonality of its supply chain.",
        });
      if (suppliers.length)
        detail.push({
          kind: "table",
          title: "Top suppliers",
          columns: [{ label: "Supplier" }, { label: "Country" }, { label: "Shipments", align: "right" }, { label: "% of imports", align: "right" }],
          rows: suppliers.map((s) => ({
            cells: [
              s.supplier_name ?? "—",
              s.supplier_address_country ?? "—",
              s.total_shipments_company ?? 0,
              s.shipments_percents_company ? `${s.shipments_percents_company.toFixed(1)}%` : "—",
            ],
            href: s.key ? `${IY}${s.key}` : undefined,
            hrefLabel: "Bills of lading ↗",
          })),
          note: "Supplier concentration is a supply-chain risk read; a shift in top suppliers can signal sourcing changes.",
        });
      if (hs.length)
        detail.push({
          kind: "bars",
          title: "Product mix (by HS code)",
          unit: "shipments",
          items: hs.slice(0, 8).map((h) => ({ label: `${h.hs_code} · ${h.description ?? ""}`, value: h.shipments ?? 0, sublabel: h.shipments_12m ? `${h.shipments_12m} in last 12m` : undefined })),
        });
      if (lanes.length)
        detail.push({
          kind: "bars",
          title: "Top trade lanes",
          unit: "shipments",
          items: lanes.map((l) => ({ label: `${l.exit_port_country ?? "?"} → ${l.entry_port ?? "?"}`, value: l.shipments ?? 0 })),
        });
      if (bols.length)
        detail.push({
          kind: "table",
          title: "Recent bills of lading",
          columns: [{ label: "Date" }, { label: "Product" }, { label: "Shipper" }, { label: "Origin" }],
          rows: bols.map((b) => ({
            cells: [b.date_formatted ?? "—", (b.Product_Description ?? "—").slice(0, 60), b.Shipper_Name ?? "—", b.Country ?? "—"],
          })),
        });
      detail.push({ kind: "links", title: "Source", links: [{ label: "Full ImportYeti company profile", url: link.url }] });

      const evidence: Evidence[] = suppliers.slice(0, 3).map((s) => ({
        summary: `Supplier: ${s.supplier_name}${s.supplier_address_country ? ` (${s.supplier_address_country})` : ""}${s.shipments_percents_company ? ` — ${s.shipments_percents_company.toFixed(0)}% of imports` : ""}`,
        url: s.key ? `${IY}${s.key}` : undefined,
      }));

      const headline =
        yoy === undefined
          ? `${data.total_shipments.toLocaleString()} U.S. import shipments; top supplier ${topSupplier?.supplier_name ?? "n/a"}.`
          : `Import volume ${yoy >= 0 ? "up" : "down"} ${Math.abs(yoy).toFixed(0)}% YoY (${data.total_shipments.toLocaleString()} shipments); top supplier ${topSupplier?.supplier_name ?? "n/a"}.`;

      return result(meta, {
        status: "ok",
        headline,
        metrics,
        timeseries: monthlyTs ? [monthlyTs] : undefined,
        evidence,
        detail,
        primaryLink: link,
        tookMs: Date.now() - start,
      });
    } catch (e) {
      const f = classifyFailure(e);
      return result(meta, {
        ...f,
        note: f.status === "no-data" ? `No ImportYeti profile matched "${entity.companyName}". Link-out still available.` : f.note,
        primaryLink: link,
        tookMs: Date.now() - start,
      });
    }
  },
};
