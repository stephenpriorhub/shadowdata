/**
 * Supply chain / U.S. imports (ImportYeti official API). Thesis: bill-of-lading
 * shipment volume is a hard, hard-to-fake read on physical demand and production.
 * Rising import volume can lead reported revenue; a drop can flag a slowdown or
 * destocking. Supplier concentration is a supply-chain risk read.
 *
 * ImportYeti is credit-metered (1 credit per company lookup), so results are cached
 * for 30 days per company. Auth header is `IYApiKey`. Even without the API (no key,
 * or a miss) the card always links out to the company's ImportYeti page.
 */
import { getJson, classifyFailure } from "./http";
import { getCached, setCached } from "../store";
import { result, type Connector, type Evidence, type Metric, type Timeseries } from "./types";

const meta = {
  id: "importyeti",
  label: "Supply Chain / Imports",
  category: "supply",
  tier: "premium",
} as const;

const CACHE_NS = "importyeti";
const CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days — conserve metered credits

interface IYData {
  title?: string;
  total_shipments?: number;
  date_range?: { start_date?: string; end_date?: string };
  time_series?: Record<string, number>;
  suppliers_table?: { supplier_name?: string; supplier_address_country?: string }[];
  hs_codes?: { description?: string; shipments_12m?: number }[];
  carriers_per_country?: Record<string, unknown>;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Parse ImportYeti's DD/MM/YYYY month keys into sortable ISO. */
function toIso(key: string): string | null {
  const m = key.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function fetchProfile(slug: string, key: string, signal: AbortSignal): Promise<IYData | null> {
  const cached = getCached<IYData>(CACHE_NS, slug, CACHE_TTL);
  if (cached) return cached;
  const res = await getJson<{ data?: IYData }>(
    `https://data.importyeti.com/v1.0/company/${encodeURIComponent(slug)}`,
    { signal, headers: { IYApiKey: key }, timeoutMs: 15_000 }
  );
  const data = res.data ?? null;
  if (data) setCached(CACHE_NS, slug, data);
  return data;
}

export const importYetiConnector: Connector = {
  ...meta,
  enabled: true,
  description: "U.S. import bill-of-lading volume, trend, top suppliers and product mix from ImportYeti.",
  requiredIdentifiers: [],
  async fetch(entity, ctx) {
    const start = Date.now();
    const slug = entity.identifiers.importYetiSlug || slugify(entity.companyName);
    const link = { label: "Open ImportYeti profile", url: `https://www.importyeti.com/company/${slug}` };
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

      // Monthly shipment time series → last-12mo vs prior-12mo (YoY volume).
      let ts: Timeseries | undefined;
      let yoy: number | undefined;
      if (data.time_series) {
        const points = Object.entries(data.time_series)
          .map(([k, v]) => ({ iso: toIso(k), v }))
          .filter((p): p is { iso: string; v: number } => !!p.iso)
          .sort((a, b) => a.iso.localeCompare(b.iso));
        if (points.length) {
          ts = { name: "Monthly shipments", points: points.slice(-24).map((p) => ({ t: p.iso, v: p.v })) };
          const last12 = points.slice(-12).reduce((s, p) => s + p.v, 0);
          const prior12 = points.slice(-24, -12).reduce((s, p) => s + p.v, 0);
          if (prior12 > 0) yoy = ((last12 - prior12) / prior12) * 100;
        }
      }

      const topSupplier = data.suppliers_table?.[0];
      const topHs = (data.hs_codes ?? []).slice().sort((a, b) => (b.shipments_12m ?? 0) - (a.shipments_12m ?? 0))[0];
      const origins = Object.keys(data.carriers_per_country ?? {}).slice(0, 3);

      const metrics: Metric[] = [
        { name: "Total shipments", value: data.total_shipments },
        {
          name: "YoY volume",
          value: yoy === undefined ? "—" : `${yoy >= 0 ? "+" : ""}${yoy.toFixed(0)}%`,
          trend: yoy === undefined ? undefined : yoy > 5 ? "up" : yoy < -5 ? "down" : "flat",
        },
        { name: "Top supplier", value: topSupplier?.supplier_name ?? "—" },
        { name: "Top origins", value: origins.length ? origins.join(", ") : "—" },
      ];

      const evidence: Evidence[] = [];
      for (const s of (data.suppliers_table ?? []).slice(0, 4)) {
        evidence.push({ summary: `Supplier: ${s.supplier_name}${s.supplier_address_country ? ` (${s.supplier_address_country})` : ""}` });
      }
      if (topHs?.description) evidence.push({ summary: `Top product category: ${topHs.description}` });
      if (data.date_range?.start_date) {
        evidence.push({ summary: `Coverage: ${data.date_range.start_date} → ${data.date_range.end_date ?? "present"}` });
      }

      const headline =
        yoy === undefined
          ? `${data.total_shipments.toLocaleString()} U.S. import shipments on record; top supplier ${topSupplier?.supplier_name ?? "n/a"}.`
          : `Import volume ${yoy >= 0 ? "up" : "down"} ${Math.abs(yoy).toFixed(0)}% YoY (${data.total_shipments.toLocaleString()} shipments); top supplier ${topSupplier?.supplier_name ?? "n/a"}.`;

      return result(meta, {
        status: "ok",
        headline,
        metrics,
        timeseries: ts ? [ts] : undefined,
        evidence,
        primaryLink: link,
        tookMs: Date.now() - start,
      });
    } catch (e) {
      const f = classifyFailure(e);
      return result(meta, {
        ...f,
        note:
          f.status === "no-data"
            ? `No ImportYeti profile matched "${entity.companyName}". Link-out still available.`
            : f.note,
        primaryLink: link,
        tookMs: Date.now() - start,
      });
    }
  },
};
