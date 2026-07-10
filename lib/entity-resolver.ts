/**
 * Ticker → entity resolution. The hard part of alt-data: one ticker must fan out
 * to a company name, domain, GitHub org, App Store IDs, subreddits, careers-board
 * slug, patent assignee, etc. Strategy:
 *   1. SEC EDGAR company_tickers.json  → authoritative CIK + company name (free).
 *   2. Polygon /v3/reference/tickers   → sector, market cap, homepage (if key set).
 *   3. Claude (cheap model)            → the fuzzy identifiers, as structured JSON.
 * The result is cached per-ticker (lib/store) so LLM enrichment is paid once.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getJson } from "./connectors/http";
import { RESOLVE_MODEL } from "./models";
import { getCachedEntity, saveEntity } from "./store";
import type { EntityIdentifiers, ResolvedEntity } from "./connectors/types";

// ── SEC ticker map (cached in-process; small file, refreshed per cold start) ──
let secMap: Record<string, { cik: string; title: string }> | null = null;

async function loadSecMap(): Promise<Record<string, { cik: string; title: string }>> {
  if (secMap) return secMap;
  const raw = await getJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
    "https://www.sec.gov/files/company_tickers.json",
    { timeoutMs: 15_000 }
  );
  const map: Record<string, { cik: string; title: string }> = {};
  for (const v of Object.values(raw)) {
    map[v.ticker.toUpperCase()] = { cik: String(v.cik_str), title: v.title };
  }
  secMap = map;
  return map;
}

interface PolygonTicker {
  name?: string;
  market_cap?: number;
  sic_description?: string;
  homepage_url?: string;
  description?: string;
}

async function polygonLookup(ticker: string): Promise<PolygonTicker | null> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return null;
  try {
    const data = await getJson<{ results?: PolygonTicker }>(
      `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(ticker)}?apiKey=${key}`,
      { timeoutMs: 10_000 }
    );
    return data.results ?? null;
  } catch {
    return null;
  }
}

const IDENTIFIER_TOOL = {
  name: "map_company_identifiers",
  description:
    "Return the online identifiers for a public company so alternative-data sources can be queried. Only include an identifier when you are confident it is correct; OMIT any field you are unsure about rather than guessing. Wrong identifiers produce misleading signals.",
  input_schema: {
    type: "object" as const,
    properties: {
      domain: { type: "string", description: "Primary corporate domain, e.g. apple.com" },
      githubOrg: {
        type: "string",
        description: "GitHub organization/user handle if the company publishes meaningful open source. Omit for non-software companies.",
      },
      iosAppIds: {
        type: "array",
        items: { type: "string" },
        description: "Numeric Apple App Store track IDs for the company's flagship consumer apps (digits only, from the apps.apple.com/app/id<NUMBER> URL). Omit if none.",
      },
      androidPackages: {
        type: "array",
        items: { type: "string" },
        description: "Android package names, e.g. com.company.app. Omit if none.",
      },
      subreddits: {
        type: "array",
        items: { type: "string" },
        description: "Relevant subreddit names WITHOUT the r/ prefix.",
      },
      greenhouseSlug: {
        type: "string",
        description: "The company's Greenhouse job-board slug (boards.greenhouse.io/<slug>) if it uses Greenhouse. Omit if unknown.",
      },
      leverSlug: {
        type: "string",
        description: "The company's Lever job-board slug (jobs.lever.co/<slug>) if it uses Lever. Omit if unknown.",
      },
      importYetiSlug: {
        type: "string",
        description: "The company's ImportYeti slug from importyeti.com/company/<slug> (usually the kebab-cased legal name, e.g. 'apple-inc'). Omit if unsure; a fallback is derived from the company name.",
      },
      patentAssignees: {
        type: "array",
        items: { type: "string" },
        description: "Legal entity names patents are assigned to, e.g. 'Apple Inc.'. Include common variants.",
      },
      wikipediaTitle: {
        type: "string",
        description: "Exact English Wikipedia article title for the company, e.g. 'Apple Inc.'",
      },
      brandTerms: {
        type: "array",
        items: { type: "string" },
        description: "1-3 search phrases that best identify the company in news/forums (usually the common brand name).",
      },
    },
    required: [],
  },
};

async function enrichIdentifiers(
  base: Pick<ResolvedEntity, "ticker" | "companyName" | "sector" | "description" | "homepageUrl">
): Promise<{ identifiers: EntityIdentifiers; llm: boolean }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const fallback: EntityIdentifiers = {
    brandTerms: [base.companyName.replace(/\b(inc|corp|corporation|ltd|plc|co|holdings|group)\b\.?/gi, "").trim()],
    wikipediaTitle: base.companyName,
  };
  if (!apiKey) return { identifiers: fallback, llm: false };

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: RESOLVE_MODEL,
      max_tokens: 1024,
      tool_choice: { type: "tool", name: IDENTIFIER_TOOL.name },
      tools: [IDENTIFIER_TOOL],
      messages: [
        {
          role: "user",
          content:
            `Company: ${base.companyName} (ticker ${base.ticker}).\n` +
            (base.sector ? `Sector: ${base.sector}.\n` : "") +
            (base.homepageUrl ? `Website: ${base.homepageUrl}.\n` : "") +
            (base.description ? `About: ${base.description.slice(0, 600)}\n` : "") +
            `\nMap this company's online identifiers using the tool. Confidence over completeness.`,
        },
      ],
    });
    const toolUse = msg.content.find((b) => b.type === "tool_use");
    const input = (toolUse && "input" in toolUse ? toolUse.input : {}) as EntityIdentifiers;
    // Merge over fallback so we always have brandTerms/wikipediaTitle to work with.
    const identifiers: EntityIdentifiers = {
      ...fallback,
      ...input,
      brandTerms: input.brandTerms?.length ? input.brandTerms : fallback.brandTerms,
      wikipediaTitle: input.wikipediaTitle || fallback.wikipediaTitle,
    };
    return { identifiers, llm: true };
  } catch {
    return { identifiers: fallback, llm: false };
  }
}

export interface ResolveOptions {
  force?: boolean; // bypass cache and re-resolve
}

export async function resolveEntity(ticker: string, opts: ResolveOptions = {}): Promise<ResolvedEntity> {
  const t = ticker.trim().toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(t)) {
    throw new Error(`Invalid ticker: "${ticker}"`);
  }
  if (!opts.force) {
    const cached = getCachedEntity(t);
    if (cached) return cached;
  }

  const [sec, poly] = await Promise.all([
    loadSecMap().catch(() => ({}) as Record<string, { cik: string; title: string }>),
    polygonLookup(t),
  ]);

  const secHit = sec[t];
  const companyName = poly?.name || secHit?.title;
  if (!companyName) {
    throw new Error(`Ticker "${t}" not found in SEC or Polygon. Check the symbol.`);
  }

  const base = {
    ticker: t,
    companyName,
    sector: poly?.sic_description,
    description: poly?.description,
    homepageUrl: poly?.homepage_url,
  };
  const { identifiers, llm } = await enrichIdentifiers(base);
  if (base.homepageUrl && !identifiers.domain) {
    try {
      identifiers.domain = new URL(base.homepageUrl).hostname.replace(/^www\./, "");
    } catch {
      /* ignore */
    }
  }

  const entity: ResolvedEntity = {
    ...base,
    cik: secHit?.cik,
    marketCap: poly?.market_cap,
    identifiers,
    resolvedAt: new Date().toISOString(),
    source: { edgar: !!secHit, polygon: !!poly, llm },
  };
  saveEntity(entity);
  return entity;
}
