import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Trophy, ExternalLink, Clock, Calendar as CalIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Tournament } from "@/lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function StudentTournaments() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedTournaments, setSelectedTournaments] = useState<Tournament[]>([]);

  useEffect(() => {
    loadTournaments();

    const channel = supabase
      .channel("student-tournaments")
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
    const { data } = await supabase
      .from("tournaments")
      .select("id, title, link_url, event_date, description, created_at, created_by")
      .order("event_date", { ascending: true });
    setTournaments((data as Tournament[]) || []);
    setLoading(false);
  }

  // Build calendar grid for the current view month
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  // Map of yyyy-mm-dd (local) -> tournaments on that day
  const tournamentsByDay: Record<string, Tournament[]> = {};
  for (const t of tournaments) {
    const d = new Date(t.event_date);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!tournamentsByDay[key]) tournamentsByDay[key] = [];
    tournamentsByDay[key].push(t);
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  function prevMonth() {
    setViewDate(new Date(year, month - 1, 1));
  }
  function nextMonth() {
    setViewDate(new Date(year, month + 1, 1));
  }

  function onDayClick(day: number | null) {
    if (day === null) return;
    const key = `${year}-${month}-${day}`;
    setSelectedTournaments(tournamentsByDay[key] || []);
  }

  // Upcoming tournaments (sorted, future or today)
  const upcoming = tournaments
    .filter((t) => new Date(t.event_date).getTime() >= today.getTime() - 24 * 60 * 60 * 1000)
    .slice(0, 5);

  function localDisplay(iso: string) {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
      time: d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    };
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Calendar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">
            {MONTHS[month]} {year}
          </h3>
          <div className="flex gap-1">
            <button
              onClick={prevMonth}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={nextMonth}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d) => (
            <div key={d} className="pb-1 text-center text-xs font-medium text-slate-400">
              {d}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <div key={i} />;
            const key = `${year}-${month}-${day}`;
            const isToday = key === todayKey;
            const dayTournaments = tournamentsByDay[key] || [];
            const hasTournaments = dayTournaments.length > 0;
            return (
              <button
                key={i}
                onClick={() => onDayClick(day)}
                className={`relative flex h-12 flex-col items-center justify-center rounded-lg text-sm transition sm:h-14 ${
                  isToday
                    ? "bg-emerald-600 text-white"
                    : hasTournaments
                    ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {day}
                {hasTournaments && (
                  <span
                    className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${
                      isToday ? "bg-white" : "bg-amber-500"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day tournaments */}
      {selectedTournaments.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-700">Tournaments on selected day</h4>
          {selectedTournaments.map((t) => {
            const d = localDisplay(t.event_date);
            return (
              <a
                key={t.id}
                href={t.link_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 transition hover:border-amber-300 hover:shadow-sm"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                  <Trophy className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{t.title}</p>
                  {t.description && <p className="mt-0.5 text-sm text-slate-500">{t.description}</p>}
                  <div className="mt-1 flex items-center gap-3">
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Clock className="h-3 w-3" /> {d.time}
                    </span>
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <ExternalLink className="h-3 w-3" /> Join
                    </span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}

      {/* Upcoming list */}
      <div>
        <h4 className="mb-2 text-sm font-semibold text-slate-700">Upcoming tournaments</h4>
        {upcoming.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">No upcoming tournaments.</p>
        ) : (
          <div className="space-y-2">
            {upcoming.map((t) => {
              const d = localDisplay(t.event_date);
              return (
                <a
                  key={t.id}
                  href={t.link_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-emerald-200 hover:shadow-sm"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                    <Trophy className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800">{t.title}</p>
                    {t.description && <p className="mt-0.5 text-sm text-slate-500">{t.description}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <CalIcon className="h-3 w-3" /> {d.date}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <Clock className="h-3 w-3" /> {d.time}
                      </span>
                      <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                        <ExternalLink className="h-3 w-3" /> Join
                      </span>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
