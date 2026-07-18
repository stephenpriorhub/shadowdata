/**
 * Server-side proxy for a single Planet PlanetScope scene tile.
 *
 * WHY a proxy: the Planet tile URL carries the API key, which must never reach the browser.
 * The client <img> points here with only (item, z, x, y); we add auth and stream back the PNG.
 * A fixed scene's tiles never change, so we cache hard.
 */
import { NextRequest } from "next/server";
import { TILE_HOST, isSceneId } from "@/lib/planet";
import { requireHubUser } from "@/lib/hub-auth";

export const runtime = "nodejs";

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

function blank(status = 200) {
  return new Response(TRANSPARENT_PNG, {
    status,
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300" },
  });
}

export async function GET(req: NextRequest) {
  // Gate on hub auth so this endpoint can't be used as an open Planet-tile proxy (quota drain).
  // Same-origin <img> requests carry the cookie; on failure we return a blank tile, not a 401 body.
  const gate = await requireHubUser(req);
  if ("response" in gate) return blank(401);

  const sp = req.nextUrl.searchParams;
  const item = sp.get("item") ?? "";
  const z = Number(sp.get("z"));
  const x = Number(sp.get("x"));
  const y = Number(sp.get("y"));

  const key = process.env.PLANET_API_KEY;
  if (!key || !isSceneId(item)) return blank();
  if (!Number.isInteger(z) || z < 8 || z > 18) return blank();
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return blank();

  try {
    const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
    const upstream = await fetch(`${TILE_HOST}/${item}/${z}/${x}/${y}.png`, {
      headers: { Authorization: auth },
    });
    if (!upstream.ok) return blank();
    const buf = Buffer.from(await upstream.arrayBuffer());
    return new Response(buf, {
      headers: {
        "Content-Type": "image/png",
        // Scene tiles are immutable; cache aggressively at the edge and in the browser.
        "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
      },
    });
  } catch {
    return blank();
  }
}
