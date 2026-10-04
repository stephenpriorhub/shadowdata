import type { NextRequest } from "next/server";
import { requireIntelAdmin, handle, jsonBody } from "@/lib/intel-auth";
import { savePortfolio, deletePortfolio } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireIntelAdmin(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  const b = await jsonBody(req);
  return handle(() => ({ portfolio: savePortfolio(id, b) }));
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const gate = await requireIntelAdmin(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  return handle(() => deletePortfolio(id));
}
