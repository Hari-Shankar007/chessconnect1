import { useEffect, useRef, useState } from "react";
import { Paperclip, Send, FileText, Download, Loader2, ImageIcon, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Message } from "@/lib/types";
import { shortTime, validateFile, fileKind, MAX_FILE_SIZE, initials } from "@/lib/utils";

interface Props {
  chatId: string;
  myId: string;
  theirName: string;
}

export default function ChatWindow({ chatId, myId, theirName }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // map of message.id -> signed URL
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  // track which message ids we've already kicked off a URL request for
  const resolvedIds = useRef<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load message history + subscribe to realtime inserts
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
        .select("id, chat_id, sender_id, content, file_url, file_type, file_name, created_at")
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

    // Realtime — fires because messages table is in supabase_realtime publication
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

  // Auto-scroll to bottom whenever messages grow
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Resolve signed URLs for any new file messages we haven't handled yet.
  // We track which ids we've already requested via a ref so this effect is
  // safe to run on every messages change without causing infinite loops.
  useEffect(() => {
    const missing = messages.filter(
      (m) => m.file_url && !resolvedIds.current.has(m.id)
    );
    if (missing.length === 0) return;

    // Mark them all as "in flight" immediately so a re-render doesn't re-trigger
    missing.forEach((m) => resolvedIds.current.add(m.id));

    const paths = missing.map((m) => m.file_url!);
    supabase.storage
      .from("chat-attachments")
      .createSignedUrls(paths, 3600)
      .then(({ data, error }) => {
        if (error || !data) return;
        setSignedUrls((prev) => {
          const next = { ...prev };
          data.forEach((d, i) => {
            if (d.signedUrl) next[missing[i].id] = d.signedUrl;
          });
          return next;
        });
      });
  }, [messages]);

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

  async function uploadFile(file: File): Promise<string | null> {
    const ext = file.name.split(".").pop() || "bin";
    const path = `${myId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
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

  async function send() {
    if ((!text.trim() && !pendingFile) || sending) return;
    setSending(true);
    setError(null);

    try {
      let fileUrl: string | null = null;
      let fileType: "pdf" | "image" | null = null;
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

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const isRole = myId ? "Student" : "Coach"; // resolved from prop context
  void isRole;

  return (
    <div className="flex h-full flex-col bg-slate-50">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white">
          {initials(theirName)}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-800">{theirName}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
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

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-2 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Pending file preview */}
      {pendingFile && (
        <div className="mx-4 mb-2 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span className="flex items-center gap-2 truncate">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate">{pendingFile.name}</span>
            <span className="shrink-0 text-xs text-emerald-600">
              ({(pendingFile.size / 1024).toFixed(0)} KB)
            </span>
          </span>
          <button onClick={() => setPendingFile(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={onPickFile}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || sending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            title="Attach PDF or image"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Type a message…"
            className="max-h-32 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
          <button
            onClick={send}
            disabled={sending || uploading || (!text.trim() && !pendingFile)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {uploading || sending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
        <p className="mx-auto mt-1 max-w-3xl text-center text-xs text-slate-400">
          PDF, JPG, PNG · max {MAX_FILE_SIZE / 1024 / 1024} MB
        </p>
      </div>
    </div>
  );
}

function Bubble({ msg, mine, url }: { msg: Message; mine: boolean; url?: string }) {
  const hasFile = !!msg.file_type;
  const hasImage = msg.file_type === "image" && url;
  const hasPdf = msg.file_type === "pdf" && url;
  const fileLoading = hasFile && !url;

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 shadow-sm sm:max-w-[70%] ${
          mine
            ? "rounded-br-md bg-emerald-600 text-white"
            : "rounded-bl-md bg-white text-slate-800"
        }`}
      >
        {/* Image attachment */}
        {hasImage && (
          <a href={url} target="_blank" rel="noreferrer" className="mb-1 block">
            <img
              src={url}
              alt={msg.file_name || "image"}
              className="max-h-64 w-full max-w-xs rounded-lg object-cover"
            />
          </a>
        )}

        {/* PDF attachment */}
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
                mine ? "bg-white/20" : "bg-red-100 text-red-600"
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
                  mine ? "text-emerald-100" : "text-slate-500"
                }`}
              >
                <Download className="h-3 w-3" /> Open PDF
              </p>
            </div>
          </a>
        )}

        {/* Loading state — shown while signed URL is being fetched */}
        {fileLoading && (
          <div
            className={`mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              mine ? "bg-emerald-700/30" : "bg-slate-100"
            }`}
          >
            <Loader2 className="h-4 w-4 animate-spin opacity-60" />
            <ImageIcon className="h-4 w-4 opacity-60" />
            <span className="opacity-70">{msg.file_name || "Loading file…"}</span>
          </div>
        )}

        {/* Text caption */}
        {msg.content && (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {msg.content}
          </p>
        )}

        <p
          className={`mt-1 text-right text-[10px] ${
            mine ? "text-emerald-100" : "text-slate-400"
          }`}
        >
          {shortTime(msg.created_at)}
        </p>
      </div>
    </div>
  );
}
