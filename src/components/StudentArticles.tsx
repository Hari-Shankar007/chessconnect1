import { useEffect, useState } from "react";
import { BookOpen, ExternalLink, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Article } from "@/lib/types";
import { formatTime } from "@/lib/utils";

export default function StudentArticles() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadArticles();

    const channel = supabase
      .channel("student-articles")
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
    const { data } = await supabase
      .from("articles")
      .select("id, title, body, link_url, image_url, created_at, created_by")
      .order("created_at", { ascending: false });
    setArticles((data as Article[]) || []);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="py-10 text-center">
        <BookOpen className="mx-auto mb-2 h-10 w-10 text-slate-300" />
        <p className="text-sm text-slate-400">No articles yet. Check back soon!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {articles.map((a) => (
        <div
          key={a.id}
          className="overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:border-emerald-200 hover:shadow-sm"
        >
          {a.image_url && (
            <img
              src={a.image_url}
              alt={a.title}
              className="h-40 w-full object-cover"
            />
          )}
          <div className="flex items-start gap-3 p-4">
            {!a.image_url && (
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
                    <ExternalLink className="h-3 w-3" /> Read article
                  </a>
                )}
                <span className="text-xs text-slate-400">{formatTime(a.created_at)}</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
