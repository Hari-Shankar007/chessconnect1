import { useCallback, useEffect, useState } from "react";
import {
  X, Loader2, Plus, Trash2, TrendingUp, FileText, Swords, Trophy,
  CheckCircle2, Circle, Calendar, Save,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ChatPartner, RatingEntry, Worksheet, GamesPlayed, TournamentParticipation, Tournament } from "@/lib/types";
import { initials } from "@/lib/utils";

interface Props {
  onClose: () => void;
  partners: ChatPartner[];
}

type Tab = "rating" | "worksheets" | "games" | "tournaments";

export default function PerformancePanel({ onClose, partners }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(partners[0]?.student_id ?? null);
  const [tab, setTab] = useState<Tab>("rating");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-600" />
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Performance Tracking</h2>
              <p className="text-sm text-slate-500">Track ratings, worksheets, games, and tournaments for each student</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Student list */}
          <aside className="w-56 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50">
            {partners.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-400">No students yet.</p>
            ) : (
              partners.map((p) => (
                <button
                  key={p.student_id}
                  onClick={() => setSelectedId(p.student_id)}
                  className={`flex w-full items-center gap-3 border-l-2 px-4 py-3 text-left transition ${
                    selectedId === p.student_id
                      ? "border-emerald-600 bg-emerald-50"
                      : "border-transparent hover:bg-slate-100"
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                    {initials(p.student_name)}
                  </div>
                  <span className="truncate text-sm font-medium text-slate-700">{p.student_name}</span>
                </button>
              ))
            )}
          </aside>

          {/* Main panel */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {selectedId ? (
              <>
                {/* Tabs */}
                <div className="flex gap-1 border-b border-slate-200 bg-white px-4 pt-3">
                  <TabBtn active={tab === "rating"} onClick={() => setTab("rating")} icon={<TrendingUp className="h-4 w-4" />} label="Rating" />
                  <TabBtn active={tab === "worksheets"} onClick={() => setTab("worksheets")} icon={<FileText className="h-4 w-4" />} label="Worksheets" />
                  <TabBtn active={tab === "games"} onClick={() => setTab("games")} icon={<Swords className="h-4 w-4" />} label="Games" />
                  <TabBtn active={tab === "tournaments"} onClick={() => setTab("tournaments")} icon={<Trophy className="h-4 w-4" />} label="Tournaments" />
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                  {tab === "rating" && <RatingTab studentId={selectedId} />}
                  {tab === "worksheets" && <WorksheetsTab studentId={selectedId} />}
                  {tab === "games" && <GamesTab studentId={selectedId} />}
                  {tab === "tournaments" && <TournamentsTab studentId={selectedId} />}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
                Select a student to view their performance.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
        active ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/* ===== Rating Tab ===== */
function RatingTab({ studentId }: { studentId: string }) {
  const [entries, setEntries] = useState<RatingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("rating_entries")
      .select("id, student_id, rating, month, created_at, created_by")
      .eq("student_id", studentId)
      .order("month", { ascending: true });
    setEntries((data as RatingEntry[]) || []);
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!rating || !month) return;
    setBusy(true);
    setError(null);
    const monthDate = `${month}-01`;
    const { error } = await supabase
      .from("rating_entries")
      .upsert({ student_id: studentId, rating: parseInt(rating, 10), month: monthDate }, { onConflict: "student_id,month" });
    if (error) setError(error.message);
    else { setRating(""); }
    setBusy(false);
    load();
  }

  async function remove(id: string) {
    await supabase.from("rating_entries").delete().eq("id", id);
    load();
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      {/* Graph */}
      <RatingGraph entries={entries} />

      {/* Add form */}
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            required
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Rating</label>
          <input
            type="number"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            placeholder="e.g. 1200"
            required
            className="w-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Log rating
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {/* List */}
      {entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No ratings logged yet.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2.5">
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500">{formatMonth(e.month)}</span>
                <span className="font-semibold text-slate-800">{e.rating}</span>
              </div>
              <button
                onClick={() => remove(e.id)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RatingGraph({ entries }: { entries: RatingEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400">
        Rating graph will appear here once you log ratings.
      </div>
    );
  }

  const W = 600;
  const H = 220;
  const padL = 50;
  const padR = 20;
  const padT = 20;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const ratings = entries.map((e) => e.rating);
  const minR = Math.min(...ratings);
  const maxR = Math.max(...ratings);
  const range = maxR - minR || 1;
  const pad = Math.max(Math.round(range * 0.15), 20);
  const yMin = minR - pad;
  const yMax = maxR + pad;
  const yRange = yMax - yMin || 1;

  const xStep = entries.length > 1 ? plotW / (entries.length - 1) : 0;

  const points = entries.map((e, i) => {
    const x = padL + i * xStep;
    const y = padT + plotH - ((e.rating - yMin) / yRange) * plotH;
    return { x, y, ...e };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${padT + plotH} L ${padL} ${padT + plotH} Z`;

  // Y-axis ticks
  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => Math.round(yMin + (yRange * i) / yTicks));

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 400 }}>
        {/* Grid lines + Y labels */}
        {tickVals.map((tv, i) => {
          const y = padT + plotH - ((tv - yMin) / yRange) * plotH;
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#f1f5f9" strokeWidth={1} />
              <text x={padL - 8} y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{tv}</text>
            </g>
          );
        })}

        {/* Area + line */}
        <path d={areaD} fill="rgba(16,185,129,0.10)" />
        <path d={pathD} fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* Points + X labels */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={4} fill="#10b981" stroke="white" strokeWidth={2} />
            <text x={p.x} y={H - padB + 16} textAnchor="middle" className="fill-slate-500 text-[10px]">
              {formatMonthShort(p.month)}
            </text>
            <text x={p.x} y={p.y - 10} textAnchor="middle" className="fill-slate-700 text-[10px] font-semibold">
              {p.rating}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ===== Worksheets Tab ===== */
function WorksheetsTab({ studentId }: { studentId: string }) {
  const [items, setItems] = useState<Worksheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("worksheets")
      .select("id, student_id, title, completed, assigned_at, deadline, created_at, created_by")
      .eq("student_id", studentId)
      .order("assigned_at", { ascending: false });
    setItems((data as Worksheet[]) || []);
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("worksheets").insert({
      student_id: studentId,
      title: title.trim(),
      deadline: deadline || null,
    });
    if (error) setError(error.message);
    else { setTitle(""); setDeadline(""); }
    setBusy(false);
    load();
  }

  async function toggle(id: string, current: boolean) {
    await supabase.from("worksheets").update({ completed: !current }).eq("id", id);
    load();
  }

  async function remove(id: string) {
    await supabase.from("worksheets").delete().eq("id", id);
    load();
  }

  if (loading) return <Spinner />;

  const completedCount = items.filter((w) => w.completed).length;

  return (
    <div className="space-y-5">
      <div className="flex gap-4">
        <StatCard label="Total Worksheets" value={items.length} icon={<FileText className="h-4 w-4" />} color="emerald" />
        <StatCard label="Completed" value={completedCount} icon={<CheckCircle2 className="h-4 w-4" />} color="emerald" />
      </div>

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-500">Worksheet name</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Endgame Tactics #3"
            required
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Deadline (optional)</label>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Assign
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No worksheets assigned yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((w) => (
            <div key={w.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3">
              <button onClick={() => toggle(w.id, w.completed)} className="shrink-0">
                {w.completed ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <Circle className="h-5 w-5 text-slate-300" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${w.completed ? "text-slate-400 line-through" : "text-slate-800"}`}>{w.title}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span>Given: {formatDate(w.assigned_at)}</span>
                  {w.deadline && (
                    <span className={`flex items-center gap-1 ${isOverdue(w.deadline) && !w.completed ? "text-red-500" : ""}`}>
                      <Calendar className="h-3 w-3" /> Due: {formatDate(w.deadline)}
                    </span>
                  )}
                  {w.completed && <span className="text-emerald-600">Completed</span>}
                </div>
              </div>
              <button
                onClick={() => remove(w.id)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== Games Tab ===== */
function GamesTab({ studentId }: { studentId: string }) {
  const [items, setItems] = useState<GamesPlayed[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("games_played")
      .select("id, student_id, count, month, created_at, created_by")
      .eq("student_id", studentId)
      .order("month", { ascending: false });
    setItems((data as GamesPlayed[]) || []);
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!count || !month) return;
    setBusy(true);
    setError(null);
    const monthDate = `${month}-01`;
    const { error } = await supabase
      .from("games_played")
      .upsert({ student_id: studentId, count: parseInt(count, 10), month: monthDate }, { onConflict: "student_id,month" });
    if (error) setError(error.message);
    else { setCount(""); }
    setBusy(false);
    load();
  }

  async function remove(id: string) {
    await supabase.from("games_played").delete().eq("id", id);
    load();
  }

  if (loading) return <Spinner />;

  const total = items.reduce((sum, g) => sum + g.count, 0);

  return (
    <div className="space-y-5">
      <div className="flex gap-4">
        <StatCard label="Total Games" value={total} icon={<Swords className="h-4 w-4" />} color="emerald" />
        <StatCard label="Months Tracked" value={items.length} icon={<Calendar className="h-4 w-4" />} color="slate" />
      </div>

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            required
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Games played</label>
          <input
            type="number"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            placeholder="e.g. 15"
            required
            className="w-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Log games
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No games logged yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((g) => (
            <div key={g.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2.5">
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500">{formatMonth(g.month)}</span>
                <span className="font-semibold text-slate-800">{g.count} games</span>
              </div>
              <button
                onClick={() => remove(g.id)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== Tournaments Tab ===== */
function TournamentsTab({ studentId }: { studentId: string }) {
  const [items, setItems] = useState<TournamentParticipation[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [playedAt, setPlayedAt] = useState(new Date().toISOString().slice(0, 10));
  const [tournamentId, setTournamentId] = useState("");

  const load = useCallback(async () => {
    const [partRes, tourRes] = await Promise.all([
      supabase
        .from("tournament_participation")
        .select("id, student_id, tournament_id, title, played_at, created_at, created_by")
        .eq("student_id", studentId)
        .order("played_at", { ascending: false }),
      supabase.from("tournaments").select("id, title, link_url, event_date, description, created_at, created_by").order("event_date", { ascending: false }),
    ]);
    setItems((partRes.data as TournamentParticipation[]) || []);
    setTournaments((tourRes.data as Tournament[]) || []);
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !playedAt) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("tournament_participation").insert({
      student_id: studentId,
      tournament_id: tournamentId || null,
      title: title.trim(),
      played_at: playedAt,
    });
    if (error) setError(error.message);
    else { setTitle(""); setTournamentId(""); }
    setBusy(false);
    load();
  }

  async function remove(id: string) {
    await supabase.from("tournament_participation").delete().eq("id", id);
    load();
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <StatCard label="Tournaments Played" value={items.length} icon={<Trophy className="h-4 w-4" />} color="amber" />

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-500">Tournament name</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. City Open 2026"
            required
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        {tournaments.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Link to calendar (optional)</label>
            <select
              value={tournamentId}
              onChange={(e) => { setTournamentId(e.target.value); if (e.target.value) { const t = tournaments.find((x) => x.id === e.target.value); if (t) setTitle(t.title); } }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            >
              <option value="">— None —</option>
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Date played</label>
          <input
            type="date"
            value={playedAt}
            onChange={(e) => setPlayedAt(e.target.value)}
            required
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No tournaments logged yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                <Trophy className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">{t.title}</p>
                <span className="text-xs text-slate-400">{formatDate(t.played_at)}</span>
              </div>
              <button
                onClick={() => remove(t.id)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== Shared ===== */
function Spinner() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: "emerald" | "slate" | "amber" }) {
  const colors = {
    emerald: "bg-emerald-50 text-emerald-700",
    slate: "bg-slate-100 text-slate-600",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${colors[color]}`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function formatMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "long", year: "numeric" });
}

function formatMonthShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function isOverdue(dateStr: string): boolean {
  return new Date(dateStr) < new Date(new Date().toDateString());
}
