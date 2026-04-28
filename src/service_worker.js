// Enhanced Service Worker for ConsentSync
class ConsentSyncServiceWorker {
  constructor() {
    this.monitoringData = new Map();
    this.setupMessageHandlers();
    this.setupEventListeners();
  }

  setupMessageHandlers() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'FETCH_POLICY':
          this.fetchPrivacyPolicy(message.url).then(sendResponse);
          return true;
        
        case 'LEARN_ACTION':
          this.learnUserAction(message);
          break;
        
        case 'AUTO_GET_RULES':
          this.getAutomationRules().then(sendResponse);
          return true;
        
        case 'AUTO_RESET':
          this.resetAutomation().then(() => sendResponse(true));
          return true;
        
        case 'GET_MONITORING_DATA':
          sendResponse(Array.from(this.monitoringData.values()));
          break;
        
        case 'CLEAR_MONITORING_DATA':
          this.monitoringData.clear();
          sendResponse(true);
          break;
        
        case 'ADD_CONSENT_LOG':
          this.addConsentLog(message.logEntry);
          sendResponse(true);
          break;
        
        case 'GET_CONSENT_LOG':
          this.getConsentLog().then(sendResponse);
          return true;
        
        case 'CLEAR_CONSENT_LOG':
          this.clearConsentLog().then(() => sendResponse(true));
          return true;
        
        case 'UPDATE_SMART_PREFERENCE':
          this.updateSmartPreference(message.preference, message.value);
          sendResponse(true);
          break;
        
        case 'GET_SMART_PREFERENCES':
          this.getSmartPreferences().then(sendResponse);
          return true;
      }
    });
  }

  setupEventListeners() {
    // Monitor tab updates for real-time tracking
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'loading' && tab.url && /^https?:/.test(tab.url)) {
        this.handleTabUpdate(tab);
      }
    });

    // Monitor permission changes
    chrome.webNavigation.onCompleted.addListener((details) => {
      this.recordSiteVisit(details.url);
    });

    // Monitor cookie changes
    chrome.cookies.onChanged.addListener((changeInfo) => {
      this.recordCookieChange(changeInfo);
    });

    // Apply automation rules when tabs load
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'loading' && tab.url && /^https?:/.test(tab.url)) {
        this.applyAutomationRules(tab.url);
      }
    });

    // Auto-clean alarm lifecycle: react when user changes autoClean or autoCleanTime in popup
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && (changes.autoClean || changes.autoCleanTime)) {
        this.applyAutoCleanSchedule();
      }
    });

    // Auto-clean execution: when the alarm fires, delete cookies if autoClean is enabled.
    // (Alarm scheduling/updates are handled by applyAutoCleanSchedule + storage.onChanged.)
    chrome.alarms.onAlarm.addListener((alarm) => {
      // Fire-and-forget async handler; errors are logged but should not crash the worker.
      this.handleAutoCleanAlarm(alarm).catch((err) => {
        console.error('Auto-clean alarm handler failed:', err);
      });
    });
  }

  /**
   * Apply auto-clean schedule from chrome.storage.local.
   * - If autoClean is enabled: create/update "autoCleanCookies" alarm with period from autoCleanTime (hours).
   * - If autoClean is disabled: clear the alarm.
   * Called on startup, on install, and when autoClean or autoCleanTime changes in storage.
   */
  async applyAutoCleanSchedule() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['autoClean', 'autoCleanTime'], (result) => {
        const { autoClean, autoCleanTime } = result;
        const periodHours = Number(autoCleanTime) || 24;
        const periodInMinutes = Math.max(1, Math.round(periodHours * 60));

        if (autoClean) {
          // Create or replace alarm: same name updates the existing alarm with new period
          chrome.alarms.create('autoCleanCookies', { periodInMinutes });
        } else {
          chrome.alarms.clear('autoCleanCookies');
        }
        resolve();
      });
    });
  }

  /**
   * Auto-clean flow:
   * 1) Only handle the "autoCleanCookies" alarm
   * 2) Re-check autoClean from storage (user may have turned it off)
   * 3) If enabled: delete all cookies via chrome.cookies.getAll({}) + chrome.cookies.remove()
   * 4) Write a consent log entry with the number of cookies cleared
   *
   * Cookie deletion is intentionally simple and deterministic (no filtering yet).
   * @param {{ name: string }} alarm
   */
  async handleAutoCleanAlarm(alarm) {
    if (!alarm || alarm.name !== 'autoCleanCookies') return;

    const { autoClean } = await new Promise((resolve) => {
      chrome.storage.local.get(['autoClean'], (result) => resolve(result || {}));
    });

    // If user disabled auto-clean, do nothing.
    if (autoClean !== true) return;

    const cookies = await new Promise((resolve) => {
      chrome.cookies.getAll({}, (allCookies) => resolve(allCookies || []));
    });

    let removedCount = 0;

    for (const cookie of cookies) {
      try {
        // chrome.cookies.remove requires a full URL that matches the cookie's scope.
        const protocol = cookie.secure ? 'https:' : 'http:';
        const domain = (cookie.domain || '').startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
        const path = cookie.path || '/';
        const url = `${protocol}//${domain}${path}`;

        const removed = await new Promise((resolve) => {
          chrome.cookies.remove(
            { url, name: cookie.name, storeId: cookie.storeId },
            (details) => resolve(details)
          );
        });

        if (removed) removedCount += 1;
      } catch (e) {
        // Keep going even if one cookie fails to remove.
      }
    }

    // Record that auto-clean ran (use consentLog for auditability).
    await this.addConsentLog({
      action: 'Auto-clean executed',
      details: `Removed ${removedCount} cookies`,
      type: 'auto_clean_executed',
      removedCount
    });
  }

  async fetchPrivacyPolicy(url) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
      }

      const raw = await response.text();
      const cleaned = this.cleanPolicyText(raw);

      // Default language metadata
      let policyLanguage = 'en';
      let policyLanguageLabel = 'English';
      let translatedPolicyText = null;

      try {
        const detection = this.detectPolicyLanguage(cleaned);
        if (detection && detection.code) {
          policyLanguage = detection.code;
          policyLanguageLabel = detection.label;
        }

        // Only attempt translation when language is confidently non-English
        if (policyLanguage !== 'en') {
          translatedPolicyText = await this.translatePolicyToEnglish(cleaned, policyLanguage);
        }
      } catch (e) {
        // Fail-safe: language detection or translation errors must not break existing flow.
        console.error('Policy language processing failed:', e);
        translatedPolicyText = null;
        policyLanguage = 'en';
        policyLanguageLabel = 'English';
      }

      const baseText = cleaned.slice(0, 20000);
      const translatedTextTrimmed = translatedPolicyText
        ? translatedPolicyText.slice(0, 20000)
        : null;

      return {
        ok: true,
        text: baseText,
        url: url,
        timestamp: new Date().toISOString(),
        policyLanguage,
        policyLanguageLabel,
        translatedPolicyText: translatedTextTrimmed
      };
    } catch (error) {
      console.error('Error fetching policy:', error);
      return { ok: false, error: error.message };
    }
  }

  cleanPolicyText(text) {
    return text
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/?[^>]+(>|$)/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }

  /**
   * Lightweight heuristic language detection for privacy policies.
   * Returns an object with a BCP-47 code and human-readable label.
   * Falls back to English if confidence is low.
   *
   * This is intentionally simple and deterministic to avoid external dependencies.
   */
  detectPolicyLanguage(text) {
    if (!text || typeof text !== 'string') {
      return { code: 'en', label: 'English' };
    }

    const sample = text.slice(0, 4000).toLowerCase();

    const profiles = [
      {
        code: 'en',
        label: 'English',
        words: ['the', 'and', 'for', 'with', 'your', 'data', 'privacy', 'policy']
      },
      {
        code: 'es',
        label: 'Spanish',
        words: ['el', 'la', 'los', 'las', 'de', 'y', 'para', 'datos', 'privacidad', 'política']
      },
      {
        code: 'fr',
        label: 'French',
        words: ['le', 'la', 'les', 'des', 'et', 'pour', 'données', 'confidentialité', 'politique']
      },
      {
        code: 'de',
        label: 'German',
        words: ['der', 'die', 'das', 'und', 'für', 'daten', 'datenschutz', 'richtlinie']
      },
      {
        code: 'it',
        label: 'Italian',
        words: ['il', 'la', 'i', 'gli', 'e', 'per', 'dati', 'privacy', 'informativa']
      },
      {
        code: 'pt',
        label: 'Portuguese',
        words: ['o', 'a', 'os', 'as', 'e', 'para', 'dados', 'privacidade', 'política']
      },
      {
        code: 'nl',
        label: 'Dutch',
        words: ['de', 'het', 'en', 'voor', 'gegevens', 'privacy', 'beleid']
      }
    ];

    let bestProfile = profiles[0];
    let bestScore = 0;

    const wordBoundary = (w) => new RegExp(`\\b${w}\\b`, 'g');

    profiles.forEach((profile) => {
      let score = 0;
      profile.words.forEach((w) => {
        const matches = sample.match(wordBoundary(w));
        if (matches) {
          score += matches.length;
        }
      });
      if (score > bestScore) {
        bestScore = score;
        bestProfile = profile;
      }
    });

    // If we have no clear signal for a non-English language, treat as English.
    if (bestProfile.code !== 'en' && bestScore >= 3) {
      return { code: bestProfile.code, label: bestProfile.label };
    }

    return { code: 'en', label: 'English' };
  }

  /**
   * Best-effort translation helper using a public translation service.
   * Returns translated English text or null if translation fails.
   * This is designed to be fail-safe: callers must gracefully handle null.
   */
  async translatePolicyToEnglish(text, sourceLang) {
    if (!text || typeof text !== 'string') return null;
    if (sourceLang === 'en') return null;

    try {
      // Many public translation APIs have payload limits; use a reasonably sized slice.
      const payload = text.slice(0, 8000);

      const response = await fetch('https://libretranslate.de/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          q: payload,
          // Let the service auto-detect the source language to keep behavior robust.
          source: 'auto',
          target: 'en',
          format: 'text'
        })
      });

      if (!response.ok) {
        console.warn('Translation request failed with status', response.status);
        return null;
      }

      const data = await response.json();
      if (data && typeof data.translatedText === 'string' && data.translatedText.trim().length > 0) {
        return data.translatedText;
      }

      return null;
    } catch (e) {
      console.error('Translation error:', e);
      return null;
    }
  }

  async learnUserAction(action) {
    try {
      const { cs_rules = {}, cs_stats = {} } = await this.getStoredData();
      const key = `${action.api}::global`;
      
      // Update statistics
      cs_stats[key] = (cs_stats[key] || 0) + (action.setting === 'block' ? 1 : -0.3);
      
      // Determine preference based on statistics
      const pref = cs_stats[key] >= 3 ? 'block' : (cs_stats[key] <= -1 ? 'allow' : 'prompt');
      cs_rules[key] = pref;
      
      await this.setStoredData({ cs_rules, cs_stats });
      
      // Record the learning action
      this.recordActivity({
        type: 'learning',
        action: action.setting,
        permission: action.api,
        pattern: action.pattern,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error learning user action:', error);
    }
  }

  async getAutomationRules() {
    try {
      const { cs_rules = {} } = await this.getStoredData();
      return cs_rules;
    } catch (error) {
      console.error('Error getting automation rules:', error);
      return {};
    }
  }

  async resetAutomation() {
    try {
      await this.setStoredData({ cs_rules: {}, cs_stats: {} });
      this.recordActivity({
        type: 'reset',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error resetting automation:', error);
    }
  }

  async applyAutomationRules(url) {
    try {
      const { cs_rules = {} } = await this.getStoredData();
      const host = this.extractHost(url);
      const pattern = `*://${host}/*`;

      // Apply global learned defaults
      const permissions = ['geolocation', 'camera', 'microphone', 'notifications'];
      
      for (const permission of permissions) {
        const pref = cs_rules[`${permission}::global`];
        if (pref === 'block' || pref === 'allow') {
          try {
            if (chrome.contentSettings && chrome.contentSettings[permission]) {
              chrome.contentSettings[permission].set({
                primaryPattern: pattern,
                setting: pref
              });
            }
          } catch (e) {
            console.log(`Could not apply ${permission} setting:`, e);
          }
        }
      }
    } catch (error) {
      console.error('Error applying automation rules:', error);
    }
  }

  handleTabUpdate(tab) {
    const host = this.extractHost(tab.url);
    if (!host) return;

    this.recordActivity({
      type: 'tab_update',
      host: host,
      url: tab.url,
      timestamp: new Date().toISOString()
    });
  }

  recordSiteVisit(url) {
    const host = this.extractHost(url);
    if (!host) return;

    const key = `visit_${host}`;
    const visitData = {
      host: host,
      url: url,
      timestamp: new Date().toISOString(),
      type: 'site_visit'
    };

    this.monitoringData.set(key, visitData);
    
    // Keep only last 100 entries
    if (this.monitoringData.size > 100) {
      const firstKey = this.monitoringData.keys().next().value;
      this.monitoringData.delete(firstKey);
    }
  }

  recordCookieChange(changeInfo) {
    const host = this.extractHost(changeInfo.cookie.domain);
    if (!host) return;

    const key = `cookie_${host}_${Date.now()}`;
    const cookieData = {
      host: host,
      cookie: changeInfo.cookie.name,
      action: changeInfo.removed ? 'removed' : 'added',
      timestamp: new Date().toISOString(),
      type: 'cookie_change'
    };

    this.monitoringData.set(key, cookieData);
  }

  recordActivity(activity) {
    const key = `activity_${Date.now()}`;
    this.monitoringData.set(key, activity);
  }

  // Consent Log Management
  async addConsentLog(logEntry) {
    try {
      const { consentLog = [] } = await this.getStoredLocalData();
      const entry = {
        ...logEntry,
        timestamp: new Date().toISOString(),
        id: Date.now()
      };
      
      consentLog.unshift(entry);
      
      // Keep only last 100 entries
      if (consentLog.length > 100) {
        consentLog.splice(100);
      }
      
      await this.setStoredLocalData({ consentLog });
    } catch (error) {
      console.error('Error adding consent log:', error);
    }
  }

  async getConsentLog() {
    try {
      const { consentLog = [] } = await this.getStoredLocalData();
      return consentLog;
    } catch (error) {
      console.error('Error getting consent log:', error);
      return [];
    }
  }

  async clearConsentLog() {
    try {
      await this.setStoredLocalData({ consentLog: [] });
    } catch (error) {
      console.error('Error clearing consent log:', error);
    }
  }

  // Smart Preferences Management
  async updateSmartPreference(preference, value) {
    try {
      const { smartPreferences = {} } = await this.getStoredData();
      smartPreferences[preference] = value;
      await this.setStoredData({ smartPreferences });
      
      // Record the preference update
      this.recordActivity({
        type: 'preference_update',
        preference,
        value,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error updating smart preference:', error);
    }
  }

  async getSmartPreferences() {
    try {
      const { smartPreferences = {} } = await this.getStoredData();
      return smartPreferences;
    } catch (error) {
      console.error('Error getting smart preferences:', error);
      return {};
    }
  }

  extractHost(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }

  async getStoredData() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['cs_rules', 'cs_stats', 'smartPreferences'], (data) => {
        resolve(data);
      });
    });
  }

  async setStoredData(data) {
    return new Promise((resolve) => {
      chrome.storage.sync.set(data, () => {
        resolve(true);
      });
    });
  }

  async getStoredLocalData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['consentLog'], (data) => {
        resolve(data);
      });
    });
  }

  async setStoredLocalData(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, () => {
        resolve(true);
      });
    });
  }
}

// Initialize the service worker
const serviceWorker = new ConsentSyncServiceWorker();

// On load: restore auto-clean alarm if user had it enabled (survives service worker restarts)
serviceWorker.applyAutoCleanSchedule();

// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
  console.log("ConsentSync v0.6.1 installed successfully");
  
  if (details.reason === 'install') {
    // First time installation
    chrome.storage.sync.set({
      cs_rules: {},
      cs_stats: {},
      version: '0.6.1',
      installDate: new Date().toISOString()
    });
  }
  // Recreate auto-clean alarm from saved settings (e.g. after extension update)
  serviceWorker.applyAutoCleanSchedule();
});

// Handle startup (browser restart): recreate alarm if autoClean was enabled
chrome.runtime.onStartup.addListener(() => {
  console.log("ConsentSync v0.6.1 started");
  serviceWorker.applyAutoCleanSchedule();
});
