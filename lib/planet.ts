/**
 * Planet Data API — find real PlanetScope scenes over a point and address their XYZ tiles.
 *
 * The account has no Basemaps subscription (mosaics list returns empty), so we use the Data API:
 * quick-search for PSScene items covering a lat/lng, then render each scene's own tiles via
 * Planet's item tile service. Tiles are fetched server-side only (the API key must never reach
 * the browser) — see app/api/sat/tile/route.ts, which proxies a single scene tile.
 */

const DATA_API = "https://api.planet.com/data/v1";
export const TILE_HOST = "https://tiles.planet.com/data/v1/PSScene";

/** A resolved PlanetScope scene covering a point. */
export interface Scene {
  id: string; // e.g. 20260716_194218_17_251a
  acquired: string; // ISO acquisition timestamp
  cloud: number; // 0..1
}

/** Web-mercator (XYZ / "slippy") tile containing a lat/lng at a given zoom. */
export function lonLatToTile(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/** Scene id format guard — used to sanitize the tile-proxy param against SSRF/path abuse. */
export function isSceneId(id: string): boolean {
  return /^[0-9]{8}_[0-9]{6}_[0-9A-Za-z_]+$/.test(id) && id.length <= 64;
}

/** Fetch one scene tile server-side and base64-encode it (for a Claude vision pass). Null on failure. */
export async function fetchTileBase64(
  item: string,
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal
): Promise<string | null> {
  const key = process.env.PLANET_API_KEY;
  if (!key || !isSceneId(item)) return null;
  try {
    const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
    const res = await fetch(`${TILE_HOST}/${item}/${z}/${x}/${y}.png`, { headers: { Authorization: auth }, signal });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  } catch {
    return null;
  }
}

/**
 * Find the best PlanetScope scene covering a point: most recent, low cloud, downloadable,
 * acquired on or before `before`. Returns null on no key, no coverage, or any API error
 * (callers degrade gracefully rather than fail the whole signal).
 */
export async function findScene(
  lat: number,
  lng: number,
  opts: { before: Date; lookbackDays?: number; cloudMax?: number; signal?: AbortSignal }
): Promise<Scene | null> {
  const key = process.env.PLANET_API_KEY;
  if (!key) return null;
  const lookbackDays = opts.lookbackDays ?? 75;
  const gte = new Date(opts.before.getTime() - lookbackDays * 86_400_000).toISOString();
  const lte = opts.before.toISOString();
  const body = {
    item_types: ["PSScene"],
    filter: {
      type: "AndFilter",
      config: [
        { type: "GeometryFilter", field_name: "geometry", config: { type: "Point", coordinates: [lng, lat] } },
        { type: "DateRangeFilter", field_name: "acquired", config: { gte, lte } },
        { type: "RangeFilter", field_name: "cloud_cover", config: { lte: opts.cloudMax ?? 0.15 } },
        // Only scenes we're actually entitled to render.
        { type: "PermissionFilter", config: ["assets.ortho_visual:download"] },
      ],
    },
  };
  try {
    const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
    const res = await fetch(`${DATA_API}/quick-search?_page_size=5&_sort=acquired%20desc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { features?: Array<{ id: string; properties?: Record<string, unknown> }> };
    const feats = Array.isArray(data.features) ? data.features : [];
    if (!feats.length) return null;
    // Already sorted newest-first; take the freshest that passed the cloud/permission filters.
    const f = feats[0];
    return {
      id: f.id,
      acquired: String(f.properties?.acquired ?? ""),
      cloud: Number(f.properties?.cloud_cover ?? 0),
    };
  } catch {
    return null;
  }
}
