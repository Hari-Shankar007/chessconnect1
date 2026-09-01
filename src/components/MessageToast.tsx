import { useEffect } from "react";
import { X, MessageSquare } from "lucide-react";

export interface ToastData {
  name: string;
  message: string;
  chatId: string;
}

interface Props {
  toast: ToastData | null;
  onDismiss: () => void;
  onClick: (chatId: string) => void;
}

export default function MessageToast({ toast, onDismiss, onClick }: Props) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div className="animate-toast fixed right-4 top-20 z-50 sm:right-6">
      <div
        onClick={() => onClick(toast.chatId)}
        className="flex w-72 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xl transition hover:border-emerald-300 sm:w-80"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800">{toast.name}</p>
          <p className="truncate text-sm text-slate-500">{toast.message}</p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
