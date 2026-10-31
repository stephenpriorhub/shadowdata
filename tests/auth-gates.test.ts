import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getHubUser } from "@/lib/hub-auth";
import { requireReader } from "@/lib/intel-auth";

const req = (headers: Record<string, string>) =>
  new NextRequest("https://shadowdata.oxfordhub.app/api/x", { headers });

describe("hub service token (x-hub-token)", () => {
  beforeEach(() => vi.stubEnv("HUB_API_TOKEN", "hub-token"));
  afterEach(() => vi.unstubAllEnvs());

  it("maps the correct token to the service identity", async () => {
    expect((await getHubUser(req({ "x-hub-token": "hub-token" })))?.id).toBe("service");
  });
  it("rejects a wrong token and makes no hub call without a cookie", async () => {
    expect(await getHubUser(req({ "x-hub-token": "hub-tokenX" }))).toBeNull();
  });
  it("rejects an empty token when HUB_API_TOKEN is unset", async () => {
    vi.stubEnv("HUB_API_TOKEN", "");
    expect(await getHubUser(req({ "x-hub-token": "" }))).toBeNull();
  });
});

describe("GrokBot feed key (Authorization: Bearer)", () => {
  beforeEach(() => {
    vi.stubEnv("INTEL_FEED_API_KEY", "feed-key");
    vi.stubEnv("NODE_ENV", "production"); // disable the localhost dev bypass
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the right key as the bot", async () => {
    const gate = await requireReader(req({ authorization: "Bearer feed-key" }));
    expect("actor" in gate && gate.actor.kind).toBe("bot");
  });
  it("rejects a wrong key", async () => {
    const gate = await requireReader(req({ authorization: "Bearer feed-keyX" }));
    expect("response" in gate && gate.response.status).toBe(401);
  });
});
