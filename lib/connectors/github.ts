/**
 * GitHub / open-source activity. Thesis: for companies whose product IS software,
 * commit/release/contributor velocity is a leading indicator of shipping pace and
 * developer mindshare — a long-term structural signal, sometimes a short-term catalyst.
 *
 * Uses the REST API. GITHUB_TOKEN raises the rate limit to 5000/hr when present, but
 * if the shared token is expired/invalid (401), we transparently retry
 * unauthenticated (60/hr) so public data still loads rather than erroring.
 */
import { getJson, HttpError, pctChange, trendOf, classifyFailure } from "./http";
import { result, type Connector, type Evidence, type Metric, type Timeseries } from "./types";

const meta = {
  id: "github",
  label: "GitHub / OSS Activity",
  category: "oss",
  tier: "free",
} as const;

interface Repo {
  name: string;
  full_name: string;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string;
  archived: boolean;
  fork: boolean;
}

/** GET the GitHub API with the token if present; on 401 (bad token) retry unauthenticated. */
async function ghGet<T>(url: string, signal: AbortSignal): Promise<T> {
  const base: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    try {
      return await getJson<T>(url, { signal, headers: { ...base, Authorization: `Bearer ${token}` } });
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        return await getJson<T>(url, { signal, headers: base }); // token dead → unauthenticated
      }
      throw e;
    }
  }
  return await getJson<T>(url, { signal, headers: base });
}

async function listRepos(org: string, signal: AbortSignal): Promise<Repo[]> {
  const orgUrl = `https://api.github.com/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=pushed&type=public`;
  try {
    return await ghGet<Repo[]>(orgUrl, signal);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      const userUrl = `https://api.github.com/users/${encodeURIComponent(org)}/repos?per_page=100&sort=pushed&type=public`;
      return await ghGet<Repo[]>(userUrl, signal);
    }
    throw e;
  }
}

async function commitActivity(fullName: string, signal: AbortSignal): Promise<Timeseries | undefined> {
  try {
    const weeks = await ghGet<{ week: number; total: number }[]>(
      `https://api.github.com/repos/${fullName}/stats/commit_activity`,
      signal
    );
    if (!Array.isArray(weeks) || weeks.length === 0) return undefined; // 202 => still computing
    return {
      name: `${fullName} weekly commits`,
      points: weeks.slice(-26).map((w) => ({
        t: new Date(w.week * 1000).toISOString().slice(0, 10),
        v: w.total,
      })),
    };
  } catch {
    return undefined;
  }
}

export const githubConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Commit velocity, release cadence, stars and contributor momentum across the company's public repos.",
  requiredIdentifiers: ["githubOrg"],
  async fetch(entity, ctx) {
    const start = Date.now();
    const org = entity.identifiers.githubOrg;
    if (!org) {
      return result(meta, {
        status: "not-applicable",
        note: "No public GitHub organization mapped to this company.",
      });
    }
    try {
      const repos = (await listRepos(org, ctx.signal))
        .filter((r) => !r.fork && !r.archived)
        .sort((a, b) => b.stargazers_count - a.stargazers_count);

      if (repos.length === 0) {
        return result(meta, {
          status: "no-data",
          note: `GitHub org "${org}" has no active public repositories.`,
          tookMs: Date.now() - start,
        });
      }

      const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);
      const mostRecentPush = repos.map((r) => r.pushed_at).sort().reverse()[0];
      const top = repos[0];
      const ts = await commitActivity(top.full_name, ctx.signal);

      let recentDeltaPct: number | undefined;
      let recentCommits: number | undefined;
      if (ts) {
        const pts = ts.points.map((p) => p.v);
        const last8 = pts.slice(-8).reduce((a, b) => a + b, 0);
        const prev8 = pts.slice(-16, -8).reduce((a, b) => a + b, 0);
        recentCommits = last8;
        recentDeltaPct = pctChange(last8, prev8);
      }

      const metrics: Metric[] = [
        { name: "Public repos", value: repos.length },
        { name: "Total stars", value: totalStars },
        { name: "Most recent push", value: new Date(mostRecentPush).toISOString().slice(0, 10) },
      ];
      if (recentCommits !== undefined) {
        metrics.push({
          name: "Commits (last 8 wks)",
          value: recentCommits,
          changePct: recentDeltaPct,
          trend: trendOf(recentDeltaPct),
        });
      }

      const evidence: Evidence[] = repos.slice(0, 5).map((r) => ({
        summary: `${r.full_name} — ★${r.stargazers_count.toLocaleString()}, updated ${r.pushed_at.slice(0, 10)}`,
        url: r.html_url,
        sourceDate: r.pushed_at,
      }));

      const headline =
        recentDeltaPct !== undefined
          ? `${totalStars.toLocaleString()} stars across ${repos.length} repos; top-repo commit volume ${recentDeltaPct >= 0 ? "up" : "down"} ${Math.abs(recentDeltaPct).toFixed(0)}% vs prior 8 wks.`
          : `${totalStars.toLocaleString()} stars across ${repos.length} public repos.`;

      return result(meta, {
        status: "ok",
        headline,
        metrics,
        timeseries: ts ? [ts] : undefined,
        evidence,
        primaryLink: { label: "View on GitHub", url: `https://github.com/${encodeURIComponent(org)}` },
        tookMs: Date.now() - start,
      });
    } catch (e) {
      const f = classifyFailure(e);
      return result(meta, {
        ...f,
        note: f.status === "no-data" ? `GitHub org "${org}" not found or has no public repos.` : f.note,
        tookMs: Date.now() - start,
      });
    }
  },
};
