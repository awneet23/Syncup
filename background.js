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
    this.GEMINI_API_KEY = ''; // Add your Gemini API key here
    this.CEREBRAS_API_KEY = ''; // Add your Cerebras API key here
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
  handleMessage(message, sender, sendResponse) {
    (async () => {
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
            console.log('═══════════════════════════════════════');
            console.log('📥 BACKGROUND: Received 15-second transcript batch');
            console.log('📝 Transcript length:', message.transcript.length, 'chars');
            console.log('📝 Transcript:', message.transcript);
            console.log('═══════════════════════════════════════');
            await this.processTranscript(message.transcript);
            console.log('✅ BACKGROUND: Transcript processing complete');
            console.log('📦 Total cards now:', this.contextualCards.length);
          } else {
            console.warn('⚠️ BACKGROUND: Empty transcript received');
          }
          sendResponse({ success: true });
          break;

        case 'CHATBOX_QUESTION':
          // Handle chatbox question - like normal AI with meeting context awareness
          console.log('═══════════════════════════════════════');
          console.log('💬 CHATBOX QUESTION RECEIVED');
          console.log('Question:', message.question);
          console.log('Meeting context length:', message.meetingContext?.length || 0);
          console.log('═══════════════════════════════════════');

          if (message.question) {
            await this.handleChatboxQuestion(
              message.question,
              message.meetingContext || ''
            );
            console.log('✅ Chatbox answer generated');
          }
          sendResponse({ success: true });
          break;
      }
    } catch (error) {
      console.error('Background script error:', error);
      sendResponse({ error: error.message });
    }
    })();
    return true; // Keep message channel open for async response
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

    console.log('📥 Processing 15-second transcript batch:', transcript);

    // Process IMMEDIATELY - content script already batched it for 15 seconds
    await this.extractTopicsAndGenerateCards(transcript);

    console.log('✅ 15-second batch processed');
  }

  /**
   * Extract keywords/topics and generate AI explanation cards (like asking ChatGPT)
   */
  async extractTopicsAndGenerateCards(text) {
    if (!text.trim()) {
      console.log('⚠️ Empty text, skipping extraction');
      return;
    }

    try {
      console.log('═══════════════════════════════════════');
      console.log('🔍 STARTING KEYWORD EXTRACTION');
      console.log('Text:', text);
      console.log('Text length:', text.length);
      console.log('═══════════════════════════════════════');

      // Step 1: Extract important keywords/topics
      const keywordsResponse = await fetch(this.CEREBRAS_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.CEREBRAS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-oss-120b',
          messages: [
            {
              role: 'system',
              content: `You are a keyword extraction expert. Extract 1-3 most important keywords, topics, or concepts from the conversation that someone might want to learn more about.

              Focus on:
              - Technical terms (e.g., "Docker", "Kubernetes", "MCP")
              - Technologies, tools, frameworks (e.g., "React", "PostgreSQL")
              - Concepts, methodologies (e.g., "Agile", "Microservices")
              - Products, services, companies (e.g., "AWS Lambda", "GitHub Actions")
              - Any specific terms that need explanation

              Extract the EXACT terms as mentioned (e.g., if they say "docker mcp", extract "docker mcp" not "Docker Containerization").

              Return ONLY a JSON array of keyword strings. Keep them concise and specific.
              Example: ["docker mcp", "kubernetes", "react hooks"]

              Do NOT include common words. Only extract meaningful keywords that need explanation.`
            },
            {
              role: 'user',
              content: `Extract important keywords from: "${text}"`
            }
          ],
          temperature: 0.2,
          max_tokens: 300
        })
      });

      if (!keywordsResponse.ok) {
        const errorText = await keywordsResponse.text();
        console.error('❌ Keyword extraction failed:', keywordsResponse.status);
        console.error('Error details:', errorText);
        console.error('API URL:', this.CEREBRAS_API_URL);
        console.error('Model:', 'gpt-oss-120b');
        console.error('API Key configured:', this.CEREBRAS_API_KEY ? 'Yes' : 'No');
        return;
      }

      const keywordsData = await keywordsResponse.json();
      console.log('📦 Full API response:', JSON.stringify(keywordsData, null, 2));

      // Cerebras may return 'content' or 'reasoning' field
      const message = keywordsData.choices?.[0]?.message;
      const keywordsContent = message?.content || message?.reasoning;

      if (!keywordsContent) {
        console.log('⚠️ No keywords extracted - empty content and reasoning');
        console.log('📦 Message object:', message);
        return;
      }

      console.log('🔍 Raw keywords content:', keywordsContent);
      const cleanContent = keywordsContent.replace(/```json\n?|\n?```/g, '').trim();
      console.log('🧹 Cleaned keywords content:', cleanContent);

      let keywords;
      try {
        keywords = JSON.parse(cleanContent);
      } catch (parseError) {
        console.error('❌ Failed to parse keywords JSON:', parseError);
        console.error('📝 Content that failed:', cleanContent);
        return;
      }
      console.log('📋 Extracted keywords:', keywords);
      console.log('📊 Keywords count:', keywords?.length || 0);

      // Step 2: Generate AI explanation card for each keyword (like asking ChatGPT)
      for (const keyword of keywords) {
        if (!this.processedTopics.has(keyword.toLowerCase())) {
          console.log(`💡 Generating AI explanation for: ${keyword}`);
          await this.generateAIExplanationCard(keyword);
          console.log(`✅ Finished generating card for: ${keyword}`);
          this.processedTopics.add(keyword.toLowerCase());
        } else {
          console.log(`⏭️ Already explained: ${keyword}`);
        }
      }

      console.log('✅ All keywords processed. Total cards:', this.contextualCards.length);

    } catch (error) {
      console.error('❌ Failed to extract topics:', error);
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
   * Generate AI explanation card (like asking ChatGPT "what is X?")
   */
  async generateAIExplanationCard(keyword) {
    try {
      console.log(`🤖 Asking AI: "What is ${keyword}?"`);

      // Ask AI to explain the keyword (like ChatGPT)
      const response = await fetch(this.CEREBRAS_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.CEREBRAS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-oss-120b',
          messages: [
            {
              role: 'system',
              content: `You are a helpful AI assistant. When asked about a topic, provide a clear, comprehensive explanation like ChatGPT would.

              Format your response as JSON:
              {
                "explanation": "Clear, comprehensive explanation of the topic (2-3 sentences)",
                "keyPoints": [
                  "Important point 1",
                  "Important point 2",
                  "Important point 3"
                ],
                "useCase": "When and why this is used, with examples",
                "learnMore": [
                  "Specific resource or next step 1",
                  "Specific resource or next step 2"
                ]
              }

              Be informative, accurate, and helpful. Provide practical information.
              Return ONLY valid JSON.`
            },
            {
              role: 'user',
              content: `What is ${keyword}? Explain it clearly and comprehensively.`
            }
          ],
          temperature: 0.5,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ AI explanation failed for ${keyword}:`, response.status);
        console.error('Error details:', errorText);
        console.error('API URL:', this.CEREBRAS_API_URL);
        console.error('Model:', 'gpt-oss-120b');
        return;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (content) {
        console.log(`✅ AI raw response for ${keyword}:`, content);

        try {
          const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
          console.log(`🧹 Cleaned content for ${keyword}:`, cleanContent);

          const aiResponse = JSON.parse(cleanContent);
          console.log(`📦 Parsed response for ${keyword}:`, aiResponse);

          const card = {
            id: Date.now() + Math.random(),
            topic: keyword,
            timestamp: new Date().toLocaleTimeString(),
            summary: aiResponse.explanation,
            keyPoints: aiResponse.keyPoints || [],
            useCase: aiResponse.useCase,
            resources: aiResponse.learnMore || [],
            expanded: false,
            isAutoGenerated: true // Mark as auto-generated from conversation
          };

          console.log(`📦 Card object created for ${keyword}:`, card);
          this.addCard(card);
          console.log(`✅ AI explanation card added for: ${keyword}`);
        } catch (parseError) {
          console.error(`❌ Failed to parse AI response for ${keyword}:`, parseError);
          console.error('Raw content that failed:', content);
        }
      } else {
        console.error(`❌ No content in AI response for ${keyword}`);
      }

    } catch (error) {
      console.error(`❌ Failed to generate AI explanation for ${keyword}:`, error);
    }
  }

  /**
   * OLD: Generate contextual information card using Cerebras + Llama (DEPRECATED)
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
          model: 'gpt-oss-120b',
          messages: [
            {
              role: 'system',
              content: `You are an expert assistant providing detailed, practical contextual information in English.

              When given a topic (which may be in Hindi or English), provide comprehensive information in this EXACT JSON format:
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

              IMPORTANT: Input may be in Hindi (Devanagari script) or English. Understand both, but ALWAYS respond in English only.

              Guidelines:
              - Be specific and practical, not generic
              - Include real-world applications and examples
              - Provide actionable information
              - For technical topics: explain benefits, use cases, and getting started steps
              - For places: include key attractions, best times to visit, practical tips
              - For concepts: explain clearly with real examples
              - Resources should be specific (actual tools, websites, or actions), not vague suggestions
              - ALL responses must be in English, regardless of input language
              
              Return ONLY valid JSON, no markdown formatting.`
            },
            {
              role: 'user',
              content: `Provide detailed, practical information about (may be in Hindi or English): ${topic}`
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
    console.log('📦 New contextual card added:', card.topic);
    console.log('📦 Total cards:', this.contextualCards.length);
    console.log('📦 Broadcasting to content script...');

    this.broadcastToContentScript('NEW_CARDS', {
      cards: this.contextualCards
    });
  }

  /**
   * Send message to content script in all Meet tabs
   */
  async broadcastToContentScript(type, data = {}) {
    try {
      const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
      console.log(`📡 Broadcasting ${type} to ${tabs.length} Meet tab(s)`);

      if (tabs.length === 0) {
        console.warn('⚠️ No Google Meet tabs found to broadcast to!');
      }

      for (const tab of tabs) {
        console.log(`📡 Sending to tab ${tab.id}:`, type, 'with', data.cards?.length || 0, 'cards');
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
      chrome.tabs.sendMessage(tabId, { type, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(`❌ Failed to send ${type} to tab ${tabId}:`, chrome.runtime.lastError.message);
        } else {
          console.log(`✅ Message ${type} sent successfully to tab ${tabId}`);
        }
      });
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
   * Handle chatbox question - works like normal AI with meeting context awareness
   */
  async handleChatboxQuestion(question, meetingContext) {
    try {
      console.log('🤖 Processing chatbox question:', question);

      // Use AI to answer - it will use meeting context if relevant, otherwise answer generally
      const response = await fetch(this.CEREBRAS_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.CEREBRAS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-oss-120b',
          messages: [
            {
              role: 'system',
              content: `You are a helpful AI assistant like ChatGPT. Answer questions intelligently.

              IMPORTANT:
              - If meeting context is provided and the question relates to it, use that context in your answer
              - If the question is general (like "what is docker?", "explain AI", etc.), answer it normally without needing meeting context
              - Be helpful, accurate, and comprehensive
              - If asked about something from the meeting (like "what did John say?", "when is the deadline?"), use the meeting context
              - If meeting context is empty or irrelevant, just answer the question normally

              Format response as JSON:
              {
                "answer": "Direct, comprehensive answer to the question",
                "usedMeetingContext": true/false,
                "additionalInfo": ["Related point 1", "Related point 2", "Related point 3"]
              }

              Return ONLY valid JSON.`
            },
            {
              role: 'user',
              content: meetingContext
                ? `Meeting Context: "${meetingContext}"\n\nQuestion: ${question}\n\nAnswer the question. Use meeting context if relevant, otherwise answer generally.`
                : `Question: ${question}\n\nAnswer this question comprehensively.`
            }
          ],
          temperature: 0.6,
          max_tokens: 600
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Chatbox AI error:', response.status);
        console.error('Error details:', errorText);
        console.error('API URL:', this.CEREBRAS_API_URL);
        console.error('Model:', 'gpt-oss-120b');
        console.error('API Key configured:', this.CEREBRAS_API_KEY ? 'Yes' : 'No');
        console.error('Question:', question);
        throw new Error(`AI API error: ${response.status} - ${errorText.substring(0, 100)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (content) {
        console.log('✅ AI raw response:', content);

        try {
          const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
          console.log('🧹 Cleaned content:', cleanContent);

          const aiResponse = JSON.parse(cleanContent);
          console.log('📦 Parsed response:', aiResponse);

          const card = {
            id: Date.now() + Math.random(),
            topic: `💬 ${question}`,
            timestamp: new Date().toLocaleTimeString(),
            summary: aiResponse.answer,
            keyPoints: aiResponse.additionalInfo || [],
            useCase: aiResponse.usedMeetingContext
              ? '✅ Answer based on meeting context'
              : '💡 General knowledge answer',
            resources: ['Ask another question in the chatbox'],
            expanded: true,
            isChatboxAnswer: true
          };

          this.addCard(card);
          console.log('✅ Chatbox answer card added');
        } catch (parseError) {
          console.error('❌ Failed to parse AI response:', parseError);
          console.error('Raw content that failed to parse:', content);
          throw new Error(`JSON parse error: ${parseError.message}`);
        }
      } else {
        console.error('❌ No content in AI response');
        console.error('Full response data:', data);
        throw new Error('No content in AI response');
      }

    } catch (error) {
      console.error('❌ Failed to answer chatbox question:', error);
      console.error('Error stack:', error.stack);

      // Fallback card with actual error message
      const fallbackCard = {
        id: Date.now(),
        topic: `💬 ${question}`,
        timestamp: new Date().toLocaleTimeString(),
        summary: `Sorry, I encountered an error: ${error.message}`,
        keyPoints: [
          'Check your internet connection',
          'Verify API keys are configured correctly',
          `Error details: ${error.message.substring(0, 100)}`
        ],
        useCase: 'Error occurred while processing your question',
        resources: ['Try asking again', 'Check browser console for details'],
        expanded: true,
        isChatboxAnswer: true
      };

      this.addCard(fallbackCard);
    }
  }

  /**
   * OLD: Handle instant question with meeting context (DEPRECATED - Wake word removed)
   */
  async handleInstantQuestion(question, meetingContext, isFromWakeWord = false, isFromChatbox = false) {
    try {
      console.log('🤔 Generating instant response for question:', question);
      console.log('🎯 Source: Wake Word =', isFromWakeWord, '| Chatbox =', isFromChatbox);

      const response = await fetch(this.CEREBRAS_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.CEREBRAS_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-oss-120b',
          messages: [
            {
              role: 'system',
              content: `You are an intelligent meeting assistant. You have access to the meeting transcript and can answer questions about the discussion.

              The meeting transcript and questions may be in Hindi (Devanagari script) or English. You must understand both languages.

              IMPORTANT: ALWAYS respond in English only, regardless of the input language. If the question is in Hindi, understand it and answer in English.

              Provide helpful, accurate answers based on the meeting context. If the answer isn't in the context, say so and provide general helpful information.

              Format your response as JSON:
              {
                "answer": "Direct answer to the question in English",
                "context": "Relevant information from the meeting that supports this answer (in English)",
                "suggestions": ["Related point 1 in English", "Related point 2 in English"]
              }

              Be concise but thorough. Return ONLY valid JSON. All responses must be in English.`
            },
            {
              role: 'user',
              content: `Meeting Context (may be in Hindi or English): "${meetingContext}"

              Question (may be in Hindi or English): ${question}

              Remember: Understand the question in any language, but respond in English only.`
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

        // Create instant response card with visual differentiation
        const card = {
          id: Date.now() + Math.random(),
          topic: `${isFromChatbox ? '💬' : '🎤'} Q: ${question}`,
          timestamp: new Date().toLocaleTimeString(),
          summary: responseData.answer,
          keyPoints: responseData.suggestions || [],
          useCase: responseData.context || 'Based on the current meeting discussion',
          resources: isFromChatbox
            ? ['Type another question in the chatbox']
            : ['Ask another question by saying "Hey SyncUp"'],
          expanded: true, // Auto-expand instant responses
          isQuestionAnswer: true, // Mark as question answer (not regular card)
          isFromWakeWord: isFromWakeWord,
          isFromChatbox: isFromChatbox
        };

        this.addCard(card);
        console.log('✅ Question answer card added');
      }

    } catch (error) {
      console.error('Failed to generate instant response:', error);

      // Fallback card if API fails
      const fallbackCard = {
        id: Date.now(),
        topic: `${isFromChatbox ? '💬' : '🎤'} Q: ${question}`,
        timestamp: new Date().toLocaleTimeString(),
        summary: 'I heard your question but encountered an error generating a response. Please try again.',
        keyPoints: ['Make sure you have a stable internet connection', 'Try rephrasing your question'],
        useCase: 'Error occurred while processing your question',
        resources: isFromChatbox
          ? ['Type another question in the chatbox']
          : ['Say "Hey SyncUp" to try again'],
        expanded: true,
        isQuestionAnswer: true,
        isFromWakeWord: isFromWakeWord,
        isFromChatbox: isFromChatbox
      };

      this.addCard(fallbackCard);
    }
  }
}

// Initialize the background service
new SyncUpBackground();
