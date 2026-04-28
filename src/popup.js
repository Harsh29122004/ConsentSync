// Utility Functions
function log(msg) {
  const el = document.getElementById("log");
  const t = new Date().toLocaleTimeString();
  el.textContent = `[${t}] ${msg}\n` + el.textContent;
}

function toast(msg, type = 'info') {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.hidden = false;
  setTimeout(() => t.hidden = true, 3000);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  return tab;
}

function urlPatternFrom(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return url;
  }
}

// --- NEW: Lightweight policy language detection (metadata only) ---
// Does not affect analysis/scoring; used only for popup display.
// Combines policy text signals with optional site language hints.
function detectPolicyLanguage(policyText, siteLangHint = '') {
  try {
    if (!policyText || typeof policyText !== 'string') return 'English';

    const sample = policyText.slice(0, 12000);
    const lower = sample.toLowerCase();

    // Helper: require a meaningful amount of script characters to avoid
    // misclassifying mostly-English policies containing a few foreign characters.
    const scriptRatioAbove = (regex, minRatio = 0.02, minCount = 20) => {
      const matches = sample.match(regex);
      const count = matches ? matches.length : 0;
      const total = Math.max(1, sample.length);
      return count >= minCount && (count / total) >= minRatio;
    };

    // 1️⃣ Strong Unicode/script detection (only if substantial)
    // Hindi (Devanagari)
    if (scriptRatioAbove(/[\u0900-\u097F]/g, 0.02, 20)) return 'Hindi';
    // Chinese (CJK ideographs)
    if (scriptRatioAbove(/[\u4E00-\u9FFF]/g, 0.015, 15)) return 'Chinese';
    // Japanese (Hiragana/Katakana). Kanji-only pages may be detected as Chinese above.
    if (scriptRatioAbove(/[\u3040-\u30FF\u31F0-\u31FF]/g, 0.01, 10)) return 'Japanese';

    // 2️⃣ Keyword heuristics (privacy-policy specific terms)
    const spanishWords = ['privacidad', 'datos personales', 'política', 'politica de privacidad', 'política de privacidad'];
    const germanWords = ['datenschutz', 'personenbezogene daten', 'datenschutzerklärung', 'datenschutzerklaerung'];
    const frenchWords = ['confidentialité', 'données personnelles', 'donnees personnelles', 'politique de confidentialité', 'politique de confidentialite'];

    if (spanishWords.some(w => lower.includes(w))) return 'Spanish';
    if (germanWords.some(w => lower.includes(w))) return 'German';
    if (frenchWords.some(w => lower.includes(w))) return 'French';

    // 3️⃣ Site language hint (HTML lang / meta hints captured from the page)
    const siteLang = (siteLangHint || '').toLowerCase();
    if (siteLang.startsWith('hi')) return 'Hindi';
    if (siteLang.startsWith('de')) return 'German';
    if (siteLang.startsWith('fr')) return 'French';
    if (siteLang.startsWith('es')) return 'Spanish';
    if (siteLang.startsWith('ja')) return 'Japanese';
    if (siteLang.startsWith('zh')) return 'Chinese';

    return 'English';
  } catch (e) {
    return 'English';
  }
}

// Enhanced Privacy Score Calculation
function calculatePrivacyScore(policyText, permissions, cookieCount) {
  let score = 100;
  let breakdown = {
    policyRisk: 0,
    permissionRisk: 0,
    cookieRisk: 0
  };

  // Policy Risk (0-40 points)
  if (policyText) {
    const text = policyText.toLowerCase();
    const riskyTerms = [
      'sell', 'third party', 'share', 'advertis', 'profiling', 'track across',
      'data broker', 'combine', 'marketing partners', 'retention', 'analytics'
    ];
    
    let policyHits = 0;
    riskyTerms.forEach(term => {
      if (text.includes(term)) policyHits++;
    });
    
    breakdown.policyRisk = Math.min(policyHits * 3, 40);
    score -= breakdown.policyRisk;
  }

  // Permission Risk (0-30 points)
  const permissionScores = {
    'geolocation': 8,
    'camera': 10,
    'microphone': 10,
    'notifications': 5
  };
  
  permissions.forEach(perm => {
    if (permissionScores[perm]) {
      breakdown.permissionRisk += permissionScores[perm];
    }
  });
  
  score -= Math.min(breakdown.permissionRisk, 30);

  // Cookie Risk (0-20 points)
  breakdown.cookieRisk = Math.min(cookieCount * 2, 20);
  score -= breakdown.cookieRisk;

  return {
    score: Math.max(0, Math.round(score)),
    breakdown
  };
}

// Enhanced Policy Analyzer with NLP
function analyzePolicyText(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const results = {
    safe: [],
    ambiguous: [],
    manipulative: [],
    summary: ''
  };

  const safeKeywords = ['privacy', 'protect', 'secure', 'encrypt', 'delete', 'control', 'opt-out'];
  const riskyKeywords = ['sell', 'third party', 'share', 'advertis', 'track', 'profiling', 'retention'];
  const manipulativeKeywords = ['necessary', 'required', 'essential', 'improve', 'personalize', 'experience'];

  sentences.forEach(sentence => {
    const s = sentence.toLowerCase();
    let safeCount = 0, riskyCount = 0, manipulativeCount = 0;

    safeKeywords.forEach(kw => { if (s.includes(kw)) safeCount++; });
    riskyKeywords.forEach(kw => { if (s.includes(kw)) riskyCount++; });
    manipulativeKeywords.forEach(kw => { if (s.includes(kw)) manipulativeCount++; });

    if (riskyCount >= 2 || manipulativeCount >= 2) {
      results.manipulative.push(sentence.trim());
    } else if (riskyCount >= 1 || manipulativeCount >= 1) {
      results.ambiguous.push(sentence.trim());
    } else if (safeCount >= 1) {
      results.safe.push(sentence.trim());
    } else {
      results.ambiguous.push(sentence.trim());
    }
  });

  // Generate summary
  const totalSentences = sentences.length;
  const manipulativePercent = (results.manipulative.length / totalSentences) * 100;
  
  if (manipulativePercent > 30) {
    results.summary = "⚠️ High risk: This policy contains many concerning data practices.";
  } else if (manipulativePercent > 15) {
    results.summary = "⚠️ Medium risk: Some concerning practices detected.";
  } else {
    results.summary = "✅ Generally safe: Standard privacy practices.";
  }

  return results;
}

// Activity Feed Management
class ActivityFeed {
  constructor() {
    this.feed = document.getElementById('activityFeed');
    this.maxItems = 10;
  }

  addActivity(icon, text, type = 'info') {
    const item = document.createElement('div');
    item.className = `feed-item fade-in`;
    
    const time = new Date().toLocaleTimeString();
    
    item.innerHTML = `
      <div class="feed-icon ${type}">
        <i class="${icon}"></i>
      </div>
      <div class="feed-content">
        <div class="feed-text">${text}</div>
        <div class="feed-time">${time}</div>
      </div>
    `;

    this.feed.insertBefore(item, this.feed.firstChild);
    
    // Keep only max items
    while (this.feed.children.length > this.maxItems) {
      this.feed.removeChild(this.feed.lastChild);
    }
  }

  clear() {
    this.feed.innerHTML = `
      <div class="feed-item">
        <div class="feed-icon">
          <i class="fas fa-info-circle"></i>
        </div>
        <div class="feed-content">
          <div class="feed-text">Feed cleared</div>
          <div class="feed-time">Just now</div>
        </div>
      </div>
    `;
  }
}

// Privacy Score Display
class PrivacyScore {
  constructor() {
    this.scoreCircle = document.getElementById('scoreCircle');
    this.scoreValue = document.getElementById('scoreValue');
    this.scoreLabel = document.getElementById('scoreLabel');
    this.scoreBadge = document.getElementById('scoreBadge');
    this.breakdown = {
      policyRisk: document.getElementById('policyRisk'),
      permissionRisk: document.getElementById('permissionRisk'),
      cookieRisk: document.getElementById('cookieRisk')
    };
  }

  updateScore(score, breakdown) {
    // Update main score
    this.scoreValue.textContent = score;
    
    // Update circle progress
    const percentage = score;
    const degrees = (percentage / 100) * 360;
    this.scoreCircle.style.background = `conic-gradient(
      ${this.getScoreColor(score)} 0deg, 
      ${this.getScoreColor(score)} ${degrees}deg, 
      #374151 ${degrees}deg, 
      #374151 360deg
    )`;

    // Update label and badge
    const { label, color } = this.getScoreInfo(score);
    this.scoreLabel.textContent = label;
    this.scoreBadge.textContent = this.getScoreEmoji(score);
    this.scoreBadge.style.background = color;
    this.scoreBadge.style.color = 'white';

    // Update breakdown
    if (breakdown) {
      this.breakdown.policyRisk.textContent = `${breakdown.policyRisk}%`;
      this.breakdown.permissionRisk.textContent = `${breakdown.permissionRisk}%`;
      this.breakdown.cookieRisk.textContent = `${breakdown.cookieRisk}%`;
    }
  }

  getScoreColor(score) {
    if (score >= 80) return '#10b981';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  }

  getScoreInfo(score) {
    if (score >= 80) return { label: '🟢 Safe', color: '#10b981' };
    if (score >= 50) return { label: '🟡 Medium Risk', color: '#f59e0b' };
    return { label: '🔴 High Risk', color: '#ef4444' };
  }

  getScoreEmoji(score) {
    if (score >= 80) return '🟢';
    if (score >= 50) return '🟡';
    return '🔴';
  }
}

// Main Application
class ConsentSyncApp {
  constructor() {
    this.activityFeed = new ActivityFeed();
    this.privacyScore = new PrivacyScore();
    this.currentOrigin = '';
    this.currentTab = null;
    this.permissions = [];
    this.cookieCount = 0;
    this.policyText = '';
    this.policyTextOriginal = '';
    this.policyTextForAnalysis = '';
    this.policyLanguage = null;
    this.policyLanguageTranslated = false;
    this.translationUnavailable = false;
    this.uiLangCode = 'en';

    this.init();
  }

  getMsg(key) {
    const args = Array.prototype.slice.call(arguments, 1);
    if (args.length && typeof getMessage === 'function') {
      return getMessage.apply(null, [this.uiLangCode, key].concat(args));
    }
    return typeof getTranslation === 'function' ? getTranslation(this.uiLangCode, key) : key;
  }

  async init() {
    this.currentTab = await getActiveTab();
    const siteEl = document.getElementById('site');
    
    if (!this.currentTab || !/^https?:/.test(this.currentTab.url)) {
      if (siteEl) {
        siteEl.textContent = this.currentTab?.url || 'No active website';
      }
      return;
    }

    this.currentOrigin = new URL(this.currentTab.url).origin;
    if (siteEl) {
      siteEl.textContent = this.currentOrigin;
    }

    this.setupEventListeners();
    this.initializePermissions();
    this.initializeCookies();
    this.detectPrivacyPolicy();
    this.loadSettings();
    this.startMonitoring();

    // Apply saved UI language (translation layer; does not change behavior)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['consentSyncUILang'], (r) => {
        this.uiLangCode = r.consentSyncUILang || 'en';
        if (typeof applyUILanguage === 'function') applyUILanguage(this.uiLangCode);
      });
    }
  }

  setupEventListeners() {
    // Dashboard
    document.getElementById('openDashboard').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Activity Feed
    document.getElementById('clearFeed').addEventListener('click', () => {
      this.activityFeed.clear();
    });

    // Cookie Controls
    document.getElementById('clearCookies').addEventListener('click', () => {
      this.clearAllCookies();
    });

    document.getElementById('blockCookies').addEventListener('click', () => {
      this.blockCookies();
    });

    // Auto-clean toggle
    document.getElementById('autoCleanToggle').addEventListener('change', (e) => {
      this.toggleAutoClean(e.target.checked);
    });

    // Persist autoCleanTime when user changes the interval dropdown (used by scheduler when implemented)
    document.getElementById('autoCleanTime').addEventListener('change', (e) => {
      const value = e.target.value;
      chrome.storage.local.set({ autoCleanTime: value });
    });

    // Permission controls
    const permissionMap = {
      'geo': 'geolocation',
      'notif': 'notifications', 
      'camera': 'camera',
      'mic': 'microphone'
    };
    
    Object.entries(permissionMap).forEach(([shortName, fullName]) => {
      const allowBtn = document.getElementById(`${shortName}Allow`);
      const blockBtn = document.getElementById(`${shortName}Block`);
      
      if (allowBtn) {
        allowBtn.addEventListener('click', () => {
          this.setPermission(fullName, 'allow');
        });
      }
      
      if (blockBtn) {
        blockBtn.addEventListener('click', () => {
          this.setPermission(fullName, 'block');
        });
      }
    });

    // Policy Analyzer
    document.getElementById('fetchPolicy').addEventListener('click', () => {
      this.fetchPrivacyPolicy();
    });

    document.getElementById('analyzePolicy').addEventListener('click', () => {
      this.analyzePrivacyPolicy();
    });

    document.getElementById('exportSummary').addEventListener('click', () => {
      this.exportSummary();
    });

    // Automation
    document.getElementById('autoView').addEventListener('click', () => {
      this.viewAutomationRules();
    });

    document.getElementById('autoReset').addEventListener('click', () => {
      this.resetAutomation();
    });

    // Log
    const clearLogBtn = document.getElementById('clearLog');
    const logEl = document.getElementById('log');
    if (clearLogBtn && logEl) {
      clearLogBtn.addEventListener('click', () => {
        logEl.textContent = '';
      });
    }

    // Policy preview toggle
    document.getElementById('togglePreview').addEventListener('click', () => {
      this.togglePolicyPreview();
    });

    // Translation preview toggle (optional UI)
    const toggleTranslation = document.getElementById('toggleTranslationPreview');
    if (toggleTranslation) {
      toggleTranslation.addEventListener('click', () => {
        this.toggleTranslationPreview();
      });
    }
  }

  initializePermissions() {
    const pattern = urlPatternFrom(this.currentTab.url);
    const permissionMap = {
      'geolocation': 'geoState',
      'notifications': 'notifState', 
      'camera': 'cameraState',
      'microphone': 'micState'
    };
    
    Object.entries(permissionMap).forEach(([perm, elementId]) => {
      const element = document.getElementById(elementId);
      if (element) {
        this.safeGet(perm, this.currentTab.url, element);
      }
    });
  }

  initializeCookies() {
    const cookieCountEl = document.getElementById('cookieCount');
    if (!cookieCountEl) return;
    
    const updateCookies = () => {
      chrome.cookies.getAll({url: this.currentOrigin}, (cookies) => {
        this.cookieCount = cookies.length;
        if (cookieCountEl) {
          cookieCountEl.textContent = this.cookieCount;
        }
        this.updatePrivacyScore();
        log(`Cookies: ${this.cookieCount}`);
      });
    };

    updateCookies();
    chrome.cookies.onChanged.addListener(updateCookies);
  }

  updatePolicyLanguageIndicator(languageLabel, wasTranslated, translationUnavailable) {
    const indicator = document.getElementById('policyLanguageIndicator');
    if (!indicator) return;

    if (!languageLabel) {
      indicator.style.display = 'none';
      indicator.textContent = '';
      return;
    }

    indicator.style.display = 'block';
    const baseText = `🌍 Policy Language: ${languageLabel}`;

    if (wasTranslated) {
      indicator.textContent = `${baseText} – 🔁 Translated to English for analysis`;
    } else if (translationUnavailable && languageLabel !== 'English') {
      indicator.textContent = `${baseText} – Translation unavailable, analyzing original policy.`;
    } else {
      indicator.textContent = baseText;
    }
  }

  detectPrivacyPolicy() {
    const policyStatusEl = document.getElementById('policyStatus');
    if (!policyStatusEl) return;
    
    // Check if we can inject content script
    if (!this.currentTab.url || this.currentTab.url.startsWith('chrome://') || this.currentTab.url.startsWith('chrome-extension://')) {
      policyStatusEl.textContent = 'Cannot scan this page';
      policyStatusEl.className = 'policy-status status-warning';
      this.activityFeed.addActivity('fas fa-exclamation-triangle', this.getMsg('cannot_scan_page_type'), 'warning');
      return;
    }
    
    chrome.tabs.sendMessage(this.currentTab.id, {type: "FIND_POLICY"}, (res) => {
      if (chrome.runtime.lastError) {
        // Content script not loaded, try to inject it
        chrome.scripting.executeScript({
          target: { tabId: this.currentTab.id },
          files: ['content.js']
        }, () => {
          if (chrome.runtime.lastError) {
            policyStatusEl.textContent = 'Cannot scan this page';
            policyStatusEl.className = 'policy-status status-warning';
            this.activityFeed.addActivity('fas fa-exclamation-triangle', this.getMsg('cannot_inject_script'), 'warning');
            return;
          }
          
          // Try again after injection
          setTimeout(() => {
            chrome.tabs.sendMessage(this.currentTab.id, {type: "FIND_POLICY"}, (res2) => {
              if (res2 && res2.link) {
                policyStatusEl.textContent = 'Policy detected';
                policyStatusEl.className = 'policy-status status-safe';
                this.policyUrl = res2.link;
                this.activityFeed.addActivity('fas fa-file-contract', this.getMsg('privacy_policy_detected'), 'success');
                log("Policy link detected");
              } else {
                policyStatusEl.textContent = 'No policy detected';
                policyStatusEl.className = 'policy-status status-warning';
                this.activityFeed.addActivity('fas fa-exclamation-triangle', this.getMsg('no_privacy_policy_found'), 'warning');
                log("No policy link");
              }
            });
          }, 500);
        });
        return;
      }
      
      if (res && res.link) {
        policyStatusEl.textContent = 'Policy detected';
        policyStatusEl.className = 'policy-status status-safe';
        this.policyUrl = res.link;
        this.activityFeed.addActivity('fas fa-file-contract', this.getMsg('privacy_policy_detected'), 'success');
        log("Policy link detected");
      } else {
        policyStatusEl.textContent = 'No policy detected';
        policyStatusEl.className = 'policy-status status-warning';
        this.activityFeed.addActivity('fas fa-exclamation-triangle', this.getMsg('no_privacy_policy_found'), 'warning');
        log("No policy link");
      }
    });
  }

  async loadSettings() {
    const result = await chrome.storage.local.get(['autoClean', 'autoCleanTime']);
    if (result.autoClean) {
      document.getElementById('autoCleanToggle').checked = true;
      document.getElementById('autoCleanSettings').style.display = 'block';
    }
    if (result.autoCleanTime) {
      document.getElementById('autoCleanTime').value = result.autoCleanTime;
    }
  }

  startMonitoring() {
    // Monitor for permission requests
    chrome.webNavigation.onCompleted.addListener((details) => {
      if (details.url.startsWith(this.currentOrigin)) {
        this.activityFeed.addActivity('fas fa-eye', this.getMsg('page_loaded_monitored'), 'info');
      }
    });

    // Initial activity
    this.activityFeed.addActivity('fas fa-play', this.getMsg('consentsync_monitoring_started'), 'success');
  }

  // Permission Management
  safeGet(api, url, element) {
    if (chrome.contentSettings && chrome.contentSettings[api] && chrome.contentSettings[api].get) {
      chrome.contentSettings[api].get({primaryUrl: url}, (info) => {
        element.textContent = info.setting || '—';
        this.updatePermissionStatus(api, info.setting);
      });
    } else {
      element.textContent = 'Not supported';
    }
  }

  safeSet(api, pattern, setting) {
    if (chrome.contentSettings && chrome.contentSettings[api] && chrome.contentSettings[api].set) {
      chrome.contentSettings[api].set({primaryPattern: pattern, setting}, () => {
        log(`${api} → ${setting}`);
        this.activityFeed.addActivity(
          `fas fa-${this.getPermissionIcon(api)}`, 
          `${api} ${setting}`, 
          setting === 'block' ? 'danger' : 'success'
        );
        chrome.runtime.sendMessage({type: 'LEARN_ACTION', api, setting, pattern});
        // Log permission blocks to consentLog for Smart Recommendations
        if (setting === 'block') {
          const domain = this.currentOrigin ? new URL(this.currentOrigin).hostname : 'unknown';
          this.addConsentLogEntry(this.getMsg('blocked_api_access', api), this.getMsg('blocked_api_on_domain', api, domain), 'permission_blocked', { permission: api });
        }
        this.updatePrivacyScore();
      });
    } else {
      toast(api + ' ' + this.getMsg('api_not_supported'), 'error');
    }
  }

  setPermission(permission, setting) {
    const pattern = urlPatternFrom(this.currentTab.url);
    this.safeSet(permission, pattern, setting);
  }

  updatePermissionStatus(api, setting) {
    const permissionMap = {
      'geolocation': 'geoState',
      'notifications': 'notifState', 
      'camera': 'cameraState',
      'microphone': 'micState'
    };
    
    const elementId = permissionMap[api];
    if (elementId) {
      const element = document.getElementById(elementId);
      if (element) {
        element.textContent = setting || '—';
        element.className = `permission-status ${setting === 'block' ? 'status-danger' : 'status-safe'}`;
      }
    }
  }

  getPermissionIcon(api) {
    const icons = {
      geolocation: 'map-marker-alt',
      notifications: 'bell',
      camera: 'video',
      microphone: 'microphone'
    };
    return icons[api] || 'shield-alt';
  }

  // Cookie Management
  clearAllCookies() {
    chrome.cookies.getAll({url: this.currentOrigin}, (cookies) => {
      cookies.forEach(cookie => {
        chrome.cookies.remove({url: this.currentOrigin, name: cookie.name});
      });
      setTimeout(() => {
        this.initializeCookies();
        this.activityFeed.addActivity('fas fa-trash', this.getMsg('all_cookies_cleared'), 'danger');
        this.addConsentLogEntry(this.getMsg('all_cookies_cleared'), this.getMsg('cleared_cookies_from', String(cookies.length), this.currentOrigin), 'cookies_cleared');
        toast(this.getMsg('cookies_cleared_toast'), 'success');
      }, 500);
    });
  }

  blockCookies() {
    // This would require additional implementation for cookie blocking
    this.activityFeed.addActivity('fas fa-ban', 'Cookie blocking requested', 'warning');
    toast("Cookie blocking feature coming soon", 'info');
  }

  toggleAutoClean(enabled) {
    chrome.storage.local.set({ autoClean: enabled });
    document.getElementById('autoCleanSettings').style.display = enabled ? 'block' : 'none';
    
    if (enabled) {
      this.activityFeed.addActivity('fas fa-clock', this.getMsg('auto_clean_enabled'), 'success');
    } else {
      this.activityFeed.addActivity('fas fa-pause', this.getMsg('auto_clean_disabled'), 'info');
    }
  }

  // Policy Analysis
  async fetchPrivacyPolicy() {
    if (!this.policyUrl) {
      toast("No policy link detected", 'error');
      return;
    }

    toast(this.getMsg('fetching_policy_toast'), 'info');
    this.activityFeed.addActivity('fas fa-download', this.getMsg('fetching_policy'), 'info');

    chrome.runtime.sendMessage({type: "FETCH_POLICY", url: this.policyUrl}, (resp) => {
      if (!resp || !resp.ok) {
        toast(this.getMsg('policy_fetch_failed'), 'error');
        this.activityFeed.addActivity('fas fa-times', this.getMsg('policy_fetch_failed'), 'danger');
        return;
      }

      // Store original and analysis-friendly policy text
      this.policyTextOriginal = resp.text || '';
      this.policyTextForAnalysis = resp.translatedPolicyText || resp.text || '';
      // Keep existing consumers using policyText, but point it to the analysis text
      this.policyText = this.policyTextForAnalysis;

      // --- NEW: detect policy language after fetch (display-only metadata) ---
      // Also capture site language hints from the active tab (HTML lang/meta).
      const finalizeLanguageLabel = (siteLangHint) => {
        const detectedLanguageLabel = detectPolicyLanguage(this.policyTextOriginal, siteLangHint || '');

        // Track detected language metadata (best-effort)
        const langCode = resp.policyLanguage || 'en';
        const langLabel = detectedLanguageLabel || resp.policyLanguageLabel || (langCode === 'en' ? 'English' : langCode);
        const wasTranslated = !!(resp.translatedPolicyText && langCode && langCode !== 'en');
        this.policyLanguage = langLabel;
        this.policyLanguageTranslated = wasTranslated;
        this.translationUnavailable = !!(langCode && langCode !== 'en' && !wasTranslated);

        // Persist original text (to avoid breaking existing storage shape) and language metadata separately
        chrome.storage.local.set({
          [`policy-${this.currentOrigin}`]: resp.text,
          [`policyLanguage-${this.currentOrigin}`]: langLabel
        }, () => {
          document.getElementById('policyPreview').style.display = 'block';
          // Preview shows the original policy text to preserve context for the user
          document.getElementById('previewContent').textContent = (resp.text || '').slice(0, 1200);
          this.activityFeed.addActivity('fas fa-check', this.getMsg('policy_fetched_successfully'), 'success');
          toast(this.getMsg('policy_saved_toast'), 'success');
          log("Policy fetched");

          // Update small language indicator in the UI
          this.updatePolicyLanguageIndicator(langLabel, wasTranslated, this.translationUnavailable);

          // Apply UI language from detected policy language (translation layer)
          const langToCode = { English: 'en', Spanish: 'es', French: 'fr', German: 'de', Hindi: 'hi', Japanese: 'ja', Chinese: 'zh' };
          const uiCode = langToCode[langLabel] || 'en';
          this.uiLangCode = uiCode;
          if (typeof applyUILanguage === 'function') applyUILanguage(uiCode);
          try { chrome.storage.local.set({ consentSyncUILang: uiCode }); } catch (e) {}

          // Update optional translation preview section
          const translationSection = document.getElementById('policyTranslationSection');
          const originalEl = document.getElementById('originalPolicyContent');
          const translatedEl = document.getElementById('translatedPolicyContent');
          if (translationSection && originalEl && translatedEl) {
            originalEl.textContent = this.policyTextOriginal.slice(0, 4000);
            if (this.policyTextForAnalysis && this.policyTextForAnalysis !== this.policyTextOriginal) {
              translatedEl.textContent = this.policyTextForAnalysis.slice(0, 4000);
            } else {
              translatedEl.textContent = 'Translation unavailable – showing original policy language only.';
            }

            // Only show translation UI when policy is non-English
            translationSection.style.display = langCode !== 'en' ? 'block' : 'none';
          }
        });
      };

      // Try to read HTML language hints from the active tab (fail-safe).
      try {
        if (this.currentTab && this.currentTab.id && chrome.scripting && chrome.scripting.executeScript) {
          chrome.scripting.executeScript({
            target: { tabId: this.currentTab.id },
            func: () => {
              try {
                const htmlLang = (document.documentElement && document.documentElement.lang) ? document.documentElement.lang : '';
                const metaLang =
                  (document.querySelector('meta[http-equiv="content-language"]') && document.querySelector('meta[http-equiv="content-language"]').getAttribute('content')) ||
                  (document.querySelector('meta[name="language"]') && document.querySelector('meta[name="language"]').getAttribute('content')) ||
                  '';
                return { htmlLang, metaLang };
              } catch (e) {
                return { htmlLang: '', metaLang: '' };
              }
            }
          }, (results) => {
            const r = Array.isArray(results) && results[0] ? results[0].result : null;
            const hint = (r && (r.htmlLang || r.metaLang)) ? (r.htmlLang || r.metaLang) : '';
            finalizeLanguageLabel(hint);
          });
        } else {
          finalizeLanguageLabel('');
        }
      } catch (e) {
        finalizeLanguageLabel('');
      }
    });
  }

  async analyzePrivacyPolicy() {
    const textForAnalysis = this.policyTextForAnalysis || this.policyText;
    if (!textForAnalysis) {
      toast(this.getMsg('fetch_policy_first'), 'error');
      return;
    }

    this.activityFeed.addActivity('fas fa-brain', this.getMsg('analyzing_policy'), 'info');
    toast(this.getMsg('analyzing_policy_toast'), 'info');

    const analysis = analyzePolicyText(textForAnalysis);
    
    // Display results
    document.getElementById('policySummary').style.display = 'block';
    const summaryContent = document.getElementById('summaryContent');
    
    let html = `
      <div class="analysis-summary">
        <div class="summary-text">${analysis.summary}</div>
        <div class="analysis-breakdown">
          <div class="breakdown-item">
            <span class="breakdown-label">✅ Safe sentences:</span>
            <span class="breakdown-value">${analysis.safe.length}</span>
          </div>
          <div class="breakdown-item">
            <span class="breakdown-label">⚠️ Ambiguous sentences:</span>
            <span class="breakdown-value">${analysis.ambiguous.length}</span>
          </div>
          <div class="breakdown-item">
            <span class="breakdown-label">🚨 Manipulative sentences:</span>
            <span class="breakdown-value">${analysis.manipulative.length}</span>
          </div>
        </div>
      </div>
      <div class="analysis-sentences">
        <div class="analysis-group">
          <div class="analysis-group-title" style="color: var(--success-light, #34d399); margin-top: 8px;">SAFE</div>
          ${analysis.safe.slice(0, 10).map(s => `<div class="analysis-sentence" style="border-left: 3px solid var(--success, #10b981); padding-left: 6px; margin-top: 4px;">${s}</div>`).join('') || '<div class="analysis-sentence" style="opacity: 0.7;">No clearly safe sentences detected.</div>'}
        </div>
        <div class="analysis-group">
          <div class="analysis-group-title" style="color: var(--warning-light, #fbbf24); margin-top: 10px;">AMBIGUOUS</div>
          ${analysis.ambiguous.slice(0, 10).map(s => `<div class="analysis-sentence" style="border-left: 3px solid var(--warning, #f59e0b); padding-left: 6px; margin-top: 4px;">${s}</div>`).join('') || '<div class="analysis-sentence" style="opacity: 0.7;">No ambiguous sentences detected.</div>'}
        </div>
        <div class="analysis-group">
          <div class="analysis-group-title" style="color: var(--danger-light, #f87171); margin-top: 10px;">RISKY</div>
          ${analysis.manipulative.slice(0, 10).map(s => `<div class="analysis-sentence" style="border-left: 3px solid var(--danger, #ef4444); padding-left: 6px; margin-top: 4px;">${s}</div>`).join('') || '<div class="analysis-sentence" style="opacity: 0.7;">No clearly risky sentences detected.</div>'}
        </div>
      </div>
    `;
    
    summaryContent.innerHTML = html;
    
    // Update privacy score
    this.updatePrivacyScore();
    
    this.activityFeed.addActivity('fas fa-chart-bar', this.getMsg('analysis_complete'), 'success');
    toast(this.getMsg('analysis_complete_toast'), 'success');
  }

  exportSummary() {
    const summary = {
      site: this.currentOrigin,
      score: this.privacyScore.scoreValue.textContent,
      cookies: this.cookieCount,
      policy: this.policyText ? 'Available' : 'Not found',
      timestamp: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(summary, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consentsync-${this.currentOrigin.replace(/[^\w]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    this.activityFeed.addActivity('fas fa-file-export', this.getMsg('summary_exported'), 'success');
    toast(this.getMsg('summary_exported_toast'), 'success');
  }

  togglePolicyPreview() {
    const content = document.getElementById('previewContent');
    const icon = document.querySelector('#togglePreview i');
    
    if (content.style.display === 'none') {
      content.style.display = 'block';
      icon.className = 'fas fa-chevron-up';
    } else {
      content.style.display = 'none';
      icon.className = 'fas fa-chevron-down';
    }
  }

  toggleTranslationPreview() {
    const container = document.getElementById('translationContent');
    const icon = document.querySelector('#toggleTranslationPreview i');
    if (!container || !icon) return;

    if (container.style.display === 'none' || container.style.display === '') {
      container.style.display = 'grid';
      icon.className = 'fas fa-chevron-up';
    } else {
      container.style.display = 'none';
      icon.className = 'fas fa-chevron-down';
    }
  }

  // Automation
  viewAutomationRules() {
    chrome.runtime.sendMessage({type: 'AUTO_GET_RULES'}, (rules) => {
      console.log('Automation rules:', rules);
      this.activityFeed.addActivity('fas fa-eye', this.getMsg('automation_rules_viewed'), 'info');
      toast(this.getMsg('rules_opened_console'), 'info');
    });
  }

  resetAutomation() {
    chrome.runtime.sendMessage({type: 'AUTO_RESET'}, () => {
      this.activityFeed.addActivity('fas fa-redo', this.getMsg('learning_reset'), 'warning');
      toast(this.getMsg('learning_reset_toast'), 'success');
    });
  }

  // Consent Logging
  addConsentLogEntry(action, details, type, extra = {}) {
    chrome.runtime.sendMessage({
      type: 'ADD_CONSENT_LOG',
      logEntry: { action, details, type, ...extra }
    });
  }

  // Privacy Score Updates
  updatePrivacyScore() {
    const policyForScore = this.policyTextForAnalysis || this.policyText || '';
    const scoreData = calculatePrivacyScore(policyForScore, this.permissions, this.cookieCount);
    this.privacyScore.updateScore(scoreData.score, scoreData.breakdown);
  }
}

// Initialize the application
document.addEventListener("DOMContentLoaded", () => {
  new ConsentSyncApp();
});
