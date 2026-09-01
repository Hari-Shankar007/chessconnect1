import { useEffect, useState, useRef } from "react";
import { X, Loader2, Plus, Trash2, FileText, ExternalLink, BookOpen, ImagePlus, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Article } from "@/lib/types";
import { formatTime } from "@/lib/utils";

interface Props {
  onClose: () => void;
}

export default function ArticlesPanel({ onClose }: Props) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadArticles();

    const channel = supabase
      .channel("articles-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "articles" },
        () => loadArticles()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadArticles() {
    const { data, error } = await supabase
      .from("articles")
      .select("id, title, body, link_url, image_url, created_at, created_by")
      .order("created_at", { ascending: false });
    if (!error && data) setArticles(data as Article[]);
    setLoading(false);
  }

  function onImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5 MB.");
      return;
    }
    setError(null);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function clearImage() {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadImage(file: File): Promise<string | null> {
    const ext = file.name.split(".").pop() || "jpg";
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
    const path = fileName;
    const { error: upErr } = await supabase.storage
      .from("article-images")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw new Error(upErr.message);
    const { data: pub } = supabase.storage.from("article-images").getPublicUrl(path);
    return pub.publicUrl;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      let imageUrl: string | null = null;
      if (imageFile) {
        imageUrl = await uploadImage(imageFile);
      }
      const { error } = await supabase.from("articles").insert({
        title: title.trim(),
        body: body.trim() || null,
        link_url: link.trim() || null,
        image_url: imageUrl,
      });
      if (error) throw new Error(error.message);
      setTitle("");
      setBody("");
      setLink("");
      clearImage();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, imageUrl?: string | null) {
    if (imageUrl) {
      const path = imageUrl.split("/article-images/")[1];
      if (path) {
        await supabase.storage.from("article-images").remove([path]);
      }
    }
    await supabase.from("articles").delete().eq("id", id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-emerald-600" />
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Articles</h2>
              <p className="text-sm text-slate-500">Publish articles with blog links for your students</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Create form */}
          <form onSubmit={create} className="mb-6 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-700">New Article</h3>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Article title"
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Short description (optional)"
              rows={2}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Blog link (https://…)"
              type="url"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />

            {/* Image picker */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onImagePick}
                className="hidden"
              />
              {imagePreview ? (
                <div className="relative overflow-hidden rounded-lg border border-slate-200">
                  <img src={imagePreview} alt="Preview" className="max-h-48 w-full object-cover" />
                  <button
                    type="button"
                    onClick={clearImage}
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-500 transition hover:border-emerald-400 hover:text-emerald-600"
                >
                  <ImagePlus className="h-5 w-5" />
                  Add cover image (optional)
                </button>
              )}
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Publish
            </button>
          </form>

          {/* List */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : articles.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No articles published yet.</p>
          ) : (
            <div className="space-y-3">
              {articles.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-slate-300"
                >
                  {a.image_url ? (
                    <img
                      src={a.image_url}
                      alt={a.title}
                      className="h-16 w-16 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                      <FileText className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800">{a.title}</p>
                    {a.body && <p className="mt-0.5 text-sm text-slate-500">{a.body}</p>}
                    <div className="mt-1 flex items-center gap-3">
                      {a.link_url && (
                        <a
                          href={a.link_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
                        >
                          <ExternalLink className="h-3 w-3" /> Open link
                        </a>
                      )}
                      <span className="text-xs text-slate-400">{formatTime(a.created_at)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => remove(a.id, a.image_url)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
