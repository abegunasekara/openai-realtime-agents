/*
 * Thin wrapper that exposes a subset of functionality needed by the React UI,
 * implemented on top of @openai/agents/realtime RealtimeSession.
 */

import { RealtimeSession, RealtimeAgent, OpenAIRealtimeWebRTC } from '@openai/agents/realtime';
import { moderationGuardrail } from './guardrails';

// Minimal event emitter (browser-safe, no Node polyfill)
type Listener<Args extends any[]> = (...args: Args) => void;

class MiniEmitter<Events extends Record<string, any[]>> {
  #events = new Map<keyof Events, Listener<any[]>[]>();

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>) {
    const arr = this.#events.get(event) || [];
    arr.push(fn);
    this.#events.set(event, arr);
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>) {
    const arr = this.#events.get(event) || [];
    this.#events.set(
      event,
      arr.filter((f) => f !== fn),
    );
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]) {
    const arr = this.#events.get(event) || [];
    arr.forEach((fn) => fn(...args));
  }
}

export type ClientEvents = {
  connection_change: ['connected' | 'connecting' | 'disconnected'];
  message: [any]; // raw transport events (will be refined later)
  audio_interrupted: [];
  history_added: [import('@openai/agents/realtime').RealtimeItem];
  history_updated: [import('@openai/agents/realtime').RealtimeItem[]];
};

export interface RealtimeClientOptions {
  getEphemeralKey: () => Promise<string>; // returns ek_ string
  initialAgents: RealtimeAgent[]; // first item is root agent
  audioElement?: HTMLAudioElement;
  customAudioStream?: MediaStream; // Custom audio stream for combined mic + browser audio
  extraContext?: Record<string, any>;
}

export class RealtimeClient {
  #session: RealtimeSession | null = null;
  #events = new MiniEmitter<ClientEvents>();
  #options: RealtimeClientOptions;
  #customAudioStream: MediaStream | null = null;

  constructor(options: RealtimeClientOptions) {
    this.#options = options;
    this.#customAudioStream = options.customAudioStream || null;
  }

  on<K extends keyof ClientEvents>(event: K, listener: (...args: ClientEvents[K]) => void) {
    this.#events.on(event, listener as any);
  }

  off<K extends keyof ClientEvents>(event: K, listener: (...args: ClientEvents[K]) => void) {
    this.#events.off(event, listener as any);
  }

  async connect() {
    if (this.#session) return;

    const ek = await this.#options.getEphemeralKey();
    const rootAgent = this.#options.initialAgents[0];

    // If we have a custom audio stream, we need to override getUserMedia BEFORE creating the transport
    if (this.#customAudioStream) {
      console.log('Setting up custom audio stream override');
      this.#overrideGetUserMedia();
    }

    const transportValue: any = this.#options.audioElement
      ? new OpenAIRealtimeWebRTC({
          useInsecureApiKey: true,
          audioElement: this.#options.audioElement,
        })
      : 'webrtc';

    this.#session = new RealtimeSession(rootAgent, {
      transport: transportValue,
      outputGuardrails: [moderationGuardrail as any],
      context: this.#options.extraContext ?? {},
    });

    // Immediately notify UI that we've started connecting.
    this.#events.emit('connection_change', 'connecting');

    // Forward every transport event as message for handler and watch for
    // low-level connection state changes so we can propagate *disconnections*
    // after initial setup.
    const transport: any = this.#session.transport;

    transport.on('*', (ev: any) => {
      // Surface raw session.updated to console for debugging missing instructions.
      if (ev?.type === 'session.updated') {
        // Could add console.log for debugging if needed
      }
      this.#events.emit('message', ev);
    });

    transport.on('connection_change', (status: any) => {
      if (status === 'disconnected') {
        this.#events.emit('connection_change', 'disconnected');
      }
    });

    // Track seen items so we can re-emit granular additions.
    const seenItems = new Map<string, string>(); // itemId -> serialized status marker

    this.#session.on('history_updated', (history: any) => {
      (history as any[]).forEach((item) => {
        const key = `${item.itemId}:${item.status}`;
        if (!seenItems.has(key)) {
          seenItems.set(key, key);
          this.#events.emit('history_added', item);
        }
      });
      // Also expose full history if callers want it.
      this.#events.emit('history_updated', history);
    });

    this.#session.on('audio_interrupted', () => {
      this.#events.emit('audio_interrupted');
    });

    this.#session.on('guardrail_tripped', (info: any) => {
      this.#events.emit('message', { type: 'guardrail_tripped', info });
    });

    // Wait for full connection establishment (data channel open).
    await this.#session.connect({ apiKey: ek });

    // Now we are truly connected.
    this.#events.emit('connection_change', 'connected');
  }

  disconnect() {
    this.#session?.close();
    this.#session = null;
    this.#restoreGetUserMedia();
    this.#events.emit('connection_change', 'disconnected');
  }

  // Store the original getUserMedia function
  #originalGetUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;

  #overrideGetUserMedia() {
    if (!this.#customAudioStream) return;

    // Store the original function
    this.#originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    // Override getUserMedia to return our custom stream
    navigator.mediaDevices.getUserMedia = async (constraints: MediaStreamConstraints) => {
      console.log('getUserMedia called with constraints:', constraints);
      
      // If audio is requested and we have a custom stream, return it
      if (constraints.audio && this.#customAudioStream) {
        console.log('Returning custom audio stream (mic + browser audio)');
        console.log('Custom stream tracks:', this.#customAudioStream.getTracks().map(t => ({
          kind: t.kind,
          label: t.label,
          enabled: t.enabled,
          readyState: t.readyState
        })));
        return this.#customAudioStream;
      }
      
      // Otherwise, use the original implementation
      console.log('Using original getUserMedia');
      return this.#originalGetUserMedia!(constraints);
    };
    
    console.log('getUserMedia override installed successfully');
  }

  #restoreGetUserMedia() {
    if (this.#originalGetUserMedia) {
      navigator.mediaDevices.getUserMedia = this.#originalGetUserMedia;
      this.#originalGetUserMedia = null;
    }
  }

  // Method to update the custom audio stream
  updateCustomAudioStream(stream: MediaStream | null) {
    this.#customAudioStream = stream;
    if (stream) {
      this.#overrideGetUserMedia();
    } else {
      this.#restoreGetUserMedia();
    }
  }

  sendUserText(text: string) {
    if (!this.#session) throw new Error('not connected');
    this.#session.sendMessage(text);
  }

  pushToTalkStart() {
    if (!this.#session) return;
    this.#session.transport.sendEvent({ type: 'input_audio_buffer.clear' } as any);
  }

  pushToTalkStop() {
    if (!this.#session) return;
    this.#session.transport.sendEvent({ type: 'input_audio_buffer.commit' } as any);
    this.#session.transport.sendEvent({ type: 'response.create' } as any);
  }

  sendEvent(event: any) {
    this.#session?.transport.sendEvent(event);
  }

  interrupt() {
    this.#session?.transport.interrupt();
  }

  mute(muted: boolean) {
    this.#session?.mute(muted);
  }
}
