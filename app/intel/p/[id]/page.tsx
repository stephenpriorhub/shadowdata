"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, useMeta, useFolders, IntelNav, PostCard, PostEditor, type Post, type Folder } from "../../shared";

/** A single post's own page — the shareable link (/intel/p/<id>). */
export default function IntelPostPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { meta, reload: reloadMeta } = useMeta();
  const { folders, setFolders } = useFolders();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api<{ post: Post }>(`/api/intel/posts/${id}`)
      .then((d) => setPost(d.post))
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (post) document.title = `${post.title} · ShadowData Intelligence`;
  }, [post]);

  const toggleSave = async (folderId: string, saved: boolean) => {
    try {
      const d = await api<{ folder: Folder }>(`/api/intel/folders/${folderId}/posts`, {
        method: "POST",
        json: { postId: id, saved },
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

  const remove = async () => {
    if (!post || !confirm(`Delete "${post.title}"? This can't be undone.`)) return;
    try {
      await api(`/api/intel/posts/${post.id}`, { method: "DELETE" });
      router.push("/intel");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <IntelNav active="feed" isAdmin={!!meta?.isAdmin} />
      <Link href="/intel" className="mb-4 inline-block text-sm text-muted hover:text-foreground">
        ← Back to the feed
      </Link>

      {error && (
        <div className="mb-4 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">
          {error === "Post not found." ? "This post doesn't exist or has been removed." : error}
        </div>
      )}
      {!post && !error && <p className="text-sm text-muted">Loading…</p>}

      {post && (
        <PostCard
          full
          post={post}
          categories={meta?.categories ?? []}
          dataTypes={meta?.dataTypes ?? []}
          folders={folders}
          onTicker={(t) => router.push(`/intel?ticker=${t}`)}
          onCategory={(c) => router.push(`/intel?category=${c}`)}
          onDataType={(c) => router.push(`/intel?dataType=${c}`)}
          onSaveToggle={toggleSave}
          onCreateFolder={createFolder}
          onEdit={meta?.isAdmin ? () => setEditing(true) : undefined}
          onDelete={meta?.isAdmin ? remove : undefined}
        />
      )}

      {editing && post && meta && (
        <PostEditor
          post={post}
          categories={meta.categories}
          dataTypes={meta.dataTypes}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setPost(saved);
            setEditing(false);
            reloadMeta();
          }}
        />
      )}
    </main>
  );
}
