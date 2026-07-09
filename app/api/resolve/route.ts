import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireHubUser } from "@/lib/hub-auth";
import { resolveEntity } from "@/lib/entity-resolver";
import { overrideIdentifiers } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/resolve?ticker=NVDA[&force=1] → resolved entity (cached per ticker). */
export async function GET(req: NextRequest) {
  const gate = await requireHubUser(req);
  if ("response" in gate) return gate.response;

  const ticker = req.nextUrl.searchParams.get("ticker");
  if (!ticker) return NextResponse.json({ error: "Missing ?ticker=" }, { status: 400 });
  const force = req.nextUrl.searchParams.get("force") === "1";
  try {
    const entity = await resolveEntity(ticker, { force });
    return NextResponse.json({ entity });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Resolution failed" },
      { status: 404 }
    );
  }
}

/** POST /api/resolve — apply manual identifier overrides from the UI. */
export async function POST(req: NextRequest) {
  const gate = await requireHubUser(req);
  if ("response" in gate) return gate.response;

  const body = (await req.json().catch(() => ({}))) as {
    ticker?: string;
    identifiers?: Record<string, unknown>;
  };
  if (!body.ticker || !body.identifiers) {
    return NextResponse.json({ error: "Provide { ticker, identifiers }" }, { status: 400 });
  }
  const updated = overrideIdentifiers(body.ticker, body.identifiers);
  if (!updated) {
    return NextResponse.json({ error: "Resolve the ticker first." }, { status: 404 });
  }
  return NextResponse.json({ entity: updated });
}
