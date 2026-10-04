"use client";

import { useCallback, useEffect, useState } from "react";
import { api, useMeta, useFolders, IntelNav, PostCard, PostEditor, type Post, type Folder } from "./shared";

const PAGE = 30;
const WATCHLIST = "__watchlist";

interface Filters {
  tickers: string[];
  portfolio: string;
  category: string;
  dataType: string;
  q: string;
}

function readUrl(): Filters {
  const sp = new URLSearchParams(window.location.search);
  return {
    tickers: (sp.get("ticker") ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean),
    portfolio: sp.get("portfolio") ?? "",
    category: sp.get("category") ?? "",
    dataType: sp.get("dataType") ?? "",
    q: sp.get("q") ?? "",
  };
}

function writeUrl(f: Filters) {
  const sp = new URLSearchParams();
  if (f.tickers.length) sp.set("ticker", f.tickers.join(","));
  if (f.portfolio) sp.set("portfolio", f.portfolio);
  if (f.category) sp.set("category", f.category);
  if (f.dataType) sp.set("dataType", f.dataType);
  if (f.q) sp.set("q", f.q);
  const qs = sp.toString();
  window.history.replaceState(null, "", qs ? `/intel?${qs}` : "/intel");
}

export default function IntelFeed() {
  const { meta, error: metaError, reload: reloadMeta } = useMeta();
  const { folders, setFolders } = useFolders();
  const [filters, setFilters] = useState<Filters | null>(null);
  const [tickerInput, setTickerInput] = useState("");
  const [qInput, setQInput] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Post | "new" | null>(null);

  useEffect(() => {
    const f = readUrl();
    setFilters(f);
    setQInput(f.q);
    api<{ watchlist: { tickers: string[] } }>("/api/watchlist")
      .then((d) => setWatchlist(d.watchlist.tickers))
      .catch(() => {});
  }, []);

  const load = useCallback(
    async (f: Filters, offset: number) => {
      // "My watchlist" is a client-side portfolio: send its tickers instead of a portfolio id.
      const usingWatchlist = f.portfolio === WATCHLIST;
      const tickers = usingWatchlist ? [...new Set([...f.tickers, ...watchlist])] : f.tickers;
      if (usingWatchlist && tickers.length === 0) {
        setPosts([]);
        setTotal(0);
        return;
      }
      const sp = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (tickers.length) sp.set("ticker", tickers.join(","));
      if (f.portfolio && !usingWatchlist) sp.set("portfolio", f.portfolio);
      if (f.category) sp.set("category", f.category);
      if (f.dataType) sp.set("dataType", f.dataType);
      if (f.q) sp.set("q", f.q);
      if (meta?.isAdmin) sp.set("hidden", "1");
      setLoading(true);
      setError(null);
      try {
        const d = await api<{ posts: Post[]; total: number }>(`/api/intel/posts?${sp}`);
        setPosts((prev) => (offset ? [...prev, ...d.posts] : d.posts));
        setTotal(d.total);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [watchlist, meta?.isAdmin]
  );

  useEffect(() => {
    if (!filters || !meta) return;
    writeUrl(filters);
    load(filters, 0);
  }, [filters, meta, load]);

  const update = (patch: Partial<Filters>) => setFilters((f) => (f ? { ...f, ...patch } : f));
  const addTicker = (t: string) => {
    const sym = t.trim().toUpperCase().replace(/^\$/, "");
    if (sym && filters && !filters.tickers.includes(sym)) update({ tickers: [...filters.tickers, sym] });
    setTickerInput("");
  };

  const toggleSave = async (postId: string, folderId: string, saved: boolean) => {
    try {
      const d = await api<{ folder: Folder }>(`/api/intel/folders/${folderId}/posts`, {
        method: "POST",
        json: { postId, saved },
      });
      setFolders((fs) => fs.map((f) => (f.id === folderId ? d.folder : f)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const createFolder = async (name: string) => {
    try {
      const d = await api<{ folder: Folder }>("/api/intel/folders", { method: "POST", json: { name } });
      setFolders((fs) => [...fs, d.folder].sort((a, b) => a.name.localeCompare(b.name)));
      return d.folder;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };

  const remove = async (p: Post) => {
    if (!confirm(`Delete "${p.title}"? This can't be undone.`)) return;
    try {
      await api(`/api/intel/posts/${p.id}`, { method: "DELETE" });
      setPosts((ps) => ps.filter((x) => x.id !== p.id));
      setTotal((t) => t - 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const active = !!filters && (filters.tickers.length > 0 || !!filters.portfolio || !!filters.category || !!filters.dataType || !!filters.q);
  const select = "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <IntelNav active="feed" isAdmin={!!meta?.isAdmin} />

      {(metaError || error) && (
        <div className="mb-4 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{metaError || error}</div>
      )}

      {meta && filters && (
        <section className="mb-5 space-y-3 rounded-xl border border-border bg-surface p-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select className={select} value={filters.portfolio} onChange={(e) => update({ portfolio: e.target.value })}>
              <option value="">All portfolios</option>
              <option value={WATCHLIST}>★ My watchlist ({watchlist.length})</option>
              {meta.portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.tickers.length})
                </option>
              ))}
            </select>
            <select className={select} value={filters.category} onChange={(e) => update({ category: e.target.value })}>
              <option value="">All categories</option>
              {meta.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.postCount})
                </option>
              ))}
            </select>
            <select className={select} value={filters.dataType} onChange={(e) => update({ dataType: e.target.value })}>
              <option value="">All data types</option>
              {meta.dataTypes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.postCount})
                </option>
              ))}
            </select>
            <input
              className={select}
              placeholder="Search posts…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && update({ q: qInput.trim() })}
              onBlur={() => qInput.trim() !== filters.q && update({ q: qInput.trim() })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              list="intel-tickers"
              className="w-40 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
              placeholder="Add ticker filter"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && addTicker(tickerInput)}
              maxLength={12}
            />
            <datalist id="intel-tickers">
              {meta.tickers.map((t) => (
                <option key={t.symbol} value={t.symbol}>
                  {t.name ?? ""}
                </option>
              ))}
            </datalist>
            {filters.tickers.map((t) => (
              <button
                key={t}
                onClick={() => update({ tickers: filters.tickers.filter((x) => x !== t) })}
                className="rounded-md border border-accent bg-accent/15 px-2 py-1 text-xs font-medium text-accent"
              >
                ${t} ✕
              </button>
            ))}
            {active && (
              <button
                onClick={() => {
                  setQInput("");
                  setFilters({ tickers: [], portfolio: "", category: "", dataType: "", q: "" });
                }}
                className="ml-auto text-xs text-muted hover:text-foreground"
              >
                Clear filters
              </button>
            )}
          </div>
        </section>
      )}

      <div className="mb-3 flex items-center justify-between text-xs text-muted">
        <span>{meta && filters ? `${total} post${total === 1 ? "" : "s"}` : "Loading…"}</span>
        {meta?.isAdmin && (
          <button onClick={() => setEditing("new")} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white">
            + New post
          </button>
        )}
      </div>

      <div className="space-y-3">
        {posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            categories={meta?.categories ?? []}
            dataTypes={meta?.dataTypes ?? []}
            folders={folders}
            onTicker={(t) => filters && !filters.tickers.includes(t) && update({ tickers: [...filters.tickers, t] })}
            onCategory={(id) => update({ category: id })}
            onDataType={(id) => update({ dataType: id })}
            onSaveToggle={(folderId, saved) => toggleSave(p.id, folderId, saved)}
            onCreateFolder={createFolder}
            onEdit={meta?.isAdmin ? () => setEditing(p) : undefined}
            onDelete={meta?.isAdmin ? () => remove(p) : undefined}
          />
        ))}
      </div>

      {!loading && meta && filters && posts.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
          {active
            ? filters.portfolio === WATCHLIST && watchlist.length === 0
              ? "Your watchlist is empty — follow tickers from the ShadowData search page."
              : "No posts match these filters."
            : "Nothing in the feed yet. Posts appear here as GrokBot finds them."}
        </div>
      )}

      {posts.length < total && (
        <div className="mt-4 text-center">
          <button
            onClick={() => filters && load(filters, posts.length)}
            disabled={loading}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted hover:text-foreground disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      {editing && meta && (
        <PostEditor
          post={editing === "new" ? null : editing}
          categories={meta.categories}
          dataTypes={meta.dataTypes}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setPosts((ps) => (ps.some((x) => x.id === saved.id) ? ps.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...ps]));
            if (editing === "new") setTotal((t) => t + 1);
            setEditing(null);
            reloadMeta();
          }}
        />
      )}
    </main>
  );
}
