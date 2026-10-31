import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedEntity } from "@/lib/connectors/types";

const cache = new Map<string, unknown>();
vi.mock("@/lib/store", () => ({
  getCached: (ns: string, key: string) => cache.get(`${ns}/${key}`) ?? null,
  setCached: (ns: string, key: string, v: unknown) => void cache.set(`${ns}/${key}`, v),
}));

const { parseFile, finraSymbol, candidateDays, finraShortConnector } = await import("@/lib/connectors/finra");

// Two published days; everything else 403s like FINRA does for weekends/holidays.
const FILES: Record<string, string> = {
  "20261029":
    "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n20261029|AAPL|400|0|1000|B,Q,N\n20261029|BF/B|10|0|100|Q\n1234",
  "20261030":
    "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n20261030|AAPL|600|5|1000|B,Q,N\n1234",
};
const fetchMock = vi.fn(async (url: string) => {
  const ymd = url.match(/CNMSshvol(\d{8})\.txt/)![1];
  const body = FILES[ymd];
  return body ? new Response(body, { status: 200 }) : new Response("AccessDenied", { status: 403 });
});

const entity = (ticker: string) => ({ ticker, identifiers: {} }) as unknown as ResolvedEntity;
const ctx = () => ({ signal: new AbortController().signal, now: new Date("2026-10-31T15:00:00Z") });

beforeEach(() => {
  cache.clear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

describe("FINRA short volume", () => {
  it("parses the pipe file, skipping header and footer", () => {
    expect(parseFile(FILES["20261029"])).toEqual({ AAPL: [400, 1000], "BF/B": [10, 100] });
  });

  it("maps class-share tickers to FINRA's slash form", () => {
    expect(finraSymbol("bf.b")).toBe("BF/B");
    expect(finraSymbol("BRK-B")).toBe("BRK/B");
  });

  it("only tries weekdays", () => {
    const days = candidateDays(new Date("2026-10-31T15:00:00Z")); // a Saturday
    expect(days[0]).toBe("20261030");
    expect(days).not.toContain("20261025"); // Sunday
  });

  it("reports the latest ratio against its prior average, with an as-of date and source link", async () => {
    const r = await finraShortConnector.fetch(entity("AAPL"), ctx());
    expect(r.status).toBe("ok");
    expect(r.metrics[0]).toMatchObject({ name: "Short % (2026-10-30)", value: 60 });
    expect(r.metrics[1]).toMatchObject({ value: 40 });
    expect(r.headline).toContain("20.0 pts above");
    expect(r.evidence[0].url).toBe("https://cdn.finra.org/equity/regsho/daily/CNMSshvol20261030.txt");
    expect(r.timeseries?.[0].points.map((p) => p.t)).toEqual(["2026-10-29", "2026-10-30"]);
  });

  it("downloads each day once and serves later tickers from the cache", async () => {
    await finraShortConnector.fetch(entity("AAPL"), ctx());
    const calls = fetchMock.mock.calls.length;
    const r = await finraShortConnector.fetch(entity("BF.B"), ctx());
    expect(r.status).toBe("ok");
    // Only the missing (403) days are retried; the two published files come from the cache.
    expect(fetchMock.mock.calls.length - calls).toBe(calls - 2);
  });

  it("says no-data for a symbol FINRA doesn't list", async () => {
    const r = await finraShortConnector.fetch(entity("ZZZZ"), ctx());
    expect(r.status).toBe("no-data");
  });

  it("returns a failed state (never throws) when FINRA is down", async () => {
    fetchMock.mockImplementation(async () => new Response("oops", { status: 500 }));
    const r = await finraShortConnector.fetch(entity("AAPL"), ctx());
    expect(r.status).toBe("error");
    expect(r.error).toBeTruthy();
  });
});
