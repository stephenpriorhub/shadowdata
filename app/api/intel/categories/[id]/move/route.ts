import type { NextRequest } from "next/server";
import { requireIntelAdmin, handle } from "@/lib/intel-auth";
import { moveTerm } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST — move this tag (and its posts' tags) to the other taxonomy. Admins only. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const gate = await requireIntelAdmin(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  return handle(() => ({ moved: moveTerm("categories", id) }));
}
