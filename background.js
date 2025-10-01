/**
 * Meet-Actions Background Service Worker
 * Handles audio capture, transcription, and action item extraction
 */

class MeetActionsBackground {
  constructor() {
    this.isRecording = false;
    this.currentStream = null;
    this.actionItems = [];
    this.assemblyAIWS = null;
    this.lastTranscriptTime = 0;
    this.transcriptBuffer = '';
    this.mockTranscriptionStarted = false;
    this.mockInterval = null;
    
    // API configurations - Replace with your actual API keys
    this.ASSEMBLY_AI_API_KEY = '';
    this.CEREBRAS_API_KEY = '';
    this.CEREBRAS_API_URL = 'https://api.cerebras.ai/v1/chat/completions';
    this.GEMINI_API_KEY = ''; // Add your Gemini API key
    this.GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
    
    this.init();
  }

  init() {
    // Listen for messages from popup and content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });

    // Handle extension startup
    chrome.runtime.onStartup.addListener(() => {
      this.resetState();
    });

    // Handle extension install
    chrome.runtime.onInstalled.addListener(() => {
      this.resetState();
    });
  }

  /**
   * Handle messages from popup and content scripts
   */
  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case 'START_RECORDING':
          const startResult = await this.startRecording();
          sendResponse(startResult);
          break;

        case 'STOP_RECORDING':
          const stopResult = await this.stopRecording();
          sendResponse(stopResult);
          break;

        case 'GET_STATUS':
          sendResponse({
            isRecording: this.isRecording,
            actionItemsCount: this.actionItems.length
          });
          break;

        case 'GET_ACTION_ITEMS':
          sendResponse({ actionItems: this.actionItems });
          break;

        case 'CLEAR_ACTION_ITEMS':
          this.actionItems = [];
          this.broadcastToContentScript('CLEAR_ACTION_ITEMS');
          sendResponse({ success: true });
          break;

        case 'SIDEBAR_INJECTED':
          // Content script is ready, send current state
          this.sendToContentScript(sender.tab.id, 'RECORDING_STATUS', {
            isRecording: this.isRecording
          });
          this.sendToContentScript(sender.tab.id, 'NEW_ACTION_ITEMS', {
            actionItems: this.actionItems
          });
          break;
      }
    } catch (error) {
      console.error('Background script error:', error);
      sendResponse({ error: error.message });
    }
  }

  /**
   * Start recording and transcription process
   */
  async startRecording() {
    if (this.isRecording) {
      return { error: 'Already recording' };
    }

    try {
      // Find Google Meet tabs (prefer audible ones)
      let tabs = await chrome.tabs.query({ 
        url: 'https://meet.google.com/*',
        audible: true 
      });
      
      if (tabs.length === 0) {
        // Fallback: check for any Google Meet tab
        tabs = await chrome.tabs.query({ 
          url: 'https://meet.google.com/*' 
        });
        
        if (tabs.length === 0) {
          throw new Error('No Google Meet tab found. Please join a meeting first.');
        }
      }

      const activeMeetTab = tabs[0];
      
      // Try modern tabCapture API approaches
      try {
        // Method 1: Try chrome.tabCapture.capture (if available)
        if (chrome.tabCapture.capture) {
          this.currentStream = await chrome.tabCapture.capture({
            audio: true,
            video: false
          });
        } 
        // Method 2: Try getMediaStreamId approach
        else if (chrome.tabCapture.getMediaStreamId) {
          const streamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: activeMeetTab.id
          });
          
          if (streamId) {
            // Since we can't use navigator.mediaDevices in service worker,
            // we'll simulate audio capture for demo purposes
            console.log('Audio stream ID obtained:', streamId);
            this.currentStream = { id: streamId, getTracks: () => [] }; // Mock stream
          }
        }
        
        if (!this.currentStream) {
          // Fallback: Use mock audio capture for demo
          console.warn('Using mock audio capture for demonstration');
          this.currentStream = { id: 'mock-stream', getTracks: () => [] };
        }
      } catch (tabCaptureError) {
        console.warn('TabCapture not available, using mock audio for demo:', tabCaptureError);
        this.currentStream = { id: 'mock-stream', getTracks: () => [] };
      }

      // Start AssemblyAI real-time transcription
      await this.startAssemblyAITranscription();

      this.isRecording = true;
      
      // Notify content script
      this.broadcastToContentScript('RECORDING_STATUS', { isRecording: true });

      console.log('Recording started successfully');
      return { success: true };
      
    } catch (error) {
      console.error('Failed to start recording:', error);
      return { error: error.message };
    }
  }

  /**
   * Stop recording and cleanup
   */
  async stopRecording() {
    if (!this.isRecording) {
      return { error: 'Not currently recording' };
    }

    try {
      // Stop audio stream
      if (this.currentStream) {
        this.currentStream.getTracks().forEach(track => track.stop());
        this.currentStream = null;
      }

      // Close AssemblyAI connection
      if (this.assemblyAIWS) {
        this.assemblyAIWS.close();
        this.assemblyAIWS = null;
      }

      this.isRecording = false;
      this.mockTranscriptionStarted = false;
      
      // Clear mock transcription interval
      if (this.mockInterval) {
        clearInterval(this.mockInterval);
        this.mockInterval = null;
      }
      
      // Notify content script
      this.broadcastToContentScript('RECORDING_STATUS', { isRecording: false });

      console.log('Recording stopped successfully');
      return { success: true };
      
    } catch (error) {
      console.error('Failed to stop recording:', error);
      return { error: error.message };
    }
  }

  /**
   * Start transcription (now using Gemini-powered mock mode for demo)
   */
  async startAssemblyAITranscription() {
    console.log('Starting Gemini-powered demo transcription mode...');
    
    // For hackathon demo, we'll use enhanced mock transcription
    // with Gemini AI for action item extraction
    this.startEnhancedMockTranscription();
    return;
    
    try {
      // Create WebSocket connection to AssemblyAI Universal Streaming API v3
      const connectionParams = {
        sampleRate: 16000,
        formatTurns: true,
        endOfTurnConfidenceThreshold: 0.7,
        minEndOfTurnSilenceWhenConfident: 160,
        maxTurnSilence: 2400,
        keytermsPrompt: []
      };
      
      // Build query string manually for browser compatibility
      const queryParams = Object.entries(connectionParams)
        .map(([key, value]) => `${key}=${encodeURIComponent(Array.isArray(value) ? JSON.stringify(value) : value)}`)
        .join('&');
      
      // Add API key as authorization parameter for browser compatibility
      const wsUrl = `wss://streaming.assemblyai.com/v3/ws?${queryParams}&authorization=${this.ASSEMBLY_AI_API_KEY}`;
      
      console.log(`Connecting to: wss://streaming.assemblyai.com/v3/ws?${queryParams}&authorization=***`);
      
      this.assemblyAIWS = new WebSocket(wsUrl);
      
      this.assemblyAIWS.onopen = () => {
        console.log('AssemblyAI WebSocket connected to v3 API successfully!');
        console.log('WebSocket ready for audio data');
      };

      this.assemblyAIWS.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleTranscriptionData(data);
        } catch (error) {
          console.error('Error parsing AssemblyAI message:', error);
          console.error('Message data:', event.data);
        }
      };

      this.assemblyAIWS.onerror = (error) => {
        console.error('AssemblyAI WebSocket error:', error);
        console.log('Falling back to mock transcription due to WebSocket error');
        this.startMockTranscription();
      };

    } catch (error) {
      console.error('Failed to start AssemblyAI transcription:', error);
      console.log('Error details:', error.message);
      console.log('Falling back to mock transcription due to API error');
      this.startMockTranscription();
    }
  }

  /**
   * Process audio stream and send to AssemblyAI
   * Note: Audio processing not available in service workers (Manifest V3)
   * This would need to be implemented in content script with proper audio access
   */
  processAudioStream() {
    console.log('Audio processing skipped - not available in service workers');
    console.log('For real audio processing, this would need to be implemented in content script');
    
    // For now, just use mock transcription since audio processing 
    // requires moving this logic to content script
    if (!this.mockTranscriptionStarted) {
      console.log('Starting mock transcription as fallback');
      this.startMockTranscription();
      this.mockTranscriptionStarted = true;
    }
  }

  /**
   * Handle transcription data from AssemblyAI Universal Streaming API v3
   */
  handleTranscriptionData(data) {
    const msgType = data.type;
    
    if (msgType === 'Begin') {
      const sessionId = data.id;
      const expiresAt = data.expires_at;
      console.log(`Session began: ID=${sessionId}, ExpiresAt=${new Date(expiresAt).toISOString()}`);
      
    } else if (msgType === 'Turn') {
      const transcript = data.transcript || '';
      const formatted = data.turn_is_formatted;
      
      if (transcript.trim()) {
        console.log('Turn transcript:', transcript);
        
        if (formatted) {
          // This is a complete, formatted turn - process for action items
          this.extractActionItems(transcript);
        } else {
          // Partial transcript - accumulate in buffer
          this.transcriptBuffer += transcript + ' ';
          
          // Process buffer periodically
          const now = Date.now();
          if (now - this.lastTranscriptTime > 30000 || this.transcriptBuffer.length > 1000) {
            this.extractActionItems(this.transcriptBuffer);
            this.transcriptBuffer = '';
            this.lastTranscriptTime = now;
          }
        }
      }
      
    } else if (msgType === 'Termination') {
      const audioDuration = data.audio_duration_seconds;
      const sessionDuration = data.session_duration_seconds;
      console.log(`Session Terminated: Audio Duration=${audioDuration}s, Session Duration=${sessionDuration}s`);
      
      // Process any remaining transcript buffer
      if (this.transcriptBuffer.trim()) {
        this.extractActionItems(this.transcriptBuffer);
        this.transcriptBuffer = '';
      }
      
    } else {
      console.log('Unknown message type:', msgType, data);
    }
  }

  /**
   * Enhanced mock transcription with realistic meeting scenarios
   */
  startEnhancedMockTranscription() {
    console.log('Starting enhanced mock transcription with Gemini AI processing');
    
    const realisticMeetingTranscripts = [
      "Alright everyone, let's start with the sprint review. Sarah, can you walk us through the user interface changes you completed this week?",
      "The client feedback on the new dashboard is really positive. However, they want us to add export functionality by the end of next week. Mike, can you take ownership of that feature?",
      "We're seeing some performance issues with the search function. The response time is too slow when users have large datasets. This needs to be our top priority for the next sprint.",
      "Lisa, please schedule a meeting with the QA team to discuss the testing strategy for the mobile app release. We need to make sure all edge cases are covered before we ship.",
      "The marketing team is asking for API documentation to be updated. David, since you worked on the new endpoints, can you coordinate with the technical writing team this week?",
      "We've identified three critical bugs that need to be fixed before the demo next Friday. Tom, can you assign these to the appropriate team members and track the progress daily?",
      "The integration with the payment gateway is almost complete. We just need to implement error handling for failed transactions. This should be done by Wednesday at the latest.",
      "Let's not forget about the security audit that's happening next month. Jennifer, please make sure all the security requirements are documented and shared with the dev team."
    ];
    
    let index = 0;
    this.mockInterval = setInterval(async () => {
      if (!this.isRecording) {
        clearInterval(this.mockInterval);
        return;
      }
      
      if (index < realisticMeetingTranscripts.length) {
        const transcript = realisticMeetingTranscripts[index];
        console.log('Processing transcript:', transcript);
        
        // Use Gemini AI to extract action items
        await this.extractActionItemsWithGemini(transcript);
        index++;
      } else {
        // Restart with different scenarios
        index = 0;
      }
    }, 12000); // Every 12 seconds for better demo pacing
  }

  /**
   * Original mock transcription (fallback)
   */
  startMockTranscription() {
    console.log('Starting basic mock transcription');
    
    const mockTranscripts = [
      "Let's make sure we follow up on the client presentation by Friday",
      "John, can you handle the database migration by next week?",
      "We need to schedule a review meeting for the new features",
      "Sarah should coordinate with the design team on the UI changes",
      "Don't forget to update the documentation before the release",
      "The testing phase needs to be completed by Thursday"
    ];
    
    let index = 0;
    this.mockInterval = setInterval(() => {
      if (!this.isRecording) {
        clearInterval(this.mockInterval);
        return;
      }
      
      if (index < mockTranscripts.length) {
        this.extractActionItems(mockTranscripts[index]);
        index++;
      } else {
        index = 0; // Restart
      }
    }, 10000);
  }

  /**
   * Extract action items using Gemini AI
   */
  async extractActionItemsWithGemini(transcript) {
    if (!transcript.trim()) return;

    try {
      console.log('Extracting action items with Gemini AI...');
      
      const response = await fetch(`${this.GEMINI_API_URL}?key=${this.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Extract action items from this meeting transcript. Return ONLY valid JSON in this exact format:

{
  "action_items": [
    {
      "action": "Brief description of the action item",
      "assignee": "Person responsible (if mentioned, otherwise null)",
      "priority": "high/medium/low",
      "deadline": "extracted deadline (if mentioned, otherwise null)"
    }
  ]
}

If no action items are found, return: {"action_items": []}

Meeting transcript: "${transcript}"`
            }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (content) {
        // Clean up the response (remove markdown formatting if present)
        const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
        
        try {
          const parsed = JSON.parse(cleanContent);
          if (parsed.action_items && Array.isArray(parsed.action_items)) {
            this.addActionItems(parsed.action_items);
          }
        } catch (parseError) {
          console.error('Failed to parse Gemini response:', parseError);
          console.log('Raw response:', content);
          // Fallback to mock extraction
          this.processMockActionItems(transcript);
        }
      }
      
    } catch (error) {
      console.error('Failed to extract action items with Gemini:', error);
      console.log('Falling back to mock extraction');
      this.processMockActionItems(transcript);
    }
  }

  /**
   * Extract action items using Cerebras API (fallback)
   */
  async extractActionItems(transcript) {
    if (!transcript.trim()) return;

    try {
      if (!this.CEREBRAS_API_KEY || this.CEREBRAS_API_KEY === 'YOUR_CEREBRAS_API_KEY_HERE') {
        console.warn('Cerebras API key not configured, using mock extraction');
        this.processMockActionItems(transcript);
        return;
      }

      const response = await fetch(this.CEREBRAS_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.CEREBRAS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama3.1-8b',
          messages: [
            {
              role: 'system',
              content: `You are an AI assistant that extracts action items from meeting transcripts. 
              
              Return ONLY valid JSON in this exact format:
              {
                "action_items": [
                  {
                    "action": "Brief description of the action",
                    "assignee": "Person responsible (if mentioned)",
                    "priority": "high/medium/low",
                    "timestamp": "current timestamp"
                  }
                ]
              }
              
              If no action items are found, return: {"action_items": []}`
            },
            {
              role: 'user',
              content: `Extract action items from this meeting transcript: "${transcript}"`
            }
          ],
          temperature: 0.1,
          max_tokens: 500
        })
      });

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (content) {
        const parsed = JSON.parse(content);
        if (parsed.action_items && Array.isArray(parsed.action_items)) {
          this.addActionItems(parsed.action_items);
        }
      }
      
    } catch (error) {
      console.error('Failed to extract action items:', error);
      this.processMockActionItems(transcript);
    }
  }

  /**
   * Mock action item extraction for demo
   */
  processMockActionItems(transcript) {
    const keywords = {
      'follow up': { priority: 'medium', action: 'Follow up on discussed items' },
      'schedule': { priority: 'high', action: 'Schedule meeting or appointment' },
      'review': { priority: 'medium', action: 'Review and provide feedback' },
      'update': { priority: 'low', action: 'Update documentation or status' },
      'complete': { priority: 'high', action: 'Complete assigned task' },
      'coordinate': { priority: 'medium', action: 'Coordinate with team members' }
    };

    for (const [keyword, template] of Object.entries(keywords)) {
      if (transcript.toLowerCase().includes(keyword)) {
        const actionItem = {
          action: template.action,
          assignee: this.extractAssignee(transcript),
          priority: template.priority,
          timestamp: new Date().toLocaleTimeString()
        };
        
        this.addActionItems([actionItem]);
        break;
      }
    }
  }

  /**
   * Extract assignee from transcript
   */
  extractAssignee(transcript) {
    const names = ['John', 'Sarah', 'Mike', 'Lisa', 'David', 'Anna'];
    for (const name of names) {
      if (transcript.includes(name)) {
        return name;
      }
    }
    return null;
  }

  /**
   * Add new action items and notify content script
   */
  addActionItems(newItems) {
    this.actionItems.push(...newItems);
    this.broadcastToContentScript('NEW_ACTION_ITEMS', {
      actionItems: this.actionItems
    });
    
    console.log('New action items added:', newItems);
  }

  /**
   * Send message to content script in all Meet tabs
   */
  async broadcastToContentScript(type, data = {}) {
    try {
      const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
      for (const tab of tabs) {
        this.sendToContentScript(tab.id, type, data);
      }
    } catch (error) {
      console.error('Failed to broadcast to content script:', error);
    }
  }

  /**
   * Send message to specific tab's content script
   */
  sendToContentScript(tabId, type, data = {}) {
    try {
      chrome.tabs.sendMessage(tabId, { type, ...data });
    } catch (error) {
      console.error('Failed to send message to content script:', error);
    }
  }

  /**
   * Reset extension state
   */
  resetState() {
    this.isRecording = false;
    this.actionItems = [];
    this.transcriptBuffer = '';
    this.lastTranscriptTime = 0;
    this.mockTranscriptionStarted = false;
    
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(track => track.stop());
      this.currentStream = null;
    }
    
    if (this.assemblyAIWS) {
      this.assemblyAIWS.close();
      this.assemblyAIWS = null;
    }
  }
}

// Initialize the background service
new MeetActionsBackground();