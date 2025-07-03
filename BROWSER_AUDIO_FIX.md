# Browser Audio Routing Fix

## Problem Description

The browser captured audio was not being routed along with microphone recorded audio to the OpenAI agent. Users could share their browser audio (e.g., from a video call, music, or other browser tab), but the agent couldn't hear it.

## Root Cause Analysis

The issue was in the audio stream routing system. The application was designed to:

1. Capture microphone audio
2. Capture browser audio via `getDisplayMedia()`
3. Combine both streams using Web Audio API
4. Pass the combined stream to the OpenAI Realtime API

However, the routing wasn't working due to:

1. **Timing Issues**: The `getUserMedia` override wasn't happening at the right time
2. **Stream Validation**: Invalid or expired streams weren't being properly detected
3. **Lack of Debugging**: Hard to identify where the audio routing was failing

## Changes Made

### 1. Enhanced RealtimeClient (`src/app/agentConfigs/realtimeClient.ts`)

**Added Better Debugging**:
```typescript
// Added comprehensive logging to track getUserMedia calls
console.log('getUserMedia called with constraints:', constraints);
console.log('Returning custom audio stream (mic + browser audio)');
```

**Improved Timing**:
```typescript
// Ensure getUserMedia override happens BEFORE creating the transport
if (this.#customAudioStream) {
  console.log('Setting up custom audio stream override');
  this.#overrideGetUserMedia();
}
```

### 2. Enhanced Audio Stream Management (`src/app/hooks/useAudioDownload.ts`)

**Added Stream Validation**:
```typescript
// Check if we have a valid existing stream
const tracks = combinedStreamRef.current.getTracks();
const hasValidTracks = tracks.length > 0 && tracks.every(track => track.readyState === 'live');
```

**Improved Browser Audio Validation**:
```typescript
// Check if browser audio stream is still valid
const browserTracks = browserAudioStreamRef.current.getTracks();
const hasValidBrowserTracks = browserTracks.length > 0 && browserTracks.every(track => track.readyState === 'live');
```

**Enhanced Debugging**:
```typescript
console.log('Creating combined audio stream...');
console.log('Microphone stream obtained:', micStream.getTracks().map(t => ({
  kind: t.kind,
  label: t.label,
  enabled: t.enabled,
  readyState: t.readyState
})));
```

### 3. Improved App Flow (`src/app/App.tsx`)

**Added Connection Flow Debugging**:
```typescript
console.log('Browser audio sharing enabled, creating combined stream...');
console.log('RealtimeClient created with customAudioStream:', customAudioStream ? 'YES' : 'NO');
```

### 4. Created Debug Tool (`debug_audio.html`)

A standalone debugging tool to test:
- Microphone access
- Browser audio capture
- Combined stream creation
- getUserMedia override functionality

## How It Works

### Normal Flow (No Browser Audio):
1. User connects → RealtimeClient uses default microphone via `getUserMedia()`

### Browser Audio Flow:
1. User enables "Share Browser Audio" → `startBrowserAudioCapture()` called
2. Browser prompts user to share screen/tab with audio
3. `createCombinedAudioStream()` creates combined stream:
   - Gets microphone via `getUserMedia()`
   - Uses Web Audio API to combine mic + browser audio
   - Returns combined stream
4. Combined stream passed to `RealtimeClient` as `customAudioStream`
5. `RealtimeClient.connect()` overrides `getUserMedia()` to return combined stream
6. When OpenAI WebRTC transport calls `getUserMedia()`, it gets the combined stream

## Testing the Fix

### Using the Debug Tool:
1. Open `debug_audio.html` in browser
2. Click "Test Microphone" → Should show microphone access
3. Click "Test Browser Audio" → Should prompt for screen/audio sharing
4. Click "Test Combined Audio" → Should create combined stream
5. Click "Test getUserMedia Override" → Should confirm override works

### Using the Main App:
1. Open the application
2. Click "Share Browser Audio" button
3. Select screen/tab to share (make sure "Share audio" is checked)
4. Connect to an agent
5. Check browser console for debugging messages:
   - "Browser audio sharing enabled, creating combined stream..."
   - "Combined audio stream created with microphone + browser audio"
   - "getUserMedia override installed successfully"
   - "getUserMedia called with constraints: ..."
   - "Returning custom audio stream (mic + browser audio)"

## Troubleshooting

### Common Issues:

1. **"Permission denied" errors**: User needs to allow both microphone and screen sharing
2. **"No audio tracks found"**: User needs to check "Share audio" when prompted
3. **Browser compatibility**: Works best in Chrome/Edge on desktop with HTTPS
4. **Audio context issues**: May need user interaction before audio contexts work

### Debug Messages to Look For:

- ✅ "Combined audio stream created with microphone + browser audio"
- ✅ "getUserMedia override installed successfully"
- ✅ "Returning custom audio stream (mic + browser audio)"
- ❌ "Failed to create combined audio stream"
- ❌ "Browser audio stream is invalid"

## Browser Support

- **Chrome/Edge**: Full support
- **Firefox**: Limited support (may not work on mobile)
- **Safari**: Limited support
- **Mobile browsers**: Generally not supported

## Security Requirements

- Must use HTTPS or localhost
- Requires user permission for microphone and screen sharing
- May require user gesture to activate audio contexts 