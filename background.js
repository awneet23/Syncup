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

        case 'QUESTION_ASKED':
          // Handle instant question with meeting context
          console.log('═══════════════════════════════════════');
          console.log('📨 QUESTION_ASKED MESSAGE RECEIVED');
          console.log('Has question?', !!message.question);
          console.log('Has context?', !!message.meetingContext);
          console.log('Question:', message.question);
          console.log('Context length:', message.meetingContext?.length);
          console.log('═══════════════════════════════════════');
          
          if (message.question && message.meetingContext) {
            console.log('❓ BACKGROUND: Question asked:', message.question);
            console.log('📋 BACKGROUND: Meeting context length:', message.meetingContext.length);
            await this.handleInstantQuestion(message.question, message.meetingContext);
            console.log('✅ BACKGROUND: Instant response generated');
          } else {
            console.error('❌ Missing question or context');
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
      console.log('🔍 CEREBRAS: Extracting topics from:', text);
      
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
              content: `You are an expert at identifying key topics and concepts from meeting conversations.
              
              Analyze the conversation and extract 1-3 most important topics that would benefit from contextual information.
              Focus on:
              - Technical terms, tools, frameworks, or technologies mentioned
              - Business concepts, methodologies, or strategies discussed
              - Places, destinations, or locations referenced
              - Products, services, or companies mentioned
              - Any specific subject matter that requires explanation
              
              Return ONLY a JSON array of topic strings. Each topic should be specific and meaningful.
              Example: ["Docker Containerization", "Kubernetes Orchestration", "Paris Travel Guide"]
              
              Do NOT include generic words like "discuss", "need", "should". Only extract substantive topics.`
            },
            {
              role: 'user',
              content: `Extract the most important topics from this conversation: "${text}"`
            }
          ],
          temperature: 0.3,
          max_tokens: 150
        })
      });

      console.log('📡 CEREBRAS: API response status:', topicsResponse.status);

      if (!topicsResponse.ok) {
        const errorText = await topicsResponse.text();
        console.error('❌ CEREBRAS: API error:', topicsResponse.status, errorText);
        throw new Error(`Cerebras API error: ${topicsResponse.status}`);
      }

      const topicsData = await topicsResponse.json();
      const topicsContent = topicsData.choices?.[0]?.message?.content;
      
      console.log('✅ CEREBRAS: Raw response:', topicsContent);
      
      if (topicsContent) {
        const cleanContent = topicsContent.replace(/```json\n?|\n?```/g, '').trim();
        console.log('🧹 CEREBRAS: Cleaned content:', cleanContent);
        
        const topics = JSON.parse(cleanContent);
        console.log('📋 CEREBRAS: Extracted topics:', topics);
        
        // Generate cards for each new topic
        for (const topic of topics) {
          if (!this.processedTopics.has(topic.toLowerCase())) {
            console.log(`🎯 CEREBRAS: Generating card for new topic: ${topic}`);
            await this.generateContextualCard(topic);
            this.processedTopics.add(topic.toLowerCase());
          } else {
            console.log(`⏭️ CEREBRAS: Skipping duplicate topic: ${topic}`);
          }
        }
      }
      
    } catch (error) {
      console.error('❌ CEREBRAS: Failed to extract topics:', error);
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
      
      // Use Cerebras API to generate detailed information
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
              content: `You are an expert assistant providing detailed, practical contextual information.

              When given a topic, provide comprehensive information in this EXACT JSON format:
              {
                "summary": "A clear 2-3 sentence explanation of what this topic is and why it matters",
                "keyPoints": [
                  "First important point or feature",
                  "Second important point or feature", 
                  "Third important point or feature"
                ],
                "useCase": "Specific practical scenarios where this is used or relevant, with concrete examples",
                "resources": [
                  "Specific resource, tool, or reference (not generic)",
                  "Another specific resource or next step",
                  "Third specific resource or learning material"
                ]
              }

              Guidelines:
              - Be specific and practical, not generic
              - Include real-world applications and examples
              - Provide actionable information
              - For technical topics: explain benefits, use cases, and getting started steps
              - For places: include key attractions, best times to visit, practical tips
              - For concepts: explain clearly with real examples
              - Resources should be specific (actual tools, websites, or actions), not vague suggestions
              
              Return ONLY valid JSON, no markdown formatting.`
            },
            {
              role: 'user',
              content: `Provide detailed, practical information about: ${topic}`
            }
          ],
          temperature: 0.5,
          max_tokens: 600
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Cerebras API error for ${topic}:`, response.status, errorText);
        throw new Error(`Cerebras API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (content) {
        console.log(`Cerebras response for ${topic}:`, content);
        const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
        const cardData = JSON.parse(cleanContent);
        
        const card = {
          id: Date.now() + Math.random(), // Ensure unique IDs
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

  /**
   * Handle instant question with meeting context
   */
  async handleInstantQuestion(question, meetingContext) {
    try {
      console.log('🤔 Generating instant response for question:', question);
      
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
              content: `You are an intelligent meeting assistant. You have access to the meeting transcript and can answer questions about the discussion.

              Provide helpful, accurate answers based on the meeting context. If the answer isn't in the context, say so and provide general helpful information.
              
              Format your response as JSON:
              {
                "answer": "Direct answer to the question",
                "context": "Relevant information from the meeting that supports this answer",
                "suggestions": ["Related point 1", "Related point 2"]
              }
              
              Be concise but thorough. Return ONLY valid JSON.`
            },
            {
              role: 'user',
              content: `Meeting Context: "${meetingContext}"
              
              Question: ${question}`
            }
          ],
          temperature: 0.4,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Cerebras API error for question:', response.status, errorText);
        throw new Error(`Cerebras API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (content) {
        console.log('✅ Instant response generated:', content);
        const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
        const responseData = JSON.parse(cleanContent);
        
        // Create instant response card
        const card = {
          id: Date.now() + Math.random(),
          topic: `💬 Q: ${question}`,
          timestamp: new Date().toLocaleTimeString(),
          summary: responseData.answer,
          keyPoints: responseData.suggestions || [],
          useCase: responseData.context || 'Based on the current meeting discussion',
          resources: ['Ask another question by saying "Hey SyncUp"'],
          expanded: true, // Auto-expand instant responses
          isInstantResponse: true
        };
        
        this.addCard(card);
        console.log('✅ Instant response card added');
      }
      
    } catch (error) {
      console.error('Failed to generate instant response:', error);
      
      // Fallback card if API fails
      const fallbackCard = {
        id: Date.now(),
        topic: `💬 Q: ${question}`,
        timestamp: new Date().toLocaleTimeString(),
        summary: 'I heard your question but encountered an error generating a response. Please try again.',
        keyPoints: ['Make sure you have a stable internet connection', 'Try rephrasing your question'],
        useCase: 'Error occurred while processing your question',
        resources: ['Say " SyncUp" to try again'],
        expanded: true,
        isInstantResponse: true
      };
      
      this.addCard(fallbackCard);
    }
  }
}

// Initialize the background service
new SyncUpBackground();