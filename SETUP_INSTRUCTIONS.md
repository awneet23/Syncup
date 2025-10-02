# SyncUp - Multi-Participant Speech Capture Setup

## How It Works Now

SyncUp captures speech from **ALL participants** in your Google Meet for real-time contextual summaries!

## ✨ New Feature: Built-in Chatbox

**Ask questions directly in the sidebar!** No need for wake words - just type your question in the chatbox and get instant AI-powered answers based on the full meeting context.

### Dual Capture Method

The extension uses TWO methods simultaneously for complete coverage:

1. **Google Meet Captions** (Primary - captures ALL participants)
   - Monitors Google Meet's caption system which transcribes EVERYONE's speech
   - Captures all participants in the meeting

2. **Your Microphone** (Backup + Real-time supplement)
   - Direct microphone capture for YOUR voice
   - Provides real-time transcription as backup
   - Works even if captions have delays

3. **Combined Processing**
   - Speech from ALL sources is buffered together
   - Processed every 15 seconds for contextual cards
   - Topics mentioned by ANY participant generate contextual information

## Setup Instructions

### Step 1: Enable Google Meet Captions

**IMPORTANT**: For the extension to capture everyone's voice, you MUST enable Google Meet captions:

#### Method 1: Automatic (when you click Start)
- The extension will try to enable captions automatically
- Check the browser console to see if it succeeded

#### Method 2: Manual (recommended)
1. Join your Google Meet meeting
2. Click the **three dots menu** (⋮) in the bottom toolbar
3. Select **"Turn on captions"** or press the **"C"** key
4. You should see captions appear at the bottom of the screen

### Step 2: Start SyncUp

1. Open the SyncUp sidebar (click the 🔍 icon)
2. Click **Start** button
3. **Allow microphone access** when prompted (for capturing YOUR voice)
4. The extension will now capture speech from **ALL participants**:
   - Your voice via microphone (real-time)
   - Everyone's voice via captions (including yours)

## How to Verify It's Working

1. Check the browser console (F12 → Console tab)
2. Look for these messages:
   - `🎤 YOUR VOICE (microphone): [your words]` - Your microphone is working
   - `📝 Caption captured from participant: [text]` - Captions capturing all participants
   - `⏰ 15 seconds elapsed - Processing conversation from ALL participants` - Processing speech
3. When YOU speak: See both microphone capture AND caption capture
4. When OTHERS speak: See caption capture
5. Every 15 seconds: See processing messages and new contextual cards appear

## Important Notes

### ✅ What Works
- **Dual capture system**:
  - YOUR voice: Microphone (real-time)
  - EVERYONE's voice: Google Meet captions (including yours)
- Processes conversation from all participants every 15 seconds
- Generates contextual cards for topics mentioned by ANY participant
- Supports both English and Hindi
- Wake word "Hey SyncUp" works with both capture methods

### ⚠️ Requirements
- **Microphone permission** - Required to capture your voice
- **Google Meet captions** - Recommended for capturing other participants
- Chrome browser recommended for best compatibility

### 💡 Troubleshooting

**Problem**: Not capturing YOUR voice
- **Solution**: Make sure you allowed microphone permission when prompted
- Check console for "🎤 YOUR VOICE (microphone)" messages

**Problem**: Not capturing other participants' speech
- **Solution**: Enable Google Meet captions (Press "C" or use menu)
- Check console for "📝 Caption captured from participant" messages

**Problem**: No contextual cards appearing
- **Solution**:
  - Wait 15 seconds for processing (cards generate every 15 seconds)
  - Check if conversation has technical/topical keywords
  - Verify console shows "⏰ 15 seconds elapsed - Processing conversation"

## Technical Details

### Dual Capture Architecture

**Method 1: Microphone Capture (YOUR voice)**
- Web Speech API (`webkitSpeechRecognition`)
- Continuous recognition with auto-restart
- Real-time transcription of YOUR voice
- Immediate wake word detection

**Method 2: Caption Capture (ALL participants)**
- MutationObserver monitoring Google Meet's DOM
- Watches for caption text changes in real-time
- Multiple selectors to find caption elements
- Deduplication to avoid processing same text twice

**Combined Processing**
- Both sources feed into a shared transcript buffer
- 15-second intervals for contextual card generation
- Full meeting transcript maintained for question context

### Asking Questions - Two Ways!

**Method 1: Chatbox (Recommended)**
- Type your question in the chatbox at the bottom of the sidebar
- Press Enter or click the send button
- Get instant AI answers based on full meeting context
- Works anytime during the meeting

**Method 2: Wake Word (Voice)**
- Say "Hey SyncUp, [your question]"
- Works from YOUR microphone (real-time)
- Also works from captions (ANY participant can trigger)
- Instant AI-powered response cards generated

## Privacy Note
This extension only processes captions shown on your screen. It does not record or store audio. All processing happens locally in your browser, with only text sent to AI APIs for analysis.
