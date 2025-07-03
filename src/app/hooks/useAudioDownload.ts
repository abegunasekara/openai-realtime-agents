import { useRef, useCallback, useState } from "react";
import { convertWebMBlobToWav } from "../lib/audioUtils";

function useAudioDownload() {
  // Ref to store the MediaRecorder instance.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  // Ref to collect all recorded Blob chunks.
  const recordedChunksRef = useRef<Blob[]>([]);
  // Ref to store the combined audio stream for the agent
  const combinedStreamRef = useRef<MediaStream | null>(null);
  // Ref to store the browser audio stream
  const browserAudioStreamRef = useRef<MediaStream | null>(null);
  // Ref to store the audio context
  const audioContextRef = useRef<AudioContext | null>(null);
  
  const [isBrowserAudioEnabled, setIsBrowserAudioEnabled] = useState(false);
  const [isCapturingBrowserAudio, setIsCapturingBrowserAudio] = useState(false);
  const [browserAudioError, setBrowserAudioError] = useState<string | null>(null);

  /**
   * Checks if browser audio capture is supported
   */
  const checkBrowserAudioSupport = useCallback(() => {
    // Check if running in secure context (HTTPS or localhost)
    const isSecureContext = window.isSecureContext || 
      window.location.hostname === 'localhost' || 
      window.location.hostname === '127.0.0.1';

    if (!isSecureContext) {
      return {
        supported: false,
        reason: "Browser audio sharing requires HTTPS or localhost. Please use HTTPS or run on localhost."
      };
    }

    // Check if getDisplayMedia is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      return {
        supported: false,
        reason: "Your browser doesn't support screen/audio sharing (getDisplayMedia not available)."
      };
    }

    // Check user agent for known issues
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('firefox') && userAgent.includes('android')) {
      return {
        supported: false,
        reason: "Firefox on Android doesn't support audio capture through screen sharing."
      };
    }

    return { supported: true, reason: null };
  }, []);

  /**
   * Starts capturing browser audio using getDisplayMedia with improved error handling
   */
  const startBrowserAudioCapture = useCallback(async () => {
    try {
      setIsCapturingBrowserAudio(true);
      setBrowserAudioError(null);

      // Check browser support first
      const supportCheck = checkBrowserAudioSupport();
      if (!supportCheck.supported) {
        throw new Error(supportCheck.reason ?? "Browser audio capture not supported");
      }

      // Try different approaches based on browser
      let stream: MediaStream | null = null;
      
      // Approach 1: Try with specific audio constraints
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        });
      } catch (firstError) {
        console.warn("First approach failed:", firstError);

        // Approach 2: Try with simpler audio constraints
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: false,
          });
        } catch (secondError) {
          console.warn("Second approach failed:", secondError);

          // Approach 3: Try with video + audio then extract audio
          try {
            const videoStream = await navigator.mediaDevices.getDisplayMedia({
              audio: true,
              video: true,
            });
            
            // Extract only audio tracks
            const audioTracks = videoStream.getAudioTracks();
            if (audioTracks.length > 0) {
              stream = new MediaStream(audioTracks);
              // Stop video tracks since we don't need them
              videoStream.getVideoTracks().forEach(track => track.stop());
            } else {
              throw new Error("No audio tracks found in the shared stream");
            }
          } catch (thirdError) {
            // All approaches failed
            const errorMessage = thirdError instanceof Error ? thirdError.message : String(thirdError);
            throw new Error(`Browser audio capture not supported. Try: 1) Use Chrome/Edge on desktop 2) Share "entire screen" or "browser tab" with audio 3) Ensure system audio is enabled. Details: ${errorMessage}`);
          }
        }
      }

      if (!stream) {
        throw new Error("Failed to create audio stream");
      }

      // Verify we have audio tracks
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error("No audio tracks in the shared stream. Make sure to select 'Share audio' when prompted.");
      }

      browserAudioStreamRef.current = stream;
      setIsBrowserAudioEnabled(true);
      
      // Handle when user stops screen sharing
      audioTracks.forEach(track => {
        track.addEventListener('ended', () => {
          console.log("Browser audio track ended");
          setIsBrowserAudioEnabled(false);
          setIsCapturingBrowserAudio(false);
          browserAudioStreamRef.current = null;
          setBrowserAudioError(null);
        });
      });
      
      console.log("Browser audio capture started successfully");
      return stream;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
      console.error("Error getting browser audio stream:", errorMessage);
      setIsCapturingBrowserAudio(false);
      setIsBrowserAudioEnabled(false);
      setBrowserAudioError(errorMessage);
      
      // Show user-friendly error message
      if (errorMessage.includes("Permission denied") || errorMessage.includes("NotAllowedError")) {
        setBrowserAudioError("Permission denied. Please allow screen/audio sharing and try again.");
      } else if (errorMessage.includes("NotSupportedError")) {
        setBrowserAudioError("Browser audio sharing not supported. Try using Chrome/Edge on desktop with HTTPS or localhost.");
      } else {
        setBrowserAudioError(errorMessage);
      }
      
      return null;
    }
  }, [checkBrowserAudioSupport]);

  /**
   * Stops browser audio capture
   */
  const stopBrowserAudioCapture = useCallback(() => {
    if (browserAudioStreamRef.current) {
      browserAudioStreamRef.current.getTracks().forEach(track => track.stop());
      browserAudioStreamRef.current = null;
    }
    setIsBrowserAudioEnabled(false);
    setIsCapturingBrowserAudio(false);
    setBrowserAudioError(null);
  }, []);

  /**
   * Creates a combined audio stream from microphone and browser audio
   */
  const createCombinedAudioStream = useCallback(async () => {
    try {
      console.log('Creating combined audio stream...');
      
      // Get microphone stream
      const micStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      console.log('Microphone stream obtained:', micStream.getTracks().map(t => ({
        kind: t.kind,
        label: t.label,
        enabled: t.enabled,
        readyState: t.readyState
      })));

      // Create audio context
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const destination = audioContext.createMediaStreamDestination();

      // Connect microphone
      const micSource = audioContext.createMediaStreamSource(micStream);
      const micGain = audioContext.createGain();
      micGain.gain.value = 1.0; // Normal microphone level
      micSource.connect(micGain);
      micGain.connect(destination);

      console.log('Microphone connected to combined stream');

      // Connect browser audio if available
      if (browserAudioStreamRef.current) {
        try {
          // Check if browser audio stream is still valid
          const browserTracks = browserAudioStreamRef.current.getTracks();
          const hasValidBrowserTracks = browserTracks.length > 0 && browserTracks.every(track => track.readyState === 'live');
          
          if (!hasValidBrowserTracks) {
            console.warn('Browser audio stream is invalid, skipping browser audio');
            browserAudioStreamRef.current = null;
            setIsBrowserAudioEnabled(false);
          } else {
            console.log('Browser audio stream available:', browserAudioStreamRef.current.getTracks().map(t => ({
              kind: t.kind,
              label: t.label,
              enabled: t.enabled,
              readyState: t.readyState
            })));
            
            const browserSource = audioContext.createMediaStreamSource(browserAudioStreamRef.current);
            const browserGain = audioContext.createGain();
            browserGain.gain.value = 0.7; // Slightly lower browser audio level
            browserSource.connect(browserGain);
            browserGain.connect(destination);
            console.log("Combined audio stream created with microphone + browser audio");
          }
        } catch (browserError) {
          console.warn("Failed to add browser audio to combined stream:", browserError);
          // Continue with just microphone
        }
      } else {
        console.log("No browser audio stream available, using microphone only");
      }

      combinedStreamRef.current = destination.stream;
      
      console.log('Combined stream created successfully:', destination.stream.getTracks().map(t => ({
        kind: t.kind,
        label: t.label,
        enabled: t.enabled,
        readyState: t.readyState
      })));
      
      return destination.stream;
    } catch (err) {
      console.error("Error creating combined audio stream:", err);
      return null;
    }
  }, []);

  /**
   * Gets the current combined audio stream, creating it if necessary
   */
  const getCombinedAudioStream = useCallback(async () => {
    // Check if we have a valid existing stream
    if (combinedStreamRef.current) {
      const tracks = combinedStreamRef.current.getTracks();
      const hasValidTracks = tracks.length > 0 && tracks.every(track => track.readyState === 'live');
      
      if (hasValidTracks) {
        console.log('Returning existing valid combined stream');
        return combinedStreamRef.current;
      } else {
        console.log('Existing combined stream is invalid, creating new one');
        // Clean up the invalid stream
        tracks.forEach(track => track.stop());
        combinedStreamRef.current = null;
      }
    }
    
    console.log('Creating new combined audio stream');
    return await createCombinedAudioStream();
  }, [createCombinedAudioStream]);

  /**
   * Starts recording by combining the provided remote stream with
   * the microphone audio and browser audio (if enabled).
   * @param remoteStream - The remote MediaStream (e.g., from the audio element).
   */
  const startRecording = async (remoteStream: MediaStream) => {
    // Create combined stream (mic + browser audio)
    const combinedStream = await getCombinedAudioStream();
    if (!combinedStream) {
      console.error("Failed to create combined audio stream");
      return;
    }

    // Create an AudioContext to merge all streams for recording
    const recordingContext = new AudioContext();
    const recordingDestination = recordingContext.createMediaStreamDestination();

    // Connect the remote audio stream (agent's voice)
    try {
      const remoteSource = recordingContext.createMediaStreamSource(remoteStream);
      const remoteGain = recordingContext.createGain();
      remoteGain.gain.value = 1.0;
      remoteSource.connect(remoteGain);
      remoteGain.connect(recordingDestination);
    } catch (err) {
      console.error("Error connecting remote stream to the recording context:", err);
    }

    // Connect the combined user audio stream (mic + browser audio)
    try {
      const combinedSource = recordingContext.createMediaStreamSource(combinedStream);
      const combinedGain = recordingContext.createGain();
      combinedGain.gain.value = 1.0;
      combinedSource.connect(combinedGain);
      combinedGain.connect(recordingDestination);
    } catch (err) {
      console.error("Error connecting combined stream to the recording context:", err);
    }

    const options = { mimeType: "audio/webm" };
    try {
      const mediaRecorder = new MediaRecorder(recordingDestination.stream, options);
      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      // Start recording without a timeslice.
      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
    } catch (err) {
      console.error("Error starting MediaRecorder with combined stream:", err);
    }
  };

  /**
   * Stops the MediaRecorder, if active.
   */
  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      // Request any final data before stopping.
      mediaRecorderRef.current.requestData();
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  };

  /**
   * Cleans up audio contexts and streams
   */
  const cleanup = useCallback(() => {
    console.log('Cleaning up audio resources...');
    
    stopRecording();
    stopBrowserAudioCapture();
    
    if (audioContextRef.current) {
      console.log('Closing audio context');
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    if (combinedStreamRef.current) {
      console.log('Stopping combined stream tracks');
      combinedStreamRef.current.getTracks().forEach(track => track.stop());
      combinedStreamRef.current = null;
    }
    
    console.log('Audio cleanup complete');
  }, [stopBrowserAudioCapture]);

  /**
   * Initiates download of the recording after converting from WebM to WAV.
   * If the recorder is still active, we request its latest data before downloading.
   */
  const downloadRecording = async () => {
    // If recording is still active, request the latest chunk.
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      // Request the current data.
      mediaRecorderRef.current.requestData();
      // Allow a short delay for ondataavailable to fire.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (recordedChunksRef.current.length === 0) {
      console.warn("No recorded chunks found to download.");
      return;
    }
    
    // Combine the recorded chunks into a single WebM blob.
    const webmBlob = new Blob(recordedChunksRef.current, { type: "audio/webm" });

    try {
      // Convert the WebM blob into a WAV blob.
      const wavBlob = await convertWebMBlobToWav(webmBlob);
      const url = URL.createObjectURL(wavBlob);

      // Generate a formatted datetime string (replace characters not allowed in filenames).
      const now = new Date().toISOString().replace(/[:.]/g, "-");

      // Create an invisible anchor element and trigger the download.
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `realtime_agents_audio_${now}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Clean up the blob URL after a short delay.
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (err) {
      console.error("Error converting recording to WAV:", err);
    }
  };

  return { 
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
  };
}

export default useAudioDownload; 