/**
 * The "smart" layer. Takes the normalized alt-data signals and asks Claude to
 * reason about how each maps to an investment thesis — split by short-term vs
 * long-term horizon, tagged bull/bear/neutral, with confidence and the specific
 * evidence each read rests on. Every claim must trace to a supplied signal
 * (defensibility standard). No price targets, no buy/sell calls.
 */
import Anthropic from "@anthropic-ai/sdk";
import { SYNTH_MODEL } from "./models";
import type { Direction, Horizon, ResolvedEntity, SignalResult } from "./connectors/types";

export interface ThesisCard {
  signal: string; // connector label this rests on
  category: string;
  direction: Direction;
  horizon: Horizon;
  confidence: "high" | "medium" | "low";
  implication: string; // what it implies for the business/investment
  evidence: string[]; // short evidence refs pulled from the signal
}

export interface Synthesis {
  summary: string;
  bullCase: string[];
  bearCase: string[];
  cards: ThesisCard[];
  strongestSupport?: string;
  strongestContradiction?: string;
  dataGaps: string[]; // signals that were not-applicable / no-data and would strengthen the read
  disclaimer: string;
}

const DISCLAIMER =
  "Alternative-data signals are circumstantial and lagging/leading in unpredictable ways. This is decision-support context, not investment advice, and contains no price targets or buy/sell recommendations. Verify against fundamentals and primary sources.";

const SYNTH_TOOL = {
  name: "emit_thesis",
  description:
    "Emit the structured alternative-data thesis. Every card MUST rest on one of the provided signals — never invent data. Prefer fewer, well-supported cards over many weak ones.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description: "2-4 sentence synthesis of what the alt-data collectively suggests, balancing bull and bear.",
      },
      bullCase: { type: "array", items: { type: "string" }, description: "Bullet points supporting a long/positive view, each grounded in a signal." },
      bearCase: { type: "array", items: { type: "string" }, description: "Bullet points supporting a bearish/cautionary view, each grounded in a signal." },
      cards: {
        type: "array",
        description: "One card per meaningful signal-to-thesis mapping.",
        items: {
          type: "object",
          properties: {
            signal: { type: "string", description: "The signal label this card rests on (must match a provided signal)." },
            category: { type: "string" },
            direction: { type: "string", enum: ["bull", "bear", "neutral"] },
            horizon: { type: "string", enum: ["short-term", "long-term"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            implication: { type: "string", description: "What this signal implies for the business and why it matters to an investor." },
            evidence: { type: "array", items: { type: "string" }, description: "Specific numbers/facts from the signal that justify the read." },
          },
          required: ["signal", "category", "direction", "horizon", "confidence", "implication", "evidence"],
        },
      },
      strongestSupport: { type: "string", description: "The single strongest supporting signal and why." },
      strongestContradiction: { type: "string", description: "The single strongest contradicting/cautionary signal and why." },
      dataGaps: {
        type: "array",
        items: { type: "string" },
        description: "Missing signals (not-applicable/no-data) that, if available, would most strengthen the analysis.",
      },
    },
    required: ["summary", "bullCase", "bearCase", "cards", "dataGaps"],
  },
};

/** Compact the signals into a token-lean brief for the model. */
function brief(entity: ResolvedEntity, signals: SignalResult[]): string {
  const lines: string[] = [
    `Company: ${entity.companyName} (${entity.ticker})`,
    entity.sector ? `Sector: ${entity.sector}` : "",
    entity.marketCap ? `Market cap: ~$${(entity.marketCap / 1e9).toFixed(1)}B` : "",
    "",
    "SIGNALS:",
  ].filter(Boolean);

  for (const s of signals) {
    if (s.status === "ok") {
      lines.push(`- [${s.label}] ${s.headline ?? ""}`);
      for (const m of s.metrics) {
        const chg = m.changePct !== undefined ? ` (${m.changePct >= 0 ? "+" : ""}${m.changePct.toFixed(0)}%)` : "";
        lines.push(`    · ${m.name}: ${m.value}${m.unit ? ` ${m.unit}` : ""}${chg}`);
      }
      for (const e of s.evidence.slice(0, 3)) lines.push(`    · evidence: ${e.summary}`);
    } else {
      lines.push(`- [${s.label}] (${s.status}${s.note ? `: ${s.note}` : ""})`);
    }
  }
  return lines.join("\n");
}

export async function synthesize(
  entity: ResolvedEntity,
  signals: SignalResult[]
): Promise<Synthesis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const withData = signals.filter((s) => s.status === "ok");
  const gaps = signals
    .filter((s) => s.status === "no-data" || s.status === "not-applicable")
    .map((s) => s.label);

  if (!apiKey || withData.length === 0) {
    return {
      summary:
        withData.length === 0
          ? "No alternative-data signals were available for this company, so no thesis could be formed. Try a company with more public digital footprint, or enable premium connectors."
          : "Synthesis is unavailable (ANTHROPIC_API_KEY not set).",
      bullCase: [],
      bearCase: [],
      cards: [],
      dataGaps: gaps,
      disclaimer: DISCLAIMER,
    };
  }

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: SYNTH_MODEL,
    max_tokens: 4096,
    system:
      "You are an alternative-data analyst for a financial publisher. You translate non-financial-statement signals (hiring, open-source, app, web, patent, filing, forum data) into an investment thesis. You are rigorous and defensible: every claim rests on a provided signal, you separate short-term catalysts from long-term structural trends, and you flag when a signal is weak or ambiguous. You never give price targets or buy/sell advice.",
    tool_choice: { type: "tool", name: SYNTH_TOOL.name },
    tools: [SYNTH_TOOL],
    messages: [{ role: "user", content: brief(entity, signals) }],
  });

  const toolUse = msg.content.find((b) => b.type === "tool_use");
  const out = (toolUse && "input" in toolUse ? (toolUse.input as Record<string, unknown>) : {}) ?? {};
  return normalizeSynthesis(out, gaps);
}

/** Coerce the model's output into the exact shape the UI expects (defensive: models
 *  occasionally return a string where an array is declared, which crashed .map/.filter). */
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : String(x ?? ""))).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function normalizeSynthesis(out: Record<string, unknown>, gaps: string[]): Synthesis {
  const rawCards = Array.isArray(out.cards) ? (out.cards as Record<string, unknown>[]) : [];
  const cards: ThesisCard[] = rawCards.map((c) => ({
    signal: typeof c.signal === "string" ? c.signal : "",
    category: typeof c.category === "string" ? c.category : "",
    direction: c.direction === "bull" || c.direction === "bear" ? c.direction : "neutral",
    horizon: c.horizon === "short-term" ? "short-term" : "long-term",
    confidence: c.confidence === "high" || c.confidence === "low" ? c.confidence : "medium",
    implication: typeof c.implication === "string" ? c.implication : "",
    evidence: toStringArray(c.evidence),
  }));
  const gapsOut = toStringArray(out.dataGaps);
  return {
    summary: typeof out.summary === "string" ? out.summary : "",
    bullCase: toStringArray(out.bullCase),
    bearCase: toStringArray(out.bearCase),
    cards,
    strongestSupport: typeof out.strongestSupport === "string" ? out.strongestSupport : undefined,
    strongestContradiction: typeof out.strongestContradiction === "string" ? out.strongestContradiction : undefined,
    dataGaps: gapsOut.length ? gapsOut : gaps,
    disclaimer: DISCLAIMER,
  };
}
