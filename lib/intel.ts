/**
 * Intelligence Feed store (DATA_DIR/intel.json) — a small CMS that GrokBot posts
 * into and admins curate. Same JSON-on-volume pattern as watchlist.ts; writes go
 * through a temp file + rename so a crash mid-write can't truncate the store.
 *
 * Every mutation is a synchronous read-modify-write, so within the single Node
 * process two requests can never interleave and lose each other's changes.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "intel.json");

export interface IntelPost {
  id: string;
  title: string;
  summary: string;
  body: string;
  /** "The Big Idea": the simplified takeaway + key data. Shown as the box at the foot of the post and as the feed blurb. */
  bigIdea: string;
  sourceUrl: string | null;
  sourceName: string | null;
  imageUrl: string | null;
  tickers: string[];
  categoryIds: string[];
  /** Shadow Data Type tags — which kind of alternative data the post is built on. */
  dataTypeIds: string[];
  author: string;
  /** Caller-supplied id used to dedupe re-posts of the same item. */
  externalId: string | null;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  hidden: boolean;
}

export interface IntelCategory {
  id: string;
  name: string;
  color: string;
}

export interface IntelTicker {
  symbol: string;
  name: string | null;
}

export interface IntelPortfolio {
  id: string;
  name: string;
  tickers: string[];
}

export interface IntelFolder {
  id: string;
  userId: string;
  name: string;
  postIds: string[];
  createdAt: string;
}

interface Store {
  posts: IntelPost[];
  categories: IntelCategory[];
  dataTypes: IntelCategory[];
  tickers: IntelTicker[];
  portfolios: IntelPortfolio[];
  folders: IntelFolder[];
}

export class IntelError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const EMPTY: Store = { posts: [], categories: [], dataTypes: [], tickers: [], portfolios: [], folders: [] };
const PALETTE = ["#6366f1", "#22c55e", "#eab308", "#ef4444", "#06b6d4", "#a855f7", "#f97316", "#ec4899"];
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

function read(): Store {
  if (!fs.existsSync(FILE)) return structuredClone(EMPTY);
  try {
    const s = { ...structuredClone(EMPTY), ...(JSON.parse(fs.readFileSync(FILE, "utf-8")) as Partial<Store>) };
    for (const p of s.posts) {
      p.dataTypeIds ??= []; // posts created before Shadow Data Types existed
      p.bigIdea ??= ""; // ...and before the Big Idea box
    }
    return s;
  } catch {
    // Never silently start from empty over a corrupt file — that would wipe the feed on next write.
    throw new IntelError("Intelligence store is unreadable; refusing to overwrite it.", 500);
  }
}

function write(s: Store) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf-8");
  fs.renameSync(tmp, FILE);
}

function mutate<T>(fn: (s: Store) => T): T {
  const s = read();
  const out = fn(s);
  write(s);
  return out;
}

const newId = () => crypto.randomBytes(8).toString("hex");

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function safeUrl(v: unknown): string | null {
  const s = str(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function normTicker(v: unknown): string | null {
  const t = str(v, 12).toUpperCase().replace(/^\$/, "");
  return TICKER_RE.test(t) ? t : null;
}

function normTickers(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/) : [];
  return [...new Set(arr.map(normTicker).filter((t): t is string => !!t))].slice(0, 25);
}

function registerTickers(s: Store, tickers: string[]) {
  const known = new Set(s.tickers.map((t) => t.symbol));
  for (const t of tickers) if (!known.has(t)) s.tickers.push({ symbol: t, name: null });
  s.tickers.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** The two tag taxonomies on a post: categories (topic) and Shadow Data Types (signal source). */
export type TaxonomyKind = "categories" | "dataTypes";
const POST_FIELD = { categories: "categoryIds", dataTypes: "dataTypeIds" } as const;
const LABEL = { categories: "category", dataTypes: "data type" } as const;

/** Map tag names/ids to ids, creating any unknown name (admins can merge/delete later). */
function resolveTerms(s: Store, kind: TaxonomyKind, v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const ids: string[] = [];
  for (const raw of arr) {
    const name = str(raw, 60);
    if (!name) continue;
    let cat = s[kind].find((c) => c.id === name || c.name.toLowerCase() === name.toLowerCase());
    if (!cat) {
      cat = { id: newId(), name, color: PALETTE[s[kind].length % PALETTE.length] };
      s[kind].push(cat);
    }
    if (!ids.includes(cat.id)) ids.push(cat.id);
  }
  return ids.slice(0, 10);
}

// ── Posts ─────────────────────────────────────────────────────────────────────

export interface PostInput {
  title?: unknown;
  summary?: unknown;
  body?: unknown;
  bigIdea?: unknown;
  sourceUrl?: unknown;
  sourceName?: unknown;
  imageUrl?: unknown;
  tickers?: unknown;
  categories?: unknown;
  dataTypes?: unknown;
  externalId?: unknown;
  publishedAt?: unknown;
  hidden?: unknown;
}

function parseDate(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Create posts. A post whose externalId or sourceUrl already exists is skipped, not
 * duplicated, so the bot can safely re-send what it found.
 */
export function createPosts(inputs: PostInput[], author: string) {
  return mutate((s) => {
    const created: IntelPost[] = [];
    const skipped: { title: string; reason: string; existingId?: string }[] = [];
    for (const input of inputs) {
      const title = str(input.title, 300);
      if (!title) {
        skipped.push({ title: "", reason: "missing title" });
        continue;
      }
      const externalId = str(input.externalId, 200) || null;
      const sourceUrl = safeUrl(input.sourceUrl);
      const dup = s.posts.find(
        (p) => (externalId && p.externalId === externalId) || (sourceUrl && p.sourceUrl === sourceUrl)
      );
      if (dup) {
        skipped.push({ title, reason: "duplicate", existingId: dup.id });
        continue;
      }
      const now = new Date().toISOString();
      const tickers = normTickers(input.tickers);
      registerTickers(s, tickers);
      const post: IntelPost = {
        id: newId(),
        title,
        summary: str(input.summary, 2000),
        body: str(input.body, 50000),
        bigIdea: str(input.bigIdea, 1500),
        sourceUrl,
        sourceName: str(input.sourceName, 120) || null,
        imageUrl: safeUrl(input.imageUrl),
        tickers,
        categoryIds: resolveTerms(s, "categories", input.categories),
        dataTypeIds: resolveTerms(s, "dataTypes", input.dataTypes),
        author: author.slice(0, 80),
        externalId,
        publishedAt: parseDate(input.publishedAt) ?? now,
        createdAt: now,
        updatedAt: now,
        hidden: input.hidden === true,
      };
      s.posts.push(post);
      created.push(post);
    }
    return { created, skipped };
  });
}

export function updatePost(id: string, input: PostInput): IntelPost {
  return mutate((s) => {
    const p = s.posts.find((x) => x.id === id);
    if (!p) throw new IntelError("Post not found.", 404);
    if (input.title !== undefined) {
      const t = str(input.title, 300);
      if (!t) throw new IntelError("Title can't be empty.");
      p.title = t;
    }
    if (input.summary !== undefined) p.summary = str(input.summary, 2000);
    if (input.body !== undefined) p.body = str(input.body, 50000);
    if (input.bigIdea !== undefined) p.bigIdea = str(input.bigIdea, 1500);
    if (input.sourceUrl !== undefined) p.sourceUrl = safeUrl(input.sourceUrl);
    if (input.sourceName !== undefined) p.sourceName = str(input.sourceName, 120) || null;
    if (input.imageUrl !== undefined) p.imageUrl = safeUrl(input.imageUrl);
    if (input.tickers !== undefined) {
      p.tickers = normTickers(input.tickers);
      registerTickers(s, p.tickers);
    }
    if (input.categories !== undefined) p.categoryIds = resolveTerms(s, "categories", input.categories);
    if (input.dataTypes !== undefined) p.dataTypeIds = resolveTerms(s, "dataTypes", input.dataTypes);
    if (input.publishedAt !== undefined) p.publishedAt = parseDate(input.publishedAt) ?? p.publishedAt;
    if (input.hidden !== undefined) p.hidden = input.hidden === true;
    p.updatedAt = new Date().toISOString();
    return p;
  });
}

export function deletePost(id: string): void {
  mutate((s) => {
    const before = s.posts.length;
    s.posts = s.posts.filter((p) => p.id !== id);
    if (s.posts.length === before) throw new IntelError("Post not found.", 404);
    for (const f of s.folders) f.postIds = f.postIds.filter((x) => x !== id);
  });
}

export function getPost(id: string): IntelPost | null {
  return read().posts.find((p) => p.id === id) ?? null;
}

export interface FeedQuery {
  tickers?: string[];
  portfolioId?: string | null;
  categoryId?: string | null;
  dataTypeId?: string | null;
  q?: string | null;
  includeHidden?: boolean;
  limit?: number;
  offset?: number;
}

export function listPosts(query: FeedQuery) {
  const s = read();
  const filterTickers = new Set(query.tickers ?? []);
  if (query.portfolioId) {
    const pf = s.portfolios.find((p) => p.id === query.portfolioId);
    // An unknown portfolio must match nothing, not silently widen to everything.
    if (!pf) return { posts: [], total: 0 };
    for (const t of pf.tickers) filterTickers.add(t);
    if (filterTickers.size === 0) return { posts: [], total: 0 };
  }
  const q = query.q?.trim().toLowerCase();
  const matched = s.posts
    .filter((p) => query.includeHidden || !p.hidden)
    .filter((p) => filterTickers.size === 0 || p.tickers.some((t) => filterTickers.has(t)))
    .filter((p) => !query.categoryId || p.categoryIds.includes(query.categoryId))
    .filter((p) => !query.dataTypeId || p.dataTypeIds.includes(query.dataTypeId))
    .filter(
      (p) =>
        !q ||
        p.title.toLowerCase().includes(q) ||
        p.summary.toLowerCase().includes(q) ||
        p.bigIdea.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q)
    )
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(100, Math.max(1, query.limit ?? 30));
  return { posts: matched.slice(offset, offset + limit), total: matched.length };
}

// ── Taxonomy: categories, data types, tickers, portfolios ─────────────────────────────────

export function getMeta() {
  const s = read();
  const counts: Record<string, number> = {};
  for (const p of s.posts) for (const t of p.tickers) counts[t] = (counts[t] ?? 0) + 1;
  const catCounts: Record<string, number> = {};
  for (const p of s.posts) for (const c of [...p.categoryIds, ...p.dataTypeIds]) catCounts[c] = (catCounts[c] ?? 0) + 1;
  return {
    categories: s.categories.map((c) => ({ ...c, postCount: catCounts[c.id] ?? 0 })),
    dataTypes: s.dataTypes.map((c) => ({ ...c, postCount: catCounts[c.id] ?? 0 })),
    tickers: s.tickers.map((t) => ({ ...t, postCount: counts[t.symbol] ?? 0 })),
    portfolios: s.portfolios,
  };
}

export function createTerm(kind: TaxonomyKind, name: unknown, color?: unknown): IntelCategory {
  return mutate((s) => {
    const n = str(name, 60);
    if (!n) throw new IntelError("Name required.");
    if (s[kind].some((c) => c.name.toLowerCase() === n.toLowerCase()))
      throw new IntelError(`A ${LABEL[kind]} with that name already exists.`, 409);
    const c = { id: newId(), name: n, color: hexOr(color, PALETTE[s[kind].length % PALETTE.length]) };
    s[kind].push(c);
    return c;
  });
}

function hexOr(v: unknown, fallback: string): string {
  const s = str(v, 7);
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}

export function updateTerm(kind: TaxonomyKind, id: string, input: { name?: unknown; color?: unknown }): IntelCategory {
  return mutate((s) => {
    const c = s[kind].find((x) => x.id === id);
    if (!c) throw new IntelError(`That ${LABEL[kind]} was not found.`, 404);
    if (input.name !== undefined) {
      const n = str(input.name, 60);
      if (!n) throw new IntelError("Name required.");
      if (s[kind].some((x) => x.id !== id && x.name.toLowerCase() === n.toLowerCase()))
        throw new IntelError(`A ${LABEL[kind]} with that name already exists.`, 409);
      c.name = n;
    }
    if (input.color !== undefined) c.color = hexOr(input.color, c.color);
    return c;
  });
}

/** Delete a tag; optionally move its posts onto another tag of the same kind first. */
export function deleteTerm(kind: TaxonomyKind, id: string, mergeInto?: string | null): void {
  mutate((s) => {
    const field = POST_FIELD[kind];
    if (!s[kind].some((c) => c.id === id)) throw new IntelError(`That ${LABEL[kind]} was not found.`, 404);
    if (mergeInto && !s[kind].some((c) => c.id === mergeInto)) throw new IntelError("Merge target not found.", 404);
    for (const p of s.posts) {
      if (!p[field].includes(id)) continue;
      p[field] = p[field].filter((x) => x !== id);
      if (mergeInto && !p[field].includes(mergeInto)) p[field].push(mergeInto);
    }
    s[kind] = s[kind].filter((c) => c.id !== id);
  });
}

export function upsertTicker(symbol: unknown, name: unknown): IntelTicker {
  return mutate((s) => {
    const t = normTicker(symbol);
    if (!t) throw new IntelError("Invalid ticker symbol.");
    let row = s.tickers.find((x) => x.symbol === t);
    if (!row) {
      row = { symbol: t, name: null };
      s.tickers.push(row);
      s.tickers.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
    // Omitted name = keep the existing one (the bot re-adding a ticker must not wipe an admin's label).
    if (name !== undefined) row.name = str(name, 120) || null;
    return row;
  });
}

/** Rename a ticker everywhere (posts + portfolios). Renaming onto an existing symbol merges them. */
export function renameTicker(from: string, to: unknown): void {
  mutate((s) => {
    const src = normTicker(from);
    const dst = normTicker(to);
    if (!src || !s.tickers.some((t) => t.symbol === src)) throw new IntelError("Ticker not found.", 404);
    if (!dst) throw new IntelError("Invalid ticker symbol.");
    if (src === dst) return;
    const swap = (arr: string[]) => [...new Set(arr.map((t) => (t === src ? dst : t)))];
    for (const p of s.posts) p.tickers = swap(p.tickers);
    for (const pf of s.portfolios) pf.tickers = swap(pf.tickers);
    const srcRow = s.tickers.find((t) => t.symbol === src)!;
    s.tickers = s.tickers.filter((t) => t.symbol !== src);
    const dstRow = s.tickers.find((t) => t.symbol === dst);
    if (dstRow) dstRow.name = dstRow.name ?? srcRow.name;
    else s.tickers.push({ symbol: dst, name: srcRow.name });
    s.tickers.sort((a, b) => a.symbol.localeCompare(b.symbol));
  });
}

/** Remove a ticker from the registry and untag it from every post and portfolio. */
export function deleteTicker(symbol: string): void {
  mutate((s) => {
    const t = normTicker(symbol);
    if (!t || !s.tickers.some((x) => x.symbol === t)) throw new IntelError("Ticker not found.", 404);
    for (const p of s.posts) p.tickers = p.tickers.filter((x) => x !== t);
    for (const pf of s.portfolios) pf.tickers = pf.tickers.filter((x) => x !== t);
    s.tickers = s.tickers.filter((x) => x.symbol !== t);
  });
}

export function savePortfolio(id: string | null, input: { name?: unknown; tickers?: unknown }): IntelPortfolio {
  return mutate((s) => {
    const name = str(input.name, 80);
    const tickers = normTickers(input.tickers);
    if (!id) {
      if (!name) throw new IntelError("Name required.");
      const dup = s.portfolios.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (dup) throw new IntelError(`A portfolio named "${dup.name}" already exists (id ${dup.id}).`, 409);
      const pf = { id: newId(), name, tickers };
      registerTickers(s, tickers);
      s.portfolios.push(pf);
      return pf;
    }
    const pf = s.portfolios.find((p) => p.id === id);
    if (!pf) throw new IntelError("Portfolio not found.", 404);
    if (input.name !== undefined) {
      if (!name) throw new IntelError("Name required.");
      pf.name = name;
    }
    if (input.tickers !== undefined) {
      pf.tickers = tickers;
      registerTickers(s, tickers);
    }
    return pf;
  });
}

export function deletePortfolio(id: string): void {
  mutate((s) => {
    if (!s.portfolios.some((p) => p.id === id)) throw new IntelError("Portfolio not found.", 404);
    s.portfolios = s.portfolios.filter((p) => p.id !== id);
  });
}

// ── Saved folders (per hub user) ──────────────────────────────────────────────

export function listFolders(userId: string) {
  const s = read();
  const live = new Set(s.posts.map((p) => p.id));
  return s.folders
    .filter((f) => f.userId === userId)
    .map((f) => ({ ...f, postIds: f.postIds.filter((id) => live.has(id)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function createFolder(userId: string, name: unknown): IntelFolder {
  return mutate((s) => {
    const n = str(name, 80);
    if (!n) throw new IntelError("Folder name required.");
    if (s.folders.some((f) => f.userId === userId && f.name.toLowerCase() === n.toLowerCase()))
      throw new IntelError("You already have a folder with that name.", 409);
    const f = { id: newId(), userId, name: n, postIds: [], createdAt: new Date().toISOString() };
    s.folders.push(f);
    return f;
  });
}

function ownFolder(s: Store, userId: string, id: string): IntelFolder {
  const f = s.folders.find((x) => x.id === id && x.userId === userId);
  if (!f) throw new IntelError("Folder not found.", 404);
  return f;
}

export function renameFolder(userId: string, id: string, name: unknown): IntelFolder {
  return mutate((s) => {
    const f = ownFolder(s, userId, id);
    const n = str(name, 80);
    if (!n) throw new IntelError("Folder name required.");
    f.name = n;
    return f;
  });
}

export function deleteFolder(userId: string, id: string): void {
  mutate((s) => {
    ownFolder(s, userId, id);
    s.folders = s.folders.filter((f) => f.id !== id);
  });
}

export function setSaved(userId: string, folderId: string, postId: string, saved: boolean): IntelFolder {
  return mutate((s) => {
    const f = ownFolder(s, userId, folderId);
    if (saved) {
      if (!s.posts.some((p) => p.id === postId)) throw new IntelError("Post not found.", 404);
      if (!f.postIds.includes(postId)) f.postIds.unshift(postId);
    } else {
      f.postIds = f.postIds.filter((x) => x !== postId);
    }
    return f;
  });
}

/** Posts in one of the user's folders, newest-saved first. Hidden posts stay visible to whoever saved them. */
export function folderPosts(userId: string, folderId: string): IntelPost[] {
  const s = read();
  const f = ownFolder(s, userId, folderId);
  const byId = new Map(s.posts.map((p) => [p.id, p]));
  return f.postIds.map((id) => byId.get(id)).filter((p): p is IntelPost => !!p);
}
