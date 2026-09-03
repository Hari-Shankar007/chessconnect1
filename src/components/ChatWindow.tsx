import { useEffect, useRef, useState } from "react";
import {
  Paperclip,
  Send,
  FileText,
  Download,
  Loader2,
  ImageIcon,
  X,
  Mic,
  Phone,
  Video,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Message } from "@/lib/types";
import {
  shortTime,
  validateFile,
  fileKind,
  MAX_FILE_SIZE,
  initials,
} from "@/lib/utils";
import AudioPlayer from "./AudioPlayer";

interface Props {
  chatId: string;
  myId: string;
  theirName: string;
  theirId: string;
  onStartCall: (type: "audio" | "video") => void;
}

export default function ChatWindow({
  chatId,
  myId,
  theirName,
  theirId,
  onStartCall,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const resolvedIds = useRef<Set<string>>(new Set());

  // Voice recording state
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ============================================================
  // LOAD MESSAGES + REALTIME
  // ============================================================

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    setMessages([]);
    resolvedIds.current = new Set();
    setSignedUrls({});

    async function load() {
      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, chat_id, sender_id, content, file_url, file_type, file_name, created_at"
        )
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        setError("Could not load messages. Please try again.");
        setLoading(false);
        return;
      }

      setMessages(data as Message[]);
      setLoading(false);
    }

    load();

    const channel = supabase
      .channel(`chat-window-${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const msg = payload.new as Message;

          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
          );
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [chatId]);

  // ============================================================
  // AUTO SCROLL
  // ============================================================

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages.length]);

  // ============================================================
  // SIGNED URLS
  // ============================================================

  useEffect(() => {
    const missing = messages.filter(
      (m) => m.file_url && !resolvedIds.current.has(m.id)
    );

    if (missing.length === 0) return;

    for (const m of missing) {
      resolvedIds.current.add(m.id);

      supabase.storage
        .from("chat-attachments")
        .createSignedUrl(m.file_url!, 3600)
        .then(({ data, error }) => {
          if (error || !data?.signedUrl) return;

          setSignedUrls((prev) => ({
            ...prev,
            [m.id]: data.signedUrl,
          }));
        });
    }
  }, [messages]);

  // ============================================================
  // FILE PICKER
  // ============================================================

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];

    e.target.value = "";

    if (!file) return;

    const err = validateFile(file);

    if (err) {
      setError(err);
      return;
    }

    setError(null);
    setPendingFile(file);
  }

  // ============================================================
  // FILE UPLOAD
  // ============================================================

  async function uploadFile(file: File): Promise<string | null> {
    const ext = file.name.split(".").pop() || "bin";

    const path = `${myId}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    const { error } = await supabase.storage
      .from("chat-attachments")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });

    if (error) return null;

    return path;
  }

  // ============================================================
  // SEND NORMAL MESSAGE / FILE
  // ============================================================

  async function send() {
    if ((!text.trim() && !pendingFile) || sending) return;

    setSending(true);
    setError(null);

    try {
      let fileUrl: string | null = null;
      let fileType: "pdf" | "image" | "audio" | null = null;
      let fileName: string | null = null;

      if (pendingFile) {
        setUploading(true);

        const path = await uploadFile(pendingFile);

        setUploading(false);

        if (!path) {
          setError("File upload failed. Please try again.");
          return;
        }

        fileUrl = path;
        fileType = fileKind(pendingFile);
        fileName = pendingFile.name;
      }

      const { error: insertErr } = await supabase.from("messages").insert({
        chat_id: chatId,
        sender_id: myId,
        content: text.trim() || null,
        file_url: fileUrl,
        file_type: fileType,
        file_name: fileName,
      });

      if (insertErr) {
        setError("Could not send message. Please try again.");
        return;
      }

      setText("");
      setPendingFile(null);
    } finally {
      setSending(false);
      setUploading(false);
    }
  }

  // ============================================================
  // ENTER TO SEND
  // ============================================================

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // ============================================================
  // VOICE RECORDING
  // ============================================================

  async function startRecording() {
    try {
      // Browser compatibility check
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "Voice recording is not supported by this browser. Please use Chrome or Safari."
        );
        return;
      }

      if (typeof MediaRecorder === "undefined") {
        setError(
          "Voice recording is not supported by this browser. Please use Chrome or Safari."
        );
        return;
      }

      // Ask for microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      recordStreamRef.current = stream;

      // Find a format supported by the phone/browser
      const mimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];

      const supportedMimeType = mimeTypes.find((type) =>
        MediaRecorder.isTypeSupported(type)
      );

      const mr = supportedMimeType
        ? new MediaRecorder(stream, {
            mimeType: supportedMimeType,
          })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = mr;
      recordedChunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      mr.onstop = () => {
        const mimeType = mr.mimeType || "audio/webm";

        const blob = new Blob(recordedChunksRef.current, {
          type: mimeType,
        });

        sendVoiceMessage(blob);

        cleanupRecording();
      };

      mr.onerror = () => {
        setError("Voice recording failed. Please try again.");

        cleanupRecording();

        setRecording(false);
        setRecordSecs(0);
      };

      mr.start(1000);

      setRecording(true);
      setRecordSecs(0);

      recordTimerRef.current = setInterval(() => {
        setRecordSecs((s) => s + 1);
      }, 1000);
    } catch (error) {
      console.error("Microphone error:", error);

      setError(
        "Microphone access denied. Please allow microphone permissions and try again."
      );
    }
  }

  // ============================================================
  // STOP RECORDING
  // ============================================================

  function stopRecording(sendIt: boolean) {
    const mr = mediaRecorderRef.current;

    if (!mr) return;

    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    if (!sendIt) {
      // Cancel without sending
      mr.onstop = null;

      cleanupRecording();

      setRecording(false);
      setRecordSecs(0);

      return;
    }

    if (mr.state !== "inactive") {
      mr.stop();
    }

    setRecording(false);
  }

  // ============================================================
  // CLEANUP RECORDING
  // ============================================================

  function cleanupRecording() {
    if (recordStreamRef.current) {
      recordStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });

      recordStreamRef.current = null;
    }

    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];

    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }

  // ============================================================
  // SEND VOICE MESSAGE
  // ============================================================

  async function sendVoiceMessage(blob: Blob) {
    if (blob.size < 100) {
      setError("Voice message too short. Try recording again.");
      return;
    }

    // Detect the actual recording format
    let ext = "webm";

    if (blob.type.includes("mp4")) {
      ext = "mp4";
    } else if (blob.type.includes("ogg")) {
      ext = "ogg";
    } else if (blob.type.includes("webm")) {
      ext = "webm";
    }

    const file = new File(
      [blob],
      `voice-${Date.now()}.${ext}`,
      {
        type: blob.type,
      }
    );

    setUploading(true);

    const path = await uploadFile(file);

    setUploading(false);

    if (!path) {
      setError("Voice message upload failed. Please try again.");
      return;
    }

    const { error: insertErr } = await supabase.from("messages").insert({
      chat_id: chatId,
      sender_id: myId,
      content: null,
      file_url: path,
      file_type: "audio",
      file_name: file.name,
    });

    if (insertErr) {
      setError("Could not send voice message. Please try again.");
    }

    setRecordSecs(0);
  }

  // ============================================================
  // CLEANUP WHEN COMPONENT UNMOUNTS
  // ============================================================

  useEffect(() => {
    return () => {
      cleanupRecording();
    };
  }, []);

  // Show microphone only when message box is empty
  const showMic =
    !text.trim() &&
    !pendingFile &&
    !recording;

  // ============================================================
  // UI
  // ============================================================

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      {/* ========================================================
          HEADER
      ======================================================== */}

      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-2 py-2 shadow-sm sm:gap-3 sm:px-4 sm:py-3">
        {/* User information */}
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white sm:h-10 sm:w-10">
            {initials(theirName)}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800 sm:text-base">
              {theirName}
            </p>

            <p className="hidden truncate text-xs text-slate-400 sm:block">
              ChessConnect
            </p>
          </div>
        </div>

        {/* Call buttons */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Voice Call */}
          <button
            type="button"
            onClick={() => onStartCall("audio")}
            className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-emerald-600 active:bg-slate-200 sm:h-11 sm:w-11"
            title="Voice call"
            aria-label="Start voice call"
          >
            <Phone className="h-5 w-5" />
          </button>

          {/* Video Call */}
          <button
            type="button"
            onClick={() => onStartCall("video")}
            className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-emerald-600 active:bg-slate-200 sm:h-11 sm:w-11"
            title="Video call"
            aria-label="Start video call"
          >
            <Video className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ========================================================
          MESSAGES
      ======================================================== */}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-4 sm:px-4 sm:py-6">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            {messages.length === 0 && (
              <p className="mt-10 text-center text-sm text-slate-400">
                No messages yet. Say hello to {theirName}!
              </p>
            )}

            {messages.map((m) => (
              <Bubble
                key={m.id}
                msg={m}
                mine={m.sender_id === myId}
                url={signedUrls[m.id]}
              />
            ))}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ========================================================
          ERROR BANNER
      ======================================================== */}

      {error && (
        <div className="mx-2 mb-2 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:mx-4">
          <span className="min-w-0 flex-1 break-words">
            {error}
          </span>

          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 rounded p-1 hover:bg-red-100"
            aria-label="Close error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ========================================================
          PENDING FILE
      ======================================================== */}

      {pendingFile && (
        <div className="mx-2 mb-2 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 sm:mx-4">
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0" />

            <span className="truncate">
              {pendingFile.name}
            </span>

            <span className="shrink-0 text-xs text-emerald-600">
              ({(pendingFile.size / 1024).toFixed(0)} KB)
            </span>
          </span>

          <button
            type="button"
            onClick={() => setPendingFile(null)}
            className="shrink-0 rounded p-1 hover:bg-emerald-100"
            aria-label="Remove attachment"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ========================================================
          RECORDING INDICATOR
      ======================================================== */}

      {recording && (
        <div className="mx-2 mb-2 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:mx-4">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />

            <span>
              Recording…{" "}
              {Math.floor(recordSecs / 60)}:
              {(recordSecs % 60)
                .toString()
                .padStart(2, "0")}
            </span>
          </span>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {/* Cancel */}
            <button
              type="button"
              onClick={() => stopRecording(false)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100 active:bg-red-200"
            >
              <X className="h-3.5 w-3.5" />
              <span>Cancel</span>
            </button>

            {/* Send */}
            <button
              type="button"
              onClick={() => stopRecording(true)}
              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 active:bg-emerald-800"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Send</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================
          INPUT AREA
      ======================================================== */}

      <div className="border-t border-slate-200 bg-white px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-3">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-1.5 sm:gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={onPickFile}
            className="hidden"
          />

          {/* Attachment button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || sending || recording}
            className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200 disabled:opacity-50 sm:h-11 sm:w-11"
            title="Attach PDF or image"
            aria-label="Attach PDF or image"
          >
            <Paperclip className="h-5 w-5" />
          </button>

          {/* Message textarea */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Type a message…"
            disabled={recording}
            className="min-w-0 max-h-32 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100 disabled:opacity-60 sm:px-4 sm:py-3"
          />

          {/* ====================================================
              MICROPHONE / SEND BUTTON
          ==================================================== */}

          {showMic ? (
            <button
              type="button"
              onClick={startRecording}
              disabled={uploading || sending}
              className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-emerald-600 active:bg-slate-200 disabled:opacity-50 sm:h-11 sm:w-11"
              title="Record voice message"
              aria-label="Record voice message"
            >
              <Mic className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={
                sending ||
                uploading ||
                (!text.trim() && !pendingFile) ||
                recording
              }
              className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full bg-emerald-600 text-white transition hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 sm:h-11 sm:w-11"
              title="Send message"
              aria-label="Send message"
            >
              {uploading || sending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          )}
        </div>

        {/* Help text */}
        <p className="mx-auto mt-1 max-w-3xl text-center text-xs text-slate-400">
          PDF, JPG, PNG, voice · max{" "}
          {MAX_FILE_SIZE / 1024 / 1024} MB
        </p>
      </div>
    </div>
  );
}

// ================================================================
// MESSAGE BUBBLE
// ================================================================

function Bubble({
  msg,
  mine,
  url,
}: {
  msg: Message;
  mine: boolean;
  url?: string;
}) {
  const hasFile = !!msg.file_type;
  const hasImage = msg.file_type === "image" && url;
  const hasPdf = msg.file_type === "pdf" && url;
  const hasAudio = msg.file_type === "audio" && url;
  const fileLoading = hasFile && !url;

  return (
    <div
      className={`flex ${
        mine ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-2 shadow-sm sm:max-w-[70%] ${
          mine
            ? "rounded-br-md bg-emerald-600 text-white"
            : "rounded-bl-md bg-white text-slate-800"
        }`}
      >
        {/* ======================================================
            IMAGE
        ====================================================== */}

        {hasImage && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mb-1 block"
          >
            <img
              src={url}
              alt={msg.file_name || "image"}
              className="max-h-64 w-full max-w-xs rounded-lg object-cover"
            />
          </a>
        )}

        {/* ======================================================
            PDF
        ====================================================== */}

        {hasPdf && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={`mb-1 flex items-center gap-3 rounded-lg p-3 transition ${
              mine
                ? "bg-emerald-700/40 hover:bg-emerald-700/60"
                : "bg-slate-100 hover:bg-slate-200"
            }`}
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                mine
                  ? "bg-white/20"
                  : "bg-red-100 text-red-600"
              }`}
            >
              <FileText className="h-5 w-5" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {msg.file_name || "document.pdf"}
              </p>

              <p
                className={`flex items-center gap-1 text-xs ${
                  mine
                    ? "text-emerald-100"
                    : "text-slate-500"
                }`}
              >
                <Download className="h-3 w-3" />
                Open PDF
              </p>
            </div>
          </a>
        )}

        {/* ======================================================
            AUDIO / VOICE MESSAGE
        ====================================================== */}

        {hasAudio && (
          <AudioPlayer
            url={url!}
            mine={mine}
          />
        )}

        {/* ======================================================
            FILE LOADING
        ====================================================== */}

        {fileLoading && (
          <div
            className={`mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              mine
                ? "bg-emerald-700/30"
                : "bg-slate-100"
            }`}
          >
            <Loader2 className="h-4 w-4 animate-spin opacity-60" />

            <ImageIcon className="h-4 w-4 opacity-60" />

            <span className="truncate opacity-70">
              {msg.file_name || "Loading file…"}
            </span>
          </div>
        )}

        {/* ======================================================
            TEXT
        ====================================================== */}

        {msg.content && (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {msg.content}
          </p>
        )}

        {/* ======================================================
            TIME
        ====================================================== */}

        <p
          className={`mt-1 text-right text-[10px] ${
            mine
              ? "text-emerald-100"
              : "text-slate-400"
          }`}
        >
          {shortTime(msg.created_at)}
        </p>
      </div>
    </div>
  );
}
