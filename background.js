/**
 * SyncUp Background Service Worker - Universal Version
 * Integrates Google Gemini for all AI features
 * Preserves existing Google Meet functionality
 */

// Import Gemini client (will be loaded via importScripts in service worker)
// importScripts('shared/gemini-client.js', 'shared/constants.js');

class SyncUpUniversal {
  constructor() {
    // Existing Google Meet state (PRESERVED)
    this.isRecording = false;
    this.currentStream = null;
    this.contextualCards = [];
    this.transcriptBuffer = '';
    this.lastProcessedTime = 0;
    this.processedTopics = new Set();
    this.audioContext = null;
    this.mediaRecorder = null;

    // New universal state
    this.geminiClient = null;
    this.activeTabContexts = new Map(); // Map<tabId, context>
    this.conversationHistory = [];
    this.actionItems = [];
    this.settings = null;

    this.init();
  }

  async init() {
    console.log('🚀 SyncUp Universal initializing...');

    // Load settings and initialize Gemini
    await this.loadSettings();
    await this.initializeGemini();

    // Setup message listeners
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep channel open for async
    });

    // Setup command keyboard shortcut
    chrome.commands.onCommand.addListener((command) => {
      if (command === 'open-command-palette') {
        this.openCommandPalette();
      }
    });

    // Track active tab changes
    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.handleTabActivated(activeInfo);
    });

    // Track tab updates
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete') {
        this.handleTabUpdated(tabId, tab);
      }
    });

    // Cleanup on startup
    chrome.runtime.onStartup.addListener(() => {
      this.cleanupOldData();
    });

    chrome.runtime.onInstalled.addListener(() => {
      console.log('✅ SyncUp Universal installed');
      this.showWelcomeNotification();
    });

    // Open side panel when extension icon is clicked
    chrome.action.onClicked.addListener((tab) => {
      this.openSidePanel(tab);
    });

    console.log('✅ SyncUp Universal ready');
  }

  /**
   * Load settings from storage
   */
  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['syncup_settings']);
      this.settings = result.syncup_settings || {
        geminiApiKey: '',
        enableUniversalContext: true,
        enableActionItems: true,
        autoDeleteHistory: true,
        historyRetentionHours: 24,
        excludedDomains: ['chrome://*', 'chrome-extension://*']
      };
      console.log('📋 Settings loaded');
    } catch (error) {
      console.error('Failed to load settings:', error);
      this.settings = {};
    }
  }

  /**
   * Initialize Gemini client with API key
   */
  async initializeGemini() {
    if (this.settings.geminiApiKey) {
      try {
        // Create new GeminiClient instance
        this.geminiClient = {
          apiKey: this.settings.geminiApiKey,
          baseURL: 'https://generativelanguage.googleapis.com/v1',
          model: 'gemini-2.5-flash',

          async generateContent(prompt, options = {}) {
            if (!this.apiKey) {
              throw new Error('Gemini API key not configured');
            }

            const endpoint = `${this.baseURL}/models/${this.model}:generateContent?key=${this.apiKey}`;

            const response = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: options.temperature || 0.5,
                  maxOutputTokens: options.maxOutputTokens || 800
                }
              })
            });

            if (!response.ok) {
              const errorText = await response.text();
              console.error('❌ Gemini API Error:', response.status);
              console.error('❌ Response:', errorText);
              console.error('❌ Endpoint:', endpoint);
              throw new Error(`Gemini API error: ${response.status} - ${errorText.substring(0, 200)}`);
            }

            const data = await response.json();
            console.log('✅ Gemini response received:', data);
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!text) {
              console.error('❌ No text in response:', data);
              throw new Error('No content in Gemini response');
            }

            console.log('✅ Gemini text extracted:', text.substring(0, 100));
            return text;
          },

          parseJSON(text) {
            try {
              // Remove markdown code blocks
              let cleanText = text.replace(/```json\n?|\n?```/g, '').trim();

              // Try to extract JSON if embedded in other text
              const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                cleanText = jsonMatch[0];
              }

              console.log('🔍 Attempting to parse JSON, length:', cleanText.length);

              // Attempt to parse
              return JSON.parse(cleanText);
            } catch (error) {
              console.error('❌ JSON Parse Error:', error.message);
              console.error('❌ Error position:', error.message);
              console.error('❌ Raw text (first 500 chars):', text.substring(0, 500));

              // Try to fix common issues and retry
              try {
                let cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
                const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  cleanText = jsonMatch[0];
                }

                // Replace unescaped newlines in strings (but not in JSON structure)
                // This is a simple fix - replace \n that aren't already escaped
                let fixed = cleanText.replace(/([^\\])\\n/g, '$1\\\\n');

                console.log('🔧 Trying fixed JSON...');
                return JSON.parse(fixed);
              } catch (retryError) {
                console.error('❌ Retry also failed:', retryError.message);
                console.error('❌ Full raw response:', text);

                // Final fallback: return structured error
                throw new Error(`Failed to parse Gemini JSON response: ${error.message}. Check console for full response.`);
              }
            }
          }
        };

        console.log('✅ Gemini client initialized');
      } catch (error) {
        console.error('Failed to initialize Gemini:', error);
      }
    } else {
      console.warn('⚠️ No Gemini API key configured');
    }
  }

  /**
   * Handle messages from content scripts and popup
   */
  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        // ==== EXISTING GOOGLE MEET MESSAGES (PRESERVED) ====
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
            cardsCount: this.contextualCards.length
          });
          break;

        case 'GET_CONTEXTUAL_CARDS':
          sendResponse({ cards: this.contextualCards });
          break;

        case 'CLEAR_CARDS':
          this.contextualCards = [];
          this.processedTopics.clear();
          this.broadcastToContentScript('CLEAR_CARDS');
          sendResponse({ success: true });
          break;

        case 'SIDEBAR_INJECTED':
          this.sendToContentScript(sender.tab.id, 'RECORDING_STATUS', {
            isRecording: this.isRecording
          });
          this.sendToContentScript(sender.tab.id, 'NEW_CARDS', {
            cards: this.contextualCards
          });
          break;

        case 'TRANSCRIPT_RECEIVED':
          if (message.transcript) {
            console.log('📥 Transcript received:', message.transcript.substring(0, 100));
            await this.processTranscriptWithGemini(message.transcript);
          }
          sendResponse({ success: true });
          break;

        case 'CHATBOX_QUESTION':
          console.log('💬 Chatbox question:', message.question);
          await this.handleChatboxQuestionWithGemini(
            message.question,
            message.meetingContext || ''
          );
          sendResponse({ success: true });
          break;

        // ==== NEW UNIVERSAL MESSAGES ====
        case 'TAB_CONTENT_DETECTED':
          await this.handleContentDetected(message, sender.tab);
          sendResponse({ success: true });
          break;

        case 'GEMINI_GENERATE_CONTEXT':
          const contextCard = await this.generateContextCard(message.topic);
          sendResponse({ success: true, card: contextCard });
          break;

        case 'OPEN_SIDE_PANEL':
          await this.openSidePanel(sender.tab);
          sendResponse({ success: true });
          break;

        case 'GET_SETTINGS':
          sendResponse({ settings: this.settings });
          break;

        case 'UPDATE_SETTINGS':
          await this.updateSettings(message.settings);
          sendResponse({ success: true });
          break;

        case 'TEST_API_KEY':
          const testResult = await this.testGeminiAPIKey(message.apiKey);
          sendResponse(testResult);
          break;

        case 'EXECUTE_COMMAND':
          // Handle command palette questions with context
          console.log('⚡ Command palette question:', message.command);
          await this.handleCommandPaletteQuestion(
            message.command,
            sender.tab,
            message.currentPageContext,
            message.currentPageUrl,
            message.currentPageTitle
          );
          sendResponse({ success: true });
          break;

        default:
          console.warn('Unknown message type:', message.type);
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Message handler error:', error);
      sendResponse({ error: error.message });
    }
  }

  /**
   * EXISTING: Start recording (PRESERVED)
   */
  async startRecording() {
    if (this.isRecording) {
      return { error: 'Already recording' };
    }

    try {
      const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });

      if (tabs.length === 0) {
        throw new Error('No Google Meet tab found');
      }

      this.isRecording = true;
      console.log('✅ Recording started');
      return { success: true };
    } catch (error) {
      console.error('Failed to start recording:', error);
      this.isRecording = false;
      return { error: error.message };
    }
  }

  /**
   * EXISTING: Stop recording (PRESERVED)
   */
  async stopRecording() {
    if (!this.isRecording) {
      return { error: 'Not recording' };
    }

    try {
      if (this.currentStream) {
        this.currentStream.getTracks().forEach(track => track.stop());
        this.currentStream = null;
      }

      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
        this.mediaRecorder = null;
      }

      this.isRecording = false;
      this.broadcastToContentScript('RECORDING_STATUS', { isRecording: false });

      console.log('🛑 Recording stopped');
      return { success: true };
    } catch (error) {
      console.error('Failed to stop recording:', error);
      return { error: error.message };
    }
  }

  /**
   * NEW: Process transcript using Gemini (replaces Cerebras)
   */
  async processTranscriptWithGemini(transcript) {
    if (!transcript.trim() || !this.geminiClient) return;

    console.log('🤖 Processing transcript with Gemini...');

    try {
      // Step 1: Extract keywords
      const keywordsPrompt = `Extract 1-3 important keywords from: "${transcript}"
Return ONLY JSON array: ["keyword1", "keyword2"]`;

      const keywordsText = await this.geminiClient.generateContent(keywordsPrompt);
      const keywords = this.geminiClient.parseJSON(keywordsText);

      console.log('📋 Extracted keywords:', keywords);

      // Step 2: Generate context cards for new keywords
      for (const keyword of keywords) {
        if (!this.processedTopics.has(keyword.toLowerCase())) {
          await this.generateContextCardWithGemini(keyword);
          this.processedTopics.add(keyword.toLowerCase());
        }
      }

    } catch (error) {
      console.error('Failed to process transcript with Gemini:', error);
    }
  }

  /**
   * NEW: Generate context card using Gemini
   */
  async generateContextCardWithGemini(keyword) {
    if (!this.geminiClient) return;

    try {
      const prompt = `Provide concise information about "${keyword}".

IMPORTANT: Return ONLY valid JSON (no markdown, no extra text). Keep all text short and avoid quotes or special characters that break JSON.

Return JSON:
{
  "explanation": "Clear explanation in 2-3 sentences",
  "keyPoints": ["point1", "point2", "point3"],
  "useCase": "When and why this is used",
  "learnMore": ["resource1", "resource2"]
}`;

      const responseText = await this.geminiClient.generateContent(prompt);
      const response = this.geminiClient.parseJSON(responseText);

      const card = {
        id: Date.now() + Math.random(),
        topic: keyword,
        timestamp: new Date().toLocaleTimeString(),
        summary: response.explanation,
        keyPoints: response.keyPoints || [],
        useCase: response.useCase,
        resources: response.learnMore || [],
        expanded: false,
        isAutoGenerated: true
      };

      this.addCard(card);
      console.log('✅ Context card generated with Gemini:', keyword);

    } catch (error) {
      console.error('Failed to generate context card:', error);
    }
  }

  /**
   * NEW: Handle chatbox question using Gemini
   */
  async handleChatboxQuestionWithGemini(question, meetingContext) {
    if (!this.geminiClient) {
      this.addErrorCard(question, 'Gemini API not configured');
      return;
    }

    try {
      const prompt = `You are a helpful AI assistant. Answer this question intelligently.

${meetingContext ? `Meeting Context Available: "${meetingContext}"\n` : 'No meeting context available.\n'}
Question: ${question}

IMPORTANT INSTRUCTIONS:
1. First, check if the question can be answered using the meeting context
2. If yes, provide an answer based on the meeting AND also provide general knowledge about the topic
3. If no meeting context or not relevant, provide a comprehensive general answer
4. ALWAYS provide helpful information regardless of whether meeting context exists
5. Keep answers concise (2-3 sentences each)
6. Avoid using quotes or special characters that break JSON formatting

Return ONLY valid JSON (no markdown, no extra text):
{
  "meetingAnswer": "Answer based on meeting context (or Not discussed in meeting if not applicable)",
  "generalAnswer": "Comprehensive general knowledge answer about this topic",
  "wasInMeeting": true,
  "additionalInfo": ["helpful point 1", "helpful point 2", "helpful point 3"]
}`;

      const responseText = await this.geminiClient.generateContent(prompt);
      const response = this.geminiClient.parseJSON(responseText);

      // Build comprehensive answer showing both meeting context and general knowledge
      let fullAnswer = '';

      if (response.wasInMeeting) {
        fullAnswer = `📍 **From the Meeting:**\n${response.meetingAnswer}\n\n`;
        fullAnswer += `📚 **General Knowledge:**\n${response.generalAnswer}`;
      } else {
        fullAnswer = `ℹ️ **Note:** This topic was not discussed in the meeting.\n\n`;
        fullAnswer += `📚 **General Answer:**\n${response.generalAnswer}`;
      }

      const card = {
        id: Date.now() + Math.random(),
        topic: `💬 ${question}`,
        timestamp: new Date().toLocaleTimeString(),
        summary: fullAnswer,
        keyPoints: response.additionalInfo || [],
        useCase: response.wasInMeeting
          ? '✅ Answered from meeting context + general knowledge'
          : '💡 General knowledge (not in meeting)',
        resources: ['Ask another question in the chatbox'],
        expanded: true,
        isChatboxAnswer: true
      };

      this.addCard(card);
      console.log('✅ Chatbox answered with Gemini (meeting:', response.wasInMeeting, ')');

    } catch (error) {
      console.error('Failed to answer question:', error);
      this.addErrorCard(question, error.message);
    }
  }

  /**
   * NEW: Handle command palette question (from any page)
   * Now with current page context and cross-tab memory!
   */
  async handleCommandPaletteQuestion(question, tab, currentPageContext, currentPageUrl, currentPageTitle) {
    if (!this.geminiClient) {
      console.error('Gemini API not configured');
      return;
    }

    try {
      console.log('🎯 Answering command palette question:', question);
      console.log('📄 Current page:', currentPageTitle);

      // Store current page context for future use
      await this.storeTabContext(tab.id, currentPageUrl, currentPageTitle, currentPageContext);

      // Retrieve context from all recent tabs (cross-tab memory)
      const recentTabsContext = await this.getRecentTabsContext();
      console.log('🧠 Retrieved context from', recentTabsContext.length, 'recent tabs');

      // Build comprehensive context
      let contextString = '';

      // Add current page context
      if (currentPageContext) {
        contextString += `\n=== CURRENT PAGE CONTEXT ===\n${currentPageContext}\n`;
      }

      // Add recent tabs context
      if (recentTabsContext.length > 0) {
        contextString += `\n=== RECENTLY VIEWED PAGES ===\n`;
        recentTabsContext.forEach((ctx, index) => {
          // Show full content for recent tabs (already limited to 10000 chars when stored)
          contextString += `\nPage ${index + 1}: ${ctx.title}\nURL: ${ctx.url}\nContent: ${ctx.content}\n`;
        });
      }

      const prompt = `You are a helpful AI assistant with access to the user's browsing context.

USER'S CONTEXT:
${contextString}

Question: ${question}

IMPORTANT INSTRUCTIONS:
1. Use the context from the current page and recently viewed pages to answer the question
2. If the answer is in the context, refer to it specifically (e.g., "From the email you were reading...")
3. If not in context, provide general knowledge answer
4. Keep answer brief but informative (2-4 sentences)
5. Return ONLY valid JSON (no markdown, no extra text)

Return JSON:
{
  "answer": "Answer using context when available, otherwise general knowledge",
  "usedContext": true/false,
  "contextSource": "current page / previous tab / general knowledge",
  "additionalInfo": ["helpful point 1", "helpful point 2", "helpful point 3"]
}`;

      const responseText = await this.geminiClient.generateContent(prompt, {
        temperature: 0.7,
        maxOutputTokens: 800
      });

      const response = this.geminiClient.parseJSON(responseText);

      console.log('✅ Command palette answer generated (used context:', response.usedContext, ')');

      // Send answer back to content script to display
      chrome.tabs.sendMessage(tab.id, {
        type: 'COMMAND_PALETTE_ANSWER',
        question: question,
        answer: response.answer,
        additionalInfo: response.additionalInfo || [],
        usedContext: response.usedContext,
        contextSource: response.contextSource
      });

    } catch (error) {
      console.error('Failed to answer command palette question:', error);

      // Send error back to content script
      chrome.tabs.sendMessage(tab.id, {
        type: 'COMMAND_PALETTE_ANSWER',
        question: question,
        answer: `Error: ${error.message}`,
        additionalInfo: []
      });
    }
  }

  /**
   * Store tab context for cross-tab memory
   */
  async storeTabContext(tabId, url, title, content) {
    try {
      const timestamp = Date.now();

      // Get existing contexts
      const result = await chrome.storage.local.get(['tab_contexts']);
      const contexts = result.tab_contexts || [];

      // Add new context
      contexts.push({
        tabId,
        url,
        title,
        content: content.substring(0, 10000), // Increased from 5000 to capture full emails
        timestamp
      });

      // Keep only last 10 tabs (to save storage)
      const recentContexts = contexts.slice(-10);

      // Save back to storage
      await chrome.storage.local.set({ tab_contexts: recentContexts });

      console.log('💾 Stored context for:', title);
    } catch (error) {
      console.error('Failed to store tab context:', error);
    }
  }

  /**
   * Get recent tabs context for cross-tab memory
   */
  async getRecentTabsContext() {
    try {
      const result = await chrome.storage.local.get(['tab_contexts']);
      const contexts = result.tab_contexts || [];

      // Return contexts from last 5 minutes, max 5 tabs
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      const recentContexts = contexts
        .filter(ctx => ctx.timestamp > fiveMinutesAgo)
        .slice(-5); // Last 5 tabs

      return recentContexts;
    } catch (error) {
      console.error('Failed to get recent tabs context:', error);
      return [];
    }
  }

  /**
   * NEW: Handle content detected from universal tabs
   */
  async handleContentDetected(message, tab) {
    if (!this.settings.enableUniversalContext) return;

    const { text, platform } = message;

    // Update tab context
    this.activeTabContexts.set(tab.id, {
      tabId: tab.id,
      url: tab.url,
      platform,
      lastText: text,
      timestamp: Date.now()
    });

    // Update side panel if open
    this.updateSidePanel();
  }

  /**
   * NEW: Generate context card for any topic
   */
  async generateContextCard(topic) {
    return await this.generateContextCardWithGemini(topic);
  }

  /**
   * Add card and broadcast
   */
  addCard(card) {
    this.contextualCards.push(card);
    console.log('📦 Card added:', card.topic);
    this.broadcastToContentScript('NEW_CARDS', { cards: this.contextualCards });
    this.updateSidePanel();
  }

  /**
   * Add error card
   */
  addErrorCard(question, errorMessage) {
    const card = {
      id: Date.now(),
      topic: `💬 ${question}`,
      timestamp: new Date().toLocaleTimeString(),
      summary: `Error: ${errorMessage}`,
      keyPoints: ['Check API key configuration', 'Try again'],
      useCase: 'Error occurred',
      resources: [],
      expanded: true,
      isChatboxAnswer: true
    };
    this.addCard(card);
  }

  /**
   * EXISTING: Broadcast to Google Meet tabs (PRESERVED)
   */
  async broadcastToContentScript(type, data = {}) {
    try {
      const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
      for (const tab of tabs) {
        this.sendToContentScript(tab.id, type, data);
      }
    } catch (error) {
      console.error('Failed to broadcast:', error);
    }
  }

  /**
   * Send message to content script
   */
  sendToContentScript(tabId, type, data = {}) {
    chrome.tabs.sendMessage(tabId, { type, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Send error:', chrome.runtime.lastError.message);
      }
    });
  }

  /**
   * NEW: Open command palette
   */
  async openCommandPalette() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'OPEN_COMMAND_PALETTE' });
    }
  }

  /**
   * NEW: Open side panel
   */
  async openSidePanel(tab) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (error) {
      console.error('Failed to open side panel:', error);
    }
  }

  /**
   * NEW: Update side panel with latest data
   */
  updateSidePanel() {
    // Send update to side panel
    chrome.runtime.sendMessage({
      type: 'UPDATE_SIDE_PANEL',
      data: {
        contextCards: this.contextualCards,
        actionItems: this.actionItems,
        activeContexts: Array.from(this.activeTabContexts.values())
      }
    });
  }

  /**
   * NEW: Handle tab activated
   */
  async handleTabActivated(activeInfo) {
    // Could implement context switching logic here
    console.log('Tab activated:', activeInfo.tabId);
  }

  /**
   * NEW: Handle tab updated
   */
  async handleTabUpdated(tabId, tab) {
    console.log('Tab updated:', tab.url);
  }

  /**
   * NEW: Update settings
   */
  async updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    await chrome.storage.sync.set({ syncup_settings: this.settings });

    // Reinitialize Gemini if API key changed
    if (newSettings.geminiApiKey) {
      await this.initializeGemini();
    }

    console.log('⚙️ Settings updated');
  }

  /**
   * NEW: Test Gemini API key
   */
  async testGeminiAPIKey(apiKey) {
    try {
      const testClient = { ...this.geminiClient, apiKey };
      await testClient.generateContent('Say hello', { maxOutputTokens: 50 });
      return { valid: true, message: 'API key is valid' };
    } catch (error) {
      return { valid: false, message: error.message };
    }
  }

  /**
   * NEW: Cleanup old data
   */
  async cleanupOldData() {
    if (!this.settings.autoDeleteHistory) return;

    const cutoffTime = Date.now() - (this.settings.historyRetentionHours * 60 * 60 * 1000);

    // Clean up old conversation history
    this.conversationHistory = this.conversationHistory.filter(
      item => item.timestamp > cutoffTime
    );

    console.log('🗑️ Old data cleaned up');
  }

  /**
   * NEW: Show welcome notification
   */
  showWelcomeNotification() {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'SyncUp Universal Ready!',
      message: 'Press Ctrl+K (Cmd+K on Mac) to open command palette. Configure your Gemini API key in settings.'
    });
  }
}

// Initialize
const syncup = new SyncUpUniversal();
