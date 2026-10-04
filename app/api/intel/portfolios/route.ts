import type { NextRequest } from "next/server";
import { requireIntelAdmin, handle, jsonBody } from "@/lib/intel-auth";
import { savePortfolio } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { name, tickers: string[] | "NVDA, AMD" } */
export async function POST(req: NextRequest) {
  const gate = await requireIntelAdmin(req);
  if ("response" in gate) return gate.response;
  const b = await jsonBody(req);
  return handle(() => ({ portfolio: savePortfolio(null, b) }), 201);
}
