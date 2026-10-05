import type { NextRequest } from "next/server";
import { requireIntelAdmin, handle } from "@/lib/intel-auth";
import { moveAllTerms } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — move EVERY tag of this taxonomy to the other one. Admins only. */
export async function POST(req: NextRequest) {
  const gate = await requireIntelAdmin(req);
  if ("response" in gate) return gate.response;
  return handle(() => moveAllTerms("categories"));
}
