import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2, TrendingUp, FileText, Swords, Trophy,
  CheckCircle2, Circle, Calendar, Camera, X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { RatingEntry, Worksheet, GamesPlayed, TournamentParticipation } from "@/lib/types";
import { initials } from "@/lib/utils";

export default function StudentPerformance() {
  const { profile } = useAuth();
  const studentId = profile!.id;
  const [ratings, setRatings] = useState<RatingEntry[]>([]);
  const [worksheets, setWorksheets] = useState<Worksheet[]>([]);
  const [games, setGames] = useState<GamesPlayed[]>([]);
  const [tournaments, setTournaments] = useState<TournamentParticipation[]>([]);
  const [loading, setLoading] = useState(true);

  // Profile image
  const [imageUrl, setImageUrl] = useState<string | null>(profile!.image_url);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [r, w, g, t] = await Promise.all([
      supabase.from("rating_entries").select("id, student_id, rating, month, period, created_at, created_by").eq("student_id", studentId).order("month", { ascending: true }),
      supabase.from("worksheets").select("id, student_id, title, completed, assigned_at, deadline, created_at, created_by").eq("student_id", studentId).order("assigned_at", { ascending: false }),
      supabase.from("games_played").select("id, student_id, count, month, created_at, created_by").eq("student_id", studentId).order("month", { ascending: false }),
      supabase.from("tournament_participation").select("id, student_id, tournament_id, title, played_at, created_at, created_by").eq("student_id", studentId).order("played_at", { ascending: false }),
    ]);
    setRatings((r.data as RatingEntry[]) || []);
    setWorksheets((w.data as Worksheet[]) || []);
    setGames((g.data as GamesPlayed[]) || []);
    setTournaments((t.data as TournamentParticipation[]) || []);
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${studentId}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("profile-images").upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("profile-images").getPublicUrl(path);
      const url = pub.publicUrl;
      const { error: dbErr } = await supabase.from("profiles").update({ image_url: url }).eq("id", studentId);
      if (dbErr) throw dbErr;
      setImageUrl(url);
    } catch {
      // ignore — keep old image
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const totalGames = games.reduce((s, g) => s + g.count, 0);
  const completedWs = worksheets.filter((w) => w.completed).length;
  const currentRating = ratings.length > 0 ? ratings[ratings.length - 1].rating : null;

  return (
    <div className="space-y-6">
      {/* Profile card */}
      <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="relative">
          {imageUrl ? (
            <img src={imageUrl} alt={profile!.name} className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-lg font-semibold text-emerald-700">
              {initials(profile!.name)}
            </div>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-white shadow-md transition hover:bg-emerald-700 disabled:opacity-50"
            title="Change profile photo"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={onImagePick} className="hidden" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-800">{profile!.name}</h3>
          <p className="text-sm text-slate-500">Student</p>
          {currentRating !== null && (
            <p className="mt-1 text-sm font-medium text-emerald-600">Current rating: {currentRating}</p>
          )}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Current Rating" value={currentRating ?? "—"} icon={<TrendingUp className="h-4 w-4" />} color="emerald" />
        <StatCard label="Games Played" value={totalGames} icon={<Swords className="h-4 w-4" />} color="slate" />
        <StatCard label="Worksheets Done" value={`${completedWs}/${worksheets.length}`} icon={<FileText className="h-4 w-4" />} color="emerald" />
        <StatCard label="Tournaments" value={tournaments.length} icon={<Trophy className="h-4 w-4" />} color="amber" />
      </div>

      {/* Rating graph */}
      <Section title="Rating Progress" icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}>
        <StudentRatingGraph entries={ratings} />
      </Section>

      {/* Worksheets */}
      <Section title="Worksheets" icon={<FileText className="h-4 w-4 text-emerald-600" />}>
        {worksheets.length === 0 ? (
          <Empty text="No worksheets assigned yet." />
        ) : (
          <div className="space-y-2">
            {worksheets.map((w) => (
              <div key={w.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3">
                {w.completed ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
                <div className="min-w-0 flex-1">
                  <p className={`font-medium ${w.completed ? "text-slate-400 line-through" : "text-slate-800"}`}>{w.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span>Given: {fmtDate(w.assigned_at)}</span>
                    {w.deadline && (
                      <span className={`flex items-center gap-1 ${isOverdue(w.deadline) && !w.completed ? "text-red-500" : ""}`}>
                        <Calendar className="h-3 w-3" /> Due: {fmtDate(w.deadline)}
                      </span>
                    )}
                    {w.completed && <span className="text-emerald-600">Completed</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Games */}
      <Section title="Games Played" icon={<Swords className="h-4 w-4 text-emerald-600" />}>
        {games.length === 0 ? (
          <Empty text="No games logged yet." />
        ) : (
          <div className="space-y-2">
            {games.map((g) => (
              <div key={g.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2.5">
                <span className="text-sm text-slate-500">{fmtMonth(g.month)}</span>
                <span className="font-semibold text-slate-800">{g.count} games</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Tournaments */}
      <Section title="Tournaments Played" icon={<Trophy className="h-4 w-4 text-amber-600" />}>
        {tournaments.length === 0 ? (
          <Empty text="No tournaments logged yet." />
        ) : (
          <div className="space-y-2">
            {tournaments.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                  <Trophy className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{t.title}</p>
                  <span className="text-xs text-slate-400">{fmtDate(t.played_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-slate-400">{text}</p>;
}

function StatCard({ label, value, icon, color }: { label: string; value: number | string; icon: React.ReactNode; color: "emerald" | "slate" | "amber" }) {
  const colors = {
    emerald: "bg-emerald-50 text-emerald-700",
    slate: "bg-slate-100 text-slate-600",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${colors[color]}`}>{icon}</div>
      <div>
        <p className="text-xl font-bold text-slate-800">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

function StudentRatingGraph({ entries }: { entries: RatingEntry[] }) {
  const [viewMode, setViewMode] = useState<"weekly" | "monthly">("monthly");
  const visible = entries.filter((e) => e.period === viewMode);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">View:</span>
        <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          <button
            onClick={() => setViewMode("monthly")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              viewMode === "monthly" ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setViewMode("weekly")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              viewMode === "weekly" ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Weekly
          </button>
        </div>
      </div>
      <RatingGraph entries={visible} period={viewMode} />
    </div>
  );
}

function RatingGraph({ entries, period }: { entries: RatingEntry[]; period: "weekly" | "monthly" }) {
  if (entries.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400">
        {period === "weekly"
          ? "Your coach hasn't logged any weekly ratings yet."
          : "Your coach hasn't logged any monthly ratings yet."}
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
  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => Math.round(yMin + (yRange * i) / yTicks));

  const labelStep = Math.max(1, Math.ceil(entries.length / 8));

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 400 }}>
        {tickVals.map((tv, i) => {
          const y = padT + plotH - ((tv - yMin) / yRange) * plotH;
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#f1f5f9" strokeWidth={1} />
              <text x={padL - 8} y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{tv}</text>
            </g>
          );
        })}
        <path d={areaD} fill="rgba(16,185,129,0.10)" />
        <path d={pathD} fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={4} fill="#10b981" stroke="white" strokeWidth={2} />
            {i % labelStep === 0 && (
              <text x={p.x} y={H - padB + 16} textAnchor="middle" className="fill-slate-500 text-[10px]">
                {period === "weekly" ? fmtWeekShort(p.month) : fmtMonthShort(p.month)}
              </text>
            )}
            <text x={p.x} y={p.y - 10} textAnchor="middle" className="fill-slate-700 text-[10px] font-semibold">
              {p.rating}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function fmtMonth(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "long", year: "numeric" });
}
function fmtMonthShort(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short" });
}
function fmtWeekShort(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "numeric", day: "numeric" });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
function isOverdue(dateStr: string): boolean {
  return new Date(dateStr) < new Date(new Date().toDateString());
}
