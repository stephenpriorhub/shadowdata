import { redact } from "@/lib/connectors/http";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAllWatchedTickers } from "@/lib/watchlist";
import { resolveEntity } from "@/lib/entity-resolver";
import { runConnectors } from "@/lib/connectors";
import { appendSnapshot } from "@/lib/store";
import { secretMatchesAny } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled scan of every watchlisted ticker → appends a fresh snapshot each, so hiring/
 * headcount/trend histories accrue automatically over time. Fired daily by instrumentation.ts.
 * Auth: `x-hub-token` header must equal HUB_API_TOKEN or CRON_SECRET (constant-time). The token
 * is never accepted in the URL (URLs land in proxy/access logs). POST only, so a pasted or
 * prefetched link can't trigger a scan. One scan at a time: a second call while one is running
 * gets 409 instead of doubling the metered API spend. Runs sequentially to be gentle on APIs.
 */
let running = false;

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-hub-token");
  if (!secretMatchesAny(token, [process.env.HUB_API_TOKEN, process.env.CRON_SECRET])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (running) {
    return NextResponse.json({ error: "A scan is already running" }, { status: 409 });
  }
  running = true;
  try {
    return await scan();
  } finally {
    running = false;
  }
}

async function scan() {
  const tickers = getAllWatchedTickers();
  const results: { ticker: string; ok: number; total: number; error?: string }[] = [];
  for (const t of tickers) {
    try {
      const entity = await resolveEntity(t);
      const signals = await runConnectors(entity);
      appendSnapshot(t, signals);
      results.push({ ticker: t, ok: signals.filter((s) => s.status === "ok").length, total: signals.length });
    } catch (e) {
      results.push({ ticker: t, ok: 0, total: 0, error: e instanceof Error ? redact(e.message) : redact(String(e)) });
    }
  }
  return NextResponse.json({ scanned: tickers.length, at: new Date().toISOString(), results });
}
