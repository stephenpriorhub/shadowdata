/**
 * Hiring signal (Greenhouse + Lever public job boards — free, no key). Thesis:
 * total open roles and the department mix are a real-time read on where a company
 * is investing. Aggressive engineering/sales hiring = expansion (long-term bull);
 * a sudden collapse in postings = a hiring freeze / cost-cutting (short-term flag).
 */
import { getJson, HttpError } from "./http";
import { result, type Connector, type Evidence, type Metric } from "./types";

const meta = {
  id: "jobs",
  label: "Hiring / Job Postings",
  category: "hiring",
  tier: "free",
} as const;

interface Role {
  title: string;
  department: string;
  url: string;
  postedAt?: string;
}

const DAY = 1000 * 60 * 60 * 24;

async function greenhouse(slug: string, signal: AbortSignal): Promise<Role[]> {
  const data = await getJson<{
    departments: { name: string; jobs: { title: string; absolute_url: string; updated_at: string }[] }[];
  }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/departments`, { signal });
  const roles: Role[] = [];
  for (const d of data.departments ?? []) {
    for (const j of d.jobs ?? []) {
      roles.push({ title: j.title, department: d.name || "Other", url: j.absolute_url, postedAt: j.updated_at });
    }
  }
  return roles;
}

async function lever(slug: string, signal: AbortSignal): Promise<Role[]> {
  const data = await getJson<
    { text: string; categories?: { team?: string }; hostedUrl: string; createdAt?: number }[]
  >(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`, { signal });
  return (data ?? []).map((p) => ({
    title: p.text,
    department: p.categories?.team || "Other",
    url: p.hostedUrl,
    postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
  }));
}

export const jobsConnector: Connector = {
  ...meta,
  enabled: true,
  description: "Open-role count and department mix from the company's Greenhouse / Lever job board.",
  requiredIdentifiers: [],
  async fetch(entity, ctx) {
    const start = Date.now();
    const { greenhouseSlug, leverSlug } = entity.identifiers;
    if (!greenhouseSlug && !leverSlug) {
      return result(meta, {
        status: "not-applicable",
        note: "No public Greenhouse or Lever job board mapped to this company.",
      });
    }
    const roles: Role[] = [];
    const errors: string[] = []; // only genuine (non-404) failures
    let notFound = false; // a mapped slug that simply doesn't exist
    const handle = (source: string, e: unknown) => {
      if (e instanceof HttpError && (e.status === 404 || e.status === 403)) notFound = true;
      else errors.push(`${source}: ${e instanceof Error ? e.message : e}`);
    };
    if (greenhouseSlug) {
      try {
        roles.push(...(await greenhouse(greenhouseSlug, ctx.signal)));
      } catch (e) {
        handle("greenhouse", e);
      }
    }
    if (leverSlug) {
      try {
        roles.push(...(await lever(leverSlug, ctx.signal)));
      } catch (e) {
        handle("lever", e);
      }
    }

    if (roles.length === 0) {
      if (errors.length) {
        return result(meta, { status: "error", error: errors.join("; "), tookMs: Date.now() - start });
      }
      return result(meta, {
        status: "no-data",
        note: notFound
          ? "No public Greenhouse/Lever board found at the mapped slug (the company may use a different ATS)."
          : "Job board resolved but currently lists no open roles.",
        tookMs: Date.now() - start,
      });
    }

    const byDept = new Map<string, number>();
    for (const r of roles) byDept.set(r.department, (byDept.get(r.department) ?? 0) + 1);
    const topDepts = [...byDept.entries()].sort((a, b) => b[1] - a[1]);
    const eng = roles.filter((r) => /engineer|developer|software|data|ml|infra/i.test(r.title)).length;
    const gtm = roles.filter((r) => /sales|account|marketing|growth|revenue/i.test(r.title)).length;
    const now = ctx.now.getTime();
    const recent = roles.filter((r) => r.postedAt && now - new Date(r.postedAt).getTime() <= 30 * DAY);

    const metrics: Metric[] = [
      { name: "Open roles", value: roles.length },
      { name: "Engineering", value: eng },
      { name: "Sales / GTM", value: gtm },
      { name: "Posted (30d)", value: recent.length, trend: recent.length >= roles.length / 3 ? "up" : undefined },
    ];

    const evidence: Evidence[] = topDepts.slice(0, 3).map(([dept, n]) => ({
      summary: `${dept}: ${n} open role${n === 1 ? "" : "s"}`,
    }));
    evidence.push(
      ...roles
        .filter((r) => r.postedAt)
        .sort((a, b) => (b.postedAt! > a.postedAt! ? 1 : -1))
        .slice(0, 3)
        .map((r) => ({
          summary: `${r.title} (${r.department})`,
          url: r.url,
          sourceDate: r.postedAt,
        }))
    );

    return result(meta, {
      status: "ok",
      headline: `${roles.length} open roles${recent.length ? ` (${recent.length} posted in 30d)` : ""}; heaviest in ${topDepts[0]?.[0] ?? "—"}.`,
      metrics,
      evidence,
      tookMs: Date.now() - start,
    });
  },
};
