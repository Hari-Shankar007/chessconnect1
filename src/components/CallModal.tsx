import { useCallback, useEffect, useRef, useState } from "react";
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { CallSignaling, CallType } from "@/lib/types";
import { initials } from "@/lib/utils";

type CallPhase =
  | "outgoing"
  | "incoming"
  | "connecting"
  | "active"
  | "ended";

interface Props {
  callId: string | null;
  chatId: string;
  myId: string;
  myName: string;
  theirId: string;
  theirName: string;
  isCaller: boolean;
  callType: CallType;
  incomingCall: CallSignaling | null;
  onEnd: () => void;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export default function CallModal({
  callId: propCallId,
  chatId,
  myId,
  myName,
  theirId,
  theirName,
  isCaller,
  callType,
  incomingCall,
  onEnd,
}: Props) {
  const [phase, setPhase] = useState<CallPhase>(
    isCaller ? "outgoing" : "incoming"
  );

  const [callId, setCallId] = useState<string | null>(propCallId);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep this value declared before any hook/effect that uses it.
  // Declaring it later causes a temporal-dead-zone runtime error in the
  // production/minified build (for example: "Cannot access 'Nt' before initialization").
  const isVideo = callType === "video";

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const callIdRef = useRef<string | null>(propCallId);

  const endedRef = useRef(false);

  // Prevent duplicate outgoing call creation.
  const outgoingStartedRef = useRef(false);

  // Prevent duplicate answer application.
  const answerAppliedRef = useRef(false);

  // Prevent duplicate accept setup.
  const acceptStartedRef = useRef(false);

  // Prevent duplicate onEnd calls.
  const onEndCalledRef = useRef(false);

  // Prevent duplicate active state/timer.
  const activeStartedRef = useRef(false);

  // Latest callback.
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // Latest phase.
  const phaseRef = useRef<CallPhase>(phase);
  phaseRef.current = phase;

  // Latest call type.
  const callTypeRef = useRef<CallType>(callType);
  callTypeRef.current = callType;

  /**
   * Mark the call as active exactly once.
   */
  const markActive = useCallback(() => {
    if (endedRef.current) return;
    if (activeStartedRef.current) return;

    activeStartedRef.current = true;
    phaseRef.current = "active";
    setPhase("active");

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    setDuration(0);

    timerRef.current = setInterval(() => {
      if (endedRef.current) return;
      setDuration((current) => current + 1);
    }, 1000);
  }, []);

  /**
   * Cleanup all WebRTC resources.
   */
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;

      try {
        pcRef.current.close();
      } catch {
        // Ignore close errors.
      }

      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors.
        }
      });

      localStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.onloadedmetadata = null;
      localVideoRef.current.srcObject = null;
    }

    remoteStreamRef.current = null;

    if (remoteVideoRef.current) {
      remoteVideoRef.current.onloadedmetadata = null;
      remoteVideoRef.current.srcObject = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  }, []);

  /**
   * Update a call row in Supabase.
   */
  const updateCall = useCallback(
    async (id: string, updates: Record<string, unknown>) => {
      const { error: updateError } = await supabase
        .from("call_signaling")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (updateError) {
        console.error("Failed to update call:", updateError);
      }
    },
    []
  );

  /**
   * End call safely.
   */
  const endCall = useCallback(
    async (
      reason: "ended" | "declined" | "missed" = "ended"
    ) => {
      if (endedRef.current) return;

      endedRef.current = true;
      phaseRef.current = "ended";
      setPhase("ended");

      const currentCallId = callIdRef.current;

      if (currentCallId) {
        await updateCall(currentCallId, {
          status: reason,
        });
      }

      cleanup();

      if (!onEndCalledRef.current) {
        onEndCalledRef.current = true;

        setTimeout(() => {
          onEndRef.current();
        }, 500);
      }
    },
    [cleanup, updateCall]
  );

  /**
   * Wait until ICE gathering has completed.
   */
  const waitForIceGathering = useCallback(
    async (pc: RTCPeerConnection) => {
      if (pc.iceGatheringState === "complete") {
        return;
      }

      await new Promise<void>((resolve) => {
        let resolved = false;

        const finish = () => {
          if (resolved) return;

          resolved = true;

          pc.removeEventListener(
            "icegatheringstatechange",
            checkState
          );

          resolve();
        };

        const checkState = () => {
          if (pc.iceGatheringState === "complete") {
            finish();
          }
        };

        pc.addEventListener(
          "icegatheringstatechange",
          checkState
        );

        // Never wait forever.
        setTimeout(finish, 5000);
      });
    },
    []
  );

  /**
   * Convert Supabase ICE data into an array.
   */
  const parseIceCandidates = useCallback(
    (value: unknown): string[] => {
      if (!value) return [];

      try {
        if (typeof value === "string") {
          const parsed = JSON.parse(value);

          if (Array.isArray(parsed)) {
            return parsed.filter(
              (item): item is string =>
                typeof item === "string"
            );
          }

          return [];
        }

        if (Array.isArray(value)) {
          return value.filter(
            (item): item is string =>
              typeof item === "string"
          );
        }
      } catch (error) {
        console.error(
          "Failed to parse ICE candidates:",
          error
        );
      }

      return [];
    },
    []
  );

  /**
   * Add remote ICE candidates safely.
   */
  const addIceCandidates = useCallback(
    async (
      pc: RTCPeerConnection,
      candidates: unknown
    ) => {
      const iceCandidates =
        parseIceCandidates(candidates);

      for (const candidateString of iceCandidates) {
        try {
          const candidate =
            JSON.parse(candidateString);

          await pc.addIceCandidate(candidate);
        } catch (error) {
          console.warn(
            "Could not add remote ICE candidate:",
            error
          );
        }
      }
    },
    [parseIceCandidates]
  );

  /**
   * Attach remote media.
   *
   * Keep the stream in a ref because the <video> element is only
   * mounted after the call becomes active. Without this, ontrack can
   * fire while the ref is still null and the remote video is lost.
   */
  const attachRemoteStream = useCallback(
    (stream: MediaStream) => {
      remoteStreamRef.current = stream;

      if (callTypeRef.current === "video") {
        const video = remoteVideoRef.current;

        if (video) {
          video.srcObject = stream;

          const playVideo = () => {
            video.play().catch((error) => {
              console.warn(
                "Remote video autoplay/playback was blocked:",
                error
              );
            });
          };

          if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
            playVideo();
          } else {
            video.onloadedmetadata = playVideo;
          }
        }
      } else {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;

          remoteAudioRef.current
            .play()
            .catch(() => {
              // Browser may require interaction.
            });
        }
      }
    },
    []
  );

  /**
   * Configure WebRTC connection state handlers.
   *
   * This is attached directly after creating the peer
   * connection, so it cannot miss the connected event.
   */
  const configureConnectionHandlers = useCallback(
    (pc: RTCPeerConnection) => {
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;

        console.log(
          "WebRTC connection state:",
          state
        );

        if (state === "connected") {
          markActive();
          return;
        }

        if (
          state === "failed" ||
          state === "closed"
        ) {
          if (!endedRef.current) {
            endCall("ended");
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;

        console.log(
          "WebRTC ICE state:",
          state
        );

        if (
          state === "connected" ||
          state === "completed"
        ) {
          markActive();
        }

        if (state === "failed") {
          if (!endedRef.current) {
            endCall("ended");
          }
        }
      };
    },
    [endCall, markActive]
  );

  // ============================================================
  // CALLER
  // Create outgoing call exactly once.
  // ============================================================

  const startOutgoingCall = useCallback(async () => {
    if (endedRef.current) return;

    if (outgoingStartedRef.current) {
      return;
    }

    outgoingStartedRef.current = true;

    try {
      setError(null);

      if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        throw new Error(
          "Camera and microphone are not available."
        );
      }

      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: callType === "video",
        });

      if (endedRef.current) {
        stream
          .getTracks()
          .forEach((track) => track.stop());

        return;
      }

      localStreamRef.current = stream;

      // The local <video> element is mounted only after the call
      // becomes active. Keep the stream in the ref and attach it
      // from the media-element effect below.
      const pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
      });

      pcRef.current = pc;

      configureConnectionHandlers(pc);

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        const remoteStream =
          event.streams?.[0] ??
          new MediaStream([event.track]);

        attachRemoteStream(remoteStream);
      };

      const callerIce: string[] = [];

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          callerIce.push(
            JSON.stringify(event.candidate)
          );
        }
      };

      const offer =
        await pc.createOffer();

      await pc.setLocalDescription(offer);

      await waitForIceGathering(pc);

      if (endedRef.current) {
        return;
      }

      const localDescription =
        pc.localDescription;

      if (!localDescription) {
        throw new Error(
          "Could not create local SDP offer."
        );
      }

      const {
        data,
        error: insertError,
      } = await supabase
        .from("call_signaling")
        .insert({
          chat_id: chatId,
          caller_id: myId,
          callee_id: theirId,
          call_type: callType,
          status: "ringing",
          sdp_offer: JSON.stringify(
            localDescription
          ),
          caller_ice: callerIce,
        })
        .select()
        .single();

      if (insertError || !data) {
        console.error(
          "Could not create call:",
          insertError
        );

        setError("Could not start call.");

        outgoingStartedRef.current = false;

        await endCall("ended");

        return;
      }

      const newCall =
        data as CallSignaling;

      callIdRef.current = newCall.id;
      setCallId(newCall.id);

      console.log(
        "Outgoing call created:",
        newCall.id
      );
    } catch (error) {
      console.error(
        "Failed to start outgoing call:",
        error
      );

      if (!endedRef.current) {
        setError(
          "Could not access camera/microphone. Please check browser permissions."
        );

        outgoingStartedRef.current = false;

        await endCall("ended");
      }
    }
  }, [
    attachRemoteStream,
    callType,
    chatId,
    configureConnectionHandlers,
    endCall,
    myId,
    theirId,
    waitForIceGathering,
  ]);

  // ============================================================
  // CALLEE
  // Accept incoming call exactly once.
  // ============================================================

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    if (endedRef.current) return;

    if (acceptStartedRef.current) {
      return;
    }

    acceptStartedRef.current = true;

    phaseRef.current = "connecting";
    setPhase("connecting");
    setError(null);

    try {
      if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        throw new Error(
          "Camera and microphone are not available."
        );
      }

      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
          video:
            incomingCall.call_type === "video",
        });

      if (endedRef.current) {
        stream
          .getTracks()
          .forEach((track) => track.stop());

        return;
      }

      localStreamRef.current = stream;

      // The local <video> element is mounted only after the call
      // becomes active. Keep the stream in the ref and attach it
      // from the media-element effect below.
      const pc =
        new RTCPeerConnection({
          iceServers: ICE_SERVERS,
        });

      pcRef.current = pc;

      configureConnectionHandlers(pc);

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.ontrack = (event) => {
        const remoteStream =
          event.streams?.[0] ??
          new MediaStream([event.track]);

        attachRemoteStream(remoteStream);
      };

      const calleeIce: string[] = [];

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          calleeIce.push(
            JSON.stringify(event.candidate)
          );
        }
      };

      if (!incomingCall.sdp_offer) {
        throw new Error(
          "Missing SDP offer."
        );
      }

      await pc.setRemoteDescription(
        JSON.parse(incomingCall.sdp_offer)
      );

      await addIceCandidates(
        pc,
        incomingCall.caller_ice
      );

      const answer =
        await pc.createAnswer();

      await pc.setLocalDescription(answer);

      await waitForIceGathering(pc);

      if (endedRef.current) {
        return;
      }

      const localDescription =
        pc.localDescription;

      if (!localDescription) {
        throw new Error(
          "Could not create local SDP answer."
        );
      }

      await updateCall(
        incomingCall.id,
        {
          status: "accepted",
          sdp_answer:
            JSON.stringify(
              localDescription
            ),
          callee_ice: calleeIce,
        }
      );

      callIdRef.current =
        incomingCall.id;

      setCallId(incomingCall.id);

      console.log(
        "Incoming call accepted:",
        incomingCall.id
      );

      // The actual WebRTC connection state will
      // switch the UI to active.
      if (
        pc.connectionState ===
          "connected" ||
        pc.iceConnectionState ===
          "connected" ||
        pc.iceConnectionState ===
          "completed"
      ) {
        markActive();
      }
    } catch (error) {
      console.error(
        "Failed to accept incoming call:",
        error
      );

      setError(
        "Could not access camera/microphone. Please check browser permissions."
      );

      acceptStartedRef.current = false;

      await endCall("ended");
    }
  }, [
    addIceCandidates,
    attachRemoteStream,
    configureConnectionHandlers,
    endCall,
    incomingCall,
    markActive,
    updateCall,
    waitForIceGathering,
  ]);

  // ============================================================
  // CALLER START
  // ============================================================

  useEffect(() => {
    if (!isCaller) return;
    if (propCallId) return;

    startOutgoingCall();
  }, [
    isCaller,
    propCallId,
    startOutgoingCall,
  ]);

  // ============================================================
  // CALLER LISTEN FOR ANSWER
  // Realtime + polling fallback.
  // ============================================================

  useEffect(() => {
    if (!isCaller) return;
    if (!callId) return;

    const cid = callId;

    let cancelled = false;

    const processCallUpdate = async (
      row: CallSignaling
    ) => {
      if (cancelled) return;
      if (endedRef.current) return;

      if (
        row.status === "declined" ||
        row.status === "ended" ||
        row.status === "missed"
      ) {
        await endCall("ended");
        return;
      }

      if (
        row.status !== "accepted" ||
        !row.sdp_answer ||
        !pcRef.current
      ) {
        return;
      }

      const pc = pcRef.current;

      if (!answerAppliedRef.current) {
        try {
          // Make sure we never apply the same answer twice.
          answerAppliedRef.current = true;

          await pc.setRemoteDescription(
            JSON.parse(row.sdp_answer)
          );

          await addIceCandidates(
            pc,
            row.callee_ice
          );
        } catch (error) {
          console.error(
            "Failed to apply call answer:",
            error
          );

          answerAppliedRef.current = false;

          return;
        }
      }

      if (
        pc.connectionState === "connected" ||
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        markActive();
      }
    };

    const channel = supabase
      .channel(`call-answer-${cid}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_signaling",
          filter: `id=eq.${cid}`,
        },
        async (payload) => {
          await processCallUpdate(
            payload.new as CallSignaling
          );
        }
      )
      .subscribe();

    /**
     * Poll ONLY the existing call.
     *
     * This never creates another call.
     */
    const pollInterval =
      setInterval(async () => {
        if (cancelled) return;
        if (endedRef.current) return;

        const {
          data,
          error: pollError,
        } = await supabase
          .from("call_signaling")
          .select(
            "id, status, sdp_answer, callee_ice"
          )
          .eq("id", cid)
          .maybeSingle();

        if (pollError) {
          console.warn(
            "Call polling error:",
            pollError
          );

          return;
        }

        if (!data) return;

        await processCallUpdate(
          data as CallSignaling
        );
      }, 1500);

    return () => {
      cancelled = true;

      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [
    addIceCandidates,
    callId,
    endCall,
    isCaller,
    markActive,
  ]);

  // ============================================================
  // CALLEE LISTEN FOR REMOTE END
  // ============================================================

  useEffect(() => {
    if (isCaller) return;
    if (!incomingCall) return;

    const cid = incomingCall.id;

    let cancelled = false;

    const handleRemoteStatus = async (
      row: CallSignaling
    ) => {
      if (cancelled) return;
      if (endedRef.current) return;

      if (
        row.status === "ended" ||
        row.status === "missed"
      ) {
        await endCall("ended");
      }
    };

    const channel = supabase
      .channel(
        `call-remote-end-${cid}`
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_signaling",
          filter: `id=eq.${cid}`,
        },
        async (payload) => {
          await handleRemoteStatus(
            payload.new as CallSignaling
          );
        }
      )
      .subscribe();

    /**
     * Poll ONLY this specific call.
     */
    const pollInterval =
      setInterval(async () => {
        if (cancelled) return;
        if (endedRef.current) return;

        const {
          data,
          error: pollError,
        } = await supabase
          .from("call_signaling")
          .select("id, status")
          .eq("id", cid)
          .maybeSingle();

        if (pollError) {
          console.warn(
            "Incoming call polling error:",
            pollError
          );

          return;
        }

        if (!data) return;

        await handleRemoteStatus(
          data as CallSignaling
        );
      }, 1500);

    return () => {
      cancelled = true;

      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [
    endCall,
    incomingCall,
    isCaller,
  ]);

  // ============================================================
  // CALLER TIMEOUT
  // ============================================================

  useEffect(() => {
    if (!isCaller) return;
    if (!callId) return;
    if (phase !== "outgoing") return;

    const timeout = setTimeout(() => {
      if (
        !endedRef.current &&
        phaseRef.current === "outgoing"
      ) {
        endCall("missed");
      }
    }, 45000);

    return () => {
      clearTimeout(timeout);
    };
  }, [
    callId,
    endCall,
    isCaller,
    phase,
  ]);

  // ============================================================
  // ATTACH MEDIA ELEMENTS
  // ============================================================
  //
  // The video elements are rendered only when phase === "active".
  // WebRTC can deliver ontrack before React has mounted those
  // elements, so attach the streams whenever the active UI mounts.
  //
  useEffect(() => {
    if (!isVideo || phase !== "active") return;

    const localStream = localStreamRef.current;
    const localVideo = localVideoRef.current;

    if (localStream && localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true;

      localVideo.play().catch((error) => {
        console.warn(
          "Local video autoplay/playback was blocked:",
          error
        );
      });
    }

    const remoteStream = remoteStreamRef.current;
    const remoteVideo = remoteVideoRef.current;

    if (remoteStream && remoteVideo) {
      remoteVideo.srcObject = remoteStream;

      const playRemoteVideo = () => {
        remoteVideo.play().catch((error) => {
          console.warn(
            "Remote video autoplay/playback was blocked:",
            error
          );
        });
      };

      if (
        remoteVideo.readyState >=
        HTMLMediaElement.HAVE_METADATA
      ) {
        playRemoteVideo();
      } else {
        remoteVideo.onloadedmetadata = playRemoteVideo;
      }
    }

    return () => {
      if (remoteVideo) {
        remoteVideo.onloadedmetadata = null;
      }
    };
  }, [isVideo, phase]);

  // ============================================================
  // CLEANUP ON UNMOUNT
  // ============================================================

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // ============================================================
  // CONTROLS
  // ============================================================

  function toggleMute() {
    const stream =
      localStreamRef.current;

    if (!stream) return;

    const audioTracks =
      stream.getAudioTracks();

    if (audioTracks.length === 0) return;

    const nextMuted = !muted;

    audioTracks.forEach((track) => {
      track.enabled = !nextMuted;
    });

    setMuted(nextMuted);
  }

  function toggleVideo() {
    const stream =
      localStreamRef.current;

    if (!stream) return;

    const videoTracks =
      stream.getVideoTracks();

    if (videoTracks.length === 0) return;

    const nextVideoOff = !videoOff;

    videoTracks.forEach((track) => {
      track.enabled = !nextVideoOff;
    });

    setVideoOff(nextVideoOff);
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-black text-white">
      {/* Remote video fills the entire meeting stage */}
      {isVideo && phase === "active" ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full object-cover bg-black"
        />
      ) : (
        <div className="absolute inset-0 bg-slate-950" />
      )}

      {/* Remote audio */}
      <audio ref={remoteAudioRef} autoPlay className="hidden" />

      {/* Top bar - Meet style */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pb-10 pt-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="truncate text-base font-medium sm:text-lg">
            {theirName}
          </h2>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-white/70 sm:text-sm">
            {phase === "outgoing" && (
              <>
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                <span>{isVideo ? "Calling…" : "Calling…"}</span>
              </>
            )}
            {phase === "incoming" && <span>Incoming call</span>}
            {phase === "connecting" && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Connecting…</span>
              </>
            )}
            {phase === "active" && <span>{fmtDuration(duration)}</span>}
            {phase === "ended" && <span>Call ended</span>}
          </div>
        </div>

        {isVideo && phase === "active" && (
          <div className="rounded-full bg-black/40 px-3 py-1 text-xs text-white/80 backdrop-blur-md">
            Video call
          </div>
        )}
      </div>

      {/* Center state / avatar for calls before video connects */}
      {(!isVideo || phase !== "active") && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-6">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-emerald-600 text-3xl font-semibold shadow-2xl ring-4 ring-white/10 sm:h-36 sm:w-36 sm:text-4xl">
              {initials(theirName)}
            </div>
            <h3 className="mt-5 text-xl font-semibold sm:text-2xl">
              {theirName}
            </h3>
            <p className="mt-2 text-sm text-white/60">
              {phase === "outgoing" && "Waiting for them to answer…"}
              {phase === "incoming" && "Wants to start a call with you"}
              {phase === "connecting" && "Setting up your call…"}
              {phase === "ended" && "Call ended"}
            </p>
            {error && (
              <p className="mt-4 max-w-sm rounded-xl bg-red-500/10 px-4 py-2 text-center text-sm text-red-300">
                {error}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Local preview - small floating tile like Google Meet */}
      {isVideo && phase === "active" && (
        <div className="absolute right-3 top-16 z-30 h-28 w-24 overflow-hidden rounded-xl border border-white/20 bg-slate-900 shadow-2xl sm:right-6 sm:top-20 sm:h-40 sm:w-56">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />

          {videoOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold">
                {initials(myName)}
              </div>
            </div>
          )}

          <div className="absolute bottom-2 left-2 rounded-md bg-black/50 px-2 py-1 text-[10px] text-white/80 backdrop-blur-sm">
            You
          </div>
        </div>
      )}

      {/* Incoming / outgoing actions */}
      {(phase === "incoming" || phase === "outgoing") && (
        <div className="absolute inset-x-0 bottom-0 z-40 flex justify-center bg-gradient-to-t from-black/80 via-black/40 to-transparent px-6 pb-8 pt-20 sm:pb-10">
          <div className="flex items-center gap-6">
            {phase === "incoming" && !isCaller && (
              <>
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={() => endCall("declined")}
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-xl transition hover:bg-red-700 active:scale-95"
                    title="Decline"
                    aria-label="Decline call"
                  >
                    <PhoneOff className="h-7 w-7" />
                  </button>
                  <span className="text-xs text-white/70">Decline</span>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={acceptCall}
                    disabled={acceptStartedRef.current}
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xl transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                    title="Accept"
                    aria-label="Accept call"
                  >
                    {isVideo ? (
                      <Video className="h-7 w-7" />
                    ) : (
                      <Phone className="h-7 w-7" />
                    )}
                  </button>
                  <span className="text-xs text-white/70">Accept</span>
                </div>
              </>
            )}

            {phase === "outgoing" && isCaller && (
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={() => endCall("ended")}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-xl transition hover:bg-red-700 active:scale-95"
                  title="Cancel"
                  aria-label="Cancel call"
                >
                  <PhoneOff className="h-7 w-7" />
                </button>
                <span className="text-xs text-white/70">Cancel</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom control bar - Google Meet inspired */}
      {phase === "active" && (
        <div className="absolute inset-x-0 bottom-0 z-40 flex justify-center bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-5 pt-16 sm:pb-7">
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/85 p-2 shadow-2xl backdrop-blur-xl sm:gap-3 sm:rounded-full sm:px-4">
            <button
              onClick={toggleMute}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition active:scale-95 sm:h-14 sm:w-14 ${
                muted
                  ? "bg-white text-slate-900"
                  : "bg-white/10 text-white hover:bg-white/20"
              }`}
              title={muted ? "Turn on microphone" : "Turn off microphone"}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            >
              {muted ? (
                <MicOff className="h-5 w-5 sm:h-6 sm:w-6" />
              ) : (
                <Mic className="h-5 w-5 sm:h-6 sm:w-6" />
              )}
            </button>

            {isVideo && (
              <button
                onClick={toggleVideo}
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition active:scale-95 sm:h-14 sm:w-14 ${
                  videoOff
                    ? "bg-white text-slate-900"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
                title={videoOff ? "Turn on camera" : "Turn off camera"}
                aria-label={videoOff ? "Turn on camera" : "Turn off camera"}
              >
                {videoOff ? (
                  <VideoOff className="h-5 w-5 sm:h-6 sm:w-6" />
                ) : (
                  <Video className="h-5 w-5 sm:h-6 sm:w-6" />
                )}
              </button>
            )}

            <button
              onClick={() => endCall("ended")}
              className="ml-1 flex h-12 min-w-[64px] shrink-0 items-center justify-center rounded-full bg-red-600 px-5 text-white shadow-lg transition hover:bg-red-700 active:scale-95 sm:h-14 sm:min-w-[72px]"
              title="End call"
              aria-label="End call"
            >
              <PhoneOff className="h-5 w-5 sm:h-6 sm:w-6" />
            </button>
          </div>
        </div>
      )}

      {phase === "ended" && (
        <div className="absolute inset-x-0 bottom-8 z-40 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-white/70" />
        </div>
      )}

      {/* Error for active video call */}
      {error && phase === "active" && (
        <div className="absolute left-1/2 top-20 z-40 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl border border-red-400/20 bg-red-950/80 px-4 py-3 text-center text-sm text-red-200 shadow-xl backdrop-blur-md">
          {error}
        </div>
      )}
    </div>
  );
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;

  return `${m}:${sec
    .toString()
    .padStart(2, "0")}`;
}
