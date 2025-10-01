/**
 * Meet-Actions Popup Controller
 * Handles start/stop controls and displays session statistics
 */

class MeetActionsPopup {
  constructor() {
    this.isRecording = false;
    this.actionItemsCount = 0;
    this.sessionStartTime = null;
    this.sessionTimer = null;
    
    this.initElements();
    this.bindEvents();
    this.updateStatus();
  }

  /**
   * Initialize DOM elements
   */
  initElements() {
    this.statusIndicator = document.getElementById('statusIndicator');
    this.statusTitle = document.getElementById('statusTitle');
    this.statusSubtitle = document.getElementById('statusSubtitle');
    this.startBtn = document.getElementById('startBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.clearBtn = document.getElementById('clearBtn');
    this.actionCount = document.getElementById('actionCount');
    this.sessionTime = document.getElementById('sessionTime');
    this.errorMessage = document.getElementById('errorMessage');
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    this.startBtn.addEventListener('click', () => this.startRecording());
    this.stopBtn.addEventListener('click', () => this.stopRecording());
    this.clearBtn.addEventListener('click', () => this.clearActionItems());
    
    // Update status every second when recording
    setInterval(() => {
      if (this.isRecording && this.sessionStartTime) {
        this.updateSessionTime();
      }
    }, 1000);
  }

  /**
   * Update the current status from background script
   */
  async updateStatus() {
    try {
      const response = await this.sendMessageToBackground('GET_STATUS');
      
      if (response.error) {
        this.showError(response.error);
        return;
      }

      this.isRecording = response.isRecording || false;
      this.actionItemsCount = response.actionItemsCount || 0;
      
      this.updateUI();
      this.hideError();
      
    } catch (error) {
      console.error('Failed to update status:', error);
      this.showError('Failed to connect to extension service');
    }
  }

  /**
   * Start recording action items
   */
  async startRecording() {
    try {
      // Check if we're on a Google Meet page
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab.url || !tab.url.includes('meet.google.com')) {
        this.showError('Please navigate to a Google Meet page first');
        return;
      }

      this.setLoading(true);
      this.hideError();
      
      const response = await this.sendMessageToBackground('START_RECORDING');
      
      if (response.error) {
        this.showError(response.error);
        this.setLoading(false);
        return;
      }

      this.isRecording = true;
      this.sessionStartTime = Date.now();
      this.updateUI();
      this.setLoading(false);
      
      console.log('Recording started successfully');
      
    } catch (error) {
      console.error('Failed to start recording:', error);
      this.showError('Failed to start recording');
      this.setLoading(false);
    }
  }

  /**
   * Stop recording action items
   */
  async stopRecording() {
    try {
      this.setLoading(true);
      this.hideError();
      
      const response = await this.sendMessageToBackground('STOP_RECORDING');
      
      if (response.error) {
        this.showError(response.error);
        this.setLoading(false);
        return;
      }

      this.isRecording = false;
      this.sessionStartTime = null;
      this.updateUI();
      this.setLoading(false);
      
      console.log('Recording stopped successfully');
      
    } catch (error) {
      console.error('Failed to stop recording:', error);
      this.showError('Failed to stop recording');
      this.setLoading(false);
    }
  }

  /**
   * Clear all action items
   */
  async clearActionItems() {
    try {
      if (!confirm('Are you sure you want to clear all action items?')) {
        return;
      }

      this.setLoading(true);
      this.hideError();
      
      const response = await this.sendMessageToBackground('CLEAR_ACTION_ITEMS');
      
      if (response.error) {
        this.showError(response.error);
        this.setLoading(false);
        return;
      }

      this.actionItemsCount = 0;
      this.updateUI();
      this.setLoading(false);
      
      console.log('Action items cleared successfully');
      
    } catch (error) {
      console.error('Failed to clear action items:', error);
      this.showError('Failed to clear action items');
      this.setLoading(false);
    }
  }

  /**
   * Update the UI based on current state
   */
  updateUI() {
    // Update status indicator
    if (this.isRecording) {
      this.statusIndicator.classList.add('recording');
      this.statusTitle.textContent = 'Recording';
      this.statusSubtitle.textContent = 'Capturing and analyzing conversation';
      
      this.startBtn.style.display = 'none';
      this.stopBtn.style.display = 'block';
    } else {
      this.statusIndicator.classList.remove('recording');
      this.statusTitle.textContent = 'Standby';
      this.statusSubtitle.textContent = 'Ready to capture action items';
      
      this.startBtn.style.display = 'block';
      this.stopBtn.style.display = 'none';
    }

    // Update action items count
    this.actionCount.textContent = this.actionItemsCount;

    // Update session time
    this.updateSessionTime();
  }

  /**
   * Update session time display
   */
  updateSessionTime() {
    if (!this.sessionStartTime) {
      this.sessionTime.textContent = '00:00';
      return;
    }

    const elapsed = Math.floor((Date.now() - this.sessionStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    
    this.sessionTime.textContent = 
      `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Set loading state
   */
  setLoading(loading) {
    const content = document.querySelector('.content');
    if (loading) {
      content.classList.add('loading');
    } else {
      content.classList.remove('loading');
    }
  }

  /**
   * Show error message
   */
  showError(message) {
    this.errorMessage.textContent = message;
    this.errorMessage.style.display = 'block';
  }

  /**
   * Hide error message
   */
  hideError() {
    this.errorMessage.style.display = 'none';
  }

  /**
   * Send message to background script
   */
  async sendMessageToBackground(type, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response || {});
        }
      });
    });
  }

  /**
   * Check if current tab is Google Meet
   */
  async isOnGoogleMeet() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab.url && tab.url.includes('meet.google.com');
    } catch (error) {
      return false;
    }
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new MeetActionsPopup();
});