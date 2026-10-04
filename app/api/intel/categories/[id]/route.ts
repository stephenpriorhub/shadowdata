import type { NextRequest } from "next/server";
import { requireIntelAdmin, handle, jsonBody } from "@/lib/intel-auth";
import { updateCategory, deleteCategory } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { name?, color? } */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireIntelAdmin(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  const b = await jsonBody(req);
  return handle(() => ({ category: updateCategory(id, b) }));
}

/** DELETE ?mergeInto=<categoryId> moves its posts into another category first. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const gate = await requireIntelAdmin(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  return handle(() => deleteCategory(id, req.nextUrl.searchParams.get("mergeInto")));
}
