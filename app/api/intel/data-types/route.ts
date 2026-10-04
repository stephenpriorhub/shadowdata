import type { NextRequest } from "next/server";
import { requireAuthor, handle, jsonBody } from "@/lib/intel-auth";
import { createTerm } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { name, color? } — admins or GrokBot may add new ones; only admins rename/merge/delete. */
export async function POST(req: NextRequest) {
  const gate = await requireAuthor(req);
  if ("response" in gate) return gate.response;
  const b = await jsonBody(req);
  return handle(() => ({ dataType: createTerm("dataTypes", b.name, b.color) }), 201);
}
