# Browser Audio Sharing Feature

## Overview

This feature allows you to share both your microphone input AND browser audio (from other tabs, applications, or system audio) to the OpenAI Realtime API agent for transcription and conversation.

## Requirements

### Browser Compatibility
- **Chrome/Chromium**: Full support (recommended)
- **Edge**: Full support 
- **Firefox**: Limited support (desktop only)
- **Safari**: Limited support
- **Mobile browsers**: Generally not supported

### Security Requirements
- **HTTPS required** for production sites
- **Localhost allowed** for development (http://localhost:3001 works)
- **Secure context required** for `getDisplayMedia()` API

## How It Works

The implementation combines:
1. **Microphone Input**: Your voice input through the microphone
2. **Browser Audio**: Audio from other browser tabs, applications, or system audio
3. **Combined Stream**: Both audio sources are mixed together and sent to the agent

## Usage

### 1. Basic Setup
- Start the application normally
- Connect to a realtime agent scenario
- The "Share Browser Audio" button will appear in the top toolbar

### 2. Enabling Browser Audio Sharing
1. Click the "Share Browser Audio" button in the top toolbar
2. Your browser will prompt you to share your screen/audio
3. **Important**: Choose "Share tab audio" or "Share system audio" when prompted
4. You can choose to share audio without sharing video (recommended for privacy)
5. Once enabled, the button will show "Browser Audio ON" and a green indicator will appear

### 3. What Gets Shared
When browser audio sharing is enabled:
- **Your microphone**: Your voice input continues to work normally
- **Browser audio**: Audio from the selected tab/system gets mixed in
- **Combined stream**: Both audio sources are sent to the agent simultaneously

### 4. Use Cases
- **Screen sharing presentations**: Share your presentation audio along with your commentary
- **Music/media sharing**: Let the agent hear and discuss music or videos you're playing
- **Multi-tab conversations**: Include audio from other browser tabs in your conversation
- **System audio**: Share any system audio (notifications, other applications, etc.)

## Technical Details

### Audio Mixing
- Microphone audio: Full volume (gain = 1.0)
- Browser audio: Slightly reduced volume (gain = 0.7) to prevent overpowering your voice
- Both streams are mixed using Web Audio API

### Browser Compatibility
- Requires modern browsers with `getDisplayMedia()` support
- Chrome, Firefox, Safari, and Edge are supported
- Mobile browsers may have limited support

### Privacy Considerations
- Browser audio sharing requires explicit user permission
- You can choose to share audio without sharing video
- The sharing can be stopped at any time by clicking the browser's sharing indicator
- The feature automatically disables when screen sharing is stopped

## Troubleshooting

### "NotSupportedError: Not supported"

This is the most common error. Here's how to fix it:

1. **Check HTTPS/Localhost**
   - Production sites MUST use HTTPS
   - For development, use `http://localhost:3001` (not `http://127.0.0.1` or IP addresses)
   - The browser requires a "secure context" for screen/audio sharing

2. **Use Compatible Browser**
   - **Best**: Chrome or Edge on desktop
   - **Good**: Firefox on desktop (may have limitations)
   - **Limited**: Safari (newer versions only)
   - **Not supported**: Most mobile browsers

3. **Check Browser Version**
   - Update to the latest browser version
   - Older browsers may not support audio capture

4. **Operating System Support**
   - **Windows 10/11**: Full support
   - **macOS**: Full support
   - **Linux**: Support varies by distribution
   - **Mobile**: Generally not supported

### Other Common Issues

1. **"Starting..." button stays stuck**
   - Check if you granted audio sharing permissions
   - Try refreshing the page and trying again
   - Check browser console for detailed error messages

2. **"Permission denied" or "NotAllowedError"**
   - Click "Allow" when browser prompts for screen sharing
   - Check if browser has blocked popups or permissions
   - Try reloading the page and granting permissions again

3. **"No audio tracks found"**
   - Make sure to check "Share audio" when prompted
   - Try selecting "Entire screen" instead of just a tab
   - Ensure the audio source (tab/app) is actually playing audio

4. **Browser audio not working**
   - Ensure you selected "Share tab audio" or "Share system audio" in the browser prompt
   - Check that the audio source (tab/application) is actually playing audio
   - Verify system audio is not muted

5. **Audio quality issues**
   - Browser audio sharing may introduce slight latency
   - For best quality, use headphones to prevent feedback
   - Close unnecessary tabs to improve performance

6. **Firefox-specific issues**
   - Firefox on Android doesn't support audio capture
   - Try using Chrome/Edge if Firefox doesn't work
   - Some Firefox versions have limited audio sharing support

### Advanced Troubleshooting

1. **Check Console Logs**
   - Open browser Developer Tools (F12)
   - Look for error messages in the Console tab
   - Share error details with support if needed

2. **Test Basic Screen Sharing**
   - Try sharing screen without audio first
   - If basic sharing doesn't work, the issue is with getDisplayMedia() support

3. **Check Browser Flags**
   - Some browsers require experimental flags for full audio support
   - In Chrome: `chrome://flags/#enable-experimental-web-platform-features`

### Resetting the Feature
- Click the "Browser Audio ON" button to disable sharing
- The connection will automatically reset to microphone-only mode
- You can re-enable sharing at any time
- Refresh the page if the feature gets stuck

## Implementation Notes

### For Developers
The feature is implemented using:
- `getDisplayMedia()` API for browser audio capture
- Web Audio API for mixing audio streams
- Custom `getUserMedia()` override to provide combined stream to OpenAI SDK
- Automatic cleanup and state management
- Multiple fallback approaches for different browsers

### File Changes
- `src/app/hooks/useAudioDownload.ts`: Enhanced with browser audio capture
- `src/app/agentConfigs/realtimeClient.ts`: Custom audio stream handling
- `src/app/App.tsx`: UI controls and state management

## Future Enhancements

Potential improvements:
- Audio level controls for microphone vs browser audio balance
- Visual audio level indicators
- Support for multiple audio sources
- Audio processing options (echo cancellation, noise suppression)
- Better mobile browser support when APIs become available 