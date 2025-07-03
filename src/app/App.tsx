"use client";

import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { v4 as uuidv4 } from "uuid";

import Image from "next/image";

// UI components
import Transcript from "./components/Transcript";
import Events from "./components/Events";
import BottomToolbar from "./components/BottomToolbar";

// Types
import { SessionStatus, TranscriptItem } from "@/app/types";
import type { RealtimeAgent } from "@openai/agents/realtime";

// Context providers & hooks
import { useTranscript } from "@/app/contexts/TranscriptContext";
import { useEvent } from "@/app/contexts/EventContext";

// Utilities
import { RealtimeClient } from "@/app/agentConfigs/realtimeClient";

// Agent configs
import { allAgentSets, defaultAgentSetKey } from "@/app/agentConfigs";
// New SDK scenarios
import { simpleHandoffScenario } from "@/app/agentConfigs/simpleHandoff";
import { customerServiceRetailScenario } from "@/app/agentConfigs/customerServiceRetail";
import { chatSupervisorScenario } from "@/app/agentConfigs/chatSupervisor";
import { salesAssistScenario } from "@/app/agentConfigs/salesAssist/metana";

const sdkScenarioMap: Record<string, RealtimeAgent[]> = {
  simpleHandoff: simpleHandoffScenario,
  customerServiceRetail: customerServiceRetailScenario,
  chatSupervisor: chatSupervisorScenario,
  salesAssist: salesAssistScenario,
};

import useAudioDownload from "./hooks/useAudioDownload";

function App() {
  const searchParams = useSearchParams()!;

  // Use urlCodec directly from URL search params (default: "opus")
  const urlCodec = searchParams.get("codec") || "opus";

  const {
    transcriptItems,
    addTranscriptMessage,
    addTranscriptBreadcrumb,
    updateTranscriptMessage,
    updateTranscriptItem,
  } = useTranscript();

  // Keep a mutable reference to the latest transcriptItems so that streaming
  // callbacks registered once during setup always have access to up-to-date
  // data without being re-registered on every render.
  const transcriptItemsRef = useRef<TranscriptItem[]>(transcriptItems);
  useEffect(() => {
    transcriptItemsRef.current = transcriptItems;
  }, [transcriptItems]);
  const { logClientEvent, logServerEvent, logHistoryItem } = useEvent();

  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [selectedAgentConfigSet, setSelectedAgentConfigSet] = useState<
    RealtimeAgent[] | null
  >(null);

  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const sdkAudioElement = React.useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const el = document.createElement("audio");
    el.autoplay = true;
    el.style.display = "none";
    document.body.appendChild(el);
    return el;
  }, []);

  // Attach SDK audio element once it exists (after first render in browser)
  useEffect(() => {
    if (sdkAudioElement && !audioElementRef.current) {
      audioElementRef.current = sdkAudioElement;
    }
  }, [sdkAudioElement]);

  const sdkClientRef = useRef<RealtimeClient | null>(null);
  const loggedFunctionCallsRef = useRef<Set<string>>(new Set());
  const [sessionStatus, setSessionStatus] =
    useState<SessionStatus>("DISCONNECTED");

  const [isEventsPaneExpanded, setIsEventsPaneExpanded] =
    useState<boolean>(true);
  const [userText, setUserText] = useState<string>("");
  const [isPTTActive, setIsPTTActive] = useState<boolean>(false);
  const [isPTTUserSpeaking, setIsPTTUserSpeaking] = useState<boolean>(false);
  const [isAudioPlaybackEnabled, setIsAudioPlaybackEnabled] = useState<boolean>(
    () => {
      if (typeof window === "undefined") return true;
      const stored = localStorage.getItem("audioPlaybackEnabled");
      return stored ? stored === "true" : true;
    }
  );

  // State for browser audio sharing
  const [isBrowserAudioSharing, setIsBrowserAudioSharing] = useState<boolean>(
    () => {
      if (typeof window === "undefined") return false;
      const stored = localStorage.getItem("browserAudioSharing");
      return stored ? stored === "true" : false;
    }
  );

  // Initialize the recording hook.
  const { 
    startRecording, 
    stopRecording, 
    downloadRecording,
    startBrowserAudioCapture,
    stopBrowserAudioCapture,
    getCombinedAudioStream,
    cleanup,
    isBrowserAudioEnabled,
    isCapturingBrowserAudio,
    browserAudioError,
    checkBrowserAudioSupport,
  } = useAudioDownload();

  const sendClientEvent = (eventObj: any) => {
    if (!sdkClientRef.current) {
      console.error("SDK client not available", eventObj);
      return;
    }

    try {
      sdkClientRef.current.sendEvent(eventObj);
    } catch (err) {
      console.error("Failed to send via SDK", err);
    }
  };

  useEffect(() => {
    let finalAgentConfig = searchParams.get("agentConfig");
    if (!finalAgentConfig || !allAgentSets[finalAgentConfig]) {
      finalAgentConfig = defaultAgentSetKey;
      const url = new URL(window.location.toString());
      url.searchParams.set("agentConfig", finalAgentConfig);
      window.location.replace(url.toString());
      return;
    }

    const agents = allAgentSets[finalAgentConfig];
    const agentKeyToUse = agents[0]?.name || "";

    setSelectedAgentName(agentKeyToUse);
    setSelectedAgentConfigSet(agents);
  }, [searchParams]);

  useEffect(() => {
    if (selectedAgentName && sessionStatus === "DISCONNECTED") {
      connectToRealtime();
    }
  }, [selectedAgentName]);

  useEffect(() => {
    if (
      sessionStatus === "CONNECTED" &&
      selectedAgentConfigSet &&
      selectedAgentName
    ) {
      const currentAgent = selectedAgentConfigSet.find(
        (a) => a.name === selectedAgentName
      );
      addTranscriptBreadcrumb(`Agent: ${selectedAgentName}`, currentAgent);
      updateSession(true);
    }
  }, [selectedAgentConfigSet, selectedAgentName, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === "CONNECTED") {
      console.log(
        `updatingSession, isPTTACtive=${isPTTActive} sessionStatus=${sessionStatus}`
      );
      updateSession();
    }
  }, [isPTTActive]);

  const fetchEphemeralKey = async (): Promise<string | null> => {
    logClientEvent({ url: "/session" }, "fetch_session_token_request");
    const tokenResponse = await fetch("/api/session");
    const data = await tokenResponse.json();
    logServerEvent(data, "fetch_session_token_response");

    if (!data.client_secret?.value) {
      logClientEvent(data, "error.no_ephemeral_key");
      console.error("No ephemeral key provided by the server");
      setSessionStatus("DISCONNECTED");
      return null;
    }

    return data.client_secret.value;
  };

  const connectToRealtime = async () => {
    const agentSetKey = searchParams.get("agentConfig") || "default";
    if (sdkScenarioMap[agentSetKey]) {
      // Use new SDK path
      if (sessionStatus !== "DISCONNECTED") return;
      setSessionStatus("CONNECTING");

      try {
        const EPHEMERAL_KEY = await fetchEphemeralKey();
        if (!EPHEMERAL_KEY) return;

        // Get combined audio stream if browser audio sharing is enabled
        let customAudioStream: MediaStream | null = null;
        if (isBrowserAudioSharing) {
          console.log('Browser audio sharing enabled, creating combined stream...');
          customAudioStream = await getCombinedAudioStream();
          if (customAudioStream) {
            console.log('Combined stream created for RealtimeClient:', customAudioStream.getTracks().map(t => ({
              kind: t.kind,
              label: t.label,
              enabled: t.enabled,
              readyState: t.readyState
            })));
          } else {
            console.error('Failed to create combined audio stream');
          }
        } else {
          console.log('Browser audio sharing not enabled, using default microphone');
        }

        // Ensure the selectedAgentName is first so that it becomes the root
        const reorderedAgents = [...sdkScenarioMap[agentSetKey]];
        const idx = reorderedAgents.findIndex(
          (a) => a.name === selectedAgentName
        );
        if (idx > 0) {
          const [agent] = reorderedAgents.splice(idx, 1);
          reorderedAgents.unshift(agent);
        }

        const client = new RealtimeClient({
          getEphemeralKey: async () => EPHEMERAL_KEY,
          initialAgents: reorderedAgents,
          audioElement: sdkAudioElement,
          customAudioStream: customAudioStream,
          extraContext: {
            addTranscriptBreadcrumb,
          },
        } as any);

        console.log('RealtimeClient created with customAudioStream:', customAudioStream ? 'YES' : 'NO');
        if (customAudioStream) {
          console.log('Custom stream tracks passed to client:', customAudioStream.getTracks().map(t => ({
            kind: t.kind,
            label: t.label,
            enabled: t.enabled,
            readyState: t.readyState
          })));
        }

        sdkClientRef.current = client;

        client.on("connection_change", (status) => {
          if (status === "connected") setSessionStatus("CONNECTED");
          else if (status === "connecting") setSessionStatus("CONNECTING");
          else setSessionStatus("DISCONNECTED");
        });

        client.on("message", (ev) => {
          logServerEvent(ev);

          // --- Realtime streaming handling ---------------------------------
          // The Realtime transport emits granular *delta* events while the
          // assistant is speaking or while the user's audio is still being
          // transcribed. Those events were previously only logged which made
          // the UI update only once when the final conversation.item.* event
          // arrived – effectively disabling streaming. We now listen for the
          // delta events and update the transcript as they arrive so that
          // 1) assistant messages stream token-by-token, and
          // 2) the user sees a live "Transcribing…" placeholder while we are
          //    still converting their speech to text.

          // NOTE: The exact payloads are still evolving.  We intentionally
          // access properties defensively to avoid runtime crashes if fields
          // are renamed or missing.

          try {
            // Guardrail trip event – mark last assistant message as FAIL
            if (ev.type === "guardrail_tripped") {
              const lastAssistant = [...transcriptItemsRef.current]
                .reverse()
                .find((i) => i.role === "assistant");

              if (lastAssistant) {
                updateTranscriptItem(lastAssistant.itemId, {
                  guardrailResult: {
                    status: "DONE",
                    category: "OFF_BRAND",
                    rationale: "Guardrail triggered",
                    testText: "",
                  },
                } as any);
              }
              return;
            }

            // Response finished – if we still have Pending guardrail mark as
            // Pass. This event fires once per assistant turn.
            if (ev.type === "response.done") {
              const lastAssistant = [...transcriptItemsRef.current]
                .reverse()
                .find((i) => i.role === "assistant");

              if (lastAssistant) {
                const existing: any = (lastAssistant as any).guardrailResult;
                if (!existing || existing.status === "IN_PROGRESS") {
                  updateTranscriptItem(lastAssistant.itemId, {
                    guardrailResult: {
                      status: "DONE",
                      category: "NONE",
                      rationale: "",
                    },
                  } as any);
                }
              }
              // continue processing other logic if needed
            }
            // Assistant text (or audio-to-text) streaming
            if (
              ev.type === "response.text.delta" ||
              ev.type === "response.audio_transcript.delta"
            ) {
              const itemId: string | undefined =
                (ev as any).item_id ?? (ev as any).itemId;
              const delta: string | undefined =
                (ev as any).delta ?? (ev as any).text;
              if (!itemId || !delta) return;

              // Ensure a transcript message exists for this assistant item.
              if (
                !transcriptItemsRef.current.some((t) => t.itemId === itemId)
              ) {
                addTranscriptMessage(itemId, "assistant", "");
                updateTranscriptItem(itemId, {
                  guardrailResult: {
                    status: "IN_PROGRESS",
                  },
                } as any);
              }

              // Append the latest delta so the UI streams.
              updateTranscriptMessage(itemId, delta, true);
              updateTranscriptItem(itemId, { status: "IN_PROGRESS" });
              return;
            }

            // Live user transcription streaming
            if (ev.type === "conversation.input_audio_transcription.delta") {
              const itemId: string | undefined =
                (ev as any).item_id ?? (ev as any).itemId;
              const delta: string | undefined =
                (ev as any).delta ?? (ev as any).text;
              if (!itemId || typeof delta !== "string") return;

              // If this is the very first chunk, create a hidden user message
              // so that we can surface "Transcribing…" immediately.
              if (
                !transcriptItemsRef.current.some((t) => t.itemId === itemId)
              ) {
                addTranscriptMessage(itemId, "user", "Transcribing…");
              }

              updateTranscriptMessage(itemId, delta, true);
              updateTranscriptItem(itemId, { status: "IN_PROGRESS" });
            }

            // Detect start of a new user speech segment when VAD kicks in.
            if (ev.type === "input_audio_buffer.speech_started") {
              const itemId: string | undefined = (ev as any).item_id;
              if (!itemId) return;

              const exists = transcriptItemsRef.current.some(
                (t) => t.itemId === itemId
              );
              if (!exists) {
                addTranscriptMessage(itemId, "user", "Transcribing…");
                updateTranscriptItem(itemId, { status: "IN_PROGRESS" });
              }
            }

            // Final transcript once Whisper finishes
            if (
              ev.type ===
              "conversation.item.input_audio_transcription.completed"
            ) {
              const itemId: string | undefined = (ev as any).item_id;
              const transcriptText: string | undefined = (ev as any).transcript;
              if (!itemId || typeof transcriptText !== "string") return;

              const exists = transcriptItemsRef.current.some(
                (t) => t.itemId === itemId
              );
              if (!exists) {
                addTranscriptMessage(itemId, "user", transcriptText.trim());
              } else {
                // Replace placeholder / delta text with final transcript
                updateTranscriptMessage(itemId, transcriptText.trim(), false);
              }
              updateTranscriptItem(itemId, { status: "DONE" });
            }

            // Assistant streaming tokens or transcript
            if (
              ev.type === "response.text.delta" ||
              ev.type === "response.audio_transcript.delta"
            ) {
              const responseId: string | undefined =
                (ev as any).response_id ?? (ev as any).responseId;
              const delta: string | undefined =
                (ev as any).delta ?? (ev as any).text;
              if (!responseId || typeof delta !== "string") return;

              // We'll use responseId as part of itemId to make it deterministic.
              const itemId = `assistant-${responseId}`;

              if (
                !transcriptItemsRef.current.some((t) => t.itemId === itemId)
              ) {
                addTranscriptMessage(itemId, "assistant", "");
              }

              updateTranscriptMessage(itemId, delta, true);
              updateTranscriptItem(itemId, { status: "IN_PROGRESS" });
            }
          } catch (err) {
            // Streaming is best-effort – never break the session because of it.
            console.warn("streaming-ui error", err);
          }
        });

        client.on("history_added", (item) => {
          logHistoryItem(item);

          // Update the transcript view
          if (item.type === "message") {
            const textContent = (item.content || [])
              .map((c: any) => {
                if (c.type === "text") return c.text;
                if (c.type === "input_text") return c.text;
                if (c.type === "input_audio") return c.transcript ?? "";
                if (c.type === "audio") return c.transcript ?? "";
                return "";
              })
              .join(" ")
              .trim();

            if (!textContent) return;

            const role = item.role as "user" | "assistant";

            // No PTT placeholder logic needed

            const exists = transcriptItemsRef.current.some(
              (t) => t.itemId === item.itemId
            );

            if (!exists) {
              addTranscriptMessage(item.itemId, role, textContent, false);
              if (role === "assistant") {
                updateTranscriptItem(item.itemId, {
                  guardrailResult: {
                    status: "IN_PROGRESS",
                  },
                } as any);
              }
            } else {
              updateTranscriptMessage(item.itemId, textContent, false);
            }

            // After assistant message completes, add default guardrail PASS if none present.
            if (role === "assistant" && (item as any).status === "completed") {
              const current = transcriptItemsRef.current.find(
                (t) => t.itemId === item.itemId
              );
              const existing = (current as any)?.guardrailResult;
              if (existing && existing.status !== "IN_PROGRESS") {
                // already final (e.g., FAIL) – leave as is.
              } else {
                updateTranscriptItem(item.itemId, {
                  guardrailResult: {
                    status: "DONE",
                    category: "NONE",
                    rationale: "",
                  },
                } as any);
              }
            }

            if ("status" in item) {
              updateTranscriptItem(item.itemId, {
                status:
                  (item as any).status === "completed" ? "DONE" : "IN_PROGRESS",
              });
            }
          }

          // Surface function / hand-off calls as breadcrumbs
          if (item.type === "function_call") {
            const title = `Tool call: ${(item as any).name}`;

            if (!loggedFunctionCallsRef.current.has(item.itemId)) {
              addTranscriptBreadcrumb(title, {
                arguments: (item as any).arguments,
              });
              loggedFunctionCallsRef.current.add(item.itemId);

              // If this looks like a handoff (transfer_to_*), switch active
              // agent so subsequent session updates & breadcrumbs reflect the
              // new agent. The Realtime SDK already updated the session on
              // the backend; this only affects the UI state.
              const toolName: string = (item as any).name ?? "";
              const handoffMatch = toolName.match(/^transfer_to_(.+)$/);
              if (handoffMatch) {
                const newAgentKey = handoffMatch[1];

                // Find agent whose name matches (case-insensitive)
                const candidate = selectedAgentConfigSet?.find(
                  (a) => a.name.toLowerCase() === newAgentKey.toLowerCase()
                );
                if (candidate && candidate.name !== selectedAgentName) {
                  setSelectedAgentName(candidate.name);
                }
              }
            }
            return;
          }
        });

        // Handle continuous updates for existing items so streaming assistant
        // speech shows up while in_progress.
        client.on("history_updated", (history) => {
          history.forEach((item: any) => {
            if (item.type === "function_call") {
              // Update breadcrumb data (e.g., add output) once we have more info.

              if (!loggedFunctionCallsRef.current.has(item.itemId)) {
                addTranscriptBreadcrumb(`Tool call: ${(item as any).name}`, {
                  arguments: (item as any).arguments,
                  output: (item as any).output,
                });
                loggedFunctionCallsRef.current.add(item.itemId);

                const toolName: string = (item as any).name ?? "";
                const handoffMatch = toolName.match(/^transfer_to_(.+)$/);
                if (handoffMatch) {
                  const newAgentKey = handoffMatch[1];
                  const candidate = selectedAgentConfigSet?.find(
                    (a) => a.name.toLowerCase() === newAgentKey.toLowerCase()
                  );
                  if (candidate && candidate.name !== selectedAgentName) {
                    setSelectedAgentName(candidate.name);
                  }
                }
              }

              return;
            }

            if (item.type !== "message") return;

            const textContent = (item.content || [])
              .map((c: any) => {
                if (c.type === "text") return c.text;
                if (c.type === "input_text") return c.text;
                if (c.type === "input_audio") return c.transcript ?? "";
                if (c.type === "audio") return c.transcript ?? "";
                return "";
              })
              .join(" ")
              .trim();

            const role = item.role as "user" | "assistant";

            if (!textContent) return;

            const exists = transcriptItemsRef.current.some(
              (t) => t.itemId === item.itemId
            );
            if (!exists) {
              addTranscriptMessage(item.itemId, role, textContent, false);
              if (role === "assistant") {
                updateTranscriptItem(item.itemId, {
                  guardrailResult: {
                    status: "IN_PROGRESS",
                  },
                } as any);
              }
            } else {
              updateTranscriptMessage(item.itemId, textContent, false);
            }

            if ("status" in item) {
              updateTranscriptItem(item.itemId, {
                status:
                  (item as any).status === "completed" ? "DONE" : "IN_PROGRESS",
              });
            }
          });
        });

        await client.connect();
      } catch (err) {
        console.error("Error connecting via SDK:", err);
        setSessionStatus("DISCONNECTED");
      }
      return;
    }
  };

  const disconnectFromRealtime = () => {
    if (sdkClientRef.current) {
      sdkClientRef.current.disconnect();
      sdkClientRef.current = null;
    }
    setSessionStatus("DISCONNECTED");
    setIsPTTUserSpeaking(false);

    // Clean up audio resources (but preserve user preferences)
    stopRecording();
    
    logClientEvent({}, "disconnected");
  };

  const sendSimulatedUserMessage = (text: string) => {
    const id = uuidv4().slice(0, 32);
    addTranscriptMessage(id, "user", text, true);

    sendClientEvent({
      type: "conversation.item.create",
      item: {
        id,
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    sendClientEvent({ type: "response.create" });
  };

  const updateSession = (shouldTriggerResponse: boolean = false) => {
    // In SDK scenarios RealtimeClient manages session config automatically.
    if (sdkClientRef.current) {
      if (shouldTriggerResponse) {
        sendSimulatedUserMessage("hi");
      }

      // Reflect Push-to-Talk UI state by (de)activating server VAD on the
      // backend. The Realtime SDK supports live session updates via the
      // `session.update` event.
      const client = sdkClientRef.current;
      if (client) {
        const turnDetection = isPTTActive
          ? null
          : {
              type: "server_vad",
              threshold: 0.9,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
              create_response: true,
            };
        try {
          client.sendEvent({
            type: "session.update",
            session: {
              turn_detection: turnDetection,
            },
          });
        } catch (err) {
          console.warn("Failed to update session", err);
        }
      }
      return;
    }
  };

  const cancelAssistantSpeech = async () => {
    // Interrupts server response and clears local audio.
    if (sdkClientRef.current) {
      try {
        sdkClientRef.current.interrupt();
      } catch (err) {
        console.error("Failed to interrupt", err);
      }
    }
  };

  const handleSendTextMessage = () => {
    if (!userText.trim()) return;
    cancelAssistantSpeech();

    if (!sdkClientRef.current) {
      console.error("SDK client not available");
      return;
    }

    try {
      sdkClientRef.current.sendUserText(userText.trim());
    } catch (err) {
      console.error("Failed to send via SDK", err);
    }

    setUserText("");
  };

  const handleTalkButtonDown = () => {
    if (sessionStatus !== "CONNECTED" || sdkClientRef.current == null) return;
    cancelAssistantSpeech();

    setIsPTTUserSpeaking(true);
    sendClientEvent({ type: "input_audio_buffer.clear" });

    // No placeholder; we'll rely on server transcript once ready.
  };

  const handleTalkButtonUp = () => {
    if (
      sessionStatus !== "CONNECTED" ||
      sdkClientRef.current == null ||
      !isPTTUserSpeaking
    )
      return;

    setIsPTTUserSpeaking(false);
    sendClientEvent({ type: "input_audio_buffer.commit" });
    sendClientEvent({ type: "response.create" });
  };

  const onToggleConnection = () => {
    if (sessionStatus === "CONNECTED" || sessionStatus === "CONNECTING") {
      disconnectFromRealtime();
      setSessionStatus("DISCONNECTED");
    } else {
      connectToRealtime();
    }
  };

  const handleAgentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newAgentConfig = e.target.value;
    const url = new URL(window.location.toString());
    url.searchParams.set("agentConfig", newAgentConfig);
    window.location.replace(url.toString());
  };

  const handleSelectedAgentChange = (
    e: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const newAgentName = e.target.value;
    // Reconnect session with the newly selected agent as root so that tool
    // execution works correctly.
    disconnectFromRealtime();
    setSelectedAgentName(newAgentName);
    // connectToRealtime will be triggered by effect watching selectedAgentName
  };

  // Instead of using setCodec, we update the URL and refresh the page when codec changes
  const handleCodecChange = (newCodec: string) => {
    const url = new URL(window.location.toString());
    url.searchParams.set("codec", newCodec);
    window.location.replace(url.toString());
  };

  useEffect(() => {
    const storedPushToTalkUI = localStorage.getItem("pushToTalkUI");
    if (storedPushToTalkUI) {
      setIsPTTActive(storedPushToTalkUI === "true");
    }
    const storedLogsExpanded = localStorage.getItem("logsExpanded");
    if (storedLogsExpanded) {
      setIsEventsPaneExpanded(storedLogsExpanded === "true");
    }
    const storedAudioPlaybackEnabled = localStorage.getItem(
      "audioPlaybackEnabled"
    );
    if (storedAudioPlaybackEnabled) {
      setIsAudioPlaybackEnabled(storedAudioPlaybackEnabled === "true");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("pushToTalkUI", isPTTActive.toString());
  }, [isPTTActive]);

  useEffect(() => {
    localStorage.setItem("logsExpanded", isEventsPaneExpanded.toString());
  }, [isEventsPaneExpanded]);

  useEffect(() => {
    localStorage.setItem(
      "audioPlaybackEnabled",
      isAudioPlaybackEnabled.toString()
    );
  }, [isAudioPlaybackEnabled]);

  useEffect(() => {
    if (audioElementRef.current) {
      if (isAudioPlaybackEnabled) {
        audioElementRef.current.muted = false;
        audioElementRef.current.play().catch((err) => {
          console.warn("Autoplay may be blocked by browser:", err);
        });
      } else {
        // Mute and pause to avoid brief audio blips before pause takes effect.
        audioElementRef.current.muted = true;
        audioElementRef.current.pause();
      }
    }

    // Toggle server-side audio stream mute so bandwidth is saved when the
    // user disables playback. Only supported when using the SDK path.
    if (sdkClientRef.current) {
      try {
        sdkClientRef.current.mute(!isAudioPlaybackEnabled);
      } catch (err) {
        console.warn("Failed to toggle SDK mute", err);
      }
    }
  }, [isAudioPlaybackEnabled]);

  // Ensure mute state is propagated to transport right after we connect or
  // whenever the SDK client reference becomes available.
  useEffect(() => {
    if (sessionStatus === "CONNECTED" && sdkClientRef.current) {
      try {
        sdkClientRef.current.mute(!isAudioPlaybackEnabled);
      } catch (err) {
        console.warn("mute sync after connect failed", err);
      }
    }
  }, [sessionStatus, isAudioPlaybackEnabled]);

  useEffect(() => {
    if (sessionStatus === "CONNECTED" && audioElementRef.current?.srcObject) {
      // The remote audio stream from the audio element.
      const remoteStream = audioElementRef.current.srcObject as MediaStream;
      startRecording(remoteStream);
    }

    // Clean up on unmount or when sessionStatus is updated.
    return () => {
      stopRecording();
    };
  }, [sessionStatus]);

  // Handle browser audio sharing toggle
  const handleBrowserAudioSharingToggle = async () => {
    if (isBrowserAudioSharing) {
      // Stop browser audio sharing
      stopBrowserAudioCapture();
      setIsBrowserAudioSharing(false);
      localStorage.setItem("browserAudioSharing", "false");
      
      // If connected, need to reconnect to properly reset audio stream
      if (sessionStatus === "CONNECTED") {
        disconnectFromRealtime();
        // The reconnection will be triggered by the selectedAgentName effect
      }
    } else {
      // Check browser support before attempting
      const supportCheck = checkBrowserAudioSupport();
      if (!supportCheck.supported) {
        alert(`Browser Audio Sharing Not Supported:\n\n${supportCheck.reason}\n\nPlease try:\n• Use Chrome or Edge on desktop\n• Access via HTTPS or localhost\n• Update your browser to the latest version`);
        return;
      }

      // Start browser audio sharing
      const browserStream = await startBrowserAudioCapture();
      if (browserStream) {
        setIsBrowserAudioSharing(true);
        localStorage.setItem("browserAudioSharing", "true");
        
        // If connected, need to reconnect to properly use combined stream
        if (sessionStatus === "CONNECTED") {
          disconnectFromRealtime();
          // The reconnection will be triggered by the selectedAgentName effect
        }
      } else if (browserAudioError) {
        // Show detailed error message
        alert(`Browser Audio Sharing Failed:\n\n${browserAudioError}\n\nTips:\n• Make sure to click "Share audio" when prompted\n• Try sharing "Entire screen" instead of just a tab\n• Check your system audio settings\n• Use Chrome or Edge for best compatibility`);
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Handle browser audio stream ending
  useEffect(() => {
    if (!isBrowserAudioEnabled && isBrowserAudioSharing) {
      // Browser audio was enabled but now stopped (user ended screen sharing)
      setIsBrowserAudioSharing(false);
      localStorage.setItem("browserAudioSharing", "false");
      
      // Reconnect to use regular microphone only
      if (sessionStatus === "CONNECTED") {
        disconnectFromRealtime();
      }
    }
  }, [isBrowserAudioEnabled, isBrowserAudioSharing, sessionStatus]);

  // Note: We don't reset browser audio sharing preference on disconnect
  // The user should keep their preference for next connection

  const agentSetKey = searchParams.get("agentConfig") || "default";

  return (
    <div className="text-base flex flex-col h-screen bg-gray-100 text-gray-800 relative">
      <div className="p-5 text-lg font-semibold flex justify-between items-center">
        <div
          className="flex items-center cursor-pointer"
          onClick={() => window.location.reload()}
        >
          <div>
            <Image
              src="/openai-logomark.svg"
              alt="OpenAI Logo"
              width={20}
              height={20}
              className="mr-2"
            />
          </div>
          <div>
            Realtime API <span className="text-gray-500">Agents</span>
          </div>
        </div>
        <div className="flex items-center">
          <label className="flex items-center text-base gap-1 mr-2 font-medium">
            Scenario
          </label>
          <div className="relative inline-block">
            <select
              value={agentSetKey}
              onChange={handleAgentChange}
              className="appearance-none border border-gray-300 rounded-lg text-base px-2 py-1 pr-8 cursor-pointer font-normal focus:outline-none"
            >
              {Object.keys(allAgentSets).map((agentKey) => (
                <option key={agentKey} value={agentKey}>
                  {agentKey}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-gray-600">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 10.44l3.71-3.21a.75.75 0 111.04 1.08l-4.25 3.65a.75.75 0 01-1.04 0L5.21 8.27a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          </div>

          {agentSetKey && (
            <div className="flex items-center ml-6">
              <label className="flex items-center text-base gap-1 mr-2 font-medium">
                Agent
              </label>
              <div className="relative inline-block">
                <select
                  value={selectedAgentName}
                  onChange={handleSelectedAgentChange}
                  className="appearance-none border border-gray-300 rounded-lg text-base px-2 py-1 pr-8 cursor-pointer font-normal focus:outline-none"
                >
                  {selectedAgentConfigSet?.map((agent) => (
                    <option key={agent.name} value={agent.name}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-gray-600">
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 10.44l3.71-3.21a.75.75 0 111.04 1.08l-4.25 3.65a.75.75 0 01-1.04 0L5.21 8.27a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </div>
            </div>
          )}

          {/* Browser Audio Sharing Toggle */}
          <div className="flex items-center ml-6">
            <button
              type="button"
              onClick={handleBrowserAudioSharingToggle}
              disabled={isCapturingBrowserAudio}
              className={`flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                isBrowserAudioSharing
                  ? "bg-blue-500 text-white hover:bg-blue-600"
                  : browserAudioError
                  ? "bg-red-100 text-red-700 hover:bg-red-200 border border-red-300"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              } ${
                isCapturingBrowserAudio ? "opacity-50 cursor-not-allowed" : ""
              }`}
              title={browserAudioError || "Share browser audio with the agent"}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              {isCapturingBrowserAudio
                ? "Starting..."
                : browserAudioError
                ? "Audio Error"
                : isBrowserAudioSharing
                ? "Browser Audio ON"
                : "Share Browser Audio"}
            </button>
            {isBrowserAudioEnabled && (
              <div className="ml-2 text-xs text-green-600 font-medium">
                Browser audio active
              </div>
            )}
            {browserAudioError && !isBrowserAudioSharing && (
              <div className="ml-2 text-xs text-red-600 font-medium max-w-xs truncate" title={browserAudioError}>
                {browserAudioError.length > 50 ? browserAudioError.substring(0, 50) + "..." : browserAudioError}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 gap-2 px-2 overflow-hidden relative">
        <Transcript
          userText={userText}
          setUserText={setUserText}
          onSendMessage={handleSendTextMessage}
          downloadRecording={downloadRecording}
          canSend={
            sessionStatus === "CONNECTED" && sdkClientRef.current != null
          }
        />

        <Events isExpanded={isEventsPaneExpanded} />
      </div>

      <BottomToolbar
        sessionStatus={sessionStatus}
        onToggleConnection={onToggleConnection}
        isPTTActive={isPTTActive}
        setIsPTTActive={setIsPTTActive}
        isPTTUserSpeaking={isPTTUserSpeaking}
        handleTalkButtonDown={handleTalkButtonDown}
        handleTalkButtonUp={handleTalkButtonUp}
        isEventsPaneExpanded={isEventsPaneExpanded}
        setIsEventsPaneExpanded={setIsEventsPaneExpanded}
        isAudioPlaybackEnabled={isAudioPlaybackEnabled}
        setIsAudioPlaybackEnabled={setIsAudioPlaybackEnabled}
        codec={urlCodec}
        onCodecChange={handleCodecChange}
      />
    </div>
  );
}

export default App;
