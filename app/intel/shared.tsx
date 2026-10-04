"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { IntelPost, IntelCategory, IntelPortfolio, IntelFolder } from "@/lib/intel";

export type Category = IntelCategory & { postCount: number };
export type Ticker = { symbol: string; name: string | null; postCount: number };
export type Portfolio = IntelPortfolio;
export type Folder = IntelFolder;
export type Post = IntelPost;

export interface Meta {
  categories: Category[];
  dataTypes: Category[];
  tickers: Ticker[];
  portfolios: Portfolio[];
  isAdmin: boolean;
}

/** fetch → JSON, throwing the API's `error` message on failure. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function useMeta() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () =>
    api<Meta>("/api/intel/meta")
      .then(setMeta)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    reload();
  }, []);
  return { meta, error, reload };
}

export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const reload = () =>
    api<{ folders: Folder[] }>("/api/intel/folders")
      .then((d) => setFolders(d.folders))
      .catch(() => {});
  useEffect(() => {
    reload();
  }, []);
  return { folders, setFolders, reload };
}

export function IntelNav({ active, isAdmin }: { active: "feed" | "saved" | "admin"; isAdmin: boolean }) {
  const tab = (key: string, href: string, label: string) => (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 text-sm ${active === key ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/" className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground">
          ← ShadowData
        </Link>
        <nav className="ml-auto flex gap-1">
          {tab("feed", "/intel", "Feed")}
          {tab("saved", "/intel/saved", "Saved")}
          {isAdmin && tab("admin", "/intel/admin", "Manage")}
        </nav>
      </div>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">📡 Intelligence Feed</h1>
      <p className="mt-1 text-sm text-muted">
        Market intelligence gathered by GrokBot and curated by the team. Filter by ticker or portfolio and save
        anything worth keeping to a folder.
      </p>
    </header>
  );
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Plain text with bare URLs turned into links. Never renders HTML from the post. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"')\]]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="break-all text-accent hover:underline">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export function PostCard({
  post,
  categories,
  dataTypes = [],
  folders,
  onTicker,
  onCategory,
  onDataType,
  onSaveToggle,
  onCreateFolder,
  onEdit,
  onDelete,
  extraAction,
  full = false,
}: {
  /** full = the post's own page (whole write-up); otherwise a feed blurb linking to it. */
  full?: boolean;
  post: Post;
  categories: Category[];
  dataTypes?: Category[];
  folders?: Folder[];
  onTicker?: (t: string) => void;
  onCategory?: (id: string) => void;
  onDataType?: (id: string) => void;
  onSaveToggle?: (folderId: string, saved: boolean) => void;
  onCreateFolder?: (name: string) => Promise<Folder | null>;
  onEdit?: () => void;
  onDelete?: () => void;
  extraAction?: React.ReactNode;
}) {
  const cats = post.categoryIds.map((id) => categories.find((c) => c.id === id)).filter((c): c is Category => !!c);
  const types = (post.dataTypeIds ?? []).map((id) => dataTypes.find((c) => c.id === id)).filter((c): c is Category => !!c);
  const savedIn = (folders ?? []).filter((f) => f.postIds.includes(post.id));
  return (
    <article className={`rounded-xl border bg-surface p-4 ${post.hidden ? "border-neutral/40 opacity-70" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
        <span>{fmtDate(post.publishedAt)}</span>
        {post.sourceName && <span>· {post.sourceName}</span>}
        <span>· by {post.author}</span>
        {post.hidden && <span className="rounded bg-neutral/15 px-1.5 text-neutral">hidden</span>}
        {cats.map((c) => (
          <button
            key={c.id}
            onClick={() => onCategory?.(c.id)}
            className="rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ background: `${c.color}26`, color: c.color }}
          >
            {c.name}
          </button>
        ))}
        {types.map((c) => (
          <button
            key={c.id}
            onClick={() => onDataType?.(c.id)}
            className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
            style={{ borderColor: c.color, color: c.color }}
            title="Shadow Data Type"
          >
            🛰️ {c.name}
          </button>
        ))}
      </div>
      {full ? (
        <>
          <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight">{post.title}</h1>
          {post.summary && <p className="mt-3 whitespace-pre-line text-base text-foreground/90">{post.summary}</p>}
          {post.body && (
            <div className="mt-4 whitespace-pre-line border-t border-border pt-4 text-sm leading-relaxed text-foreground/85">
              <Linkified text={post.body} />
            </div>
          )}
          {post.bigIdea && (
            <section className="mt-5 rounded-xl border border-accent/40 bg-accent/10 p-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-accent">💡 The Big Idea</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground">{post.bigIdea}</p>
            </section>
          )}
          {post.sourceUrl && (
            <a
              href={post.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-4 inline-block rounded-lg border border-border px-3 py-1.5 text-sm text-accent hover:border-accent/60"
            >
              Read the source{post.sourceName ? ` on ${post.sourceName}` : ""} ↗
            </a>
          )}
        </>
      ) : (
        <>
          <h2 className="mt-1.5 text-base font-semibold leading-snug">
            <Link href={`/intel/p/${post.id}`} className="hover:text-accent">
              {post.title}
            </Link>
          </h2>
          {blurb(post) && (
            <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-sm text-foreground/85">
              {post.bigIdea && <span className="mr-1 font-semibold text-accent">💡 Big idea:</span>}
              {blurb(post)}
            </p>
          )}
          <Link href={`/intel/p/${post.id}`} className="mt-2 inline-block text-xs font-medium text-accent">
            Read full post →
          </Link>
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {post.tickers.map((t) => (
          <button
            key={t}
            onClick={() => onTicker?.(t)}
            className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-accent hover:border-accent/60"
            title={`Filter the feed to ${t}`}
          >
            ${t}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {post.tickers.length === 1 && (
            <Link href={`/?ticker=${post.tickers[0]}`} className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground">
              Analyze {post.tickers[0]}
            </Link>
          )}
          {extraAction}
          <ShareButton postId={post.id} />
          {onEdit && (
            <button onClick={onEdit} className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground">
              Edit
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="rounded-md px-2 py-1 text-xs text-muted hover:text-bear">
              Delete
            </button>
          )}
          {onSaveToggle && folders && (
            <SaveMenu savedIn={savedIn} folders={folders} onToggle={onSaveToggle} onCreate={onCreateFolder} />
          )}
        </div>
      </div>
    </article>
  );
}

/** Feed blurb: the Big Idea, else the summary, else the opening of the body. */
function blurb(post: Post): string {
  if (post.bigIdea) return post.bigIdea;
  if (post.summary) return post.summary;
  const b = post.body.replace(/\s+/g, " ").trim();
  return b.length > 280 ? `${b.slice(0, 280).replace(/\s\S*$/, "")}…` : b;
}

export function postUrl(id: string): string {
  return `${window.location.origin}/intel/p/${id}`;
}

function ShareButton({ postId }: { postId: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const url = typeof window === "undefined" ? "" : postUrl(postId);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      // Clipboard can be blocked (permissions, embedded browsers) — show the link to copy by hand.
      setState("manual");
    }
  };
  return (
    <span className="relative">
      <button onClick={share} className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground" title="Copy a link to this post">
        {state === "copied" ? "✓ Link copied" : "Share"}
      </button>
      {state === "manual" && (
        <span className="absolute right-0 bottom-full z-20 mb-1 flex w-80 items-center gap-1 rounded-lg border border-border bg-surface-2 p-2 shadow-xl">
          <input
            readOnly
            autoFocus
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs outline-none"
          />
          <button onClick={() => setState("idle")} className="px-1 text-xs text-muted hover:text-foreground">
            ✕
          </button>
        </span>
      )}
    </span>
  );
}

function SaveMenu({
  savedIn,
  folders,
  onToggle,
  onCreate,
}: {
  savedIn: Folder[];
  folders: Folder[];
  onToggle: (folderId: string, saved: boolean) => void;
  onCreate?: (name: string) => Promise<Folder | null>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const create = async () => {
    if (!name.trim() || !onCreate) return;
    const f = await onCreate(name.trim());
    if (f) {
      onToggle(f.id, true);
      setName("");
    }
  };
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`rounded-md border px-2.5 py-1 text-xs ${savedIn.length ? "border-accent bg-accent/15 text-accent" : "border-border text-muted hover:text-foreground"}`}
      >
        {savedIn.length ? "★ Saved" : "☆ Save"}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-border bg-surface-2 p-2 shadow-xl">
          <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted">Save to folder</p>
          {folders.length === 0 && <p className="px-1 py-1 text-xs text-muted">No folders yet — create one below.</p>}
          <div className="max-h-56 overflow-y-auto">
            {folders.map((f) => {
              const on = savedIn.some((s) => s.id === f.id);
              return (
                <label key={f.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface">
                  <input type="checkbox" checked={on} onChange={() => onToggle(f.id, !on)} className="accent-[var(--accent)]" />
                  <span className="truncate">{f.name}</span>
                </label>
              );
            })}
          </div>
          {onCreate && (
            <div className="mt-2 flex gap-1 border-t border-border pt-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
                placeholder="New folder name"
                className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
                maxLength={80}
              />
              <button onClick={create} className="rounded bg-accent px-2 py-1 text-xs text-white">
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Create/edit form for a post (admins). `post` null = new post. */
export function PostEditor({
  post,
  categories,
  dataTypes,
  onClose,
  onSaved,
}: {
  post: Post | null;
  categories: Category[];
  dataTypes: Category[];
  onClose: () => void;
  onSaved: (p: Post) => void;
}) {
  const [f, setF] = useState({
    title: post?.title ?? "",
    summary: post?.summary ?? "",
    body: post?.body ?? "",
    bigIdea: post?.bigIdea ?? "",
    sourceUrl: post?.sourceUrl ?? "",
    sourceName: post?.sourceName ?? "",
    tickers: post?.tickers.join(", ") ?? "",
    categoryIds: post?.categoryIds ?? [],
    newCategory: "",
    dataTypeIds: post?.dataTypeIds ?? [],
    newDataType: "",
    hidden: post?.hidden ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    setErr(null);
    const payload = {
      title: f.title,
      summary: f.summary,
      body: f.body,
      bigIdea: f.bigIdea,
      sourceUrl: f.sourceUrl,
      sourceName: f.sourceName,
      tickers: f.tickers,
      categories: [...f.categoryIds, ...(f.newCategory.trim() ? [f.newCategory.trim()] : [])],
      dataTypes: [...f.dataTypeIds, ...(f.newDataType.trim() ? [f.newDataType.trim()] : [])],
      hidden: f.hidden,
    };
    try {
      if (post) {
        const d = await api<{ post: Post }>(`/api/intel/posts/${post.id}`, { method: "PATCH", json: payload });
        onSaved(d.post);
      } else {
        const d = await api<{ created: Post[]; skipped: { reason: string }[] }>("/api/intel/posts", {
          method: "POST",
          json: payload,
        });
        if (!d.created[0]) throw new Error(`Not created: ${d.skipped[0]?.reason ?? "unknown reason"}`);
        onSaved(d.created[0]);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div className="mt-10 w-full max-w-2xl rounded-xl border border-border bg-surface-2 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{post ? "Edit post" : "New post"}</h2>
        <div className="mt-4 space-y-3">
          <Field label="Title">
            <input className={input} value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={300} />
          </Field>
          <Field label="Summary">
            <textarea className={input} rows={3} value={f.summary} onChange={(e) => set("summary", e.target.value)} />
          </Field>
          <Field label="Body">
            <textarea className={input} rows={8} value={f.body} onChange={(e) => set("body", e.target.value)} />
          </Field>
          <Field label="💡 The Big Idea — simplified takeaway + key data (also the feed blurb)">
            <textarea className={input} rows={4} maxLength={1500} value={f.bigIdea} onChange={(e) => set("bigIdea", e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Source URL">
              <input className={input} value={f.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} />
            </Field>
            <Field label="Source name">
              <input className={input} value={f.sourceName} onChange={(e) => set("sourceName", e.target.value)} />
            </Field>
          </div>
          <Field label="Tickers (comma-separated)">
            <input className={input} value={f.tickers} onChange={(e) => set("tickers", e.target.value.toUpperCase())} />
          </Field>
          <Field label="Categories">
            <TagPicker
              terms={categories}
              selected={f.categoryIds}
              onChange={(ids) => set("categoryIds", ids)}
              newValue={f.newCategory}
              onNew={(v) => set("newCategory", v)}
              placeholder="+ new category"
            />
          </Field>
          <Field label="Shadow Data Type">
            <TagPicker
              terms={dataTypes}
              selected={f.dataTypeIds}
              onChange={(ids) => set("dataTypeIds", ids)}
              newValue={f.newDataType}
              onNew={(v) => set("newDataType", v)}
              placeholder="+ new data type"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={f.hidden} onChange={(e) => set("hidden", e.target.checked)} />
            Hidden from the feed
          </label>
        </div>
        {err && <p className="mt-3 text-sm text-bear">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted">
            Cancel
          </button>
          <button onClick={save} disabled={busy || !f.title.trim()} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </div>
  );
}

function TagPicker({
  terms,
  selected,
  onChange,
  newValue,
  onNew,
  placeholder,
}: {
  terms: Category[];
  selected: string[];
  onChange: (ids: string[]) => void;
  newValue: string;
  onNew: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {terms.map((c) => {
        const on = selected.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(on ? selected.filter((x) => x !== c.id) : [...selected, c.id])}
            className="rounded-full border px-2.5 py-0.5 text-xs"
            style={on ? { background: `${c.color}26`, color: c.color, borderColor: c.color } : undefined}
          >
            {c.name}
          </button>
        );
      })}
      <input
        className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs outline-none focus:border-accent"
        placeholder={placeholder}
        value={newValue}
        onChange={(e) => onNew(e.target.value)}
        maxLength={60}
      />
    </div>
  );
}
