import { redact } from "@/lib/connectors/http";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireHubUser } from "@/lib/hub-auth";
import { getDailySynthesis, normalizeTicker, SynthesisUnavailable } from "@/lib/synthesis-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/synthesize { ticker } → structured thesis (short vs long term, bull/bear,
 * confidence, cited evidence). Built server-side from the ticker's latest snapshot and
 * cached per ticker per day (lib/synthesis-cache.ts). Any `signals` in the body are ignored.
 */
export async function POST(req: NextRequest) {
  const gate = await requireHubUser(req);
  if ("response" in gate) return gate.response;

  const body = (await req.json().catch(() => ({}))) as { ticker?: unknown };
  const ticker = normalizeTicker(body.ticker);
  if (!ticker) return NextResponse.json({ error: "Provide { ticker }" }, { status: 400 });
  try {
    return NextResponse.json(await getDailySynthesis(ticker));
  } catch (e) {
    if (e instanceof SynthesisUnavailable) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json(
      { error: e instanceof Error ? redact(e.message) : "Synthesis failed" },
      { status: 500 }
    );
  }
}
