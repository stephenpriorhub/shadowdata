import type { NextRequest } from "next/server";
import { requireAuthor, handle, jsonBody } from "@/lib/intel-auth";
import { upsertTicker } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { symbol, name? } — add a ticker or set its display name. Admins or GrokBot. */
export async function POST(req: NextRequest) {
  const gate = await requireAuthor(req);
  if ("response" in gate) return gate.response;
  const b = await jsonBody(req);
  return handle(() => ({ ticker: upsertTicker(b.symbol, b.name) }), 201);
}
