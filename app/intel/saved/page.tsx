"use client";

import { useEffect, useState } from "react";
import { api, useMeta, useFolders, IntelNav, PostCard, type Post, type Folder } from "../shared";

export default function SavedFolders() {
  const { meta } = useMeta();
  const { folders, setFolders } = useFolders();
  const [chosenId, setActiveId] = useState<string | null>(null);
  // Posts are tagged with the folder they belong to, so a folder switch shows "Loading…" without a reset effect.
  const [loaded, setLoaded] = useState<{ folderId: string; posts: Post[] } | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeId = chosenId && folders.some((f) => f.id === chosenId) ? chosenId : (folders[0]?.id ?? null);
  const posts = loaded && loaded.folderId === activeId ? loaded.posts : null;
  const setPosts = (fn: (ps: Post[] | null) => Post[] | null) =>
    setLoaded((l) => (l ? { folderId: l.folderId, posts: fn(l.posts) ?? [] } : l));

  useEffect(() => {
    if (!activeId) return;
    api<{ posts: Post[] }>(`/api/intel/folders/${activeId}`)
      .then((d) => setLoaded({ folderId: activeId, posts: d.posts }))
      .catch((e: Error) => setError(e.message));
  }, [activeId]);

  const active = folders.find((f) => f.id === activeId) ?? null;

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const create = () =>
    run(async () => {
      if (!newName.trim()) return;
      const d = await api<{ folder: Folder }>("/api/intel/folders", { method: "POST", json: { name: newName.trim() } });
      setFolders((fs) => [...fs, d.folder].sort((a, b) => a.name.localeCompare(b.name)));
      setActiveId(d.folder.id);
      setNewName("");
    });

  const rename = (id: string, name: string) =>
    run(async () => {
      const d = await api<{ folder: Folder }>(`/api/intel/folders/${id}`, { method: "PATCH", json: { name } });
      setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, name: d.folder.name } : f)));
      setRenaming(null);
    });

  const remove = (f: Folder) =>
    run(async () => {
      if (!confirm(`Delete the folder "${f.name}"? The posts stay in the feed.`)) return;
      await api(`/api/intel/folders/${f.id}`, { method: "DELETE" });
      setFolders((fs) => fs.filter((x) => x.id !== f.id));
      setActiveId(null);
    });

  const unsave = (postId: string) =>
    run(async () => {
      if (!activeId) return;
      const d = await api<{ folder: Folder }>(`/api/intel/folders/${activeId}/posts`, {
        method: "POST",
        json: { postId, saved: false },
      });
      setFolders((fs) => fs.map((f) => (f.id === activeId ? d.folder : f)));
      setPosts((ps) => ps?.filter((p) => p.id !== postId) ?? null);
    });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <IntelNav active="saved" isAdmin={!!meta?.isAdmin} />
      {error && <div className="mb-4 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{error}</div>}

      <div className="grid gap-5 md:grid-cols-[220px_1fr]">
        <aside className="space-y-1">
          <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">Your folders</p>
          {folders.map((f) =>
            renaming === f.id ? (
              <input
                key={f.id}
                autoFocus
                defaultValue={f.name}
                maxLength={80}
                className="w-full rounded-lg border border-accent bg-surface px-3 py-1.5 text-sm outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename(f.id, e.currentTarget.value);
                  if (e.key === "Escape") setRenaming(null);
                }}
                onBlur={(e) => (e.currentTarget.value.trim() && e.currentTarget.value !== f.name ? rename(f.id, e.currentTarget.value) : setRenaming(null))}
              />
            ) : (
              <button
                key={f.id}
                onClick={() => setActiveId(f.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm ${f.id === activeId ? "bg-accent/15 text-accent" : "text-foreground/85 hover:bg-surface"}`}
              >
                <span className="truncate">📁 {f.name}</span>
                <span className="text-xs text-muted">{f.postIds.length}</span>
              </button>
            )
          )}
          <div className="flex gap-1 pt-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="New folder"
              maxLength={80}
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
            <button onClick={create} className="rounded-lg bg-accent px-3 text-sm text-white">
              +
            </button>
          </div>
        </aside>

        <section>
          {!active && (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
              {folders.length
                ? "Pick a folder."
                : "No folders yet. Create one here, or hit ☆ Save on any post in the feed."}
            </div>
          )}
          {active && (
            <>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-lg font-semibold">📁 {active.name}</h2>
                <button onClick={() => setRenaming(active.id)} className="ml-auto text-xs text-muted hover:text-foreground">
                  Rename
                </button>
                <button onClick={() => remove(active)} className="text-xs text-muted hover:text-bear">
                  Delete folder
                </button>
              </div>
              {!posts && <p className="text-sm text-muted">Loading…</p>}
              {posts && posts.length === 0 && (
                <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
                  This folder is empty.
                </div>
              )}
              <div className="space-y-3">
                {posts?.map((p) => (
                  <PostCard
                    key={p.id}
                    post={p}
                    categories={meta?.categories ?? []}
                    onTicker={(t) => (window.location.href = `/intel?ticker=${t}`)}
                    onCategory={(id) => (window.location.href = `/intel?category=${id}`)}
                    extraAction={
                      <button onClick={() => unsave(p.id)} className="rounded-md px-2 py-1 text-xs text-muted hover:text-bear">
                        Remove from folder
                      </button>
                    }
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
