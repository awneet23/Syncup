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
    this.currentLanguage = 'en-US'; // Current recognition language
    this.alwaysOnCaptionObserver = null; // Always-on caption capture for chatbox

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
      <div class="sidebar-header" style = "padding: 0px; border-bottom: none;">
        <div class="header-top" style = "margin-bottom:-20px;">
          <h3 style = "margin-left:25px;"> SyncUp</h3>
          <div class="sidebar-controls">
            <span class="control-icon start-icon" id="sidebarStartBtn" title="Start">
            <img src="https://img.icons8.com/?size=30&id=99cTBfGlewZU&format=png&color=FFFFFF" alt="Start" > </img>
            </span>
            <span class="control-icon stop-icon" id="sidebarStopBtn" style="display: none;" title="Pause">
            <img src="https://img.icons8.com/?size=30&id=9987&format=png&color=FFFFFF" alt="Start" > </img>
            </span>
            <span class="control-icon clear-icon" id="sidebarClearBtn" title="Clear All" style="margin-bottom:15px;">
            <img src="https://img.icons8.com/?size=30&id=67884&format=png&color=FFFFFF" alt="Start" > </img>
            </span>
          </div>
        </div>
        <div class="listening-indicator" id="listeningIndicator" style="display: none;">
          <span class="dot" style = "background: #FFFFFF;"></span>
          <span class="dot" style = "background: #FFFFFF;"></span>
          <span class="dot" style = "background: #FFFFFF;"></span>
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
      <div class="chatbox-container">
        <div class="chatbox-input-wrapper">
          <input
            type="text"
            id="chatbox-input"
            class="chatbox-input"
            placeholder="Ask anything about the meeting..."
            autocomplete="off"
          />
          <button id="chatbox-send-btn" class="chatbox-send-btn" style="width: 40px; height: 40px;">
            <span>➤</span>
          </button>
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

    // Add event listeners for chatbox
    this.setupChatbox();

    // Start always-on caption capture for chatbox (even when not recording)
    this.startAlwaysOnCaptionCapture();

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
    console.log('📨 Content script received message:', message.type);

    switch (message.type) {
      case 'NEW_CARDS':
        console.log('📨 NEW_CARDS received with', message.cards?.length || 0, 'cards');
        this.updateContextualCards(message.cards);
        sendResponse({ success: true });
        break;
      
      case 'RECORDING_STATUS':
        this.updateRecordingStatus(message.isRecording);
        sendResponse({ success: true });
        break;
      
      case 'CLEAR_CARDS':
        this.clearCards();
        sendResponse({ success: true });
        break;
        
      case 'START_SPEECH_RECOGNITION':
        console.log('&#x1F4E8; Content script received START_SPEECH_RECOGNITION');
        this.startSpeechRecognition();
        sendResponse({ success: true });
        break;
        
      case 'STOP_SPEECH_RECOGNITION':
        console.log('&#x1F4E8; Content script received STOP_SPEECH_RECOGNITION');
        this.stopSpeechRecognition();
        sendResponse({ success: true });
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
    console.log('🔄 Updating contextual cards display');
    console.log('🔄 Received cards:', newCards?.length || 0);
    console.log('🔄 Full cards data:', JSON.stringify(newCards, null, 2));

    // Preserve expanded state of existing cards
    const previousExpandedStates = {};
    if (this.contextualCards && this.contextualCards.length > 0) {
      this.contextualCards.forEach((card, index) => {
        if (card.id) {
          previousExpandedStates[card.id] = card.expanded || false;
        }
      });
    }

    this.contextualCards = newCards || [];

    // Apply previous expanded states, keeping new cards collapsed
    this.contextualCards.forEach(card => {
      if (card.id && previousExpandedStates.hasOwnProperty(card.id)) {
        card.expanded = previousExpandedStates[card.id];
      } else {
        // New cards default to collapsed
        card.expanded = false;
      }
    });

    const listContainer = document.getElementById('contextual-cards-list');

    if (!listContainer) {
      console.error('❌ Container element not found!');
      console.error('❌ Sidebar element exists:', !!this.sidebarElement);
      console.error('❌ Is injected:', this.isInjected);
      return;
    }

    console.log('✅ Found list container, updating...');
    console.log('✅ List container parent:', listContainer.parentElement?.className);

    if (this.contextualCards.length === 0) {
      listContainer.innerHTML = ``;
      return;
    }

    // Render all items (cards and chat) in chronological order
    this.renderAllItems(this.contextualCards, listContainer);
  }

  /**
   * Render all items (both cards and chat messages) in chronological order
   */
  renderAllItems(items, listContainer) {
    // Helper function to truncate text to max two lines
    const truncateToTwoLines = (text, maxLength = 120) => {
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength) + '...';
    };

    let html = '';

    items.forEach((item, index) => {
      const originalIndex = index;

      if (item.isChatboxAnswer) {
        // Render as chat message
        const question = item.topic.replace(/^💬\s*/, '');
        const truncatedSummary = truncateToTwoLines(item.summary);

        html += `
          <div class="chat-message-pair">
            <div class="chat-question">
              <div class="chat-bubble chat-bubble-question">
                ${this.escapeHtml(question)}
              </div>
            </div>
            <div class="chat-answer">
              <div class="context-card-compact chat-answer-card ${item.expanded ? 'expanded' : ''} style = "margin-bottom: -8px;""
                   data-index="${originalIndex}"
                   data-id="${item.id}"
                   data-chatbox-answer="true">
                <div class="card-compact-header">
                  <h4 class="card-topic-compact">Answer</h4>
                </div>
                <div class="card-preview-wrapper">
                  <div class="card-preview-text">${this.escapeHtml(truncatedSummary)}</div>
                  <span class="read-more-inline" data-card-index="${originalIndex}">Read more</span>
                </div>

                <div class="card-full-content" style="display: ${item.expanded ? 'block' : 'none'}">
                  <div class="card-summary">
                    <p>${this.escapeHtml(item.summary)}</p>
                  </div>

                  ${item.keyPoints && item.keyPoints.length > 0 ? `
                    <div class="card-section">
                      <h5>Key Points</h5>
                      <ul class="key-points-list">
                        ${item.keyPoints.map(point => `<li>${this.escapeHtml(point)}</li>`).join('')}
                      </ul>
                    </div>
                  ` : ''}

                  <div class="read-less-btn" data-card-index="${originalIndex}">Show less</div>
                </div>
              </div>
            </div>
          </div>
        `;
      } else {
        // Render as regular card
        let cardType = '';

        if (item.isAutoGenerated) {
          cardType = 'data-auto-generated="true"';
        }

        const truncatedSummary = truncateToTwoLines(item.summary);

        html += `
          <div class="context-card-compact ${item.expanded ? 'expanded' : ''}"
               data-index="${originalIndex}"
               data-id="${item.id}"
               ${cardType}>
            <div class="card-compact-header">
              <h4 class="card-topic-compact">${this.escapeHtml(item.topic)}</h4>
            </div>
            <div class="card-preview-wrapper">
              <div class="card-preview-text">${this.escapeHtml(truncatedSummary)}</div>
              <span class="read-more-inline" data-card-index="${originalIndex}">Read more</span>
            </div>

            <div class="card-full-content" style="display: ${item.expanded ? 'block' : 'none'}">
              <div class="card-summary">
                <p>${this.escapeHtml(item.summary)}</p>
              </div>

              ${item.keyPoints && item.keyPoints.length > 0 ? `
                <div class="card-section">
                  <h5>Key Points</h5>
                  <ul class="key-points-list">
                    ${item.keyPoints.map(point => `<li>${this.escapeHtml(point)}</li>`).join('')}
                  </ul>
                </div>
              ` : ''}

              ${item.useCase ? `
                <div class="card-section">
                  <h5>Use Case</h5>
                  <p class="use-case-text">${this.escapeHtml(item.useCase)}</p>
                </div>
              ` : ''}

              ${item.resources && item.resources.length > 0 ? `
                <div class="card-section">
                  <h5>Resources</h5>
                  <ul class="resources-list">
                    ${item.resources.map(resource => `<li>&#x1F4DA; ${this.escapeHtml(resource)}</li>`).join('')}
                  </ul>
                </div>
              ` : ''}

              <div class="read-less-btn" data-card-index="${originalIndex}">Show less</div>
            </div>
          </div>
        `;
      }
    });

    listContainer.innerHTML = html;
    console.log('✅ Items HTML rendered to DOM');
    console.log('📊 Total items rendered:', items.length);

    // Add click event listeners to inline Read More buttons
    const readMoreInlineBtns = listContainer.querySelectorAll('.read-more-inline');
    readMoreInlineBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.getAttribute('data-card-index'));
        this.toggleCard(index);
      });
    });

    // Add click event listeners to Show Less buttons
    const readLessBtns = listContainer.querySelectorAll('.read-less-btn');
    readLessBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.getAttribute('data-card-index'));
        this.toggleCard(index);
      });
    });

    // Scroll to bottom to show latest items
    const sidebarContent = listContainer.closest('.sidebar-content');
    if (sidebarContent) {
      sidebarContent.scrollTop = sidebarContent.scrollHeight;
    }
  }

  /**
   * Render regular cards (non-chat) - DEPRECATED, kept for compatibility
   */
  renderRegularCards(cards, listContainer) {
    // Helper function to truncate text to max two lines
    const truncateToTwoLines = (text, maxLength = 120) => {
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength) + '...';
    };

    // Helper function to generate card HTML
    const generateCardHTML = (card, originalIndex) => {
      let cardType = '';
      let cardIcon = '📘';

      if (card.isAutoGenerated) {
        cardType = 'data-auto-generated="true"';
        cardIcon = '💡';
      }

      // Truncate summary to max 2 lines
      const truncatedSummary = truncateToTwoLines(card.summary);

      return `
      <div class="context-card-compact ${card.expanded ? 'expanded' : ''}"
           data-index="${originalIndex}"
           data-id="${card.id}"
           ${cardType}>
        <div class="card-compact-header">
          <span class="card-icon-compact">${cardIcon}</span>
          <h4 class="card-topic-compact">${this.escapeHtml(card.topic)}</h4>
        </div>
        <div class="card-preview-text">${this.escapeHtml(truncatedSummary)}</div>
        <div class="read-more-btn" data-card-index="${originalIndex}">Read more</div>

        <div class="card-full-content" style="display: ${card.expanded ? 'block' : 'none'}">
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
                ${card.resources.map(resource => `<li>&#x1F4DA; ${this.escapeHtml(resource)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          <div class="read-less-btn" data-card-index="${originalIndex}">Show less</div>
        </div>
      </div>
      `;
    };

    // Build the HTML - all cards in one flow
    let html = '';
    cards.forEach((card) => {
      const originalIndex = this.contextualCards.indexOf(card);
      html += generateCardHTML(card, originalIndex);
    });

    listContainer.innerHTML = html;
    console.log('✅ Cards HTML rendered to DOM');
    console.log('📊 Total cards rendered:', cards.length);

    // Add click event listeners to Read More buttons
    const readMoreBtns = listContainer.querySelectorAll('.read-more-btn');
    readMoreBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.getAttribute('data-card-index'));
        this.toggleCard(index);
      });
    });

    // Add click event listeners to Show Less buttons
    const readLessBtns = listContainer.querySelectorAll('.read-less-btn');
    readLessBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.getAttribute('data-card-index'));
        this.toggleCard(index);
      });
    });

    // Scroll to bottom to show latest cards
    listContainer.scrollTop = listContainer.scrollHeight;
  }

  /**
   * Render chat messages
   */
  renderChatMessages(chatMessages, chatContainer) {
    // Helper function to truncate text to max two lines
    const truncateToTwoLines = (text, maxLength = 120) => {
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength) + '...';
    };

    let html = '';

    chatMessages.forEach((message, index) => {
      // Extract question from topic (remove the emoji prefix if present)
      const question = message.topic.replace(/^💬\s*/, '');
      const originalIndex = this.contextualCards.indexOf(message);
      const truncatedSummary = truncateToTwoLines(message.summary);

      html += `
        <div class="chat-message-pair">
          <div class="chat-question">
            <div class="chat-bubble chat-bubble-question">
              ${this.escapeHtml(question)}
            </div>
          </div>
          <div class="chat-answer">
            <div class="chat-bubble chat-bubble-answer ${message.expanded ? 'expanded' : ''}">
              <div class="chat-preview-text">${this.escapeHtml(truncatedSummary)}</div>
              <div class="chat-read-more-btn" data-chat-index="${originalIndex}">Read more</div>

              <div class="chat-full-content" style="display: ${message.expanded ? 'block' : 'none'}">
                <p>${this.escapeHtml(message.summary)}</p>
                ${message.keyPoints && message.keyPoints.length > 0 ? `
                  <ul class="chat-key-points">
                    ${message.keyPoints.map(point => `<li>${this.escapeHtml(point)}</li>`).join('')}
                  </ul>
                ` : ''}
                <div class="chat-read-less-btn" data-chat-index="${originalIndex}">Show less</div>
              </div>
            </div>
          </div>
        </div>
      `;
    });

    chatContainer.innerHTML = html;

    // Add click event listeners to Read More buttons
    const readMoreBtns = chatContainer.querySelectorAll('.chat-read-more-btn');
    readMoreBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.getAttribute('data-chat-index'));
        this.toggleCard(index);
      });
    });

    // Add click event listeners to Show Less buttons
    const readLessBtns = chatContainer.querySelectorAll('.chat-read-less-btn');
    readLessBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.getAttribute('data-chat-index'));
        this.toggleCard(index);
      });
    });

    // Scroll to bottom to show latest messages
    chatContainer.scrollTop = chatContainer.scrollHeight;
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
    const listeningIndicator = document.getElementById('listeningIndicator');
    const startBtn = document.getElementById('sidebarStartBtn');
    const stopBtn = document.getElementById('sidebarStopBtn');

    if (listeningIndicator) {
      if (isRecording) {
        listeningIndicator.style.display = 'flex';
        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'inline-block';
      } else {
        listeningIndicator.style.display = 'none';
        if (startBtn) startBtn.style.display = 'inline-block';
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
    console.log('=== Starting Speech Recognition for ALL Participants ===');

    // Method 1: Capture Google Meet captions (captures ALL participants including you)
    this.startMeetCaptionCapture();

    // Method 2: ALSO capture your microphone (backup + real-time supplement)
    this.startMicrophoneRecognition();

    // Set up buffer processing for all captured speech
    this.setupBufferProcessing();
  }

  /**
   * Capture Google Meet's built-in captions to get all participants' speech
   */
  startMeetCaptionCapture() {
    console.log('🎯 Starting Google Meet caption capture for ALL participants...');
    console.log('👥 This will capture speech from EVERYONE in the meeting');

    // Try to enable Google Meet captions programmatically
    this.enableMeetCaptions();

    // Store the last processed caption to avoid duplicates
    this.lastCaptionText = '';
    this.lastCaptionTime = 0;

    // Try multiple approaches to find captions
    this.tryFindExistingCaptions();

    // Monitor caption elements that Google Meet creates
    const captionObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        // CRITICAL: Skip mutations from our own sidebar
        if (mutation.target.closest?.('#syncup-sidebar') ||
            mutation.target.closest?.('.syncup-sidebar') ||
            mutation.target.id === 'syncup-sidebar') {
          return;
        }

        // Method 1: Check for text changes in existing nodes
        if (mutation.type === 'characterData') {
          const element = mutation.target.parentElement;
          if (element && !element.closest('#syncup-sidebar')) {
            const text = element.textContent?.trim();
            if (text && text.length > 3) {
              this.processDiscoveredCaption(element, text, 'characterData');
            }
          }
        }

        // Method 2: Check newly added nodes
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            // Skip our sidebar
            if (node.id === 'syncup-sidebar' || node.closest?.('#syncup-sidebar')) {
              return;
            }

            const text = node.textContent?.trim();

            // Check if this looks like a caption container
            const isLikelyCaptionElement =
              node.getAttribute?.('aria-live') === 'polite' ||
              node.className?.includes?.('caption') ||
              node.className?.includes?.('subtitle') ||
              (text && text.length > 5 && text.length < 500);

            if (isLikelyCaptionElement && text) {
              this.processDiscoveredCaption(node, text, 'addedNode');
            }

            // Also check children (but skip sidebar children)
            const captionElements = node.querySelectorAll?.('[aria-live="polite"], [class*="caption"], [class*="subtitle"], span, div');
            captionElements?.forEach((element) => {
              if (!element.closest('#syncup-sidebar')) {
                const childText = element.textContent?.trim();
                if (childText && childText.length > 3) {
                  this.processDiscoveredCaption(element, childText, 'childNode');
                }
              }
            });
          }
        });
      });
    });

    // Observe the entire document for caption changes
    captionObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    this.captionObserver = captionObserver;
    console.log('✅ Caption observer started - will capture ALL participants speech');
    console.log('💡 IMPORTANT: Press "C" to enable Google Meet captions for all participants');

    // Periodic check for captions
    this.captionCheckInterval = setInterval(() => {
      this.tryFindExistingCaptions();
    }, 5000);
  }

  /**
   * Try to find existing caption elements on the page
   */
  tryFindExistingCaptions() {
    // Comprehensive selectors for Google Meet captions
    const selectors = [
      '[aria-live="polite"]',
      '[class*="caption"]',
      '[class*="subtitle"]',
      '[jsname*="dsyhz"]', // Known Google Meet caption jsname
      '.a4cQT', // Another known caption class
      '[data-promo-anchor-id="caption"]'
    ];

    selectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        console.log(`🔍 Found ${elements.length} potential caption elements with selector: ${selector}`);
        elements.forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.length > 3) {
            console.log('📋 Caption element text:', text);
          }
        });
      }
    });
  }

  /**
   * Process discovered caption with deduplication
   */
  processDiscoveredCaption(element, text, source) {
    const now = Date.now();

    // CRITICAL: Ignore text from our own sidebar to prevent feedback loop
    if (element.closest('#syncup-sidebar') || element.closest('.syncup-sidebar')) {
      return; // Skip processing - this is our own UI
    }

    // Avoid duplicate processing (same text within 2 seconds)
    if (text !== this.lastCaptionText || now - this.lastCaptionTime > 2000) {
      console.log(`📝 Caption from ${source}:`, text);
      this.lastCaptionText = text;
      this.lastCaptionTime = now;
      this.processCaptionText(text);
    }
  }

  /**
   * Try to enable Google Meet captions automatically
   */
  enableMeetCaptions() {
    try {
      console.log('🔍 Searching for captions button to enable...');

      // Multiple selectors for finding captions button
      const selectors = [
        '[aria-label*="captions" i]',
        '[aria-label*="subtitles" i]',
        '[aria-label*="Turn on captions" i]',
        '[data-tooltip*="captions" i]',
        '[data-tooltip*="subtitles" i]',
        'button[jsname*="caption" i]',
        'button[jsname*="subtitle" i]'
      ];

      let captionButton = null;

      for (const selector of selectors) {
        const buttons = document.querySelectorAll(selector);
        if (buttons.length > 0) {
          captionButton = buttons[0];
          console.log('✅ Found caption button with selector:', selector);
          break;
        }
      }

      if (captionButton) {
        const isEnabled = captionButton.getAttribute('aria-pressed') === 'true' ||
                         captionButton.classList.contains('active') ||
                         captionButton.getAttribute('data-is-muted') === 'false';

        if (!isEnabled) {
          console.log('🔘 Enabling Google Meet captions for ALL participants...');
          captionButton.click();
          console.log('✅ Captions enabled - will now capture ALL participants speech');
        } else {
          console.log('✅ Captions already enabled');
        }
      } else {
        console.log('⚠️ Captions button not found. Please enable captions manually:');
        console.log('   1. Click the three dots menu in Google Meet');
        console.log('   2. Select "Turn on captions" or "Captions (c)"');
        console.log('   3. This will capture speech from ALL participants');
      }
    } catch (error) {
      console.log('⚠️ Could not auto-enable captions:', error.message);
      console.log('💡 Please enable captions manually for best results');
    }
  }

  /**
   * Process caption text from Google Meet
   */
  processCaptionText(text) {
    // Filter out Google Meet UI noise
    const uiNoisePatterns = [
      /BETA/gi,
      /format_size/gi,
      /Font (size|color)/gi,
      /Default|Tiny|Small|Medium|Large|Huge|Jumbo/gi,
      /White|Black|Blue|Green|Red|Yellow|Cyan|Magenta/gi,
      /Open caption settings/gi,
      /Jump to bottom/gi,
      /arrow_downward/gi,
      /close|circle|settings/gi,
      /language/gi,
      /English|Hindi|Spanish|French|German|Chinese/gi,
      /\(India\)|\(South Africa\)|\(Brazil\)|\(Spain\)/gi
    ];

    // Check if this looks like UI noise
    let isUIText = false;
    for (const pattern of uiNoisePatterns) {
      if (pattern.test(text)) {
        isUIText = true;
        break;
      }
    }

    // Ignore very short text or UI noise
    if (isUIText || text.trim().length < 5) {
      console.log('🚫 Ignored UI noise or short text:', text.substring(0, 30));
      return;
    }

    // ONLY add to buffer - DO NOT process immediately
    this.transcriptBuffer += text + ' ';
    this.meetingTranscript += text + ' ';

    // Keep only last 8000 characters to avoid API limits (approx 2000 tokens)
    if (this.meetingTranscript.length > 8000) {
      this.meetingTranscript = this.meetingTranscript.slice(-8000);
      console.log('📏 Trimmed meeting transcript to last 8000 chars');
    }

    console.log('✅ Added caption to buffer:', text.substring(0, 50));
    console.log('📊 Meeting transcript now:', this.meetingTranscript.length, 'chars');

    // Wake word feature removed - questions only via chatbox
  }

  /**
   * Start microphone-based recognition to capture YOUR voice in real-time
   */
  startMicrophoneRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.error('❌ Speech recognition not supported in this browser');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();

    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US'; // Will also try to recognize Hindi

    console.log('✅ Microphone recognition configured - will capture YOUR voice');
    console.log('📢 Browser will request microphone permission...');

    this.recognition.onstart = () => {
      console.log('🎤 Microphone recognition STARTED - Capturing your voice');
    };

    this.recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        const isFinal = event.results[i].isFinal;

        if (isFinal) {
          console.log('🎤 YOUR VOICE (microphone):', transcript);

          // ONLY add to buffer for 15-second processing, DO NOT process immediately
          this.transcriptBuffer += transcript + ' ';
          this.meetingTranscript += transcript + ' ';

          // Keep only last 8000 characters to avoid API limits
          if (this.meetingTranscript.length > 8000) {
            this.meetingTranscript = this.meetingTranscript.slice(-8000);
            console.log('📏 Trimmed meeting transcript to last 8000 chars');
          }

          console.log('✅ Added YOUR voice to buffer');
          console.log('📊 Meeting transcript now:', this.meetingTranscript.length, 'chars');
        }
      }
    };

    this.recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        console.log('⚠️ Microphone permission denied - will rely on captions only');
      } else if (event.error === 'no-speech') {
        // Ignore no-speech errors, just restart
        setTimeout(() => {
          if (this.isRecording && this.recognition) {
            try { this.recognition.start(); } catch (e) {}
          }
        }, 1000);
      }
    };

    this.recognition.onend = () => {
      // Auto-restart if still recording
      if (this.isRecording) {
        setTimeout(() => {
          if (this.recognition) {
            try { this.recognition.start(); } catch (e) {}
          }
        }, 500);
      }
    };

    try {
      this.recognition.start();
      console.log('🎤 Microphone recognition started');
    } catch (error) {
      console.log('⚠️ Could not start microphone:', error.message);
      console.log('💡 Will rely on captions for all participants');
    }
  }

  /**
   * Set up buffer processing for captured speech
   */
  setupBufferProcessing() {
    console.log('⏱️ Setting up buffer processing...');
    console.log('💡 Speech from ALL participants (captions + your mic) will be processed every 15 seconds');

    // Clear any existing buffer
    this.transcriptBuffer = '';

    // Set up interval to process buffer every 15 seconds
    this.bufferInterval = setInterval(() => {
      if (this.transcriptBuffer.trim().length > 0) {
        console.log('⏰ 15 seconds elapsed - Processing conversation from ALL participants:', this.transcriptBuffer);

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
        console.log('⏰ 15 seconds elapsed - No conversation detected from any participant');
      }
    }, 15000); // 15 seconds

    console.log('✅ Buffer processing setup complete - capturing ALL participants');
  }

  stopSpeechRecognition() {
    console.log('🛑 Stopping speech recognition for all participants...');

    // Stop microphone recognition
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
      console.log('✅ Microphone recognition stopped');
    }

    // Stop caption observer
    if (this.captionObserver) {
      this.captionObserver.disconnect();
      this.captionObserver = null;
      console.log('✅ Caption observer stopped');
    }

    // Clear caption check interval
    if (this.captionCheckInterval) {
      clearInterval(this.captionCheckInterval);
      this.captionCheckInterval = null;
      console.log('✅ Caption check interval stopped');
    }

    // Clear buffer interval
    if (this.bufferInterval) {
      clearInterval(this.bufferInterval);
      this.bufferInterval = null;
      console.log('✅ Buffer processing stopped');
    }

    console.log('🔇 Speech recognition stopped for all participants');
  }

  /**
   * Start always-on caption capture (for chatbox - works even when not recording)
   */
  startAlwaysOnCaptionCapture() {
    console.log('🔄 Starting always-on caption capture for chatbox...');

    // Try to enable captions
    this.enableMeetCaptions();

    // Monitor captions continuously for chatbox context
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'characterData') {
          const element = mutation.target.parentElement;
          if (element) {
            const text = element.textContent?.trim();
            if (text && text.length > 3) {
              // Only add to meeting transcript (for chatbox), not buffer
              this.meetingTranscript += text + ' ';

              // Keep only last 8000 characters to avoid API limits
              if (this.meetingTranscript.length > 8000) {
                this.meetingTranscript = this.meetingTranscript.slice(-8000);
                console.log('📏 [Always-On] Trimmed transcript to last 8000 chars');
              }

              console.log('📝 [Always-On] Caption captured:', text.substring(0, 50));
              console.log('📊 [Always-On] Total transcript:', this.meetingTranscript.length, 'chars');
            }
          }
        }

        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            const text = node.textContent?.trim();
            const isLikelyCaptionElement =
              node.getAttribute?.('aria-live') === 'polite' ||
              node.className?.includes?.('caption') ||
              node.className?.includes?.('subtitle') ||
              (text && text.length > 5 && text.length < 500);

            if (isLikelyCaptionElement && text) {
              // Only add to meeting transcript (for chatbox), not buffer
              this.meetingTranscript += text + ' ';

              // Keep only last 8000 characters to avoid API limits
              if (this.meetingTranscript.length > 8000) {
                this.meetingTranscript = this.meetingTranscript.slice(-8000);
                console.log('📏 [Always-On] Trimmed transcript to last 8000 chars');
              }

              console.log('📝 [Always-On] Caption captured:', text.substring(0, 50));
              console.log('📊 [Always-On] Total transcript:', this.meetingTranscript.length, 'chars');
            }
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    this.alwaysOnCaptionObserver = observer;
    console.log('✅ Always-on caption capture running (chatbox will always work)');
  }

  /**
   * Setup chatbox event listeners
   */
  setupChatbox() {
    const chatInput = document.getElementById('chatbox-input');
    const sendBtn = document.getElementById('chatbox-send-btn');

    if (!chatInput || !sendBtn) {
      console.error('Chatbox elements not found');
      return;
    }

    // Handle send button click
    sendBtn.addEventListener('click', () => {
      this.sendChatQuestion();
    });

    // Handle Enter key press
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendChatQuestion();
      }
    });

    console.log('✅ Chatbox setup complete');
  }

  /**
   * Send question from chatbox - works like normal AI with meeting context awareness
   */
  sendChatQuestion() {
    const chatInput = document.getElementById('chatbox-input');
    const question = chatInput.value.trim();

    if (!question) {
      console.log('⚠️ Empty question, ignoring');
      return;
    }

    console.log('═══════════════════════════════════════');
    console.log('💬 CHATBOX QUESTION');
    console.log('Question:', question);
    console.log('Meeting transcript length:', this.meetingTranscript.length, 'characters');
    console.log('Meeting transcript preview:', this.meetingTranscript.substring(0, 200));
    console.log('Is recording:', this.isRecording);
    console.log('═══════════════════════════════════════');

    // Send to background - AI will use meeting context if relevant, otherwise answer generally
    chrome.runtime.sendMessage({
      type: 'CHATBOX_QUESTION',
      question: question,
      meetingContext: this.meetingTranscript || ''
    }, (response) => {
      console.log('📬 Chatbox response received:', response);

      if (chrome.runtime.lastError) {
        console.error('❌ Chrome runtime error:', chrome.runtime.lastError);
        return;
      }

      if (response && response.success) {
        console.log('✅ Chatbox question answered successfully');
        chatInput.value = ''; // Clear input
      } else if (response && response.error) {
        console.error('❌ Chatbox error:', response.error);
        // Show error card
        const errorCard = {
          id: Date.now() + Math.random(),
          topic: `💬 ${question}`,
          timestamp: new Date().toLocaleTimeString(),
          summary: `Error: ${response.error}. Please try again.`,
          keyPoints: ['Check your internet connection', 'Verify API keys are configured'],
          useCase: 'An error occurred',
          resources: ['Try again'],
          expanded: true,
          isChatboxAnswer: true
        };
        this.contextualCards.push(errorCard);
        this.updateContextualCards(this.contextualCards);
        chatInput.value = '';
      } else {
        console.warn('⚠️ Unexpected response format:', response);
      }
    });
  }

}

// Initialize the sidebar when script loads
if (document.location.hostname === 'meet.google.com') {
  console.log('📢 SyncUp content script loaded on Google Meet');
  const sidebar = new SyncUpSidebar();
  console.log('✅ SyncUp sidebar instance created');
}