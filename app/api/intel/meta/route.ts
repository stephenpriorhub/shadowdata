import type { NextRequest } from "next/server";
import { requireReader, handle, isIntelAdmin } from "@/lib/intel-auth";
import { getMeta } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/intel/meta → categories, tickers, portfolios (+ whether the caller is an admin). */
export async function GET(req: NextRequest) {
  const gate = await requireReader(req);
  if ("response" in gate) return gate.response;
  const isAdmin = gate.actor.kind === "user" && isIntelAdmin(gate.actor.user.role);
  return handle(() => ({ ...getMeta(), isAdmin }));
}
