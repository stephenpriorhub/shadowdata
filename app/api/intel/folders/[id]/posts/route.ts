import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireUser, handle, jsonBody } from "@/lib/intel-auth";
import { setSaved } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST { postId, saved: boolean } — add a post to / remove it from this folder. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const gate = await requireUser(req);
  if ("response" in gate) return gate.response;
  const { id } = await params;
  const b = await jsonBody(req);
  if (typeof b.postId !== "string") return NextResponse.json({ error: "Missing postId" }, { status: 400 });
  return handle(() => ({ folder: setSaved(gate.actor.id, id, b.postId as string, b.saved !== false) }));
}
