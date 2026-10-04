import type { NextRequest } from "next/server";
import { requireUser, handle, jsonBody } from "@/lib/intel-auth";
import { folderPosts, renameFolder, deleteFolder } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET → the posts saved in this folder (caller's own folders only). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const gate = await requireUser(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  return handle(() => ({ posts: folderPosts(gate.actor.id, id) }));
}

/** PATCH { name } */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireUser(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  const b = await jsonBody(req);
  return handle(() => ({ folder: renameFolder(gate.actor.id, id, b.name) }));
}

/** DELETE — removes the folder only; the posts stay in the feed. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const gate = await requireUser(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  return handle(() => deleteFolder(gate.actor.id, id));
}
