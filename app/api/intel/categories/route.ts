import type { NextRequest } from "next/server";
import { requireIntelAdmin, handle, jsonBody } from "@/lib/intel-auth";
import { createTerm } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { name, color? } — admins only (categories are reserved; GrokBot uses data types). */
export async function POST(req: NextRequest) {
  const gate = await requireIntelAdmin(req);
  if ("response" in gate) return gate.response;
  const b = await jsonBody(req);
  return handle(() => ({ category: createTerm("categories", b.name, b.color) }), 201);
}
