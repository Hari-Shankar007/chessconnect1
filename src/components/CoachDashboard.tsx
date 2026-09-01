import { useCallback, useEffect, useRef, useState } from "react";
import {
  LogOut,
  Loader2,
  MessageSquare,
  UserPlus,
  ArrowLeft,
  Search,
  BookOpen,
  Trophy,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { ChatPartner, CallSignaling, CallType } from "@/lib/types";
import {
  initials,
  shortTime,
} from "@/lib/utils";
import {
  ensureNotificationPermission,
  registerPushNotifications,
  showBrowserNotification,
  playNotificationSound,
} from "@/lib/notifications";
import ChatWindow from "./ChatWindow";
import AdminPanel from "./AdminPanel";
import ArticlesPanel from "./ArticlesPanel";
import TournamentPanel from "./TournamentPanel";
import PerformancePanel from "./PerformancePanel";
import CallModal from "./CallModal";
import MessageToast, { ToastData } from "./MessageToast";

export default function CoachDashboard() {
  const { profile, signOut } = useAuth();

  const [partners, setPartners] = useState<ChatPartner[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeStudentName, setActiveStudentName] = useState<string>("");
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);

  const [showAdmin, setShowAdmin] = useState(false);
  const [showArticles, setShowArticles] = useState(false);
  const [showTournaments, setShowTournaments] = useState(false);
  const [showPerformance, setShowPerformance] = useState(false);

  const [search, setSearch] = useState("");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);

  const [unread, setUnread] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<ToastData | null>(null);

  const activeChatIdRef = useRef<string | null>(null);
  const partnerMapRef = useRef<Map<string, ChatPartner>>(new Map());

  // Call state
  const [callState, setCallState] = useState<{
    chatId: string;
    theirId: string;
    theirName: string;
    type: CallType;
    isCaller: boolean;
  } | null>(null);

  const [incomingCall, setIncomingCall] =
    useState<CallSignaling | null>(null);

  /*
   * Keep the current call state in a ref.
   *
   * This is important because the incoming-call polling effect should
   * NOT depend on callState. Otherwise every call state change destroys
   * and recreates the realtime channel + polling interval.
   */
  const callStateRef = useRef<typeof callState>(null);

  function startCall(type: CallType) {
    if (!activeChatId || !activeStudentId) return;

    const nextCallState = {
      chatId: activeChatId,
      theirId: activeStudentId,
      theirName: activeStudentName,
      type,
      isCaller: true,
    };

    callStateRef.current = nextCallState;
    setIncomingCall(null);
    setCallState(nextCallState);
  }

  /*
   * Incoming call listener
   *
   * IMPORTANT:
   * - This effect only depends on profile.
   * - It does NOT depend on callState.
   * - callStateRef is used inside polling.
   * - Realtime and polling share lastSeenId.
   * - A realtime call is immediately marked as seen so polling
   *   does not notify the coach about the same call again.
   */
  useEffect(() => {
    if (!profile) return;

    let disposed = false;
    let lastSeenId: string | null = null;

    const callColumns =
      "id, chat_id, caller_id, callee_id, call_type, status, sdp_offer, sdp_answer, caller_ice, callee_ice, created_at, updated_at";

    /*
     * Establish a baseline before polling.
     *
     * We only care about calls where this coach is the callee.
     * This prevents unrelated users' calls from affecting the baseline.
     */
    const initializeLastSeen = async () => {
      const { data } = await supabase
        .from("call_signaling")
        .select(callColumns)
        .eq("callee_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!disposed && data) {
        lastSeenId = (data as CallSignaling).id;
      }
    };

    void initializeLastSeen();

    const handleIncomingCall = (row: CallSignaling) => {
      if (disposed) return;

      if (row.callee_id !== profile.id) return;
      if (row.status !== "ringing") return;

      /*
       * Prevent duplicate handling.
       *
       * This is especially important because the same call can be
       * received through both Supabase Realtime and the polling fallback.
       */
      if (lastSeenId === row.id) return;

      lastSeenId = row.id;

      /*
       * If another call is already open, do not replace it with
       * another incoming call.
       */
      if (callStateRef.current) return;

      const partner = partnerMapRef.current.get(row.chat_id);
      const studentName = partner?.student_name || "Student";

      const nextCallState = {
        chatId: row.chat_id,
        theirId: row.caller_id,
        theirName: studentName,
        type: row.call_type,
        isCaller: false,
      };

      callStateRef.current = nextCallState;

      setIncomingCall(row);
      setCallState(nextCallState);

      playNotificationSound();

      showBrowserNotification(
        `Incoming ${row.call_type} call`,
        `${studentName} is calling…`,
        () => {
          const currentPartner =
            partnerMapRef.current.get(row.chat_id);

          if (currentPartner) {
            openChat(currentPartner);
          }
        }
      );
    };

    /*
     * Supabase Realtime listener.
     */
    const channel = supabase
      .channel("coach-incoming-calls")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_signaling",
        },
        (payload) => {
          const row = payload.new as CallSignaling;

          handleIncomingCall(row);
        }
      )
      .subscribe();

    /*
     * Polling fallback.
     *
     * We only look for recent ringing calls.
     * This prevents an old abandoned call from suddenly appearing
     * as a new call when the dashboard is opened.
     */
    const pollInterval = window.setInterval(async () => {
      if (disposed) return;

      /*
       * Never poll for a new call while a CallModal is already open.
       */
      if (callStateRef.current) return;

      const cutoff = new Date(
        Date.now() - 45 * 1000
      ).toISOString();

      const { data, error } = await supabase
        .from("call_signaling")
        .select(callColumns)
        .eq("callee_id", profile.id)
        .eq("status", "ringing")
        .gt("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data || disposed) return;

      const row = data as CallSignaling;

      handleIncomingCall(row);
    }, 2000);

    return () => {
      disposed = true;

      window.clearInterval(pollInterval);

      void supabase.removeChannel(channel);
    };
  }, [profile]);

  function endCallHandler() {
    callStateRef.current = null;

    setCallState(null);
    setIncomingCall(null);
  }

  const loadPartners = useCallback(async () => {
    if (!profile) return;

    const { data, error } = await supabase.rpc(
      "get_chat_partners",
      {
        p_coach: profile.id,
      }
    );

    if (!error && data) {
      setPartners(data as ChatPartner[]);
    }

    setLoading(false);
  }, [profile]);

  useEffect(() => {
    loadPartners();
  }, [loadPartners]);

  /*
   * Refresh partner list when messages/chats are created.
   */
  useEffect(() => {
    if (!profile) return;

    const channel = supabase
      .channel("coach-partners")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        () => {
          void loadPartners();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chats",
        },
        () => {
          void loadPartners();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile, loadPartners]);

  function openChat(p: ChatPartner) {
    setActiveChatId(p.chat_id);
    setActiveStudentName(p.student_name);
    setActiveStudentId(p.student_id);

    setMobileChatOpen(true);

    activeChatIdRef.current = p.chat_id;

    setUnread((prev) => ({
      ...prev,
      [p.chat_id]: 0,
    }));
  }

  /*
   * Keep partner map synchronized.
   *
   * Incoming calls and notifications use this ref so they always
   * have access to the latest student information without forcing
   * their realtime subscriptions to restart.
   */
  useEffect(() => {
    partnerMapRef.current = new Map(
      partners.map((p) => [p.chat_id, p])
    );
  }, [partners]);

  /*
   * PUSH NOTIFICATION SETUP
   */
  useEffect(() => {
    async function setupPushNotifications() {
      // First request normal browser notification permission
      const permissionGranted =
        await ensureNotificationPermission();

      if (!permissionGranted) {
        console.log(
          "[ChessConnect] Notification permission not granted."
        );
        return;
      }

      // Create / retrieve the Web Push subscription
      const subscription =
        await registerPushNotifications();

      if (subscription) {
        console.log(
          "[ChessConnect] Push subscription ready:",
          subscription.endpoint
        );

        // The next step will save this subscription
        // to Supabase for this logged-in coach.
      }
    }

    setupPushNotifications();
  }, []);

  /*
   * Incoming message notifications.
   */
  useEffect(() => {
    if (!profile) return;

    const channel = supabase
      .channel("coach-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const msg = payload.new as {
            chat_id: string;
            sender_id: string;
            content: string | null;
            file_type: string | null;
            file_name: string | null;
          };

          /*
           * Ignore our own messages.
           */
          if (msg.sender_id === profile.id) return;

          const partner =
            partnerMapRef.current.get(msg.chat_id);

          const senderName =
            partner?.student_name || "Student";

          const preview =
            msg.content ||
            (msg.file_type
              ? `Sent a ${msg.file_type}`
              : "New message");

          /*
           * If the coach is already looking at this chat while
           * the browser is visible, don't create another notification.
           */
          if (
            activeChatIdRef.current === msg.chat_id &&
            document.visibilityState === "visible"
          ) {
            return;
          }

          setUnread((prev) => ({
            ...prev,
            [msg.chat_id]:
              (prev[msg.chat_id] || 0) + 1,
          }));

          setToast({
            name: senderName,
            message: preview,
            chatId: msg.chat_id,
          });

          playNotificationSound();

          showBrowserNotification(
            `New message from ${senderName}`,
            preview,
            () => {
              const currentPartner =
                partnerMapRef.current.get(
                  msg.chat_id
                );

              if (currentPartner) {
                openChat(currentPartner);
              }
            }
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile]);

  const filtered = partners.filter((p) =>
    p.student_name
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <img
            src="/Black_White_Minimalist_Square_Frame_Fashion_Custom_Tailor_Logo.png"
            alt="EduChess"
            className="h-9 w-9 rounded-lg object-contain bg-emerald-600 p-0.5"
            style={{ filter: "invert(1)" }}
          />

          <span className="font-bold text-slate-800">
            EduChess Chat
          </span>

          <span className="ml-1 hidden rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 sm:inline">
            Coach
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowArticles(true)}
            className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            title="Articles"
          >
            <BookOpen className="h-4 w-4" />
            <span className="hidden lg:inline">
              Articles
            </span>
          </button>

          <button
            onClick={() => setShowPerformance(true)}
            className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            title="Performance"
          >
            <TrendingUp className="h-4 w-4" />
            <span className="hidden lg:inline">
              Performance
            </span>
          </button>

          <button
            onClick={() => setShowTournaments(true)}
            className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            title="Tournaments"
          >
            <Trophy className="h-4 w-4" />
            <span className="hidden lg:inline">
              Tournaments
            </span>
          </button>

          <button
            onClick={() => setShowAdmin(true)}
            className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-900"
          >
            <UserPlus className="h-4 w-4" />

            <span className="hidden sm:inline">
              Manage
            </span>
          </button>

          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-slate-700">
              {profile?.name}
            </p>

            <p className="text-xs text-emerald-600">
              Coach
            </p>
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

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`${
            mobileChatOpen
              ? "hidden md:flex"
              : "flex"
          } w-full shrink-0 flex-col border-r border-slate-200 bg-white md:w-80 lg:w-96`}
        >
          {/* Search */}
          <div className="border-b border-slate-100 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

              <input
                value={search}
                onChange={(e) =>
                  setSearch(e.target.value)
                }
                placeholder="Search students…"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <MessageSquare className="mx-auto mb-2 h-8 w-8 text-slate-300" />

                <p className="text-sm text-slate-400">
                  {partners.length === 0
                    ? "No students yet. Tap “Manage” to create one."
                    : "No students match your search."}
                </p>
              </div>
            ) : (
              filtered.map((p) => {
                const active =
                  p.chat_id === activeChatId;

                const lastIsMe =
                  p.last_sender_id === profile?.id;

                return (
                  <button
                    key={p.chat_id}
                    onClick={() => openChat(p)}
                    className={`flex w-full items-center gap-3 border-l-2 px-4 py-3 text-left transition ${
                      active
                        ? "border-emerald-600 bg-emerald-50"
                        : "border-transparent hover:bg-slate-50"
                    }`}
                  >
                    {p.student_image ? (
                      <img
                        src={p.student_image}
                        alt={p.student_name}
                        className="h-11 w-11 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">
                        {initials(p.student_name)}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium text-slate-800">
                            {p.student_name}
                          </p>

                          {(unread[p.chat_id] || 0) > 0 && (
                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-xs font-bold text-white">
                              {unread[p.chat_id]}
                            </span>
                          )}
                        </div>

                        {p.last_created_at && (
                          <span className="shrink-0 text-xs text-slate-400">
                            {shortTime(
                              p.last_created_at
                            )}
                          </span>
                        )}
                      </div>

                      <p className="truncate text-sm text-slate-400">
                        {p.last_content
                          ? (lastIsMe
                              ? "You: "
                              : "") +
                            p.last_content
                          : p.last_file_type
                          ? (lastIsMe
                              ? "You: "
                              : "") +
                            `Sent a ${p.last_file_type}`
                          : "No messages yet"}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Chat area */}
        <main
          className={`${
            mobileChatOpen
              ? "flex"
              : "hidden md:flex"
          } flex-1 flex-col`}
        >
          {activeChatId ? (
            <div className="relative flex h-full flex-col">
              {/* Mobile back button */}
              <button
                onClick={() =>
                  setMobileChatOpen(false)
                }
                className="absolute left-2 top-2.5 z-10 flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 md:hidden"
              >
                <ArrowLeft className="h-4 w-4" />
                Chats
              </button>

              <ChatWindow
                chatId={activeChatId}
                myId={profile!.id}
                theirName={activeStudentName}
                theirId={activeStudentId!}
                onStartCall={startCall}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <div>
                <MessageSquare className="mx-auto mb-3 h-12 w-12 text-slate-300" />

                <p className="text-slate-500">
                  Select a student to start chatting
                </p>

                <p className="text-sm text-slate-400">
                  Your conversations will appear here.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {showAdmin && (
        <AdminPanel
          onClose={() => setShowAdmin(false)}
          onCreated={loadPartners}
        />
      )}

      {showArticles && (
        <ArticlesPanel
          onClose={() => setShowArticles(false)}
        />
      )}

      {showTournaments && (
        <TournamentPanel
          onClose={() => setShowTournaments(false)}
        />
      )}

      {showPerformance && (
        <PerformancePanel
          onClose={() => setShowPerformance(false)}
          partners={partners}
        />
      )}

      {callState && (
        <CallModal
          callId={null}
          chatId={callState.chatId}
          myId={profile!.id}
          myName={profile!.name}
          theirId={callState.theirId}
          theirName={callState.theirName}
          isCaller={callState.isCaller}
          callType={callState.type}
          incomingCall={incomingCall}
          onEnd={endCallHandler}
        />
      )}

      <MessageToast
        toast={toast}
        onDismiss={() => setToast(null)}
        onClick={(cid) => {
          const p =
            partnerMapRef.current.get(cid);

          if (p) {
            openChat(p);
          }

          setToast(null);
        }}
      />
    </div>
  );
}
