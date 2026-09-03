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

  // ============================================================
  // WEBRTC REFS
  // ============================================================

  const pcRef = useRef<RTCPeerConnection | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  const localVideoSenderRef = useRef<RTCRtpSender | null>(null);
  const localAudioSenderRef = useRef<RTCRtpSender | null>(null);

  // ============================================================
  // SCREEN SHARE REFS
  // ============================================================

  const screenStreamRef = useRef<MediaStream | null>(null);

  /*
   * This is the video track sent to the receiver while sharing.
   * It contains:
   *
   *     SCREEN
   *     + small CAMERA overlay
   */
  const composedScreenStreamRef = useRef<MediaStream | null>(null);
  const composedVideoTrackRef = useRef<MediaStreamTrack | null>(null);

  /*
   * Original microphone track is kept in localStreamRef.
   * While sharing, audio is mixed:
   *
   *     microphone + screen/tab audio
   */
  const mixedAudioTrackRef = useRef<MediaStreamTrack | null>(null);

  const screenAudioContextRef = useRef<AudioContext | null>(null);
  const screenAudioDestinationRef =
    useRef<MediaStreamAudioDestinationNode | null>(null);

  const screenAnimationFrameRef =
    useRef<number | null>(null);

  const screenVideoElementRef =
    useRef<HTMLVideoElement | null>(null);

  const cameraVideoElementRef =
    useRef<HTMLVideoElement | null>(null);

  const screenCanvasRef =
    useRef<HTMLCanvasElement | null>(null);

  // ============================================================
  // MEDIA ELEMENT REFS
  // ============================================================

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  // ============================================================
  // CALL REFS
  // ============================================================

  const timerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const callIdRef =
    useRef<string | null>(propCallId);

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

  // ============================================================
  // MARK ACTIVE
  // ============================================================

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

  // ============================================================
  // STOP SCREEN SHARE
  // ============================================================

  const stopScreenSharing = useCallback(async () => {
    const pc = pcRef.current;

    const cameraStream =
      localStreamRef.current;

    const cameraTrack =
      cameraStream?.getVideoTracks()[0] ?? null;

    const microphoneTrack =
      cameraStream?.getAudioTracks()[0] ?? null;

    // ----------------------------------------------------------
    // Stop animation frame
    // ----------------------------------------------------------

    if (screenAnimationFrameRef.current !== null) {
      cancelAnimationFrame(
        screenAnimationFrameRef.current
      );

      screenAnimationFrameRef.current = null;
    }

    // ----------------------------------------------------------
    // Restore original camera
    // ----------------------------------------------------------

    if (
      pc &&
      localVideoSenderRef.current &&
      cameraTrack
    ) {
      try {
        await localVideoSenderRef.current.replaceTrack(
          cameraTrack
        );
      } catch (error) {
        console.error(
          "Failed to restore camera:",
          error
        );
      }
    }

    // ----------------------------------------------------------
    // Restore original microphone
    // ----------------------------------------------------------

    if (
      pc &&
      localAudioSenderRef.current &&
      microphoneTrack
    ) {
      try {
        await localAudioSenderRef.current.replaceTrack(
          microphoneTrack
        );
      } catch (error) {
        console.error(
          "Failed to restore microphone:",
          error
        );
      }
    }

    // ----------------------------------------------------------
    // Stop composed video track
    // ----------------------------------------------------------

    if (composedVideoTrackRef.current) {
      try {
        composedVideoTrackRef.current.stop();
      } catch {
        // Ignore.
      }

      composedVideoTrackRef.current = null;
    }

    if (composedScreenStreamRef.current) {
      composedScreenStreamRef.current
        .getTracks()
        .forEach((track) => {
          try {
            track.stop();
          } catch {
            // Ignore.
          }
        });

      composedScreenStreamRef.current = null;
    }

    // ----------------------------------------------------------
    // Stop screen capture
    // ----------------------------------------------------------

    if (screenStreamRef.current) {
      screenStreamRef.current
        .getTracks()
        .forEach((track) => {
          try {
            track.stop();
          } catch {
            // Ignore.
          }
        });

      screenStreamRef.current = null;
    }

    // ----------------------------------------------------------
    // Stop screen audio mixing
    // ----------------------------------------------------------

    if (mixedAudioTrackRef.current) {
      try {
        mixedAudioTrackRef.current.stop();
      } catch {
        // Ignore.
      }

      mixedAudioTrackRef.current = null;
    }

    if (screenAudioContextRef.current) {
      try {
        await screenAudioContextRef.current.close();
      } catch {
        // Ignore.
      }

      screenAudioContextRef.current = null;
    }

    screenAudioDestinationRef.current = null;

    screenVideoElementRef.current = null;
    cameraVideoElementRef.current = null;
    screenCanvasRef.current = null;

    // ----------------------------------------------------------
    // Restore local preview
    // ----------------------------------------------------------

    if (
      localVideoRef.current &&
      cameraStream
    ) {
      localVideoRef.current.srcObject =
        cameraStream;

      localVideoRef.current.muted = true;

      localVideoRef.current
        .play()
        .catch(() => {
          // Ignore autoplay errors.
        });
    }

    setScreenSharing(false);
    setScreenShareError(null);
  }, []);

  // ============================================================
  // CREATE COMPOSED SCREEN + CAMERA VIDEO
  // ============================================================

  const createComposedScreenVideo =
    useCallback(
      async (
        screenStream: MediaStream,
        cameraStream: MediaStream
      ): Promise<MediaStream> => {
        const screenVideo =
          document.createElement("video");

        screenVideo.autoplay = true;
        screenVideo.muted = true;
        screenVideo.playsInline = true;

        const cameraVideo =
          document.createElement("video");

        cameraVideo.autoplay = true;
        cameraVideo.muted = true;
        cameraVideo.playsInline = true;

        screenVideo.srcObject =
          screenStream;

        cameraVideo.srcObject =
          cameraStream;

        screenVideoElementRef.current =
          screenVideo;

        cameraVideoElementRef.current =
          cameraVideo;

        await Promise.all([
          screenVideo.play(),
          cameraVideo.play(),
        ]);

        const canvas =
          document.createElement("canvas");

        /*
         * 16:9 canvas gives the receiver a stable video
         * layout similar to Google Meet.
         */
        canvas.width = 1280;
        canvas.height = 720;

        screenCanvasRef.current =
          canvas;

        const context =
          canvas.getContext("2d");

        if (!context) {
          throw new Error(
            "Could not create screen sharing canvas."
          );
        }

        const drawVideoContain = (
          video: HTMLVideoElement,
          x: number,
          y: number,
          width: number,
          height: number
        ) => {
          if (
            video.videoWidth <= 0 ||
            video.videoHeight <= 0
          ) {
            return;
          }

          const sourceRatio =
            video.videoWidth /
            video.videoHeight;

          const targetRatio =
            width / height;

          let drawWidth = width;
          let drawHeight = height;

          if (
            sourceRatio >
            targetRatio
          ) {
            drawWidth = width;
            drawHeight =
              width /
              sourceRatio;
          } else {
            drawHeight = height;
            drawWidth =
              height *
              sourceRatio;
          }

          const drawX =
            x +
            (width -
              drawWidth) /
              2;

          const drawY =
            y +
            (height -
              drawHeight) /
              2;

          context.drawImage(
            video,
            drawX,
            drawY,
            drawWidth,
            drawHeight
          );
        };

        const drawFrame = () => {
          if (
            endedRef.current ||
            !screenStreamRef.current
          ) {
            return;
          }

          /*
           * Background.
           */
          context.fillStyle =
            "#000000";

          context.fillRect(
            0,
            0,
            canvas.width,
            canvas.height
          );

          /*
           * Main screen.
           */
          drawVideoContain(
            screenVideo,
            0,
            0,
            canvas.width,
            canvas.height
          );

          /*
           * Camera picture-in-picture.
           *
           * Approx. 25% of screen width.
           */
          const pipWidth = 300;
          const pipHeight = 169;

          const pipX =
            canvas.width -
            pipWidth -
            28;

          const pipY = 28;

          /*
           * Shadow / background.
           */
          context.fillStyle =
            "rgba(0,0,0,0.45)";

          context.fillRect(
            pipX - 4,
            pipY - 4,
            pipWidth + 8,
            pipHeight + 8
          );

          /*
           * Camera.
           */
          drawVideoContain(
            cameraVideo,
            pipX,
            pipY,
            pipWidth,
            pipHeight
          );

          /*
           * Camera border.
           */
          context.strokeStyle =
            "rgba(255,255,255,0.35)";

          context.lineWidth = 3;

          context.strokeRect(
            pipX,
            pipY,
            pipWidth,
            pipHeight
          );

          screenAnimationFrameRef.current =
            requestAnimationFrame(
              drawFrame
            );
        };

        drawFrame();

        if (
          !canvas.captureStream
        ) {
          throw new Error(
            "Canvas video capture is not supported by this browser."
          );
        }

        const composedStream =
          canvas.captureStream(30);

        const composedVideoTrack =
          composedStream.getVideoTracks()[0];

        if (!composedVideoTrack) {
          throw new Error(
            "Could not create shared video track."
          );
        }

        composedScreenStreamRef.current =
          composedStream;

        composedVideoTrackRef.current =
          composedVideoTrack;

        return composedStream;
      },
      []
    );

  // ============================================================
  // MIX MICROPHONE + SCREEN AUDIO
  // ============================================================

  const createMixedScreenAudio =
    useCallback(
      async (
        screenStream: MediaStream,
        cameraStream: MediaStream
      ): Promise<MediaStream | null> => {
        const microphoneTrack =
          cameraStream.getAudioTracks()[0];

        const screenAudioTrack =
          screenStream.getAudioTracks()[0];

        /*
         * If the browser did not provide screen audio,
         * continue with microphone only.
         */
        if (!screenAudioTrack) {
          return null;
        }

        const AudioContextClass =
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;

        if (!AudioContextClass) {
          console.warn(
            "Web Audio API is not available."
          );

          return null;
        }

        const audioContext =
          new AudioContextClass();

        if (
          audioContext.state ===
          "suspended"
        ) {
          try {
            await audioContext.resume();
          } catch {
            // Ignore.
          }
        }

        const destination =
          audioContext.createMediaStreamDestination();

        /*
         * Microphone.
         */
        if (microphoneTrack) {
          const microphoneStream =
            new MediaStream([
              microphoneTrack,
            ]);

          const microphoneSource =
            audioContext.createMediaStreamSource(
              microphoneStream
            );

          microphoneSource.connect(
            destination
          );
        }

        /*
         * Screen/tab/system audio.
         */
        const screenAudioOnlyStream =
          new MediaStream([
            screenAudioTrack,
          ]);

        const screenAudioSource =
          audioContext.createMediaStreamSource(
            screenAudioOnlyStream
          );

        screenAudioSource.connect(
          destination
        );

        const mixedTrack =
          destination.stream.getAudioTracks()[0];

        if (!mixedTrack) {
          await audioContext.close();

          return null;
        }

        screenAudioContextRef.current =
          audioContext;

        screenAudioDestinationRef.current =
          destination;

        mixedAudioTrackRef.current =
          mixedTrack;

        return destination.stream;
      },
      []
    );

  // ============================================================
  // START SCREEN SHARING
  // ============================================================

  const startScreenSharing =
    useCallback(async () => {
      if (!isVideo) return;

      if (screenSharing) return;

      const pc = pcRef.current;

      const cameraStream =
        localStreamRef.current;

      if (!pc || !cameraStream) {
        return;
      }

      if (
        !navigator.mediaDevices?.getDisplayMedia
      ) {
        setScreenShareError(
          "This browser/device does not provide screen sharing. Try the latest desktop Chrome or Edge."
        );

        return;
      }

      try {
        setScreenShareError(null);

        /*
         * Request screen.
         *
         * audio:true allows Chrome/Edge to offer
         * tab/system audio where supported.
         */
        const screenStream =
          await navigator.mediaDevices.getDisplayMedia(
            {
              video: {
                frameRate: {
                  ideal: 30,
                  max: 60,
                },
              },
              audio: true,
            }
          );

        const screenTrack =
          screenStream.getVideoTracks()[0];

        if (!screenTrack) {
          screenStream
            .getTracks()
            .forEach((track) =>
              track.stop()
            );

          throw new Error(
            "No screen video was selected."
          );
        }

        screenStreamRef.current =
          screenStream;

        /*
         * ------------------------------------------------------
         * Create SCREEN + CAMERA composed video.
         * ------------------------------------------------------
         */
        const composedStream =
          await createComposedScreenVideo(
            screenStream,
            cameraStream
          );

        const composedVideoTrack =
          composedStream.getVideoTracks()[0];

        if (!composedVideoTrack) {
          throw new Error(
            "Could not create shared video."
          );
        }

        /*
         * ------------------------------------------------------
         * Replace camera video with composed screen+camera.
         * ------------------------------------------------------
         */
        if (
          localVideoSenderRef.current
        ) {
          await localVideoSenderRef.current.replaceTrack(
            composedVideoTrack
          );
        } else {
          throw new Error(
            "Could not find the video connection."
          );
        }

        /*
         * ------------------------------------------------------
         * Mix microphone + screen audio.
         * ------------------------------------------------------
         */
        const mixedAudioStream =
          await createMixedScreenAudio(
            screenStream,
            cameraStream
          );

        if (
          mixedAudioStream &&
          localAudioSenderRef.current
        ) {
          const mixedTrack =
            mixedAudioStream.getAudioTracks()[0];

          if (mixedTrack) {
            await localAudioSenderRef.current.replaceTrack(
              mixedTrack
            );
          }
        }

        setScreenSharing(true);

        /*
         * Local preview should show the same
         * screen + camera composition.
         */
        if (localVideoRef.current) {
          localVideoRef.current.srcObject =
            composedStream;

          localVideoRef.current.muted =
            true;

          localVideoRef.current
            .play()
            .catch(() => {
              // Ignore autoplay errors.
            });
        }

        /*
         * ------------------------------------------------------
         * Browser native "Stop sharing".
         * ------------------------------------------------------
         */
        screenTrack.onended = () => {
          void stopScreenSharing();
        };

        /*
         * Screen audio can also end independently.
         */
        const screenAudioTrack =
          screenStream.getAudioTracks()[0];

        if (screenAudioTrack) {
          screenAudioTrack.onended = () => {
            /*
             * Do NOT stop the entire screen share if only
             * the audio track ended.
             *
             * The video screen may still be active.
             */
          };
        }
      } catch (error) {
        console.error(
          "Screen sharing failed:",
          error
        );

        /*
         * Clean up anything partially created.
         */
        if (
          screenAnimationFrameRef.current !==
          null
        ) {
          cancelAnimationFrame(
            screenAnimationFrameRef.current
          );

          screenAnimationFrameRef.current =
            null;
        }

        if (
          screenStreamRef.current
        ) {
          screenStreamRef.current
            .getTracks()
            .forEach((track) => {
              try {
                track.stop();
              } catch {
                // Ignore.
              }
            });

          screenStreamRef.current =
            null;
        }

        if (
          composedVideoTrackRef.current
        ) {
          try {
            composedVideoTrackRef.current.stop();
          } catch {
            // Ignore.
          }

          composedVideoTrackRef.current =
            null;
        }

        if (
          composedScreenStreamRef.current
        ) {
          composedScreenStreamRef.current
            .getTracks()
            .forEach((track) => {
              try {
                track.stop();
              } catch {
                // Ignore.
              }
            });

          composedScreenStreamRef.current =
            null;
        }

        if (
          screenAudioContextRef.current
        ) {
          try {
            await screenAudioContextRef.current.close();
          } catch {
            // Ignore.
          }

          screenAudioContextRef.current =
            null;
        }

        mixedAudioTrackRef.current =
          null;

        /*
         * Restore camera/mic if necessary.
         */
        const cameraTrack =
          cameraStream.getVideoTracks()[0];

        const microphoneTrack =
          cameraStream.getAudioTracks()[0];

        if (
          localVideoSenderRef.current &&
          cameraTrack
        ) {
          try {
            await localVideoSenderRef.current.replaceTrack(
              cameraTrack
            );
          } catch {
            // Ignore.
          }
        }

        if (
          localAudioSenderRef.current &&
          microphoneTrack
        ) {
          try {
            await localAudioSenderRef.current.replaceTrack(
              microphoneTrack
            );
          } catch {
            // Ignore.
          }
        }

        if (
          error instanceof DOMException &&
          error.name ===
            "NotAllowedError"
        ) {
          setScreenShareError(
            "Screen sharing was cancelled."
          );
        } else if (
          error instanceof DOMException &&
          error.name ===
            "AbortError"
        ) {
          setScreenShareError(
            "Screen sharing was cancelled."
          );
        } else {
          setScreenShareError(
            error instanceof Error
              ? error.message
              : "Could not start screen sharing."
          );
        }

        setScreenSharing(false);
      }
    }, [
      cameraVideoElementRef,
      createComposedScreenVideo,
      createMixedScreenAudio,
      isVideo,
      screenSharing,
      stopScreenSharing,
    ]);

  // ============================================================
  // CLEANUP
  // ============================================================

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (
      screenAnimationFrameRef.current !==
      null
    ) {
      cancelAnimationFrame(
        screenAnimationFrameRef.current
      );

      screenAnimationFrameRef.current =
        null;
    }

    if (
      screenAudioContextRef.current
    ) {
      screenAudioContextRef.current
        .close()
        .catch(() => {
          // Ignore.
        });

      screenAudioContextRef.current =
        null;
    }

    screenAudioDestinationRef.current =
      null;

    if (mixedAudioTrackRef.current) {
      try {
        mixedAudioTrackRef.current.stop();
      } catch {
        // Ignore.
      }

      mixedAudioTrackRef.current =
        null;
    }

    if (screenStreamRef.current) {
      screenStreamRef.current
        .getTracks()
        .forEach((track) => {
          try {
            track.stop();
          } catch {
            // Ignore.
          }
        });

      screenStreamRef.current = null;
    }

    if (
      composedScreenStreamRef.current
    ) {
      composedScreenStreamRef.current
        .getTracks()
        .forEach((track) => {
          try {
            track.stop();
          } catch {
            // Ignore.
          }
        });

      composedScreenStreamRef.current =
        null;
    }

    if (composedVideoTrackRef.current) {
      try {
        composedVideoTrackRef.current.stop();
      } catch {
        // Ignore.
      }

      composedVideoTrackRef.current =
        null;
    }

    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange =
        null;
      pcRef.current.oniceconnectionstatechange =
        null;

      try {
        pcRef.current.close();
      } catch {
        // Ignore.
      }

      pcRef.current = null;
    }

    localVideoSenderRef.current = null;
    localAudioSenderRef.current = null;

    if (localStreamRef.current) {
      localStreamRef.current
        .getTracks()
        .forEach((track) => {
          try {
            track.stop();
          } catch {
            // Ignore.
          }
        });

      localStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.onloadedmetadata =
        null;

      localVideoRef.current.srcObject =
        null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.onloadedmetadata =
        null;

      remoteVideoRef.current.srcObject =
        null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject =
        null;
    }

    remoteStreamRef.current = null;

    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime =
        0;
    }

    screenVideoElementRef.current =
      null;

    cameraVideoElementRef.current =
      null;

    screenCanvasRef.current = null;

    setScreenSharing(false);
  }, []);

  // ============================================================
  // UPDATE CALL
  // ============================================================

  const updateCall = useCallback(
    async (
      id: string,
      updates: Record<string, unknown>
    ) => {
      const {
        error: updateError,
      } = await supabase
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

  // ============================================================
  // END CALL
  // ============================================================

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
        await updateCall(
          currentCallId,
          {
            status: reason,
          }
        );
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

  // ============================================================
  // ICE GATHERING
  // ============================================================

  const waitForIceGathering =
    useCallback(
      async (
        pc: RTCPeerConnection
      ) => {
        if (
          pc.iceGatheringState ===
          "complete"
        ) {
          return;
        }

        await new Promise<void>(
          (resolve) => {
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

            setTimeout(
              finish,
              5000
            );
          }
        );
      },
      []
    );

  // ============================================================
  // PARSE ICE
  // ============================================================

  const parseIceCandidates =
    useCallback(
      (value: unknown): string[] => {
        if (!value) return [];

        try {
          if (
            typeof value === "string"
          ) {
            const parsed =
              JSON.parse(value);

            if (
              Array.isArray(parsed)
            ) {
              return parsed.filter(
                (
                  item
                ): item is string =>
                  typeof item ===
                  "string"
              );
            }

            return [];
          }

          if (
            Array.isArray(value)
          ) {
            return value.filter(
              (
                item
              ): item is string =>
                typeof item ===
                "string"
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

  // ============================================================
  // ADD ICE
  // ============================================================

  const addIceCandidates =
    useCallback(
      async (
        pc: RTCPeerConnection,
        candidates: unknown
      ) => {
        const iceCandidates =
          parseIceCandidates(
            candidates
          );

        for (
          const candidateString of
            iceCandidates
        ) {
          try {
            const candidate =
              JSON.parse(
                candidateString
              );

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

  // ============================================================
  // ATTACH REMOTE STREAM
  // ============================================================

  const attachRemoteStream =
    useCallback(
      (stream: MediaStream) => {
        remoteStreamRef.current =
          stream;

        if (
          callTypeRef.current ===
          "video"
        ) {
          const video =
            remoteVideoRef.current;

          if (video) {
            video.srcObject =
              stream;

            const playVideo =
              () => {
                video
                  .play()
                  .catch(
                    (error) => {
                      console.warn(
                        "Remote video playback was blocked:",
                        error
                      );
                    }
                  );
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
          if (
            remoteAudioRef.current
          ) {
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

  // ============================================================
  // CONNECTION HANDLERS
  // ============================================================

  const configureConnectionHandlers =
    useCallback(
      (
        pc: RTCPeerConnection
      ) => {
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
              if (
                !endedRef.current
              ) {
                void endCall(
                  "ended"
                );
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

            if (
              state === "failed"
            ) {
              if (
                !endedRef.current
              ) {
                void endCall(
                  "ended"
                );
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

      if (
        outgoingStartedRef.current
      ) {
        return;
      }

      outgoingStartedRef.current =
        true;

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
              video:
                callType === "video",
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
            iceServers:
              ICE_SERVERS,
          });

        pcRef.current = pc;

        configureConnectionHandlers(
          pc
        );

        stream
          .getTracks()
          .forEach((track) => {
            const sender =
              pc.addTrack(
                track,
                stream
              );

            if (
              track.kind ===
              "video"
            ) {
              localVideoSenderRef.current =
                sender;
            }

            if (
              track.kind ===
              "audio"
            ) {
              localAudioSenderRef.current =
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
          if (
            event.candidate
          ) {
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

        if (
          endedRef.current
        ) {
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
          .from(
            "call_signaling"
          )
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
            caller_ice:
              callerIce,
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

          await endCall(
            "ended"
          );

          return;
        }

        const newCall =
          data as CallSignaling;

        callIdRef.current =
          newCall.id;

        setCallId(
          newCall.id
        );

        console.log(
          "Outgoing call created:",
          newCall.id
        );
      } catch (error) {
        console.error(
          "Failed to start outgoing call:",
          error
        );

        if (
          !endedRef.current
        ) {
          setError(
            "Could not access camera/microphone. Please check browser permissions."
          );

          outgoingStartedRef.current =
            false;

          await endCall(
            "ended"
          );
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

      if (
        acceptStartedRef.current
      ) {
        return;
      }

      acceptStartedRef.current =
        true;

      phaseRef.current =
        "connecting";

      setPhase(
        "connecting"
      );

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

        if (
          endedRef.current
        ) {
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
            iceServers:
              ICE_SERVERS,
          });

        pcRef.current = pc;

        configureConnectionHandlers(
          pc
        );

        stream
          .getTracks()
          .forEach((track) => {
            const sender =
              pc.addTrack(
                track,
                stream
              );

            if (
              track.kind ===
              "video"
            ) {
              localVideoSenderRef.current =
                sender;
            }

            if (
              track.kind ===
              "audio"
            ) {
              localAudioSenderRef.current =
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
          if (
            event.candidate
          ) {
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

        if (
          endedRef.current
        ) {
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
            status:
              "accepted",
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

        await endCall(
          "ended"
        );
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
      if (
        ringtoneRef.current
      ) {
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
          ringtone.currentTime =
            0;

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
      ringtone.currentTime =
        0;
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
      async (
        row: CallSignaling
      ) => {
        if (cancelled) return;
        if (endedRef.current) return;

        if (
          row.status ===
            "declined" ||
          row.status ===
            "ended" ||
          row.status ===
            "missed"
        ) {
          await endCall(
            "ended"
          );

          return;
        }

        if (
          row.status !==
            "accepted" ||
          !row.sdp_answer ||
          !pcRef.current
        ) {
          return;
        }

        const pc =
          pcRef.current;

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

    const channel =
      supabase
        .channel(
          `call-answer-${cid}`
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table:
              "call_signaling",
            filter: `id=eq.${cid}`,
          },
          async (
            payload
          ) => {
            await processCallUpdate(
              payload.new as CallSignaling
            );
          }
        )
        .subscribe();

    const pollInterval =
      setInterval(
        async () => {
          if (cancelled) return;
          if (endedRef.current)
            return;

          const {
            data,
            error:
              pollError,
          } = await supabase
            .from(
              "call_signaling"
            )
            .select(
              "id, status, sdp_answer, callee_ice"
            )
            .eq(
              "id",
              cid
            )
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
        },
        1500
      );

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

    const cid =
      incomingCall.id;

    let cancelled = false;

    const handleRemoteStatus =
      async (
        row: CallSignaling
      ) => {
        if (cancelled) return;
        if (endedRef.current) return;

        if (
          row.status ===
            "ended" ||
          row.status ===
            "missed"
        ) {
          await endCall(
            "ended"
          );
        }
      };

    const channel =
      supabase
        .channel(
          `call-remote-end-${cid}`
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table:
              "call_signaling",
            filter: `id=eq.${cid}`,
          },
          async (
            payload
          ) => {
            await handleRemoteStatus(
              payload.new as CallSignaling
            );
          }
        )
        .subscribe();

    const pollInterval =
      setInterval(
        async () => {
          if (cancelled) return;
          if (endedRef.current)
            return;

          const {
            data,
            error:
              pollError,
          } = await supabase
            .from(
              "call_signaling"
            )
            .select(
              "id, status"
            )
            .eq(
              "id",
              cid
            )
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
        },
        1500
      );

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
    if (phase !== "outgoing")
      return;

    const timeout =
      setTimeout(() => {
        if (
          !endedRef.current &&
          phaseRef.current ===
            "outgoing"
        ) {
          void endCall(
            "missed"
          );
        }
      }, 45000);

    return () => {
      clearTimeout(
        timeout
      );
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
    if (phase !== "active")
      return;

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

      localVideo.muted =
        true;

      localVideo
        .play()
        .catch(() => {
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
  // CLEANUP ON UNMOUNT
  // ============================================================

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // ============================================================
  // MUTE
  // ============================================================

  function toggleMute() {
    const stream =
      localStreamRef.current;

    if (!stream) return;

    const audioTracks =
      stream.getAudioTracks();

    if (
      audioTracks.length ===
      0
    ) {
      return;
    }

    const nextMuted =
      !muted;

    audioTracks.forEach(
      (track) => {
        track.enabled =
          !nextMuted;
      }
    );

    /*
     * If screen sharing is active, the microphone
     * source is mixed through Web Audio.
     *
     * Disabling the original microphone track
     * therefore also removes it from the mixed audio.
     */
    setMuted(nextMuted);
  }

  // ============================================================
  // VIDEO
  // ============================================================

  function toggleVideo() {
    if (screenSharing) return;

    const stream =
      localStreamRef.current;

    if (!stream) return;

    const videoTracks =
      stream.getVideoTracks();

    if (
      videoTracks.length ===
      0
    ) {
      return;
    }

    const nextVideoOff =
      !videoOff;

    videoTracks.forEach(
      (track) => {
        track.enabled =
          !nextVideoOff;
      }
    );

    setVideoOff(
      nextVideoOff
    );
  }

  // ============================================================
  // FULLSCREEN
  // ============================================================

  function toggleFullscreen() {
    const video =
      remoteVideoRef.current;

    if (!video) return;

    if (
      document.fullscreenElement
    ) {
      void document
        .exitFullscreen();

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
          // Ignore.
        });
    }
  }

  // ============================================================
  // STATUS
  // ============================================================

  const statusText = () => {
    if (
      phase === "outgoing"
    ) {
      return isVideo
        ? "Calling video…"
        : "Calling…";
    }

    if (
      phase === "incoming"
    ) {
      return "Incoming call";
    }

    if (
      phase === "connecting"
    ) {
      return "Connecting…";
    }

    if (
      phase === "active"
    ) {
      return fmtDuration(
        duration
      );
    }

    return "Call ended";
  };

  // ============================================================
  // UI
  // ============================================================

  return (
    <div className="fixed inset-0 z-[60] h-[100dvh] w-full overflow-hidden bg-[#202124] text-white touch-manipulation">
      {/* ====================================================== */}
      {/* REMOTE VIDEO STAGE */}
      {/* ====================================================== */}

      {isVideo &&
        phase === "active" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <video
              ref={
                remoteVideoRef
              }
              autoPlay
              playsInline
              className="h-full w-full object-contain bg-black md:object-cover"
            />

            {/* TOP BAR */}
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pb-16 pt-[max(16px,env(safe-area-inset-top))] md:px-8">
              <div className="pointer-events-auto flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold shadow-lg">
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
                className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur-md transition hover:bg-black/60 active:scale-95"
                title="Fullscreen"
                aria-label="Fullscreen"
              >
                <Maximize2 className="h-5 w-5" />
              </button>
            </div>

            {/* SCREEN SHARING INDICATOR */}
            {screenSharing && (
              <div className="absolute left-1/2 top-[max(16px,env(safe-area-inset-top))] z-30 mt-12 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-xs font-medium backdrop-blur-md">
                You are sharing your screen
              </div>
            )}

            {/* LOCAL PREVIEW */}
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
                  ref={
                    localVideoRef
                  }
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
              )}

              {screenSharing && (
                <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-[10px]">
                  Screen + camera
                </div>
              )}
            </div>
          </div>
        )}

      {/* ====================================================== */}
      {/* VOICE / PRE-CALL STAGE */}
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
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/90 via-black/50 to-transparent" />

        <div className="relative flex justify-center px-2 pb-[max(14px,env(safe-area-inset-bottom))] pt-8 sm:px-5 md:pb-6">
          <div className="flex max-w-[calc(100vw-16px)] items-center gap-1.5 overflow-x-auto rounded-2xl bg-[#202124]/95 px-2 py-2 shadow-2xl backdrop-blur-xl sm:gap-3 sm:px-3">
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
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#ea4335] text-white shadow-lg transition hover:bg-[#d93025] active:scale-95"
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
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#34a853] text-white shadow-lg transition hover:bg-[#2d8f47] active:scale-95 disabled:opacity-50"
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

            {phase ===
              "connecting" && (
              <div className="flex h-14 w-14 items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-white" />
              </div>
            )}

            {/* ================================================= */}
            {/* ACTIVE */}
            {/* ================================================= */}

            {phase === "active" && (
              <>
                {/* MICROPHONE */}
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

                {/* CAMERA */}
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

                {/* SCREEN SHARE */}
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

                {/* SPEAKER */}
                <div
                  className="hidden h-12 w-12 items-center justify-center rounded-full bg-[#3c4043] text-white sm:flex"
                  title="Speaker"
                  aria-label="Speaker"
                >
                  <Volume2 className="h-5 w-5" />
                </div>

                {/* END CALL */}
                <button
                  onClick={() =>
                    void endCall(
                      "ended"
                    )
                  }
                  className="ml-1 flex h-14 w-16 shrink-0 items-center justify-center rounded-full bg-[#ea4335] text-white shadow-lg transition hover:bg-[#d93025] active:scale-95"
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
          <div className="absolute bottom-28 left-1/2 z-50 w-[calc(100%-32px)] max-w-sm -translate-x-1/2 rounded-xl bg-black/85 px-4 py-3 text-center text-xs text-white shadow-xl backdrop-blur-md sm:bottom-32">
            {screenShareError}
          </div>
        )}
    </div>
  );
}

// ============================================================
// FORMAT CALL DURATION
// ============================================================

function fmtDuration(
  seconds: number
): string {
  const m = Math.floor(
    seconds / 60
  );

  const sec =
    seconds % 60;

  return `${m}:${sec
    .toString()
    .padStart(2, "0")}`;
}
