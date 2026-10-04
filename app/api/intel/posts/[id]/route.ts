import type { NextRequest } from "next/server";
import { requireReader, requireAuthor, requireIntelAdmin, handle, jsonBody, isIntelAdmin } from "@/lib/intel-auth";
import { getPost, updatePost, deletePost, IntelError } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const gate = await requireReader(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  const admin = gate.actor.kind === "user" && isIntelAdmin(gate.actor.user.role);
  return handle(() => {
    const p = getPost(id);
    if (!p || (p.hidden && !admin)) throw new IntelError("Post not found.", 404);
    return { post: p };
  });
}

/** Edit a post — admins, or GrokBot correcting its own output. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireAuthor(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  const body = await jsonBody(req);
  return handle(() => ({ post: updatePost(id, body) }));
}

/** Delete a post — admins only. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const gate = await requireIntelAdmin(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  return handle(() => deletePost(id));
}
