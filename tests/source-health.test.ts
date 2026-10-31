import { beforeEach, describe, expect, it, vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-health-"));
vi.stubEnv("DATA_DIR", dir);

const { recordOutcome, summarize, _resetHealthForTests } = await import("@/lib/source-health");
const { CONNECTORS, runConnectors } = await import("@/lib/connectors");
const { GET } = await import("@/app/api/health/sources/route");
import type { Connector, ResolvedEntity, SignalResult } from "@/lib/connectors/types";

const NOW = new Date("2026-10-31T12:00:00Z").getTime();
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const o = (status: "ok" | "no-data" | "error", minAgo = 10) => ({ at: at(minAgo), status, ticker: "X" });

beforeEach(() => _resetHealthForTests());

describe("summarize", () => {
  it("working when recent runs succeeded (no-data counts as the source answering)", () => {
    expect(summarize([o("ok", 30), o("no-data", 20), o("ok")], NOW).state).toBe("working");
  });
  it("failing when the last 3 runs all errored", () => {
    const h = summarize([o("ok", 90), o("error", 30), o("error", 20), { ...o("error"), error: "Reddit: HTTP 403 (auth)" }], NOW);
    expect(h.state).toBe("failing");
    expect(h.lastError).toBe("Reddit: HTTP 403 (auth)");
    expect(h.lastOkAt).toBe(at(90));
  });
  it("degraded when errors are mixed in recently", () => {
    expect(summarize([o("ok", 30), o("error", 20), o("ok")], NOW).state).toBe("degraded");
  });
  it("no-recent-runs when nothing ran in the last day, or never", () => {
    expect(summarize([o("ok", 60 * 27)], NOW).state).toBe("no-recent-runs");
    expect(summarize(undefined, NOW).state).toBe("no-recent-runs");
  });
});

describe("runConnectors", () => {
  const entity = { ticker: "TEST", companyName: "Test", identifiers: {} } as unknown as ResolvedEntity;
  const fake = (id: string, impl: () => Promise<SignalResult>): Connector => ({
    id, label: id, category: "web", tier: "free", enabled: true, description: "", requiredIdentifiers: [],
    source: { label: `${id} source`, url: `https://example.com/${id}` }, fetch: impl,
  });

  it("stamps as-of and source on every result, records outcomes, and persists them", async () => {
    const saved = CONNECTORS.splice(0, CONNECTORS.length,
      fake("good", async () => ({ connectorId: "good", label: "good", category: "web", tier: "free", status: "ok", metrics: [], evidence: [], fetchedAt: new Date().toISOString(), asOf: "2026-10-30" })),
      fake("boom", async () => { throw new Error("socket hang up"); }),
      fake("na", async () => ({ connectorId: "na", label: "na", category: "web", tier: "free", status: "not-applicable", metrics: [], evidence: [], fetchedAt: new Date().toISOString() })),
    );
    try {
      const results = await runConnectors(entity);
      const by = Object.fromEntries(results.map((r) => [r.connectorId, r]));
      expect(by.good.asOf).toBe("2026-10-30"); // connector's data date wins
      expect(by.boom.status).toBe("error");
      expect(by.boom.error).toBeTruthy();
      expect(by.boom.asOf).toBe(by.boom.fetchedAt);
      for (const r of results) expect(r.source?.url).toMatch(/^https:\/\/example\.com\//);

      const res = await GET(new NextRequest("http://localhost/api/health/sources"));
      const body = await res.json();
      const state = Object.fromEntries(body.sources.map((s: { id: string; state: string }) => [s.id, s.state]));
      expect(state).toEqual({ good: "working", boom: "failing", na: "no-recent-runs" }); // n/a isn't a run
      expect(body.summary).toEqual({ working: 1, degraded: 0, failing: 1, noRecentRuns: 1 });

      const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "source-health.json"), "utf-8"));
      expect(Object.keys(onDisk).sort()).toEqual(["boom", "good"]);
    } finally {
      CONNECTORS.splice(0, CONNECTORS.length, ...saved);
    }
  });

  it("every real connector declares a source link", () => {
    for (const c of CONNECTORS) expect(c.source.url, c.id).toMatch(/^https:\/\//);
  });
});

describe("recordOutcome", () => {
  it("keeps only the last 20 runs per source", () => {
    for (let i = 0; i < 25; i++) recordOutcome("X", { connectorId: "c", status: "ok", fetchedAt: at(25 - i) } as SignalResult);
    expect(summarize((JSON.parse(fs.readFileSync(path.join(dir, "source-health.json"), "utf-8")) as Record<string, never[]>).c, NOW).recent.runs).toBe(20);
  });
});
