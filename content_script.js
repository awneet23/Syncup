/**
 * SyncUp Content Script
 * Injects sidebar into Google Meet for displaying real-time contextual information
 */

class SyncUpSidebar {
  constructor() {
    this.isInjected = false;
    this.contextualCards = [];
    this.sidebarElement = null;
    this.isRecording = false;
    this.recognition = null;
    this.transcriptBuffer = '';
    this.bufferInterval = null;
    this.meetingTranscript = ''; // Store full meeting transcript for context
    this.isListeningForQuestion = false; // Wake word detected, listening for question
    this.isSidebarOpen = false; // Track sidebar open/close state
    this.toggleButton = null; // Toggle button element
    
    this.init();
  }

  /**
   * Initialize the sidebar injection
   */
  init() {
    // Wait for Google Meet to fully load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.injectSidebar());
    } else {
      this.injectSidebar();
    }

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });

    // Observer to re-inject if Meet UI changes
    this.setupMutationObserver();
  }

  /**
   * Inject the sidebar into Google Meet
   */
  injectSidebar() {
    if (this.isInjected || !this.isGoogleMeetPage()) {
      console.log('Sidebar injection skipped - already injected or not on Meet page');
      return;
    }

    console.log('Attempting to inject SyncUp sidebar...');

    const meetContainer = document.body;

    if (!meetContainer) {
      console.log('Body not ready, retrying...');
      setTimeout(() => this.injectSidebar(), 1000);
      return;
    }

    // Create toggle button first
    this.toggleButton = document.createElement('button');
    this.toggleButton.className = 'syncup-toggle-btn';
    this.toggleButton.innerHTML = '&#x1F50D;';
    this.toggleButton.title = 'Toggle SyncUp Sidebar';
    
    // Add toggle button click handler
    this.toggleButton.addEventListener('click', () => {
      this.toggleSidebar();
    });
    
    document.body.appendChild(this.toggleButton);

    // Create sidebar container
    this.sidebarElement = document.createElement('div');
    this.sidebarElement.id = 'syncup-sidebar';
    this.sidebarElement.className = 'syncup-sidebar'; // Starts closed (CSS has right: -420px)

    // Sidebar HTML structure
    this.sidebarElement.innerHTML = `
      <div class="sidebar-header">
        <h3>&#x1F50D; SyncUp</h3>
        <p class="header-subtitle">Contextual Information</p>
        <div class="recording-status">
          <span class="status-indicator"></span>
          <span class="status-text">Standby</span>
        </div>
        <div class="sidebar-controls">
          <button class="sidebar-btn start-btn" id="sidebarStartBtn">
            <span>&#x25B6;</span> Start
          </button>
          <button class="sidebar-btn stop-btn" id="sidebarStopBtn" style="display: none;">
            <span>&#x23F9;</span> Stop
          </button>
          <button class="sidebar-btn clear-btn" id="sidebarClearBtn">
            <span>&#x1F5D1;</span> Clear All
          </button>
        </div>
      </div>
      <div class="sidebar-content">
        <div class="contextual-cards-list" id="contextual-cards-list">
          <div class="placeholder">
            <div class="placeholder-icon">&#x1F4A1;</div>
            <p>Contextual information will appear here</p>
            <p class="help-text">Click Start to begin listening</p>
          </div>
        </div>
      </div>
      <div class="sidebar-footer">
        <div class="powered-by">
          &#x26A1; Powered by Gemini + Cerebras + Meta Llama
        </div>
      </div>
    `;

    // Inject into the page
    document.body.appendChild(this.sidebarElement);
    this.isInjected = true;

    // Add event listeners for sidebar buttons
    this.setupSidebarControls();

    console.log('SyncUp: Sidebar injected successfully');
    
    // Notify background script that sidebar is ready
    chrome.runtime.sendMessage({
      type: 'SIDEBAR_INJECTED',
      url: window.location.href
    });
  }

  /**
   * Handle messages from background script and popup
   */
  handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'NEW_CARDS':
        this.updateContextualCards(message.cards);
        break;
      
      case 'RECORDING_STATUS':
        this.updateRecordingStatus(message.isRecording);
        break;
      
      case 'CLEAR_CARDS':
        this.clearCards();
        break;
        
      case 'START_SPEECH_RECOGNITION':
        console.log('&#x1F4E8; Content script received START_SPEECH_RECOGNITION');
        this.startSpeechRecognition();
        break;
        
      case 'STOP_SPEECH_RECOGNITION':
        console.log('&#x1F4E8; Content script received STOP_SPEECH_RECOGNITION');
        this.stopSpeechRecognition();
        break;
      
      case 'GET_SIDEBAR_STATUS':
        sendResponse({ 
          isInjected: this.isInjected,
          isRecording: this.isRecording,
          cardsCount: this.contextualCards.length
        });
        break;
    }
  }

  /**
   * Update the contextual cards display
   */
  updateContextualCards(newCards) {
    this.contextualCards = newCards;
    const listContainer = document.getElementById('contextual-cards-list');
    
    if (!listContainer) return;

    if (this.contextualCards.length === 0) {
      listContainer.innerHTML = `
        <div class="placeholder">
          <div class="placeholder-icon">&#x1F4A1;</div>
          <p>Listening for topics...</p>
          <p class="help-text">Contextual information will appear as topics are mentioned</p>
        </div>
      `;
      return;
    }

    // Generate cards HTML
    const cardsHTML = this.contextualCards.map((card, index) => `
      <div class="context-card ${card.expanded ? 'expanded' : ''}" 
           data-index="${index}" 
           data-id="${card.id}"
           ${card.isInstantResponse ? 'data-instant="true"' : ''}>
        <div class="card-header" data-card-index="${index}">
          <div class="card-title-row">
            <span class="card-icon">${card.isInstantResponse ? '&#x1F4AC;' : '&#x1F4D9;'}</span>
            <h4 class="card-topic">${this.escapeHtml(card.topic)}</h4>
            <span class="expand-icon">${card.expanded ? '&#x25BC;' : '&#x25B6;'}</span>
          </div>
          <div class="card-timestamp">${card.timestamp}</div>
        </div>
        <div class="card-body" style="display: ${card.expanded ? 'block' : 'none'}">
          <div class="card-summary">
            <p>${this.escapeHtml(card.summary)}</p>
          </div>
          
          ${card.keyPoints && card.keyPoints.length > 0 ? `
            <div class="card-section">
              <h5>${card.isInstantResponse ? 'Related Points' : 'Key Points'}</h5>
              <ul class="key-points-list">
                ${card.keyPoints.map(point => `<li>${this.escapeHtml(point)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          
          ${card.useCase ? `
            <div class="card-section">
              <h5>${card.isInstantResponse ? 'Context' : 'Use Case'}</h5>
              <p class="use-case-text">${this.escapeHtml(card.useCase)}</p>
            </div>
          ` : ''}
          
          ${card.resources && card.resources.length > 0 ? `
            <div class="card-section">
              <h5>Resources</h5>
              <ul class="resources-list">
                ${card.resources.map(resource => `<li>&#x1F4DA; ${this.escapeHtml(resource)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      </div>
    `).join('');

    listContainer.innerHTML = cardsHTML;
    
    // Add click event listeners to all card headers
    const cardHeaders = listContainer.querySelectorAll('.card-header');
    cardHeaders.forEach(header => {
      header.addEventListener('click', (e) => {
        const index = parseInt(header.getAttribute('data-card-index'));
        this.toggleCard(index);
      });
    });
    
    // Scroll to bottom to show latest cards
    listContainer.scrollTop = listContainer.scrollHeight;
  }

  /**
   * Toggle card expansion
   */
  toggleCard(index) {
    if (index >= 0 && index < this.contextualCards.length) {
      this.contextualCards[index].expanded = !this.contextualCards[index].expanded;
      this.updateContextualCards(this.contextualCards);
    }
  }

  /**
   * Update recording status indicator
   */
  updateRecordingStatus(isRecording) {
    this.isRecording = isRecording;
    const statusIndicator = document.querySelector('.status-indicator');
    const statusText = document.querySelector('.status-text');
    const startBtn = document.getElementById('sidebarStartBtn');
    const stopBtn = document.getElementById('sidebarStopBtn');
    
    if (statusIndicator && statusText) {
      if (isRecording) {
        statusIndicator.className = 'status-indicator recording';
        statusText.textContent = 'Listening';
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'block';
      } else {
        statusIndicator.className = 'status-indicator';
        statusText.textContent = 'Standby';
        if (startBtn) startBtn.style.display = 'block';
        if (stopBtn) stopBtn.style.display = 'none';
      }
    }
  }

  /**
   * Clear all contextual cards
   */
  clearCards() {
    this.contextualCards = [];
    this.updateContextualCards([]);
  }

  /**
   * Check if current page is Google Meet
   */
  isGoogleMeetPage() {
    return window.location.hostname === 'meet.google.com' && 
           window.location.pathname.includes('/');
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Setup mutation observer to handle dynamic UI changes
   */
  setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      // Check if sidebar was removed and re-inject if needed
      if (this.isInjected && !document.getElementById('syncup-sidebar')) {
        this.isInjected = false;
        setTimeout(() => this.injectSidebar(), 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Setup sidebar control buttons
   */
  setupSidebarControls() {
    const startBtn = document.getElementById('sidebarStartBtn');
    const stopBtn = document.getElementById('sidebarStopBtn');
    const clearBtn = document.getElementById('sidebarClearBtn');

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        console.log('&#x1F4E8; Start button clicked');
        this.isRecording = true;
        this.updateRecordingStatus(true);
        this.startSpeechRecognition();
        
        // Also notify background
        chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (response) => {
          if (response && response.error) {
            console.error('Failed to start:', response.error);
          }
        });
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        console.log('&#x1F4E8; Stop button clicked');
        this.isRecording = false;
        this.updateRecordingStatus(false);
        this.stopSpeechRecognition();
        
        // Also notify background
        chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
          if (response && response.error) {
            console.error('Failed to stop:', response.error);
          }
        });
      });
    }
    
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        console.log('&#x1F4E8; Clear button clicked');
        chrome.runtime.sendMessage({ type: 'CLEAR_CARDS' });
      });
    }
  }

  /**
   * Toggle sidebar open/close
   */
  toggleSidebar() {
    this.isSidebarOpen = !this.isSidebarOpen;
    
    if (this.isSidebarOpen) {
      this.sidebarElement.classList.add('open');
      this.toggleButton.classList.add('sidebar-open');
      this.toggleButton.innerHTML = '&#x2715;';
      this.toggleButton.title = 'Close SyncUp Sidebar';
    } else {
      this.sidebarElement.classList.remove('open');
      this.toggleButton.classList.remove('sidebar-open');
      this.toggleButton.innerHTML = '&#x1F50D;';
      this.toggleButton.title = 'Open SyncUp Sidebar';
    }
  }

  /**
   * Start speech recognition using Web Speech API
   */
  startSpeechRecognition() {
    console.log('=== Starting Speech Recognition ===');
    
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.error('&#x2718; Speech recognition not supported in this browser');
      alert('Speech recognition is not supported in your browser. Please use Chrome.');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    
    console.log('&#x2714; Speech recognition configured');
    console.log('&#x1F4E8; Browser will request microphone permission...');
    console.log('&#x23F1; Cards will be generated every 15 seconds based on conversation');
    
    // Clear any existing buffer
    this.transcriptBuffer = '';
    
    // Set up interval to process buffer every 15 seconds
    this.bufferInterval = setInterval(() => {
      if (this.transcriptBuffer.trim().length > 0) {
        console.log('&#x23F1; 15 seconds elapsed - Processing conversation:', this.transcriptBuffer);
        
        // Send accumulated transcript to background
        chrome.runtime.sendMessage({
          type: 'TRANSCRIPT_RECEIVED',
          transcript: this.transcriptBuffer.trim()
        }, (response) => {
          console.log('&#x1F4E8; 15-second conversation batch sent to background');
        });
        
        // Clear buffer for next 15 seconds
        this.transcriptBuffer = '';
      } else {
        console.log('&#x23F1; 15 seconds elapsed - No conversation detected');
      }
    }, 15000); // 15 seconds
    
    this.recognition.onstart = () => {
      console.log('&#x1F4E8; Speech recognition STARTED - Microphone is active');
      console.log('&#x1F4AC; Start speaking now...');
    };
    
    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        const isFinal = event.results[i].isFinal;
        
        // LOG EVERYTHING - Show all transcripts in real-time
        console.log('&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;');
        console.log('&#x1F4AC; TRANSCRIPT:', transcript);
        console.log('&#x1F510; Is Final:', isFinal);
        console.log('&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;&#x1F4D9;');
        
        if (isFinal) {
          const lowerTranscript = transcript.toLowerCase().trim();
          
          console.log('&#x1F50D; Checking for wake word in:', lowerTranscript);
          
          // Check for wake word "Hey SyncUp"
          const hasWakeWord = lowerTranscript.includes('hey sync up') || 
                             lowerTranscript.includes('hey syncup') ||
                             lowerTranscript.includes('a sync up') ||
                             lowerTranscript.includes('hey  ') ||
                             lowerTranscript.includes('hello') ||
                             lowerTranscript.includes('hello car') ||
                             lowerTranscript.includes('hello world') ||
                             lowerTranscript.includes('hello raj');
        
          console.log('&#x1F4A1; Wake word detected?', hasWakeWord);
          
          if (hasWakeWord) {
            console.log('&#x1F4A1; WAKE WORD DETECTED: Hey SyncUp!');
            console.log('&#x1F4E8; Now listening for your question...');
            this.isListeningForQuestion = true;
            this.showWakeWordIndicator();
            
            // Extract question if it's in the same sentence
            const questionPart = transcript.replace(/hey sync ?up/i, '')
                                          .replace(/a sync ?up/i, '')
                                          .replace(/hey sink ?up/i, '')
                                          .trim();
            console.log('&#x3F; Question part extracted:', questionPart);
            
            if (questionPart.length > 5) {
              console.log('&#x2714; Question found in same sentence, processing...');
              this.handleQuestion(questionPart);
              this.isListeningForQuestion = false;
            } else {
              console.log('&#x23F1; Waiting for question in next sentence...');
            }
            continue;
          }
          
          // If we're listening for a question after wake word
          if (this.isListeningForQuestion) {
            console.log('&#x3F; Question captured after wake word:', transcript);
            this.handleQuestion(transcript);
            this.isListeningForQuestion = false;
            this.hideWakeWordIndicator();
            continue;
          }
          
          // Normal transcript buffering for regular cards
          this.transcriptBuffer += transcript + ' ';
          this.meetingTranscript += transcript + ' '; // Keep full meeting context
          console.log('&#x2714; Added to buffer:', transcript);
          console.log('&#x1F4AC; Current buffer length:', this.transcriptBuffer.length);
          console.log('&#x1F4D9; Meeting transcript length:', this.meetingTranscript.length);
        } else {
          interimTranscript += transcript;
          console.log('&#x23F1; Interim (not final):', transcript);
        }
      }
    };
    
    this.recognition.onerror = (event) => {
      console.error('&#x2718; Speech recognition error:', event.error);
      
      if (event.error === 'not-allowed') {
        alert('Microphone permission denied. Please allow microphone access and try again.');
      } else if (event.error === 'no-speech') {
        console.log('&#x26A0; No speech detected, restarting...');
        setTimeout(() => {
          if (this.isRecording && this.recognition) {
            this.recognition.start();
          }
        }, 1000);
      } else {
        console.error('Error details:', event);
      }
    };
    
    this.recognition.onend = () => {
      console.log('&#x1F4E8; Speech recognition ended, restarting...');
      // Restart recognition if still recording
      if (this.isRecording) {
        setTimeout(() => {
          if (this.recognition) {
            try {
              this.recognition.start();
            } catch (e) {
              console.error('Failed to restart:', e);
            }
          }
        }, 500);
      }
    };
    
    try {
      this.recognition.start();
      console.log('&#x1F4E8; Recognition start() called - waiting for permission...');
    } catch (error) {
      console.error('&#x2718; Failed to start speech recognition:', error);
      alert('Failed to start speech recognition: ' + error.message);
    }
  }

  stopSpeechRecognition() {
    if (this.recognition) {
      this.recognition.stop();
      console.log('&#x1F510; Speech recognition stopped');
      clearInterval(this.bufferInterval);
    }
  }

  handleQuestion(question) {
    console.log('&#x1F4A1; Handling question:', question);
    console.log('&#x1F4D9; Meeting context available:', this.meetingTranscript.length, 'characters');
    
    // Send question with meeting context to background script
    chrome.runtime.sendMessage({
      type: 'QUESTION_ASKED',
      question: question,
      meetingContext: this.meetingTranscript
    }, (response) => {
      if (response && response.success) {
        console.log('&#x2714; Question sent to background successfully');
      } else if (response && response.error) {
        console.error('&#x2718; Error sending question:', response.error);
      }
    });
  }

  /**
   * Show visual indicator that wake word was detected
   */
  showWakeWordIndicator() {
    console.log('&#x1F4A1; SHOWING WAKE WORD INDICATOR');
    const statusText = document.querySelector('.status-text');
    if (statusText) {
      statusText.textContent = '&#x1F4E8; Listening for your question...';
      statusText.style.color = '#34a853';
      console.log('&#x2714; Status text updated to show listening for question');
    } else {
      console.error('&#x2718; Could not find status text element');
    }
  }

  /**
   * Hide wake word indicator
   */
  hideWakeWordIndicator() {
    console.log('&#x1F4A1; HIDING WAKE WORD INDICATOR');
    const statusText = document.querySelector('.status-text');
    if (statusText) {
      statusText.textContent = 'Listening';
      statusText.style.color = '';
      console.log('&#x2714; Status text reset to normal');
    } else {
      console.error('&#x2718; Could not find status text element');
    }
  }
}

// Initialize the sidebar when script loads
if (document.location.hostname === 'meet.google.com') {
  console.log('&#x1F4E8; SyncUp content script loaded on Google Meet');
  const sidebar = new SyncUpSidebar();
  console.log('&#x2714; SyncUp sidebar instance created');
}