import { useEffect, useRef, useState } from "react";
import { Play, Pause, Loader2, AlertCircle } from "lucide-react";

interface Props {
  url: string;
  mine: boolean;
}

export default function AudioPlayer({ url, mine }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";

    const onLoaded = () => {
      setDuration(audio.duration || 0);
      setLoading(false);
    };
    const onTime = () => setCurrent(audio.currentTime);
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
    };
    const onError = () => {
      setFailed(true);
      setLoading(false);
    };

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("durationchange", onLoaded);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("error", onError);

    audio.src = url;
    audio.load();

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("durationchange", onLoaded);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onError);
    };
  }, [url]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio || failed) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().catch(() => {
        setFailed(true);
        setPlaying(false);
      });
      setPlaying(true);
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration || failed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * duration;
    setCurrent(audio.currentTime);
  }

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  if (failed) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm">
        <AlertCircle className={`h-4 w-4 ${mine ? "text-emerald-200" : "text-red-400"}`} />
        <span className={mine ? "text-emerald-100" : "text-slate-500"}>Could not load audio</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 py-1">
      <button
        onClick={toggle}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
          mine ? "bg-white/20 hover:bg-white/30" : "bg-emerald-100 hover:bg-emerald-200"
        }`}
      >
        {loading ? (
          <Loader2 className={`h-4 w-4 animate-spin ${mine ? "text-white" : "text-emerald-600"}`} />
        ) : playing ? (
          <Pause className={`h-4 w-4 ${mine ? "text-white" : "text-emerald-600"}`} />
        ) : (
          <Play className={`h-4 w-4 ${mine ? "text-white" : "text-emerald-600"}`} />
        )}
      </button>
      <div className="flex-1">
        <div
          onClick={seek}
          className="h-1.5 cursor-pointer rounded-full bg-black/10"
        >
          <div
            className="h-full rounded-full bg-current opacity-60"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className={`mt-1 text-[10px] ${mine ? "text-emerald-100" : "text-slate-400"}`}>
          {fmt(current)} / {fmt(duration)}
        </p>
      </div>
    </div>
  );
}

function fmt(s: number): string {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
