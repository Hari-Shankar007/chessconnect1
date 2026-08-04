import { useEffect, useRef, useState } from "react";
import { LogOut, Loader2, MessageSquare, BookOpen, Trophy, TrendingUp } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Chat } from "@/lib/types";
import { ensureNotificationPermission, showBrowserNotification, playNotificationSound } from "@/lib/notifications";
import ChatWindow from "./ChatWindow";
import StudentArticles from "./StudentArticles";
import StudentTournaments from "./StudentTournaments";
import StudentPerformance from "./StudentPerformance";
import MessageToast, { ToastData } from "./MessageToast";

type Tab = "chat" | "articles" | "tournaments" | "performance";

export default function StudentDashboard() {
  const { profile, signOut } = useAuth();
  const [chat, setChat] = useState<Chat | null>(null);
  const [coachName, setCoachName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("chat");
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<ToastData | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const coachNameRef = useRef<string>("Coach");

  useEffect(() => {
    async function load() {
      if (!profile) return;
      const { data, error } = await supabase
        .from("chats")
        .select("id, student_id, coach_id, created_at")
        .eq("student_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        setLoading(false);
        return;
      }
      setChat(data as Chat);
      chatIdRef.current = (data as Chat).id;

      const { data: coach } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", (data as Chat).coach_id)
        .maybeSingle();
      setCoachName(coach?.name || "Coach");
      coachNameRef.current = coach?.name || "Coach";
      setLoading(false);
    }
    load();
  }, [profile]);

  // Request notification permission on mount
  useEffect(() => {
    ensureNotificationPermission();
  }, []);

  // Realtime: listen for incoming messages from coach
  useEffect(() => {
    if (!profile || !chatIdRef.current) return;
    const cid = chatIdRef.current;

    const channel = supabase
      .channel("student-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${cid}` },
        (payload) => {
          const msg = payload.new as { sender_id: string; content: string | null; file_type: string | null };
          // Only notify for messages from coach (not our own)
          if (msg.sender_id === profile.id) return;

          const preview = msg.content || (msg.file_type ? `Sent a ${msg.file_type}` : "New message");

          // If chat tab is active and page is visible, don't notify
          if (tab === "chat" && document.visibilityState === "visible") return;

          setUnread((n) => n + 1);
          setToast({ name: coachNameRef.current, message: preview, chatId: cid });
          playNotificationSound();
          showBrowserNotification(`New message from ${coachNameRef.current}`, preview, () => {
            setTab("chat");
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, tab]);

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <img
            src={`${import.meta.env.BASE_URL}Black_White_Minimalist_Square_Frame_Fashion_Custom_Tailor_Logo.png`}
            alt="EduChess"
            className="h-9 w-9 rounded-lg object-contain bg-emerald-600 p-0.5"
            style={{ filter: "invert(1)" }}
          />
          <span className="font-bold text-slate-800">EduChess</span>
        </div>

        {/* Tab navigation */}
        <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1">
          <TabBtn active={tab === "chat"} onClick={() => { setTab("chat"); setUnread(0); }} icon={<MessageSquare className="h-4 w-4" />} label="Chat" badge={unread} />
          <TabBtn active={tab === "articles"} onClick={() => setTab("articles")} icon={<BookOpen className="h-4 w-4" />} label="Articles" />
          <TabBtn active={tab === "tournaments"} onClick={() => setTab("tournaments")} icon={<Trophy className="h-4 w-4" />} label="Tournaments" />
          <TabBtn active={tab === "performance"} onClick={() => setTab("performance")} icon={<TrendingUp className="h-4 w-4" />} label="Performance" />
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="hidden text-sm font-medium text-slate-700 sm:block">{profile?.name}</p>
            <p className="hidden text-xs text-emerald-600 sm:block">Student</p>
          </div>
          <button
            onClick={signOut}
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            title="Sign out"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {tab === "chat" && (
          <>
            {/* Sidebar (hidden on mobile) */}
            <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your Coach</p>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : chat ? (
                <div className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                    {coachName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{coachName}</p>
                    <p className="flex items-center gap-1 text-xs text-slate-400">
                      <MessageSquare className="h-3 w-3" /> Active conversation
                    </p>
                  </div>
                </div>
              ) : (
                <p className="px-4 py-6 text-sm text-slate-400">No chat assigned yet.</p>
              )}
            </aside>

            {/* Chat area */}
            <main className="flex-1">
              {loading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : chat ? (
                <ChatWindow chatId={chat.id} myId={profile!.id} theirName={coachName} />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center">
                  <div>
                    <MessageSquare className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                    <p className="text-slate-500">You don't have a coach assigned yet.</p>
                    <p className="text-sm text-slate-400">Please ask your academy admin to assign one.</p>
                  </div>
                </div>
              )}
            </main>
          </>
        )}

        {tab === "articles" && (
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="mx-auto max-w-3xl">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-800">
                <BookOpen className="h-5 w-5 text-emerald-600" /> Articles from your coach
              </h2>
              <StudentArticles />
            </div>
          </main>
        )}

        {tab === "tournaments" && (
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="mx-auto max-w-3xl">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-800">
                <Trophy className="h-5 w-5 text-amber-600" /> Tournament Calendar
              </h2>
              <p className="mb-4 text-sm text-slate-500">
                Times are shown in your local timezone. Click a tournament to join.
              </p>
              <StudentTournaments />
            </div>
          </main>
        )}

        {tab === "performance" && (
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="mx-auto max-w-3xl">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-800">
                <TrendingUp className="h-5 w-5 text-emerald-600" /> My Performance
              </h2>
              <StudentPerformance />
            </div>
          </main>
        )}
      </div>

      <MessageToast toast={toast} onDismiss={() => setToast(null)} onClick={() => { setTab("chat"); setUnread(0); setToast(null); }} />
    </div>
  );
}

function TabBtn({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
        active ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-xs font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
