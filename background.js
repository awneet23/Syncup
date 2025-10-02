/**
 * SyncUp Background Service Worker
 * Handles audio capture, Gemini transcription, and Cerebras contextual analysis
 */

class SyncUpBackground {
  constructor() {
    this.isRecording = false;
    this.currentStream = null;
    this.contextualCards = [];
    this.transcriptBuffer = '';
    this.lastProcessedTime = 0;
    this.processedTopics = new Set();
    this.audioContext = null;
    this.mediaRecorder = null;
    
    // API configurations - User needs to add their keys
    this.GEMINI_API_KEY = 'AIzaSyAE544iRSwjAlHjkIyCPkQdQA2fVLtQhfc'; // Add your Gemini API key here
    this.CEREBRAS_API_KEY = 'csk-2xdh96vcp8hcw43w32cmttckypdj6e9evy5n5xv3pdkf386f'; // Add your Cerebras API key here
    this.CEREBRAS_API_URL = 'https://api.cerebras.ai/v1/chat/completions';
    
    // Use real speech recognition instead of demo mode
    this.USE_SPEECH_RECOGNITION = true;
    
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
          // Content script is ready, send current state
          this.sendToContentScript(sender.tab.id, 'RECORDING_STATUS', {
            isRecording: this.isRecording
          });
          this.sendToContentScript(sender.tab.id, 'NEW_CARDS', {
            cards: this.contextualCards
          });
          break;

        case 'TRANSCRIPT_RECEIVED':
          // Process transcript from content script's speech recognition
          if (message.transcript) {
            console.log('📥 BACKGROUND: Received transcript:', message.transcript);
            await this.processTranscript(message.transcript);
            console.log('✅ BACKGROUND: Transcript processed');
          } else {
            console.warn('⚠️ BACKGROUND: Empty transcript received');
          }
          sendResponse({ success: true });
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
      // Find Google Meet tabs
      let tabs = await chrome.tabs.query({ 
        url: 'https://meet.google.com/*'
      });
      
      if (tabs.length === 0) {
        throw new Error('No Google Meet tab found. Please join a meeting first.');
      }

      this.isRecording = true;
      
      console.log('✅ Recording state set to true');
      return { success: true };
      
    } catch (error) {
      console.error('Failed to start recording:', error);
      this.isRecording = false;
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

      // Stop media recorder
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
        this.mediaRecorder = null;
      }

      this.isRecording = false;
      
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
   * Process transcript to extract topics and generate contextual information
   */
  async processTranscript(transcript) {
    if (!transcript.trim()) return;

    this.transcriptBuffer += transcript + ' ';
    
    // Process buffer periodically
    const now = Date.now();
    if (now - this.lastProcessedTime > 5000 || this.transcriptBuffer.length > 200) {
      await this.extractTopicsAndGenerateCards(this.transcriptBuffer);
      this.transcriptBuffer = '';
      this.lastProcessedTime = now;
    }
  }

  /**
   * Extract topics using Cerebras + Llama and generate contextual cards
   */
  async extractTopicsAndGenerateCards(text) {
    if (!text.trim()) return;

    try {
      console.log('Extracting topics with Cerebras + Llama...');
      
      // Use Cerebras API with Meta Llama
      const topicsResponse = await fetch(this.CEREBRAS_API_URL, {
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
              content: `You are an AI that extracts topics and concepts from conversation transcripts. 
              Return ONLY a JSON array of topics mentioned. Each topic should be a single word or short phrase.
              Extract ANY topic mentioned - technical, travel, food, business, personal, etc.
              Example: ["Docker", "Paris", "Machine Learning", "Budget Planning", "Italian Food"]
              
              Return 1-3 most important topics from the text.`
            },
            {
              role: 'user',
              content: `Extract topics from: "${text}"`
            }
          ],
          temperature: 0.3,
          max_tokens: 100
        })
      });

      if (!topicsResponse.ok) {
        const errorText = await topicsResponse.text();
        console.error('Cerebras API error:', topicsResponse.status, errorText);
        throw new Error(`Cerebras API error: ${topicsResponse.status}`);
      }

      const topicsData = await topicsResponse.json();
      const topicsContent = topicsData.choices?.[0]?.message?.content;
      
      if (topicsContent) {
        console.log('Raw Cerebras response:', topicsContent);
        const cleanContent = topicsContent.replace(/```json\n?|\n?```/g, '').trim();
        const topics = JSON.parse(cleanContent);
        
        // Generate cards for each new topic
        for (const topic of topics) {
          if (!this.processedTopics.has(topic.toLowerCase())) {
            await this.generateContextualCard(topic);
            this.processedTopics.add(topic.toLowerCase());
          }
        }
      }
      
    } catch (error) {
      console.error('Failed to extract topics:', error);
      console.error('Error details:', error.message);
    }
  }

  /**
   * Demo topic extraction using keyword matching
   */
  async extractTopicsDemo(text) {
    const techKeywords = {
      'docker': 'Docker',
      'kubernetes': 'Kubernetes',
      'react': 'React',
      'postgresql': 'PostgreSQL',
      'mongodb': 'MongoDB',
      'tensorflow': 'TensorFlow',
      'github actions': 'GitHub Actions',
      'aws lambda': 'AWS Lambda',
      'python': 'Python',
      'redis': 'Redis',
      'jwt': 'JWT',
      'rest': 'REST API',
      'microservices': 'Microservices',
      'ci/cd': 'CI/CD',
      'travel': 'Travel',
      'vacation': 'Vacation',
      'hotel': 'Hotels',
      'flight': 'Flights',
      'tourism': 'Tourism',
      'restaurant': 'Restaurants',
      'food': 'Food & Dining',
      'weather': 'Weather',
      'budget': 'Budget Planning',
      'itinerary': 'Travel Itinerary',
      'destination': 'Travel Destinations',
      'booking': 'Booking & Reservations',
      'passport': 'Travel Documents',
      'visa': 'Visa Requirements'
    };

    const lowerText = text.toLowerCase();
    
    // First check for exact keyword matches
    for (const [keyword, topic] of Object.entries(techKeywords)) {
      if (lowerText.includes(keyword) && !this.processedTopics.has(topic.toLowerCase())) {
        await this.generateContextualCard(topic);
        this.processedTopics.add(topic.toLowerCase());
      }
    }
    
    // Also extract capitalized words as potential topics (proper nouns)
    const words = text.split(/\s+/);
    for (const word of words) {
      // Check if word starts with capital letter and is longer than 3 characters
      if (word.length > 3 && /^[A-Z][a-z]+/.test(word)) {
        const cleanWord = word.replace(/[^a-zA-Z]/g, '');
        if (cleanWord && !this.processedTopics.has(cleanWord.toLowerCase())) {
          await this.generateContextualCard(cleanWord);
          this.processedTopics.add(cleanWord.toLowerCase());
        }
      }
    }
  }

  /**
   * Generate contextual information card using Cerebras + Llama
   */
  async generateContextualCard(topic) {
    try {
      console.log(`Generating contextual card for: ${topic}`);
      
      if (!this.CEREBRAS_API_KEY) {
        // No API key, use demo mode
        this.addDemoCard(topic);
        return;
      }

      // Real mode: Use Cerebras API to generate detailed information
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
              content: `You are a helpful technical assistant. Provide concise, accurate information about technical topics.
              Format your response as JSON with this structure:
              {
                "summary": "2-3 sentence overview",
                "keyPoints": ["point 1", "point 2", "point 3"],
                "useCase": "When and why to use this",
                "resources": ["resource 1", "resource 2"]
              }`
            },
            {
              role: 'user',
              content: `Provide detailed information about ${topic} in the context of software development.`
            }
          ],
          temperature: 0.3,
          max_tokens: 800
        })
      });

      if (!response.ok) {
        throw new Error(`Cerebras API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (content) {
        const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
        const cardData = JSON.parse(cleanContent);
        
        const card = {
          id: Date.now(),
          topic: topic,
          timestamp: new Date().toLocaleTimeString(),
          summary: cardData.summary,
          keyPoints: cardData.keyPoints || [],
          useCase: cardData.useCase,
          resources: cardData.resources || [],
          expanded: false
        };
        
        this.addCard(card);
      }
      
    } catch (error) {
      console.error(`Failed to generate card for ${topic}:`, error);
      // Fallback to demo card
      this.addDemoCard(topic);
    }
  }

  /**
   * Add demo card with predefined information
   */
  addDemoCard(topic) {
    const demoCards = {
      'Docker': {
        summary: 'Docker is a platform for developing, shipping, and running applications in containers. It packages applications with all dependencies into standardized units.',
        keyPoints: [
          'Containerization platform for consistent environments',
          'Lightweight alternative to virtual machines',
          'Simplifies deployment and scaling'
        ],
        useCase: 'Use Docker when you need consistent development and production environments, microservices architecture, or simplified deployment workflows.',
        resources: [
          'Official Docker Documentation',
          'Docker Hub for container images',
          'Docker Compose for multi-container apps'
        ]
      },
      'Kubernetes': {
        summary: 'Kubernetes is an open-source container orchestration platform that automates deployment, scaling, and management of containerized applications.',
        keyPoints: [
          'Automated container orchestration and scaling',
          'Self-healing and load balancing capabilities',
          'Declarative configuration and version control'
        ],
        useCase: 'Use Kubernetes for managing large-scale containerized applications, automating deployments, and ensuring high availability.',
        resources: [
          'Kubernetes Official Docs',
          'kubectl command-line tool',
          'Helm for package management'
        ]
      },
      'React': {
        summary: 'React is a JavaScript library for building user interfaces, particularly single-page applications. It uses a component-based architecture and virtual DOM.',
        keyPoints: [
          'Component-based UI development',
          'Virtual DOM for efficient updates',
          'Large ecosystem and community support'
        ],
        useCase: 'Use React for building interactive, dynamic web applications with reusable components and efficient rendering.',
        resources: [
          'React Official Documentation',
          'Create React App starter',
          'React DevTools for debugging'
        ]
      },
      'PostgreSQL': {
        summary: 'PostgreSQL is a powerful, open-source relational database system with strong ACID compliance and advanced features like JSON support.',
        keyPoints: [
          'ACID-compliant relational database',
          'Advanced features: JSON, full-text search',
          'Highly extensible and standards-compliant'
        ],
        useCase: 'Use PostgreSQL for applications requiring complex queries, data integrity, and advanced database features.',
        resources: [
          'PostgreSQL Official Docs',
          'pgAdmin management tool',
          'PostGIS for spatial data'
        ]
      },
      'Python': {
        summary: 'Python is a high-level, interpreted programming language known for its simplicity and readability. Widely used in web development, data science, and automation.',
        keyPoints: [
          'Clean, readable syntax',
          'Extensive standard library and packages',
          'Versatile: web, data science, AI, automation'
        ],
        useCase: 'Use Python for rapid development, data analysis, machine learning, web backends, and scripting tasks.',
        resources: [
          'Python Official Documentation',
          'PyPI package repository',
          'Popular frameworks: Django, Flask, FastAPI'
        ]
      }
    };

    const cardTemplate = demoCards[topic] || {
      summary: `${topic} is a technology or concept mentioned in your meeting. This is a placeholder for detailed information.`,
      keyPoints: [
        'Key feature or concept 1',
        'Key feature or concept 2',
        'Key feature or concept 3'
      ],
      useCase: `Use ${topic} when you need specific functionality in your project.`,
      resources: [
        'Official documentation',
        'Community resources',
        'Tutorials and guides'
      ]
    };

    const card = {
      id: Date.now(),
      topic: topic,
      timestamp: new Date().toLocaleTimeString(),
      summary: cardTemplate.summary,
      keyPoints: cardTemplate.keyPoints,
      useCase: cardTemplate.useCase,
      resources: cardTemplate.resources,
      expanded: false
    };

    this.addCard(card);
  }

  /**
   * Add new card and notify content script
   */
  addCard(card) {
    this.contextualCards.push(card);
    this.broadcastToContentScript('NEW_CARDS', {
      cards: this.contextualCards
    });
    
    console.log('New contextual card added:', card.topic);
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
    this.contextualCards = [];
    this.transcriptBuffer = '';
    this.lastProcessedTime = 0;
    this.processedTopics.clear();
    
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(track => track.stop());
      this.currentStream = null;
    }
    
    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }
  }
}

// Initialize the background service
new SyncUpBackground();