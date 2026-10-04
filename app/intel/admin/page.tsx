"use client";

import { useEffect, useState } from "react";
import { api, useMeta, IntelNav, PostEditor, fmtDate, type Post, type Meta, type Category, type Portfolio } from "../shared";

type Tab = "posts" | "categories" | "tickers" | "portfolios";

const input = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent";
const btn = "rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground";
const dangerBtn = "rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:border-bear/50 hover:text-bear";

export default function IntelAdmin() {
  const { meta, error: metaError, reload } = useMeta();
  const [tab, setTab] = useState<Tab>("posts");
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (meta && !meta.isAdmin) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <IntelNav active="admin" isAdmin={false} />
        <p className="text-sm text-muted">Only OxfordHub admins can manage the Intelligence Feed.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <IntelNav active="admin" isAdmin />
      {(metaError || error) && (
        <div className="mb-4 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{metaError || error}</div>
      )}
      <div className="mb-5 flex gap-1 border-b border-border">
        {(["posts", "categories", "tickers", "portfolios"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm capitalize ${tab === t ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {!meta && <p className="text-sm text-muted">Loading…</p>}
      {meta && tab === "posts" && <PostsTab meta={meta} run={run} onError={setError} />}
      {meta && tab === "categories" && <CategoriesTab categories={meta.categories} run={run} />}
      {meta && tab === "tickers" && <TickersTab meta={meta} run={run} />}
      {meta && tab === "portfolios" && <PortfoliosTab portfolios={meta.portfolios} run={run} />}
    </main>
  );
}

type Run = (fn: () => Promise<unknown>) => Promise<void>;

function PostsTab({ meta, run, onError }: { meta: Meta; run: Run; onError: (e: string) => void }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Post | "new" | null>(null);

  const load = (query = q) =>
    api<{ posts: Post[]; total: number }>(`/api/intel/posts?hidden=1&limit=100&q=${encodeURIComponent(query)}`)
      .then((d) => {
        setPosts(d.posts);
        setTotal(d.total);
      })
      .catch((e: Error) => onError(e.message));

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const catName = (id: string) => meta.categories.find((c) => c.id === id)?.name;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${input} w-64`} placeholder="Search posts…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        <span className="text-xs text-muted">
          {total} post{total === 1 ? "" : "s"}
          {total > posts.length ? ` (showing newest ${posts.length})` : ""}
        </span>
        <button onClick={() => setEditing("new")} className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white">
          + New post
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">Post</th>
              <th className="px-3 py-2">Tickers</th>
              <th className="px-3 py-2">Categories</th>
              <th className="px-3 py-2">Published</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id} className={`border-t border-border ${p.hidden ? "opacity-60" : ""}`}>
                <td className="max-w-sm px-3 py-2">
                  <div className="truncate font-medium">{p.title}</div>
                  <div className="text-[11px] text-muted">
                    by {p.author}
                    {p.hidden && <span className="ml-1 text-neutral">· hidden</span>}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-accent">{p.tickers.join(", ")}</td>
                <td className="px-3 py-2 text-xs text-muted">{p.categoryIds.map(catName).filter(Boolean).join(", ")}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{fmtDate(p.publishedAt)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <button className={btn} onClick={() => setEditing(p)}>Edit</button>
                    <button
                      className={btn}
                      onClick={() => run(async () => {
                        const d = await api<{ post: Post }>(`/api/intel/posts/${p.id}`, { method: "PATCH", json: { hidden: !p.hidden } });
                        setPosts((ps) => ps.map((x) => (x.id === p.id ? d.post : x)));
                      })}
                    >
                      {p.hidden ? "Unhide" : "Hide"}
                    </button>
                    <button
                      className={dangerBtn}
                      onClick={() => confirm(`Delete "${p.title}"? This can't be undone.`) && run(async () => {
                        await api(`/api/intel/posts/${p.id}`, { method: "DELETE" });
                        setPosts((ps) => ps.filter((x) => x.id !== p.id));
                        setTotal((t) => t - 1);
                      })}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {posts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted">No posts.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <PostEditor
          post={editing === "new" ? null : editing}
          categories={meta.categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            run(() => load());
          }}
        />
      )}
    </section>
  );
}

function CategoriesTab({ categories, run }: { categories: Category[]; run: Run }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  return (
    <section className="max-w-2xl">
      <div className="mb-4 flex gap-2">
        <input className={`${input} flex-1`} placeholder="Category name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-10 cursor-pointer rounded border border-border bg-surface" />
        <button
          className="rounded-lg bg-accent px-3 text-sm text-white disabled:opacity-50"
          disabled={!name.trim()}
          onClick={() => run(async () => {
            await api("/api/intel/categories", { method: "POST", json: { name, color } });
            setName("");
          })}
        >
          Add
        </button>
      </div>
      <div className="space-y-2">
        {categories.map((c) => (
          <CategoryRow key={`${c.id}:${c.name}`} cat={c} others={categories.filter((x) => x.id !== c.id)} run={run} />
        ))}
        {categories.length === 0 && <p className="text-sm text-muted">No categories yet. GrokBot creates them as it posts, or add one above.</p>}
      </div>
    </section>
  );
}

function CategoryRow({ cat, others, run }: { cat: Category; others: Category[]; run: Run }) {
  const [name, setName] = useState(cat.name);
  const [mergeInto, setMergeInto] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
      <input
        type="color"
        value={cat.color}
        onChange={(e) => run(() => api(`/api/intel/categories/${cat.id}`, { method: "PATCH", json: { color: e.target.value } }))}
        className="h-8 w-9 cursor-pointer rounded border border-border bg-surface"
      />
      <input className={`${input} flex-1`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      <span className="text-xs text-muted">{cat.postCount} posts</span>
      {name.trim() && name !== cat.name && (
        <button className={btn} onClick={() => run(() => api(`/api/intel/categories/${cat.id}`, { method: "PATCH", json: { name } }))}>
          Save
        </button>
      )}
      <select className={`${input} text-xs`} value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
        <option value="">Delete (untag posts)</option>
        {others.map((o) => (
          <option key={o.id} value={o.id}>Merge into {o.name}</option>
        ))}
      </select>
      <button
        className={dangerBtn}
        onClick={() => {
          const target = others.find((o) => o.id === mergeInto);
          const msg = target
            ? `Merge "${cat.name}" into "${target.name}"? Its ${cat.postCount} posts move over.`
            : `Delete "${cat.name}"? Its ${cat.postCount} posts lose this category.`;
          if (confirm(msg))
            run(() => api(`/api/intel/categories/${cat.id}${mergeInto ? `?mergeInto=${mergeInto}` : ""}`, { method: "DELETE" }));
        }}
      >
        {mergeInto ? "Merge" : "Delete"}
      </button>
    </div>
  );
}

function TickersTab({ meta, run }: { meta: Meta; run: Run }) {
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const shown = meta.tickers.filter(
    (t) => !filter || t.symbol.includes(filter.toUpperCase()) || (t.name ?? "").toLowerCase().includes(filter.toLowerCase())
  );
  return (
    <section className="max-w-3xl">
      <div className="mb-4 flex flex-wrap gap-2">
        <input className={`${input} w-28`} placeholder="Symbol" value={symbol} maxLength={12} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        <input className={`${input} flex-1`} placeholder="Company name (optional)" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        <button
          className="rounded-lg bg-accent px-3 text-sm text-white disabled:opacity-50"
          disabled={!symbol.trim()}
          onClick={() => run(async () => {
            await api("/api/intel/tickers", { method: "POST", json: { symbol, name } });
            setSymbol("");
            setName("");
          })}
        >
          Add
        </button>
        <input className={`${input} w-40`} placeholder="Filter list…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <p className="mb-3 text-xs text-muted">
        Changing a symbol rewrites it on every post and portfolio. Changing it to a symbol that already exists merges the two.
      </p>
      <div className="space-y-2">
        {shown.map((t) => (
          <TickerRow key={`${t.symbol}:${t.name ?? ""}`} ticker={t} run={run} />
        ))}
        {meta.tickers.length === 0 && <p className="text-sm text-muted">No tickers yet. They&apos;re added automatically as posts are tagged.</p>}
      </div>
    </section>
  );
}

function TickerRow({ ticker, run }: { ticker: Meta["tickers"][number]; run: Run }) {
  const [symbol, setSymbol] = useState(ticker.symbol);
  const [name, setName] = useState(ticker.name ?? "");
  const dirty = symbol !== ticker.symbol || name !== (ticker.name ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
      <input className={`${input} w-28 font-medium text-accent`} value={symbol} maxLength={12} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
      <input className={`${input} flex-1`} placeholder="Company name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      <span className="w-16 text-xs text-muted">{ticker.postCount} posts</span>
      {dirty && (
        <button
          className={btn}
          onClick={() => {
            if (symbol !== ticker.symbol && !confirm(`Rename ${ticker.symbol} → ${symbol} on every post and portfolio?`)) return;
            run(() => api(`/api/intel/tickers/${encodeURIComponent(ticker.symbol)}`, { method: "PATCH", json: { symbol, name } }));
          }}
        >
          Save
        </button>
      )}
      <button
        className={dangerBtn}
        onClick={() =>
          confirm(`Delete ${ticker.symbol}? It's removed from ${ticker.postCount} posts and every portfolio (the posts stay).`) &&
          run(() => api(`/api/intel/tickers/${encodeURIComponent(ticker.symbol)}`, { method: "DELETE" }))
        }
      >
        Delete
      </button>
    </div>
  );
}

function PortfoliosTab({ portfolios, run }: { portfolios: Portfolio[]; run: Run }) {
  const [name, setName] = useState("");
  const [tickers, setTickers] = useState("");
  return (
    <section className="max-w-3xl">
      <p className="mb-3 text-xs text-muted">
        A portfolio is a named group of tickers. Filtering the feed by a portfolio shows every post tagged with any of its tickers.
        Each user&apos;s own ShadowData watchlist is always available as &ldquo;My watchlist&rdquo;.
      </p>
      <div className="mb-4 space-y-2 rounded-xl border border-border bg-surface p-3">
        <input className={`${input} w-full`} placeholder="Portfolio name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <textarea className={`${input} w-full`} rows={2} placeholder="Tickers, comma-separated" value={tickers} onChange={(e) => setTickers(e.target.value.toUpperCase())} />
        <button
          className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
          disabled={!name.trim()}
          onClick={() => run(async () => {
            await api("/api/intel/portfolios", { method: "POST", json: { name, tickers } });
            setName("");
            setTickers("");
          })}
        >
          Create portfolio
        </button>
      </div>
      <div className="space-y-2">
        {portfolios.map((p) => (
          <PortfolioRow key={`${p.id}:${p.name}:${p.tickers.join()}`} pf={p} run={run} />
        ))}
      </div>
    </section>
  );
}

function PortfolioRow({ pf, run }: { pf: Portfolio; run: Run }) {
  const [name, setName] = useState(pf.name);
  const [tickers, setTickers] = useState(pf.tickers.join(", "));
  const dirty = name !== pf.name || tickers !== pf.tickers.join(", ");
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
      <div className="flex gap-2">
        <input className={`${input} flex-1 font-medium`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        {dirty && (
          <button className={btn} onClick={() => run(() => api(`/api/intel/portfolios/${pf.id}`, { method: "PATCH", json: { name, tickers } }))}>
            Save
          </button>
        )}
        <button
          className={dangerBtn}
          onClick={() => confirm(`Delete the portfolio "${pf.name}"? Posts and tickers are not affected.`) && run(() => api(`/api/intel/portfolios/${pf.id}`, { method: "DELETE" }))}
        >
          Delete
        </button>
      </div>
      <textarea className={`${input} w-full text-xs`} rows={2} value={tickers} onChange={(e) => setTickers(e.target.value.toUpperCase())} />
    </div>
  );
}
