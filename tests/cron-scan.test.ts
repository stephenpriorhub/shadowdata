import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Stub the scan's dependencies so no external API is called.
const scanned: string[] = [];
let release: (() => void) | null = null;
vi.mock("@/lib/watchlist", () => ({ getAllWatchedTickers: () => ["AAA"] }));
vi.mock("@/lib/entity-resolver", () => ({ resolveEntity: async (t: string) => ({ ticker: t }) }));
vi.mock("@/lib/connectors", () => ({
  runConnectors: async (e: { ticker: string }) => {
    scanned.push(e.ticker);
    if (release === null) return [];
    await new Promise<void>((r) => (release = r));
    return [];
  },
}));
vi.mock("@/lib/store", () => ({ appendSnapshot: () => {} }));

const { POST } = await import("@/app/api/cron/scan/route");
const routeModule = await import("@/app/api/cron/scan/route");

const URL_BASE = "https://shadowdata.oxfordhub.app/api/cron/scan";
const post = (headers: Record<string, string> = {}, url = URL_BASE) =>
  POST(new NextRequest(url, { method: "POST", headers }));

describe("POST /api/cron/scan", () => {
  beforeEach(() => {
    scanned.length = 0;
    release = null;
    vi.stubEnv("HUB_API_TOKEN", "hub-token");
    vi.stubEnv("CRON_SECRET", "cron-secret");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a missing or wrong token without scanning", async () => {
    expect((await post()).status).toBe(401);
    expect((await post({ "x-hub-token": "nope" })).status).toBe(401);
    expect(scanned).toEqual([]);
  });

  it("no longer accepts the token in the query string", async () => {
    expect((await post({}, `${URL_BASE}?token=hub-token`)).status).toBe(401);
    expect(scanned).toEqual([]);
  });

  it("accepts HUB_API_TOKEN or CRON_SECRET in the header", async () => {
    const res = await post({ "x-hub-token": "hub-token" });
    expect(res.status).toBe(200);
    expect((await res.json()).scanned).toBe(1);
    expect((await post({ "x-hub-token": "cron-secret" })).status).toBe(200);
  });

  it("rejects everything when no secret is configured", async () => {
    vi.stubEnv("HUB_API_TOKEN", "");
    vi.stubEnv("CRON_SECRET", "");
    expect((await post({ "x-hub-token": "" })).status).toBe(401);
  });

  it("has no GET handler (a pasted link can't start a scan)", () => {
    expect("GET" in routeModule).toBe(false);
  });

  it("refuses a second scan while one is running, then allows the next", async () => {
    release = () => {}; // make the scan wait until released
    const first = post({ "x-hub-token": "hub-token" });
    await vi.waitFor(() => expect(scanned.length).toBe(1));
    expect((await post({ "x-hub-token": "hub-token" })).status).toBe(409);
    release!();
    expect((await first).status).toBe(200);
    release = null;
    expect((await post({ "x-hub-token": "hub-token" })).status).toBe(200);
  });
});
