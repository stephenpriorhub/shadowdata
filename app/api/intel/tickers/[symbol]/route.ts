import type { NextRequest } from "next/server";
import { requireIntelAdmin, handle, jsonBody } from "@/lib/intel-auth";
import { upsertTicker, renameTicker, deleteTicker, normTicker } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ symbol: string }> };

/** PATCH { name?, symbol? } — a new symbol renames it on every post/portfolio (merging if it exists). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireIntelAdmin(req);
  if ("response" in gate) return gate.response;
  const { symbol } = await params;
  const b = await jsonBody(req);
  return handle(() => {
    let current = decodeURIComponent(symbol).toUpperCase();
    if (b.symbol !== undefined && normTicker(b.symbol) !== current) {
      renameTicker(current, b.symbol);
      current = normTicker(b.symbol)!;
    }
    if (b.name !== undefined) upsertTicker(current, b.name);
    return { ok: true, symbol: current };
  });
}

/** DELETE — untags it from every post and portfolio. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const gate = await requireIntelAdmin(req);
  if ("response" in gate) return gate.response;
  const { symbol } = await params;
  return handle(() => deleteTicker(decodeURIComponent(symbol)));
}
