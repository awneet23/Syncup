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

    // Create sidebar container
    this.sidebarElement = document.createElement('div');
    this.sidebarElement.id = 'syncup-sidebar';
    this.sidebarElement.className = 'syncup-sidebar';

    // Sidebar HTML structure
    this.sidebarElement.innerHTML = `
      <div class="sidebar-header">
        <h3>🔍 SyncUp</h3>
        <p class="header-subtitle">Contextual Information</p>
        <div class="recording-status">
          <span class="status-indicator"></span>
          <span class="status-text">Standby</span>
        </div>
        <div class="sidebar-controls">
          <button class="sidebar-btn start-btn" id="sidebarStartBtn">
            <span>▶</span> Start
          </button>
          <button class="sidebar-btn stop-btn" id="sidebarStopBtn" style="display: none;">
            <span>⏹</span> Stop
          </button>
          <button class="sidebar-btn clear-btn" id="sidebarClearBtn">
            <span>🗑️</span> Clear All
          </button>
        </div>
      </div>
      <div class="sidebar-content">
        <div class="contextual-cards-list" id="contextual-cards-list">
          <div class="placeholder">
            <div class="placeholder-icon">💡</div>
            <p>Contextual information will appear here</p>
            <p class="help-text">Click Start to begin listening</p>
          </div>
        </div>
      </div>
      <div class="sidebar-footer">
        <div class="powered-by">
          ⚡ Powered by Gemini + Cerebras + Meta Llama
        </div>
      </div>
    `;

    // Inject into the page
    document.body.appendChild(this.sidebarElement);
    this.isInjected = true;

    // Add event listeners for sidebar buttons
    this.setupSidebarControls();

    console.log('SyncUp: Sidebar injected successfully');
    
    // Force immediate visibility
    setTimeout(() => {
      if (this.sidebarElement) {
        this.sidebarElement.style.display = 'flex';
        this.sidebarElement.style.zIndex = '999999';
        console.log('SyncUp: Sidebar visibility forced');
      }
    }, 500);
    
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
        console.log('📨 Content script received START_SPEECH_RECOGNITION');
        this.startSpeechRecognition();
        break;
        
      case 'STOP_SPEECH_RECOGNITION':
        console.log('📨 Content script received STOP_SPEECH_RECOGNITION');
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
          <div class="placeholder-icon">💡</div>
          <p>Listening for topics...</p>
          <p class="help-text">Contextual information will appear as topics are mentioned</p>
        </div>
      `;
      return;
    }

    // Generate cards HTML
    const cardsHTML = this.contextualCards.map((card, index) => `
      <div class="context-card ${card.expanded ? 'expanded' : ''}" data-index="${index}" data-id="${card.id}">
        <div class="card-header" data-card-index="${index}">
          <div class="card-title-row">
            <span class="card-icon">📌</span>
            <h4 class="card-topic">${this.escapeHtml(card.topic)}</h4>
            <span class="expand-icon">${card.expanded ? '▼' : '▶'}</span>
          </div>
          <div class="card-timestamp">${card.timestamp}</div>
        </div>
        <div class="card-body" style="display: ${card.expanded ? 'block' : 'none'}">
          <div class="card-summary">
            <p>${this.escapeHtml(card.summary)}</p>
          </div>
          
          ${card.keyPoints && card.keyPoints.length > 0 ? `
            <div class="card-section">
              <h5>Key Points</h5>
              <ul class="key-points-list">
                ${card.keyPoints.map(point => `<li>${this.escapeHtml(point)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          
          ${card.useCase ? `
            <div class="card-section">
              <h5>Use Case</h5>
              <p class="use-case-text">${this.escapeHtml(card.useCase)}</p>
            </div>
          ` : ''}
          
          ${card.resources && card.resources.length > 0 ? `
            <div class="card-section">
              <h5>Resources</h5>
              <ul class="resources-list">
                ${card.resources.map(resource => `<li>📚 ${this.escapeHtml(resource)}</li>`).join('')}
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
        console.log('🖱️ Start button clicked');
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
        console.log('🖱️ Stop button clicked');
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
        console.log('🖱️ Clear button clicked');
        chrome.runtime.sendMessage({ type: 'CLEAR_CARDS' });
      });
    }
  }

  /**
   * Start speech recognition using Web Speech API
   */
  startSpeechRecognition() {
    console.log('=== Starting Speech Recognition ===');
    
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.error('❌ Speech recognition not supported in this browser');
      alert('Speech recognition is not supported in your browser. Please use Chrome.');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    
    console.log('✅ Speech recognition configured');
    console.log('📢 Browser will request microphone permission...');
    console.log('⏱️ Cards will be generated every 15 seconds based on conversation');
    
    // Clear any existing buffer
    this.transcriptBuffer = '';
    
    // Set up interval to process buffer every 15 seconds
    this.bufferInterval = setInterval(() => {
      if (this.transcriptBuffer.trim().length > 0) {
        console.log('⏰ 15 seconds elapsed - Processing conversation:', this.transcriptBuffer);
        
        // Send accumulated transcript to background
        chrome.runtime.sendMessage({
          type: 'TRANSCRIPT_RECEIVED',
          transcript: this.transcriptBuffer.trim()
        }, (response) => {
          console.log('📤 15-second conversation batch sent to background');
        });
        
        // Clear buffer for next 15 seconds
        this.transcriptBuffer = '';
      } else {
        console.log('⏰ 15 seconds elapsed - No conversation detected');
      }
    }, 15000); // 15 seconds
    
    this.recognition.onstart = () => {
      console.log('🎤 Speech recognition STARTED - Microphone is active');
      console.log('💬 Start speaking now...');
    };
    
    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        
        if (event.results[i].isFinal) {
          // Add to buffer instead of sending immediately
          this.transcriptBuffer += transcript + ' ';
          console.log('✅ Added to buffer:', transcript);
          console.log('📝 Current buffer:', this.transcriptBuffer);
        } else {
          interimTranscript += transcript;
          console.log('⏳ Interim transcript:', transcript);
        }
      }
    };
    
    this.recognition.onerror = (event) => {
      console.error('❌ Speech recognition error:', event.error);
      
      if (event.error === 'not-allowed') {
        alert('Microphone permission denied. Please allow microphone access and try again.');
      } else if (event.error === 'no-speech') {
        console.log('⚠️ No speech detected, restarting...');
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
      console.log('🔄 Speech recognition ended, restarting...');
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
      console.log('🚀 Recognition start() called - waiting for permission...');
    } catch (error) {
      console.error('❌ Failed to start speech recognition:', error);
      alert('Failed to start speech recognition: ' + error.message);
    }
  }

  stopSpeechRecognition() {
    if (this.recognition) {
      this.recognition.stop();
      console.log('🔇 Speech recognition stopped');
      clearInterval(this.bufferInterval);
    }
  }
}

// Initialize the sidebar when script loads
if (document.location.hostname === 'meet.google.com') {
  console.log('🚀 SyncUp content script loaded on Google Meet');
  const sidebar = new SyncUpSidebar();
  console.log('✅ SyncUp sidebar instance created');
}