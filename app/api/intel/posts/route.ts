import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireReader, requireAuthor, actorName, handle, isIntelAdmin } from "@/lib/intel-auth";
import { createPosts, listPosts, normTicker, type PostInput } from "@/lib/intel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/intel/posts?ticker=NVDA,AMD&portfolio=<id>&category=<id>&dataType=<id>&q=&limit=&offset=&hidden=1
 * Newest first. `hidden=1` includes hidden posts (admins only).
 */
export async function GET(req: NextRequest) {
  const gate = await requireReader(req);
  if ("response" in gate) return gate.response;
  const sp = req.nextUrl.searchParams;
  const tickers = (sp.get("ticker") ?? "")
    .split(",")
    .map(normTicker)
    .filter((t): t is string => !!t);
  const canSeeHidden = gate.actor.kind === "user" && isIntelAdmin(gate.actor.user.role);
  return handle(() =>
    listPosts({
      tickers,
      portfolioId: sp.get("portfolio"),
      categoryId: sp.get("category"),
      dataTypeId: sp.get("dataType"),
      q: sp.get("q"),
      includeHidden: canSeeHidden && sp.get("hidden") === "1",
      limit: Number(sp.get("limit")) || undefined,
      offset: Number(sp.get("offset")) || undefined,
    })
  );
}

/**
 * POST /api/intel/posts — GrokBot (Bearer INTEL_FEED_API_KEY) or an admin.
 * Body: one post object, `{ posts: [...] }`, or a bare array (max 50 per call).
 * Duplicates (same externalId or sourceUrl) are skipped and reported, never re-created.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAuthor(req);
  if ("response" in gate) return gate.response;
  const body = (await req.json().catch(() => null)) as unknown;
  const list: unknown[] = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { posts?: unknown }).posts)
      ? (body as { posts: unknown[] }).posts
      : body && typeof body === "object"
        ? [body]
        : [];
  if (list.length === 0) return NextResponse.json({ error: "No posts in request body." }, { status: 400 });
  if (list.length > 50) return NextResponse.json({ error: "Max 50 posts per request." }, { status: 400 });
  const inputs = list.filter((x): x is PostInput => !!x && typeof x === "object");
  return handle(() => createPosts(inputs, actorName(gate.actor)), 201);
}
