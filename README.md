# Meet-Actions 📋

AI-powered Chrome extension that extracts real-time action items from Google Meet conversations using Cerebras API and Meta Llama models.

**Built for FutureStack GenAI Hackathon**

## 🎯 Features

- **Real-time Transcription** - Captures audio from Google Meet using Chrome's tabCapture API
- **AI-Powered Analysis** - Uses Cerebras API with Llama models for lightning-fast action item extraction
- **Live Sidebar** - Injects a responsive sidebar into Google Meet showing action items as they're detected
- **Smart Detection** - Identifies action items, assignees, priorities, and timestamps
- **Session Management** - Start/stop recording with session statistics
- **Modern UI** - Clean, dark-themed interface matching Google Meet's design

## 🚀 Quick Start

### Prerequisites

1. **Chrome Browser** (latest version)
2. **AssemblyAI API Key** - [Get free key](https://www.assemblyai.com/)
3. **Cerebras API Key** - [Get access](https://cerebras.ai/)

### Installation

1. **Clone/Download** this repository
2. **Configure API Keys** in `background.js`:
   ```javascript
   this.ASSEMBLY_AI_API_KEY = 'your_assemblyai_key_here';
   this.CEREBRAS_API_KEY = 'your_cerebras_key_here';
   ```

3. **Load Extension**:
   - Open Chrome → Extensions → Developer mode ON
   - Click "Load unpacked" → Select this folder
   - Pin the extension to toolbar

4. **Test Setup**:
   - Join a Google Meet call
   - Click the extension icon
   - Hit "Start Recording"
   - Watch action items appear in the sidebar!

## 🛠️ Architecture

### Core Components

```
📁 Meet-Actions/
├── 📄 manifest.json      # Extension configuration & permissions
├── 🎨 styles.css         # Sidebar styling
├── 📱 popup.html         # Control panel UI
├── ⚡ popup.js           # Control panel logic
├── 🖥️ content_script.js  # Sidebar injection & UI
├── 🧠 background.js      # Service worker (main brain)
└── 🐳 Dockerfile        # Container configuration
```

### Data Flow

```
Google Meet Audio → tabCapture API → AssemblyAI → Real-time Transcript
                                                        ↓
Action Items ← Cerebras API (Llama) ← Transcript Analysis
     ↓
Sidebar UI ← Content Script ← Background Service Worker
```

### Technology Stack

- **Frontend**: Vanilla JavaScript, Chrome Extension APIs
- **Audio Processing**: Chrome tabCapture API, Web Audio API
- **Transcription**: AssemblyAI Real-time WebSocket API
- **AI Analysis**: Cerebras API with Meta Llama models
- **Deployment**: Docker containerization

## 🎮 Usage

### Starting a Session

1. Navigate to Google Meet
2. Join or start a meeting
3. Click the Meet-Actions extension icon
4. Click "🎤 Start Recording"
5. Watch the sidebar appear with real-time action items!

### Managing Action Items

- **View Progress**: Action items appear automatically in the sidebar
- **Session Stats**: See count and session time in the popup
- **Clear Items**: Use "🗑️ Clear Action Items" button
- **Stop Recording**: Click "⏹️ Stop Recording" when done

### Demo Mode

The extension includes a **demo mode** that works without API keys:
- Uses mock transcription data
- Generates sample action items
- Perfect for testing and demonstrations

## 🔧 Configuration

### API Setup

**AssemblyAI Configuration:**
```javascript
// In background.js
this.ASSEMBLY_AI_API_KEY = 'your_key_here';
```

**Cerebras Configuration:**
```javascript
// In background.js
this.CEREBRAS_API_KEY = 'your_key_here';
this.CEREBRAS_API_URL = 'https://api.cerebras.ai/v1/chat/completions';
```

### Customization

**Modify Action Item Detection:**
- Edit the system prompt in `background.js → extractActionItems()`
- Adjust keywords in `processMockActionItems()`
- Customize priority levels and assignee detection

**UI Customization:**
- Modify sidebar styles in `styles.css`
- Update popup design in `popup.html`
- Adjust sidebar content in `content_script.js`

## 🐳 Docker Deployment

Build and run the containerized version:

```bash
# Build image
docker build -t meet-actions .

# Run container
docker run -p 3000:3000 meet-actions

# Development mode
docker run -v $(pwd):/app -p 3000:3000 meet-actions
```

## 🔐 Security & Privacy

- **Local Processing**: Audio processing happens locally in the browser
- **Secure APIs**: All API calls use HTTPS encryption
- **No Storage**: Transcripts are not stored permanently
- **Permission-Based**: Requires explicit user consent for audio access

## 🎪 Hackathon Highlights

### Sponsor Integration Requirements ✅

- **✅ Cerebras API**: Lightning-fast LLM inference for action item extraction
- **✅ Meta Llama**: Underlying model for intelligent text analysis  
- **✅ Docker**: Containerized deployment for easy demonstration

### Innovation Points

- **Real-time Processing**: Live transcription and analysis during meetings
- **Seamless Integration**: Non-intrusive sidebar that enhances Google Meet
- **AI-Powered Intelligence**: Smart detection of tasks, priorities, and assignments
- **Modern Architecture**: Manifest V3, service workers, and responsive design

## 🚨 Troubleshooting

### Common Issues

**Extension not loading:**
- Enable Developer mode in Chrome Extensions
- Check for manifest.json syntax errors
- Verify all file paths are correct

**No audio capture:**
- Ensure you're on a Google Meet page
- Check microphone permissions in Chrome
- Verify tabCapture permission is granted

**API errors:**
- Validate API keys are correctly set
- Check network connectivity
- Review browser console for detailed errors

**Sidebar not appearing:**
- Refresh the Google Meet page
- Check browser console for injection errors
- Ensure content script permissions are granted

### Debug Mode

Enable debug mode for detailed logging:
```javascript
// In background.js, add:
const DEBUG_MODE = true;
```

## 📊 Performance

- **Low Latency**: ~2-3 second delay from speech to action item
- **Efficient Processing**: Minimal impact on meeting performance
- **Smart Batching**: Processes transcripts in optimized chunks
- **Resource Conscious**: Uses browser's native audio processing

## 🤝 Contributing

Built for the FutureStack GenAI Hackathon! 

### Development Setup

1. Fork the repository
2. Make your changes
3. Test with Google Meet
4. Submit your improvements

### Future Enhancements

- Meeting summaries and notes export
- Integration with project management tools
- Multi-language support
- Voice-to-action item templates
- Calendar integration for follow-ups

## 📜 License

MIT License - Feel free to use and modify for your projects!

## 🏆 Hackathon Team

**Project**: Meet-Actions  
**Event**: FutureStack GenAI Hackathon  
**Tech Stack**: Chrome Extensions, Cerebras API, Meta Llama, Docker  

---

*Built with ❤️ for productive meetings and actionable outcomes!*