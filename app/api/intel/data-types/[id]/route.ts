import type { NextRequest } from "next/server";
import { requireIntelAdmin, handle, jsonBody } from "@/lib/intel-auth";
import { updateTerm, deleteTerm } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { name?, color? } — admins only. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireIntelAdmin(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  const b = await jsonBody(req);
  return handle(() => ({ dataType: updateTerm("dataTypes", id, b) }));
}

/** DELETE ?mergeInto=<id> moves its posts onto another one first. Admins only. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const gate = await requireIntelAdmin(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  return handle(() => deleteTerm("dataTypes", id, req.nextUrl.searchParams.get("mergeInto")));
}
