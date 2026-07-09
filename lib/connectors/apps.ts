/**
 * App usage proxy (Apple App Store — iTunes lookup + reviews RSS, free, no key).
 * Thesis: rating-count growth is a public proxy for install/usage momentum; a
 * surge in recent reviews or a ratings collapse after an update is a short-term
 * signal. (Sensor Tower / data.ai give true download+DAU numbers — premium stub.)
 *
 * iOS only in v1 (Google Play has no free official API — see the disabled stub).
 */
import { getJson, classifyFailure } from "./http";
import { result, type Connector, type Evidence, type Metric } from "./types";

const meta = {
  id: "appstore",
  label: "App Store Signal",
  category: "apps",
  tier: "free",
} as const;

interface LookupResult {
  trackName: string;
  averageUserRating?: number;
  userRatingCount?: number;
  averageUserRatingForCurrentVersion?: number;
  userRatingCountForCurrentVersion?: number;
  version?: string;
  currentVersionReleaseDate?: string;
  trackViewUrl?: string;
}

interface RssEntry {
  author?: { name?: { label?: string } };
  "im:rating"?: { label?: string };
  title?: { label?: string };
  content?: { label?: string };
}

export const appsConnector: Connector = {
  ...meta,
  enabled: true,
  description: "App Store rating count (install proxy), rating trend and recent-review sentiment.",
  requiredIdentifiers: ["iosAppIds"],
  async fetch(entity, ctx) {
    const start = Date.now();
    const ids = entity.identifiers.iosAppIds ?? [];
    if (ids.length === 0) {
      return result(meta, { status: "not-applicable", note: "No App Store app mapped to this company." });
    }
    try {
      const lookup = await getJson<{ results: LookupResult[] }>(
        `https://itunes.apple.com/lookup?id=${ids.join(",")}`,
        { signal: ctx.signal }
      );
      const apps = lookup.results ?? [];
      if (apps.length === 0) {
        return result(meta, { status: "no-data", tookMs: Date.now() - start });
      }
      // Headline app = highest rating count.
      const main = apps.slice().sort((a, b) => (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0))[0];

      const metrics: Metric[] = [
        { name: "Rating", value: main.averageUserRating?.toFixed(2) ?? "—", unit: "★" },
        { name: "Total ratings", value: (main.userRatingCount ?? 0).toLocaleString() },
        {
          name: "This version",
          value: (main.userRatingCountForCurrentVersion ?? 0).toLocaleString(),
        },
        { name: "Last update", value: main.currentVersionReleaseDate?.slice(0, 10) ?? "—" },
      ];

      // Recent reviews for the main app.
      const evidence: Evidence[] = [
        {
          summary: `${main.trackName} — ${main.averageUserRating?.toFixed(2) ?? "?"}★ from ${(main.userRatingCount ?? 0).toLocaleString()} ratings`,
          url: main.trackViewUrl,
        },
      ];
      try {
        const rss = await getJson<{ feed: { entry?: RssEntry[] } }>(
          `https://itunes.apple.com/us/rss/customerreviews/id=${ids[0]}/sortBy=mostRecent/json`,
          { signal: ctx.signal }
        );
        const entries = (rss.feed?.entry ?? []).filter((e) => e["im:rating"]);
        for (const e of entries.slice(0, 4)) {
          evidence.push({
            summary: `${e["im:rating"]?.label ?? "?"}★ "${e.title?.label ?? ""}" — ${(e.content?.label ?? "").slice(0, 140)}`,
          });
        }
      } catch {
        /* reviews are best-effort */
      }

      return result(meta, {
        status: "ok",
        headline: `${main.trackName}: ${main.averageUserRating?.toFixed(2) ?? "?"}★ across ${(main.userRatingCount ?? 0).toLocaleString()} ratings; updated ${main.currentVersionReleaseDate?.slice(0, 10) ?? "—"}.`,
        metrics,
        evidence,
        tookMs: Date.now() - start,
      });
    } catch (e) {
      return result(meta, { ...classifyFailure(e), tookMs: Date.now() - start });
    }
  },
};
