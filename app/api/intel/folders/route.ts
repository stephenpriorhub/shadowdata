import type { NextRequest } from "next/server";
import { requireUser, handle, jsonBody } from "@/lib/intel-auth";
import { listFolders, createFolder } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → the caller's saved folders. */
export async function GET(req: NextRequest) {
  const gate = await requireUser(req);
  if ("response" in gate) return gate.response;
  return handle(() => ({ folders: listFolders(gate.actor.id) }));
}

/** POST { name } */
export async function POST(req: NextRequest) {
  const gate = await requireUser(req);
  if ("response" in gate) return gate.response;
  const b = await jsonBody(req);
  return handle(() => ({ folder: createFolder(gate.actor.id, b.name) }), 201);
}
