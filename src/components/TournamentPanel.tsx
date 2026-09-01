import { useEffect, useState } from "react";
import { X, Loader2, Plus, Trash2, Calendar, ExternalLink, Clock, MapPin, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Tournament } from "@/lib/types";

interface Props {
  onClose: () => void;
}

export default function TournamentPanel({ onClose }: Props) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form — coach enters date/time in their own local timezone; we store as UTC
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    loadTournaments();

    const channel = supabase
      .channel("tournaments-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournaments" },
        () => loadTournaments()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadTournaments() {
    const { data, error } = await supabase
      .from("tournaments")
      .select("id, title, link_url, event_date, description, created_at, created_by")
      .order("event_date", { ascending: true });
    if (!error && data) setTournaments(data as Tournament[]);
    setLoading(false);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !link.trim() || !date || !time) return;
    setBusy(true);
    setError(null);

    // Combine the coach's local date + time into a single local datetime,
    // then let JS convert to ISO (UTC) for storage.
    const local = new Date(`${date}T${time}`);
    if (isNaN(local.getTime())) {
      setError("Invalid date or time.");
      setBusy(false);
      return;
    }

    const { error } = await supabase.from("tournaments").insert({
      title: title.trim(),
      link_url: link.trim(),
      event_date: local.toISOString(),
      description: desc.trim() || null,
    });

    if (error) {
      setError(error.message);
    } else {
      setTitle("");
      setLink("");
      setDate("");
      setTime("");
      setDesc("");
    }
    setBusy(false);
  }

  async function remove(id: string) {
    await supabase.from("tournaments").delete().eq("id", id);
  }

  // Format the stored UTC time into the coach's local timezone for display
  function localDisplay(iso: string) {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
      time: d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    };
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-emerald-600" />
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Tournament Calendar</h2>
              <p className="text-sm text-slate-500">Schedule tournaments with links for your students</p>
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
            <h3 className="text-sm font-semibold text-slate-700">Schedule Tournament</h3>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tournament title"
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Tournament / join link (https://…)"
              type="url"
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-500">Date (your local time)</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-500">Time (your local time)</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </div>
            </div>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add tournament
            </button>
          </form>

          {/* List */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : tournaments.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No tournaments scheduled yet.</p>
          ) : (
            <div className="space-y-3">
              {tournaments.map((t) => {
                const d = localDisplay(t.event_date);
                return (
                  <div
                    key={t.id}
                    className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-slate-300"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                      <Calendar className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800">{t.title}</p>
                      {t.description && <p className="mt-0.5 text-sm text-slate-500">{t.description}</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-3">
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Calendar className="h-3 w-3" /> {d.date}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Clock className="h-3 w-3" /> {d.time}
                        </span>
                        <a
                          href={t.link_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
                        >
                          <ExternalLink className="h-3 w-3" /> Open link
                        </a>
                      </div>
                    </div>
                    <button
                      onClick={() => remove(t.id)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
