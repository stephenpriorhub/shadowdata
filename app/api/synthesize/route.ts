import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireHubUser } from "@/lib/hub-auth";
import { resolveEntity } from "@/lib/entity-resolver";
import { synthesize } from "@/lib/synthesis";
import type { SignalResult } from "@/lib/connectors/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/synthesize { ticker, signals } → structured thesis (short vs long term,
 * bull/bear, confidence, cited evidence). One Claude call; JSON response.
 */
export async function POST(req: NextRequest) {
  const gate = await requireHubUser(req);
  if ("response" in gate) return gate.response;

  const body = (await req.json().catch(() => ({}))) as {
    ticker?: string;
    signals?: SignalResult[];
  };
  if (!body.ticker || !Array.isArray(body.signals)) {
    return NextResponse.json({ error: "Provide { ticker, signals }" }, { status: 400 });
  }
  try {
    const entity = await resolveEntity(body.ticker);
    const synthesis = await synthesize(entity, body.signals);
    return NextResponse.json({ synthesis });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Synthesis failed" },
      { status: 500 }
    );
  }
}
