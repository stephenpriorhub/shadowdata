import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireHubUser } from "@/lib/hub-auth";
import { resolveEntity } from "@/lib/entity-resolver";
import { runConnectors, lockedConnectorsInfo, eligibleConnectors } from "@/lib/connectors";
import { appendSnapshot } from "@/lib/store";
import type { SignalResult } from "@/lib/connectors/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/signals { ticker }
 * Streams Server-Sent Events as each connector settles, so the UI fills cards in
 * as sources land (they have very different latencies). Events (each a `data:`
 * JSON line with a `type`):
 *   entity  → the resolved entity
 *   locked  → the disabled/"coming soon" connectors
 *   pending → ids of connectors that will run
 *   signal  → one SignalResult
 *   done    → { count }
 *   error   → { message }
 */
export async function POST(req: NextRequest) {
  const gate = await requireHubUser(req);
  if ("response" in gate) return gate.response;

  const body = (await req.json().catch(() => ({}))) as { ticker?: string };
  if (!body.ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...(data as object) })}\n\n`));
      };
      try {
        const entity = await resolveEntity(body.ticker!);
        send("entity", { entity });
        send("locked", { locked: lockedConnectorsInfo() });
        send("pending", {
          ids: eligibleConnectors(entity).map((c) => ({ id: c.id, label: c.label, category: c.category })),
        });

        const collected: SignalResult[] = [];
        await runConnectors(entity, (r) => {
          collected.push(r);
          send("signal", { signal: r });
        });

        // Persist a snapshot (app-side only; NO brain writes in v1).
        try {
          appendSnapshot(entity.ticker, collected);
        } catch {
          /* snapshot persistence is best-effort */
        }
        send("done", { count: collected.length });
      } catch (e) {
        send("error", { message: e instanceof Error ? e.message : "Signal fetch failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
