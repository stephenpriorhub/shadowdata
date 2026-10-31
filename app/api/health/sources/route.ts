import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireHubUser } from "@/lib/hub-auth";
import { CONNECTORS } from "@/lib/connectors";
import { getAllHealth, summarize } from "@/lib/source-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health/sources → per-source health from real recent runs (lookups + the daily scan):
 * working | degraded | failing | no-recent-runs, with last success/failure times and the last
 * client-safe error. Separate from /api/health (Railway's cheap liveness check). Signed-in hub
 * users, or `x-hub-token` for monitoring.
 */
export async function GET(req: NextRequest) {
  const gate = await requireHubUser(req);
  if ("response" in gate) return gate.response;

  const all = getAllHealth();
  const sources = CONNECTORS.filter((c) => c.enabled).map((c) => ({
    id: c.id,
    label: c.label,
    source: c.source,
    ...summarize(all[c.id]),
  }));
  const count = (s: string) => sources.filter((x) => x.state === s).length;
  return NextResponse.json({
    at: new Date().toISOString(),
    summary: { working: count("working"), degraded: count("degraded"), failing: count("failing"), noRecentRuns: count("no-recent-runs") },
    sources,
  });
}
