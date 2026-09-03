import { useCallback, useEffect, useRef, useState } from "react";
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  MonitorUp,
  MonitorOff,
  Loader2,
  Volume2,
  Maximize2,
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

  const [screenSharing, setScreenSharing] = useState(false);
  const [screenShareError, setScreenShareError] = useState<string | null>(
    null
  );

  const [error, setError] = useState<string | null>(null);

  const [remoteVideoFullscreen, setRemoteVideoFullscreen] =
    useState(false);

  const isVideo = callType === "video";

  const pcRef = useRef<RTCPeerConnection | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  const screenStreamRef = useRef<MediaStream | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const callIdRef = useRef<string | null>(propCallId);

  const endedRef = useRef(false);

  const outgoingStartedRef = useRef(false);
  const answerAppliedRef = useRef(false);
  const acceptStartedRef = useRef(false);
  const onEndCalledRef = useRef(false);
  const activeStartedRef = useRef(false);

  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const phaseRef = useRef<CallPhase>(phase);
  phaseRef.current = phase;

  const callTypeRef = useRef<CallType>(callType);
  callTypeRef.current = callType;

  /**
   * Mark call active exactly once.
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
   * Stop screen sharing and return to camera.
   */
  const stopScreenSharing = useCallback(async () => {
    const pc = pcRef.current;
    const cameraStream = localStreamRef.current;
    const screenStream = screenStreamRef.current;

    if (screenStream) {
      screenStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors.
        }
      });
    }

    screenStreamRef.current = null;

    if (pc && videoSenderRef.current && cameraStream) {
      const cameraTrack = cameraStream.getVideoTracks()[0];

      if (cameraTrack) {
        try {
          await videoSenderRef.current.replaceTrack(cameraTrack);
        } catch (error) {
          console.error(
            "Failed to restore camera after screen sharing:",
            error
          );
        }
      }
    }

    setScreenSharing(false);
    setScreenShareError(null);

    const localVideo = localVideoRef.current;

    if (localVideo && cameraStream) {
      localVideo.srcObject = cameraStream;

      localVideo.play().catch(() => {
        // Ignore autoplay errors.
      });
    }
  }, []);

  /**
   * Start Google Meet style screen sharing.
   */
  const startScreenSharing = useCallback(async () => {
    if (!isVideo) return;
    if (!pcRef.current) return;
    if (!localStreamRef.current) return;
    if (screenSharing) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenShareError(
        "Screen sharing is not supported by this browser."
      );
      return;
    }

    try {
      setScreenShareError(null);

      const screenStream =
        await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: {
              ideal: 30,
              max: 60,
            },
          },
          audio: true,
        });

      const screenTrack = screenStream.getVideoTracks()[0];

      if (!screenTrack) {
        screenStream.getTracks().forEach((track) => track.stop());

        throw new Error("Could not get screen video track.");
      }

      const pc = pcRef.current;

      let videoSender = videoSenderRef.current;

      if (!videoSender) {
        videoSender =
          pc
            .getSenders()
            .find(
              (sender) =>
                sender.track?.kind === "video"
            ) ?? null;

        videoSenderRef.current = videoSender;
      }

      if (!videoSender) {
        screenStream.getTracks().forEach((track) => track.stop());

        throw new Error(
          "Could not find the video connection."
        );
      }

      await videoSender.replaceTrack(screenTrack);

      screenStreamRef.current = screenStream;

      setScreenSharing(true);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = screenStream;

        localVideoRef.current.play().catch(() => {
          // Ignore autoplay errors.
        });
      }

      /**
       * Browser native Stop Sharing button.
       */
      screenTrack.onended = () => {
        void stopScreenSharing();
      };
    } catch (error) {
      console.error(
        "Screen sharing failed:",
        error
      );

      if (
        error instanceof DOMException &&
        error.name === "NotAllowedError"
      ) {
        setScreenShareError(
          "Screen sharing was cancelled."
        );
      } else {
        setScreenShareError(
          "Could not start screen sharing."
        );
      }

      setScreenSharing(false);
    }
  }, [
    isVideo,
    screenSharing,
    stopScreenSharing,
  ]);

  /**
   * Cleanup all WebRTC resources.
   */
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (screenStreamRef.current) {
      screenStreamRef.current
        .getTracks()
        .forEach((track) => {
          try {
            track.stop();
          } catch {
            // Ignore track stop errors.
          }
        });

      screenStreamRef.current = null;
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

    videoSenderRef.current = null;

    if (localStreamRef.current) {
      localStreamRef.current
        .getTracks()
        .forEach((track) => {
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

    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }

    setScreenSharing(false);
  }, []);

  /**
   * Update call row.
   */
  const updateCall = useCallback(
    async (
      id: string,
      updates: Record<string, unknown>
    ) => {
      const { error: updateError } =
        await supabase
          .from("call_signaling")
          .update({
            ...updates,
            updated_at:
              new Date().toISOString(),
          })
          .eq("id", id);

      if (updateError) {
        console.error(
          "Failed to update call:",
          updateError
        );
      }
    },
    []
  );

  /**
   * End call safely.
   */
  const endCall = useCallback(
    async (
      reason:
        | "ended"
        | "declined"
        | "missed" = "ended"
    ) => {
      if (endedRef.current) return;

      endedRef.current = true;

      phaseRef.current = "ended";
      setPhase("ended");

      const currentCallId =
        callIdRef.current;

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
   * Wait for ICE gathering.
   */
  const waitForIceGathering = useCallback(
    async (pc: RTCPeerConnection) => {
      if (
        pc.iceGatheringState ===
        "complete"
      ) {
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
          if (
            pc.iceGatheringState ===
            "complete"
          ) {
            finish();
          }
        };

        pc.addEventListener(
          "icegatheringstatechange",
          checkState
        );

        setTimeout(finish, 5000);
      });
    },
    []
  );

  /**
   * Parse ICE candidates.
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
   * Add remote ICE candidates.
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

          await pc.addIceCandidate(
            candidate
          );
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
   * Attach remote stream.
   */
  const attachRemoteStream = useCallback(
    (stream: MediaStream) => {
      remoteStreamRef.current = stream;

      if (
        callTypeRef.current === "video"
      ) {
        const video =
          remoteVideoRef.current;

        if (video) {
          video.srcObject = stream;

          const playVideo = () => {
            video
              .play()
              .catch((error) => {
                console.warn(
                  "Remote video playback was blocked:",
                  error
                );
              });
          };

          if (
            video.readyState >=
            HTMLMediaElement.HAVE_METADATA
          ) {
            playVideo();
          } else {
            video.onloadedmetadata =
              playVideo;
          }
        }
      } else {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject =
            stream;

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
   * Configure connection handlers.
   */
  const configureConnectionHandlers =
    useCallback(
      (pc: RTCPeerConnection) => {
        pc.onconnectionstatechange =
          () => {
            const state =
              pc.connectionState;

            console.log(
              "WebRTC connection state:",
              state
            );

            if (
              state === "connected"
            ) {
              markActive();
              return;
            }

            if (
              state === "failed" ||
              state === "closed"
            ) {
              if (!endedRef.current) {
                void endCall("ended");
              }
            }
          };

        pc.oniceconnectionstatechange =
          () => {
            const state =
              pc.iceConnectionState;

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
                void endCall("ended");
              }
            }
          };
      },
      [endCall, markActive]
    );

  // ============================================================
  // CALLER
  // ============================================================

  const startOutgoingCall =
    useCallback(async () => {
      if (endedRef.current) return;

      if (outgoingStartedRef.current) {
        return;
      }

      outgoingStartedRef.current = true;

      try {
        setError(null);

        if (
          !navigator.mediaDevices ||
          !navigator.mediaDevices
            .getUserMedia
        ) {
          throw new Error(
            "Camera and microphone are not available."
          );
        }

        const stream =
          await navigator.mediaDevices.getUserMedia(
            {
              audio: true,
              video: callType === "video",
            }
          );

        if (endedRef.current) {
          stream
            .getTracks()
            .forEach((track) =>
              track.stop()
            );

          return;
        }

        localStreamRef.current =
          stream;

        const pc =
          new RTCPeerConnection({
            iceServers: ICE_SERVERS,
          });

        pcRef.current = pc;

        configureConnectionHandlers(pc);

        stream
          .getTracks()
          .forEach((track) => {
            const sender =
              pc.addTrack(
                track,
                stream
              );

            if (
              track.kind === "video"
            ) {
              videoSenderRef.current =
                sender;
            }
          });

        pc.ontrack = (event) => {
          const remoteStream =
            event.streams?.[0] ??
            new MediaStream([
              event.track,
            ]);

          attachRemoteStream(
            remoteStream
          );
        };

        const callerIce: string[] =
          [];

        pc.onicecandidate = (
          event
        ) => {
          if (event.candidate) {
            callerIce.push(
              JSON.stringify(
                event.candidate
              )
            );
          }
        };

        const offer =
          await pc.createOffer();

        await pc.setLocalDescription(
          offer
        );

        await waitForIceGathering(
          pc
        );

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
            sdp_offer:
              JSON.stringify(
                localDescription
              ),
            caller_ice: callerIce,
          })
          .select()
          .single();

        if (
          insertError ||
          !data
        ) {
          console.error(
            "Could not create call:",
            insertError
          );

          setError(
            "Could not start call."
          );

          outgoingStartedRef.current =
            false;

          await endCall("ended");

          return;
        }

        const newCall =
          data as CallSignaling;

        callIdRef.current =
          newCall.id;

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

          outgoingStartedRef.current =
            false;

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
  // ============================================================

  const acceptCall =
    useCallback(async () => {
      if (!incomingCall) return;
      if (endedRef.current) return;

      if (acceptStartedRef.current) {
        return;
      }

      acceptStartedRef.current = true;

      phaseRef.current =
        "connecting";

      setPhase("connecting");
      setError(null);

      try {
        if (
          !navigator.mediaDevices ||
          !navigator.mediaDevices
            .getUserMedia
        ) {
          throw new Error(
            "Camera and microphone are not available."
          );
        }

        const stream =
          await navigator.mediaDevices.getUserMedia(
            {
              audio: true,
              video:
                incomingCall.call_type ===
                "video",
            }
          );

        if (endedRef.current) {
          stream
            .getTracks()
            .forEach((track) =>
              track.stop()
            );

          return;
        }

        localStreamRef.current =
          stream;

        const pc =
          new RTCPeerConnection({
            iceServers: ICE_SERVERS,
          });

        pcRef.current = pc;

        configureConnectionHandlers(pc);

        stream
          .getTracks()
          .forEach((track) => {
            const sender =
              pc.addTrack(
                track,
                stream
              );

            if (
              track.kind === "video"
            ) {
              videoSenderRef.current =
                sender;
            }
          });

        pc.ontrack = (event) => {
          const remoteStream =
            event.streams?.[0] ??
            new MediaStream([
              event.track,
            ]);

          attachRemoteStream(
            remoteStream
          );
        };

        const calleeIce: string[] =
          [];

        pc.onicecandidate = (
          event
        ) => {
          if (event.candidate) {
            calleeIce.push(
              JSON.stringify(
                event.candidate
              )
            );
          }
        };

        if (
          !incomingCall.sdp_offer
        ) {
          throw new Error(
            "Missing SDP offer."
          );
        }

        await pc.setRemoteDescription(
          JSON.parse(
            incomingCall.sdp_offer
          )
        );

        await addIceCandidates(
          pc,
          incomingCall.caller_ice
        );

        const answer =
          await pc.createAnswer();

        await pc.setLocalDescription(
          answer
        );

        await waitForIceGathering(
          pc
        );

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
            callee_ice:
              calleeIce,
          }
        );

        callIdRef.current =
          incomingCall.id;

        setCallId(
          incomingCall.id
        );

        console.log(
          "Incoming call accepted:",
          incomingCall.id
        );

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

        acceptStartedRef.current =
          false;

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
  // RINGTONE
  // ============================================================

  useEffect(() => {
    if (
      isCaller ||
      phase !== "incoming" ||
      endedRef.current
    ) {
      if (ringtoneRef.current) {
        ringtoneRef.current.pause();
        ringtoneRef.current.currentTime =
          0;
      }

      return;
    }

    const ringtone =
      ringtoneRef.current;

    if (!ringtone) return;

    ringtone.loop = true;
    ringtone.volume = 1;

    const playRingtone =
      async () => {
        try {
          ringtone.currentTime = 0;
          await ringtone.play();
        } catch (error) {
          console.warn(
            "Incoming call ringtone playback was blocked:",
            error
          );
        }
      };

    void playRingtone();

    return () => {
      ringtone.pause();
      ringtone.currentTime = 0;
    };
  }, [isCaller, phase]);

  // ============================================================
  // CALLER START
  // ============================================================

  useEffect(() => {
    if (!isCaller) return;
    if (propCallId) return;

    void startOutgoingCall();
  }, [
    isCaller,
    propCallId,
    startOutgoingCall,
  ]);

  // ============================================================
  // CALLER ANSWER LISTENER
  // ============================================================

  useEffect(() => {
    if (!isCaller) return;
    if (!callId) return;

    const cid = callId;

    let cancelled = false;

    const processCallUpdate =
      async (row: CallSignaling) => {
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

        if (
          !answerAppliedRef.current
        ) {
          try {
            answerAppliedRef.current =
              true;

            await pc.setRemoteDescription(
              JSON.parse(
                row.sdp_answer
              )
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

            answerAppliedRef.current =
              false;

            return;
          }
        }

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
      };

    const channel = supabase
      .channel(
        `call-answer-${cid}`
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
          await processCallUpdate(
            payload.new as CallSignaling
          );
        }
      )
      .subscribe();

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

      supabase.removeChannel(
        channel
      );

      clearInterval(
        pollInterval
      );
    };
  }, [
    addIceCandidates,
    callId,
    endCall,
    isCaller,
    markActive,
  ]);

  // ============================================================
  // CALLEE REMOTE END
  // ============================================================

  useEffect(() => {
    if (isCaller) return;
    if (!incomingCall) return;

    const cid = incomingCall.id;

    let cancelled = false;

    const handleRemoteStatus =
      async (row: CallSignaling) => {
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
            "id, status"
          )
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

      supabase.removeChannel(
        channel
      );

      clearInterval(
        pollInterval
      );
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
        phaseRef.current ===
          "outgoing"
      ) {
        void endCall("missed");
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
  // ATTACH MEDIA
  // ============================================================

  useEffect(() => {
    if (!isVideo) return;
    if (phase !== "active") return;

    const localStream =
      localStreamRef.current;

    const localVideo =
      localVideoRef.current;

    if (
      localStream &&
      localVideo &&
      !screenSharing
    ) {
      localVideo.srcObject =
        localStream;

      localVideo.muted = true;

      localVideo.play().catch(() => {
        // Ignore autoplay errors.
      });
    }

    const remoteStream =
      remoteStreamRef.current;

    const remoteVideo =
      remoteVideoRef.current;

    if (
      remoteStream &&
      remoteVideo
    ) {
      remoteVideo.srcObject =
        remoteStream;

      const playRemoteVideo =
        () => {
          remoteVideo
            .play()
            .catch(() => {
              // Ignore autoplay errors.
            });
        };

      if (
        remoteVideo.readyState >=
        HTMLMediaElement.HAVE_METADATA
      ) {
        playRemoteVideo();
      } else {
        remoteVideo.onloadedmetadata =
          playRemoteVideo;
      }
    }

    return () => {
      if (remoteVideo) {
        remoteVideo.onloadedmetadata =
          null;
      }
    };
  }, [
    isVideo,
    phase,
    screenSharing,
  ]);

  // ============================================================
  // CLEANUP
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

    if (audioTracks.length === 0)
      return;

    const nextMuted = !muted;

    audioTracks.forEach(
      (track) => {
        track.enabled =
          !nextMuted;
      }
    );

    setMuted(nextMuted);
  }

  function toggleVideo() {
    if (screenSharing) return;

    const stream =
      localStreamRef.current;

    if (!stream) return;

    const videoTracks =
      stream.getVideoTracks();

    if (videoTracks.length === 0)
      return;

    const nextVideoOff =
      !videoOff;

    videoTracks.forEach(
      (track) => {
        track.enabled =
          !nextVideoOff;
      }
    );

    setVideoOff(nextVideoOff);
  }

  function toggleFullscreen() {
    const video =
      remoteVideoRef.current;

    if (!video) return;

    if (
      document.fullscreenElement
    ) {
      void document.exitFullscreen();
      setRemoteVideoFullscreen(
        false
      );
      return;
    }

    if (
      video.requestFullscreen
    ) {
      void video
        .requestFullscreen()
        .then(() => {
          setRemoteVideoFullscreen(
            true
          );
        })
        .catch(() => {
          // Ignore fullscreen errors.
        });
    }
  }

  const statusText = () => {
    if (phase === "outgoing") {
      return isVideo
        ? "Calling video…"
        : "Calling…";
    }

    if (phase === "incoming") {
      return "Incoming call";
    }

    if (phase === "connecting") {
      return "Connecting…";
    }

    if (phase === "active") {
      return fmtDuration(
        duration
      );
    }

    return "Call ended";
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-[#202124] text-white">
      {/* ====================================================== */}
      {/* REMOTE VIDEO STAGE */}
      {/* ====================================================== */}

      {isVideo &&
        phase === "active" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#202124]">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="h-full w-full object-contain md:object-cover"
            />

            {/* Top bar */}
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between bg-gradient-to-b from-black/60 to-transparent px-4 pb-16 pt-[max(16px,env(safe-area-inset-top))] md:px-8">
              <div className="pointer-events-auto flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold shadow-lg">
                  {initials(
                    theirName
                  )}
                </div>

                <div>
                  <div className="text-sm font-medium md:text-base">
                    {theirName}
                  </div>

                  <div className="text-xs text-white/70">
                    {fmtDuration(
                      duration
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={
                  toggleFullscreen
                }
                className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur-md transition hover:bg-black/60"
                title="Fullscreen"
                aria-label="Fullscreen"
              >
                <Maximize2 className="h-5 w-5" />
              </button>
            </div>

            {/* Screen sharing indicator */}
            {screenSharing && (
              <div className="absolute left-1/2 top-5 z-30 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-xs font-medium backdrop-blur-md md:top-6">
                You are sharing your screen
              </div>
            )}

            {/* Local preview */}
            <div className="absolute bottom-[112px] right-3 z-30 h-32 w-24 overflow-hidden rounded-xl border border-white/20 bg-[#3c4043] shadow-2xl sm:bottom-28 sm:right-5 sm:h-40 sm:w-32 md:h-44 md:w-56">
              {videoOff &&
              !screenSharing ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#3c4043]">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold">
                    {initials(
                      myName
                    )}
                  </div>

                  <span className="text-[10px] text-white/60">
                    Camera off
                  </span>
                </div>
              ) : (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
              )}

              {screenSharing && (
                <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-[10px]">
                  Sharing
                </div>
              )}
            </div>
          </div>
        )}

      {/* ====================================================== */}
      {/* VOICE CALL / PRE-CALL STAGE */}
      {/* ====================================================== */}

      {(!isVideo ||
        phase !== "active") && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#202124] via-[#202124] to-[#171717]">
          <div className="flex w-full max-w-md flex-col items-center px-6 text-center">
            <div className="mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-emerald-600 text-3xl font-semibold shadow-2xl sm:h-32 sm:w-32 sm:text-4xl">
              {initials(
                theirName
              )}
            </div>

            <h2 className="text-2xl font-semibold sm:text-3xl">
              {theirName}
            </h2>

            <p className="mt-2 text-sm text-white/60 sm:text-base">
              {statusText()}
            </p>

            {error && (
              <div className="mt-5 max-w-sm rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {screenShareError && (
              <div className="mt-3 max-w-sm rounded-xl bg-orange-500/10 px-4 py-3 text-sm text-orange-300">
                {screenShareError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====================================================== */}
      {/* REMOTE AUDIO */}
      {/* ====================================================== */}

      <audio
        ref={remoteAudioRef}
        autoPlay
        className="hidden"
      />

      {/* ====================================================== */}
      {/* RINGTONE */}
      {/* ====================================================== */}

      <audio
        ref={ringtoneRef}
        src={`${import.meta.env.BASE_URL}chess.mp3`}
        preload="auto"
        loop
        className="hidden"
        aria-hidden="true"
      />

      {/* ====================================================== */}
      {/* PRE-CALL ERROR */}
      {/* ====================================================== */}

      {isVideo &&
        phase !== "active" &&
        error && (
          <div className="absolute left-1/2 top-1/2 z-20 mt-28 w-[calc(100%-32px)] max-w-sm -translate-x-1/2 rounded-xl bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
            {error}
          </div>
        )}

      {/* ====================================================== */}
      {/* GOOGLE MEET STYLE CONTROL BAR */}
      {/* ====================================================== */}

      <div className="absolute bottom-0 left-0 right-0 z-40">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/80 to-transparent" />

        <div className="relative flex justify-center px-3 pb-[max(18px,env(safe-area-inset-bottom))] pt-8 sm:px-5 md:justify-center md:pb-6">
          <div className="flex max-w-full items-center gap-2 rounded-2xl bg-[#202124]/90 px-2 py-2 shadow-2xl backdrop-blur-xl sm:gap-3 sm:px-3">
            {/* ================================================= */}
            {/* INCOMING */}
            {/* ================================================= */}

            {phase === "incoming" &&
              !isCaller && (
                <>
                  <button
                    onClick={() =>
                      void endCall(
                        "declined"
                      )
                    }
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#ea4335] text-white shadow-lg transition hover:bg-[#d93025] active:scale-95 sm:h-14 sm:w-14"
                    title="Decline"
                    aria-label="Decline call"
                  >
                    <PhoneOff className="h-6 w-6" />
                  </button>

                  <button
                    onClick={() =>
                      void acceptCall()
                    }
                    disabled={
                      acceptStartedRef.current
                    }
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#34a853] text-white shadow-lg transition hover:bg-[#2d8f47] active:scale-95 disabled:opacity-50 sm:h-14 sm:w-14"
                    title="Accept"
                    aria-label="Accept call"
                  >
                    {isVideo ? (
                      <Video className="h-6 w-6" />
                    ) : (
                      <Phone className="h-6 w-6" />
                    )}
                  </button>
                </>
              )}

            {/* ================================================= */}
            {/* OUTGOING */}
            {/* ================================================= */}

            {phase === "outgoing" &&
              isCaller && (
                <button
                  onClick={() =>
                    void endCall(
                      "ended"
                    )
                  }
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#ea4335] text-white shadow-lg transition hover:bg-[#d93025] active:scale-95"
                  title="Cancel"
                  aria-label="Cancel call"
                >
                  <PhoneOff className="h-6 w-6" />
                </button>
              )}

            {/* ================================================= */}
            {/* CONNECTING */}
            {/* ================================================= */}

            {phase === "connecting" && (
              <div className="flex h-14 w-14 items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-white" />
              </div>
            )}

            {/* ================================================= */}
            {/* ACTIVE */}
            {/* ================================================= */}

            {phase === "active" && (
              <>
                {/* Microphone */}
                <button
                  onClick={
                    toggleMute
                  }
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition active:scale-95 sm:h-12 sm:w-12 ${
                    muted
                      ? "bg-white text-[#202124]"
                      : "bg-[#3c4043] text-white hover:bg-[#4a4d50]"
                  }`}
                  title={
                    muted
                      ? "Turn microphone on"
                      : "Mute microphone"
                  }
                  aria-label={
                    muted
                      ? "Turn microphone on"
                      : "Mute microphone"
                  }
                >
                  {muted ? (
                    <MicOff className="h-5 w-5" />
                  ) : (
                    <Mic className="h-5 w-5" />
                  )}
                </button>

                {/* Camera */}
                {isVideo && (
                  <button
                    onClick={
                      toggleVideo
                    }
                    disabled={
                      screenSharing
                    }
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:h-12 sm:w-12 ${
                      videoOff
                        ? "bg-white text-[#202124]"
                        : "bg-[#3c4043] text-white hover:bg-[#4a4d50]"
                    }`}
                    title={
                      videoOff
                        ? "Turn camera on"
                        : "Turn camera off"
                    }
                    aria-label={
                      videoOff
                        ? "Turn camera on"
                        : "Turn camera off"
                    }
                  >
                    {videoOff ? (
                      <VideoOff className="h-5 w-5" />
                    ) : (
                      <Video className="h-5 w-5" />
                    )}
                  </button>
                )}

                {/* Screen Share */}
                {isVideo && (
                  <button
                    onClick={() =>
                      screenSharing
                        ? void stopScreenSharing()
                        : void startScreenSharing()
                    }
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition active:scale-95 sm:h-12 sm:w-12 ${
                      screenSharing
                        ? "bg-white text-[#202124]"
                        : "bg-[#3c4043] text-white hover:bg-[#4a4d50]"
                    }`}
                    title={
                      screenSharing
                        ? "Stop sharing"
                        : "Share screen"
                    }
                    aria-label={
                      screenSharing
                        ? "Stop sharing"
                        : "Share screen"
                    }
                  >
                    {screenSharing ? (
                      <MonitorOff className="h-5 w-5" />
                    ) : (
                      <MonitorUp className="h-5 w-5" />
                    )}
                  </button>
                )}

                {/* Speaker indicator */}
                <div
                  className="hidden h-12 w-12 items-center justify-center rounded-full bg-[#3c4043] text-white sm:flex"
                  title="Speaker"
                  aria-label="Speaker"
                >
                  <Volume2 className="h-5 w-5" />
                </div>

                {/* End */}
                <button
                  onClick={() =>
                    void endCall(
                      "ended"
                    )
                  }
                  className="ml-1 flex h-14 w-16 shrink-0 items-center justify-center rounded-full bg-[#ea4335] text-white shadow-lg transition hover:bg-[#d93025] active:scale-95 sm:h-14 sm:w-16"
                  title="End call"
                  aria-label="End call"
                >
                  <PhoneOff className="h-6 w-6" />
                </button>
              </>
            )}

            {/* ================================================= */}
            {/* ENDED */}
            {/* ================================================= */}

            {phase === "ended" && (
              <div className="flex h-12 w-12 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-white/60" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ====================================================== */}
      {/* SCREEN SHARE ERROR */}
      {/* ====================================================== */}

      {screenShareError &&
        phase === "active" && (
          <div className="absolute bottom-28 left-1/2 z-50 w-[calc(100%-32px)] max-w-sm -translate-x-1/2 rounded-xl bg-black/80 px-4 py-3 text-center text-xs text-white shadow-xl backdrop-blur-md sm:bottom-32">
            {screenShareError}
          </div>
        )}
    </div>
  );
}

function fmtDuration(
  seconds: number
): string {
  const m = Math.floor(
    seconds / 60
  );

  const sec = seconds % 60;

  return `${m}:${sec
    .toString()
    .padStart(2, "0")}`;
}
