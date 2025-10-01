/**
 * Meet-Actions Content Script
 * Injects sidebar into Google Meet for displaying real-time action items
 */

class MeetActionsSidebar {
  constructor() {
    this.isInjected = false;
    this.actionItems = [];
    this.sidebarElement = null;
    this.isRecording = false;
    
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

    console.log('Attempting to inject sidebar...');

    // Always inject into document.body for maximum compatibility
    const meetContainer = document.body;

    if (!meetContainer) {
      console.log('Body not ready, retrying...');
      setTimeout(() => this.injectSidebar(), 1000);
      return;
    }

    // Create sidebar container
    this.sidebarElement = document.createElement('div');
    this.sidebarElement.id = 'meet-actions-sidebar';
    this.sidebarElement.className = 'meet-actions-sidebar';

    // Sidebar HTML structure
    this.sidebarElement.innerHTML = `
      <div class="sidebar-header">
        <h3>📋 Action Items</h3>
        <div class="recording-status">
          <span class="status-indicator"></span>
          <span class="status-text">Standby</span>
        </div>
      </div>
      <div class="sidebar-content">
        <div class="action-items-list" id="action-items-list">
          <div class="placeholder">
            <p>🎯 Action items will appear here when recording starts</p>
            <p class="help-text">Click the extension icon to start capturing</p>
          </div>
        </div>
      </div>
      <div class="sidebar-footer">
        <div class="powered-by">
          ⚡ Powered by Cerebras + Llama
        </div>
      </div>
    `;

    // Inject into the page
    document.body.appendChild(this.sidebarElement);
    this.isInjected = true;

    console.log('Meet-Actions: Sidebar injected successfully');
    
    // Force immediate visibility for demo
    setTimeout(() => {
      if (this.sidebarElement) {
        this.sidebarElement.style.display = 'flex';
        this.sidebarElement.style.zIndex = '999999';
        console.log('Meet-Actions: Sidebar visibility forced');
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
      case 'NEW_ACTION_ITEMS':
        this.updateActionItems(message.actionItems);
        break;
      
      case 'RECORDING_STATUS':
        this.updateRecordingStatus(message.isRecording);
        break;
      
      case 'CLEAR_ACTION_ITEMS':
        this.clearActionItems();
        break;
      
      case 'GET_SIDEBAR_STATUS':
        sendResponse({ 
          isInjected: this.isInjected,
          isRecording: this.isRecording,
          actionItemsCount: this.actionItems.length
        });
        break;
    }
  }

  /**
   * Update the action items display
   */
  updateActionItems(newActionItems) {
    this.actionItems = newActionItems;
    const listContainer = document.getElementById('action-items-list');
    
    if (!listContainer) return;

    if (this.actionItems.length === 0) {
      listContainer.innerHTML = `
        <div class="placeholder">
          <p>🎯 Listening for action items...</p>
          <p class="help-text">Action items will appear as they're detected</p>
        </div>
      `;
      return;
    }

    // Generate action items HTML
    const itemsHTML = this.actionItems.map((item, index) => `
      <div class="action-item" data-index="${index}">
        <div class="action-header">
          <span class="action-number">#${index + 1}</span>
          <span class="action-timestamp">${item.timestamp || 'Now'}</span>
        </div>
        <div class="action-content">
          <div class="action-text">${this.escapeHtml(item.action)}</div>
          ${item.assignee ? `<div class="action-assignee">👤 ${this.escapeHtml(item.assignee)}</div>` : ''}
          ${item.priority ? `<div class="action-priority priority-${item.priority}">${item.priority.toUpperCase()}</div>` : ''}
        </div>
      </div>
    `).join('');

    listContainer.innerHTML = itemsHTML;
    
    // Scroll to bottom to show latest items
    listContainer.scrollTop = listContainer.scrollHeight;
  }

  /**
   * Update recording status indicator
   */
  updateRecordingStatus(isRecording) {
    this.isRecording = isRecording;
    const statusIndicator = document.querySelector('.status-indicator');
    const statusText = document.querySelector('.status-text');
    
    if (statusIndicator && statusText) {
      if (isRecording) {
        statusIndicator.className = 'status-indicator recording';
        statusText.textContent = 'Recording';
      } else {
        statusIndicator.className = 'status-indicator';
        statusText.textContent = 'Standby';
      }
    }
  }

  /**
   * Clear all action items
   */
  clearActionItems() {
    this.actionItems = [];
    this.updateActionItems([]);
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
      if (this.isInjected && !document.getElementById('meet-actions-sidebar')) {
        this.isInjected = false;
        setTimeout(() => this.injectSidebar(), 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}

// Initialize the sidebar when script loads
if (document.location.hostname === 'meet.google.com') {
  new MeetActionsSidebar();
}