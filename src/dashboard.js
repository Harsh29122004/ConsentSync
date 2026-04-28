// Enhanced Dashboard Application for ConsentSync Phases 6 & 7
class ConsentSyncDashboard {
  constructor() {
    this.sites = [];
    this.currentFilter = 'all';
    this.searchTerm = '';
    this.activityFeed = [];
    this.consentLog = [];
    this.smartPreferences = {};
    this.currentTab = 'overview';
    this.unsafeIndex = null;
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
    try {
      const r = await chrome.storage.local.get(['consentSyncUILang']);
      this.uiLangCode = r.consentSyncUILang || 'en';
    } catch (e) {
      this.uiLangCode = 'en';
    }
    this.setupTabNavigation();
    this.setupEventListeners();
    await this.loadUnsafeIndex();
    await this.loadSites();
    await this.loadSmartPreferences();
    await this.loadConsentLog();
    this.updateStatistics();
    this.renderSites();
    this.renderConsentLog();
    this.updatePreferenceStatuses();
    this.renderRecommendations();
    this.addActivity(this.getMsg('dashboard_loaded'), 'info');

    if (typeof applyUILanguage === 'function') applyUILanguage(this.uiLangCode);
  }

  setupTabNavigation() {
    const tabItems = document.querySelectorAll('.tab-item');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabItems.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        this.switchTab(targetTab);
      });
    });
  }

  switchTab(tabName) {
    // Update active tab
    document.querySelectorAll('.tab-item').forEach(tab => {
      tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update active pane
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');

    this.currentTab = tabName;
    this.addActivity(this.getMsg('switched_to_tab', tabName), 'info');

    // Refresh Smart Recommendations when switching to preferences tab
    if (tabName === 'preferences') {
      this.loadConsentLog().then(() => this.renderRecommendations());
    }
  }

  setupEventListeners() {
    // Search functionality
    document.getElementById('siteSearch').addEventListener('input', (e) => {
      this.searchTerm = e.target.value.toLowerCase();
      this.renderSites();
    });

    // Log search
    document.getElementById('logSearch').addEventListener('input', (e) => {
      this.filterConsentLog(e.target.value.toLowerCase());
    });

    // Add current site
    document.getElementById('addCurrentSite').addEventListener('click', () => {
      this.addCurrentSite();
    });

    // Export data
    document.getElementById('exportData').addEventListener('click', () => {
      this.exportData();
    });

    // Clear activity
    document.getElementById('clearActivity').addEventListener('click', () => {
      this.clearActivity();
    });

    // Clear log
    document.getElementById('clearLog').addEventListener('click', () => {
      this.clearConsentLog();
    });

    // Export to Word
    document.getElementById('exportToWord').addEventListener('click', () => {
      this.exportToWord();
    });

    // Smart Preferences
    document.getElementById('autoApplyToggle').addEventListener('change', (e) => {
      this.toggleAutoApply(e.target.checked);
    });

    // Individual preference toggles
    ['location', 'camera', 'microphone', 'notification'].forEach(perm => {
      document.getElementById(`${perm}Toggle`).addEventListener('change', (e) => {
        this.updatePreference(perm, e.target.checked);
      });
    });

    // Policy Analyzer
    document.getElementById('analyzeCurrentSite').addEventListener('click', () => {
      this.analyzeCurrentSite();
    });

    document.getElementById('analyzeAllSites').addEventListener('click', () => {
      this.analyzeAllSites();
    });

    document.getElementById('exportAnalysis').addEventListener('click', () => {
      this.exportAnalysis();
    });

    // GDPR Controls
    document.getElementById('eraseData').addEventListener('click', () => {
      this.eraseAllData();
    });

    document.getElementById('privacySettings').addEventListener('click', () => {
      this.openPrivacySettings();
    });

    document.getElementById('dataTransparency').addEventListener('click', () => {
      this.showDataTransparency();
    });

    // Recommendation actions
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('recommendation-action')) {
        this.applyRecommendation(e.target);
      }
    });

    // Sites list action delegation (avoid inline handlers for CSP)
    const sitesListEl = document.getElementById('sitesList');
    if (sitesListEl) {
      sitesListEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const action = btn.dataset.action;
        const domain = btn.dataset.domain;
        if (!action || !domain) return;
        if (action === 'visit-site') {
          this.visitSite(domain);
        } else if (action === 'clear-cookies') {
          this.clearSiteCookies(domain);
        }
      });
    }
  }

  async loadSites() {
    try {
      // Get all cookies to find sites
      const cookies = await chrome.cookies.getAll({});
      const sites = new Map();

      // Group cookies by domain
      cookies.forEach(cookie => {
        const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
        if (!sites.has(domain)) {
          sites.set(domain, {
            domain: domain,
            cookies: 0,
            permissions: {
              geolocation: 'prompt',
              notifications: 'prompt',
              camera: 'prompt',
              microphone: 'prompt'
            },
            lastVisited: new Date().toISOString(),
            privacyScore: 0,
            riskLevel: 'unknown'
          });
        }
        sites.get(domain).cookies++;
      });

      // Get permission settings for each site
      for (const [domain, site] of sites) {
        // Skip invalid domains
        if (!domain || domain.includes(' ') || domain.length === 0 || domain.includes('*')) {
          continue;
        }
        
        const pattern = `*://${domain}/*`;
        
        // Check each permission
        const permissions = ['geolocation', 'notifications', 'camera', 'microphone'];
        for (const perm of permissions) {
          try {
            const setting = await this.getPermissionSetting(perm, pattern);
            site.permissions[perm] = setting;
          } catch (e) {
            console.log(`Could not get ${perm} setting for ${domain}`);
            site.permissions[perm] = 'prompt';
          }
        }

        // Calculate privacy score
        site.privacyScore = this.calculateSiteScore(site);

        // Unsafe detection override layer
        try {
          const unsafeCheck = await this.checkUnsafeStatus(domain);
          if (unsafeCheck && unsafeCheck.flagged) {
            site.privacyScore = Math.min(site.privacyScore, 49);
            site.riskLevel = 'high-risk';
            site.unsafe = true;
            site.unsafeReason = unsafeCheck.reason || 'Unsafe classification';

            this.addConsentLog({
              action: this.getMsg('unsafe_site_detected', domain),
              details: site.unsafeReason,
              type: 'policy_analysis'
            });

            this.addActivity('⚠️ ' + this.getMsg('domain_flagged_unsafe', domain), 'danger');
          } else {
            site.riskLevel = this.getRiskLevel(site.privacyScore);
          }
        } catch (e) {
          // Graceful fallback to computed score
          site.riskLevel = this.getRiskLevel(site.privacyScore);
        }
      }

      this.sites = Array.from(sites.values());
      this.addActivity(this.getMsg('loaded_sites', String(this.sites.length)), 'success');
    } catch (error) {
      console.error('Error loading sites:', error);
      this.addActivity(this.getMsg('error_loading_sites'), 'danger');
    }
  }

  async loadSmartPreferences() {
    try {
      const result = await chrome.storage.sync.get(['smartPreferences', 'autoApply']);
      this.smartPreferences = result.smartPreferences || {};
      
      // Set toggle states
      document.getElementById('autoApplyToggle').checked = result.autoApply || false;
      
      // Update preference statuses
      this.updatePreferenceStatuses();
    } catch (error) {
      console.error('Error loading smart preferences:', error);
    }
  }

  async loadConsentLog() {
    try {
      const result = await chrome.storage.local.get(['consentLog']);
      this.consentLog = result.consentLog || [];
    } catch (error) {
      console.error('Error loading consent log:', error);
    }
  }

  updatePreferenceStatuses() {
    const permissions = ['location', 'camera', 'microphone', 'notification'];
    
    permissions.forEach(perm => {
      const status = this.smartPreferences[perm] || 'learning';
      const statusEl = document.getElementById(`${perm}Status`);
      const toggleEl = document.getElementById(`${perm}Toggle`);
      
      if (statusEl) {
        statusEl.textContent = this.getStatusText(status);
        statusEl.className = `preference-status ${this.getStatusClass(status)}`;
      }
      
      if (toggleEl) {
        toggleEl.checked = status === 'auto-block';
      }
    });
  }

  getStatusText(status) {
    switch (status) {
      case 'auto-block': return 'Auto-blocking';
      case 'auto-allow': return 'Auto-allowing';
      case 'learning': return 'Learning...';
      default: return 'Manual';
    }
  }

  getStatusClass(status) {
    switch (status) {
      case 'auto-block': return 'status-danger';
      case 'auto-allow': return 'status-success';
      case 'learning': return 'status-warning';
      default: return 'status-info';
    }
  }

  async updatePreference(permission, autoBlock) {
    const status = autoBlock ? 'auto-block' : 'manual';
    this.smartPreferences[permission] = status;
    
    await chrome.storage.sync.set({ smartPreferences: this.smartPreferences });
    this.updatePreferenceStatuses();
    
    this.addConsentLog({
      action: this.getMsg('updated_preference_log', permission),
      details: this.getMsg('set_to_status', status),
      type: 'preference_update'
    });
    
    this.addActivity(this.getMsg('preference_updated', permission, status), 'success');
  }

  async toggleAutoApply(enabled) {
    await chrome.storage.sync.set({ autoApply: enabled });
    
    this.addConsentLog({
      action: this.getMsg('toggled_auto_apply'),
      details: enabled ? this.getMsg('auto_apply_enabled_details') : this.getMsg('auto_apply_disabled_details'),
      type: 'automation_toggle'
    });
    
    this.addActivity(enabled ? this.getMsg('auto_apply_enabled') : this.getMsg('auto_apply_disabled'), 'info');
  }

  async getPermissionSetting(permission, pattern) {
    return new Promise((resolve) => {
      if (chrome.contentSettings && chrome.contentSettings[permission]) {
        chrome.contentSettings[permission].get({primaryUrl: pattern}, (result) => {
          if (chrome.runtime.lastError) {
            resolve('prompt');
            return;
          }
          resolve(result && result.setting ? result.setting : 'prompt');
        });
      } else {
        resolve('prompt');
      }
    });
  }

  calculateSiteScore(site) {
    let score = 100;

    // Deduct points for cookies
    score -= Math.min(site.cookies * 2, 20);

    // Deduct points for permissions
    const permissionScores = {
      'geolocation': 8,
      'camera': 10,
      'microphone': 10,
      'notifications': 5
    };

    Object.entries(site.permissions).forEach(([perm, setting]) => {
      if (setting === 'allow') {
        score -= permissionScores[perm] || 0;
      }
    });

    return Math.max(0, Math.round(score));
  }

  /**
   * Deterministic privacy score (0-100) for Policy Analyzer context.
   * Based on: permissions, cookies, unsafe domain flag, and risky policy keywords.
   *
   * Score breakdown (total deductions max 100):
   * - Permission risk: 0-30 pts (geolocation:8, camera:10, mic:10, notifications:5 per 'allow')
   * - Cookie risk: 0-20 pts (2 pts per cookie, max 20)
   * - Policy keyword risk: 0-40 pts (3 pts per risky term found, max 40)
   * - Unsafe domain: 50 pt penalty (caps score at 50 if flagged)
   * - No policy found: 10 pt penalty (transparency red flag)
   *
   * @param {Object} params
   * @param {Object} params.permissions - {geolocation, camera, microphone, notifications} with values 'allow'|'block'|'prompt'
   * @param {number} params.cookieCount
   * @param {boolean} params.unsafeFlagged
   * @param {number} params.riskyKeywordCount - from policy text analysis
   * @param {boolean} params.policyFound
   * @returns {{ score: number, breakdown: Object }}
   */
  calculateDeterministicPrivacyScore({ permissions = {}, cookieCount = 0, unsafeFlagged = false, riskyKeywordCount = 0, policyFound = true }) {
    let score = 100;
    const breakdown = { permissionRisk: 0, cookieRisk: 0, policyRisk: 0, unsafePenalty: 0, noPolicyPenalty: 0 };

    // Permission risk (0-30 points): each 'allow' deducts
    const permissionScores = { geolocation: 8, camera: 10, microphone: 10, notifications: 5 };
    Object.entries(permissions).forEach(([perm, setting]) => {
      if (setting === 'allow') {
        breakdown.permissionRisk += permissionScores[perm] || 0;
      }
    });
    breakdown.permissionRisk = Math.min(breakdown.permissionRisk, 30);
    score -= breakdown.permissionRisk;

    // Cookie risk (0-20 points): 2 pts per cookie, max 20
    breakdown.cookieRisk = Math.min(cookieCount * 2, 20);
    score -= breakdown.cookieRisk;

    // Policy keyword risk (0-40 points): 3 pts per risky term, max 40
    breakdown.policyRisk = Math.min(riskyKeywordCount * 3, 40);
    score -= breakdown.policyRisk;

    // No policy found: 10 pt penalty (lack of transparency)
    if (!policyFound) {
      breakdown.noPolicyPenalty = 10;
      score -= breakdown.noPolicyPenalty;
    }

    // Unsafe domain: cap at 50 (major penalty)
    if (unsafeFlagged) {
      breakdown.unsafePenalty = Math.max(0, score - 50);
      score = 50;
    }

    return {
      score: Math.max(0, Math.round(score)),
      breakdown
    };
  }

  /**
   * Count risky keywords in policy text (same list as popup.js analyzePolicyText).
   * @param {string} policyText
   * @returns {number}
   */
  countRiskyPolicyKeywords(policyText) {
    if (!policyText || typeof policyText !== 'string') return 0;
    const riskyTerms = [
      'sell', 'third party', 'share', 'advertis', 'profiling', 'track across',
      'data broker', 'combine', 'marketing partners', 'retention', 'analytics'
    ];
    const text = policyText.toLowerCase();
    return riskyTerms.filter(term => text.includes(term)).length;
  }

  /**
   * Gather site data and compute deterministic privacy score for Policy Analyzer.
   * Fetches policy if URL provided, counts cookies, gets permission settings.
   * @param {string} hostname
   * @param {{ flagged: boolean }} unsafeInfo
   * @param {string|null} policyUrl
   * @returns {Promise<{ score: number, riskLevel: string, breakdown: Object, policyUrl: string|null }>}
   */
  async computePolicyAnalysisScore(hostname, unsafeInfo, policyUrl) {
    // Get cookie count for domain
    const cookies = await chrome.cookies.getAll({ domain: hostname });
    const cookieCount = cookies.length;

    // Get permission settings (allow = risk)
    const pattern = `*://${hostname}/*`;
    const permissions = {};
    for (const perm of ['geolocation', 'notifications', 'camera', 'microphone']) {
      permissions[perm] = await this.getPermissionSetting(perm, pattern);
    }

    // Fetch policy and count risky keywords if policy URL exists
    let riskyKeywordCount = 0;
    const policyFound = !!policyUrl;
    if (policyUrl) {
      const resp = await new Promise(resolve =>
        chrome.runtime.sendMessage({ type: 'FETCH_POLICY', url: policyUrl }, resolve)
      );
      if (resp && resp.ok && (resp.translatedPolicyText || resp.text)) {
        const analysisText = resp.translatedPolicyText || resp.text;
        riskyKeywordCount = this.countRiskyPolicyKeywords(analysisText);
      }
    }

    const { score, breakdown } = this.calculateDeterministicPrivacyScore({
      permissions,
      cookieCount,
      unsafeFlagged: unsafeInfo.flagged,
      riskyKeywordCount,
      policyFound
    });

    const riskLevel = score >= 80 ? 'Low Risk' : score >= 50 ? 'Medium Risk' : 'High Risk';
    return { score, riskLevel, breakdown, policyUrl };
  }

  // --- Unsafe Website Detection ---
  async loadUnsafeIndex() {
    try {
      const url = chrome.runtime.getURL('unsafe_blocklist.json');
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        this.unsafeIndex = new Set((data.domains || []).map(d => d.toLowerCase()));
      } else {
        this.unsafeIndex = new Set();
      }
    } catch (e) {
      this.unsafeIndex = new Set();
    }
  }

  getBaseDomain(hostname) {
    try {
      const parts = hostname.toLowerCase().split('.');
      if (parts.length <= 2) return hostname.toLowerCase();
      return parts.slice(-2).join('.');
    } catch (e) {
      return hostname;
    }
  }

  async checkUnsafeStatus(domain) {
    const host = domain.toLowerCase();
    const base = this.getBaseDomain(host);

    const flaggedLocal = this.unsafeIndex && (this.unsafeIndex.has(host) || this.unsafeIndex.has(base));
    if (flaggedLocal) {
      return { flagged: true, source: 'local', reason: 'Listed on local unsafe blocklist' };
    }

    try {
      const { gSafeKey } = await chrome.storage.sync.get(['gSafeKey']);
      if (gSafeKey) {
        const flagged = await this.queryGoogleSafeBrowsing(host, gSafeKey);
        if (flagged === true) {
          return { flagged: true, source: 'gsb', reason: 'Unsafe per Google Safe Browsing' };
        }
      }
    } catch (e) {
      // ignore
    }

    return { flagged: false, source: 'none' };
  }

  async queryGoogleSafeBrowsing(domain, apiKey) {
    try {
      const body = {
        client: { clientId: 'consentsync', clientVersion: '0.6.1' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url: `http://${domain}/` }, { url: `https://${domain}/` }]
        }
      };
      const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) return false;
      const data = await res.json();
      return !!(data && data.matches && data.matches.length > 0);
    } catch (e) {
      return false;
    }
  }

  getRiskLevel(score) {
    if (score >= 80) return 'safe';
    if (score >= 50) return 'medium-risk';
    return 'high-risk';
  }

  updateStatistics() {
    const totalSites = this.sites.length;
    const avgScore = totalSites > 0 ? Math.round(this.sites.reduce((sum, site) => sum + site.privacyScore, 0) / totalSites) : 0;
    const totalCookies = this.sites.reduce((sum, site) => sum + site.cookies, 0);
    const highRiskSites = this.sites.filter(site => site.riskLevel === 'high-risk').length;

    document.getElementById('totalSites').textContent = totalSites;
    document.getElementById('avgScore').textContent = avgScore;
    document.getElementById('totalCookies').textContent = totalCookies;
    document.getElementById('highRiskSites').textContent = highRiskSites;
  }

  renderSites() {
    const container = document.getElementById('sitesList');
    
    // Filter sites
    let filteredSites = this.sites.filter(site => {
      // Apply search filter
      if (this.searchTerm && !site.domain.toLowerCase().includes(this.searchTerm)) {
        return false;
      }

      // Apply risk filter
      if (this.currentFilter === 'high-risk' && site.riskLevel !== 'high-risk') return false;
      if (this.currentFilter === 'medium-risk' && site.riskLevel !== 'medium-risk') return false;
      if (this.currentFilter === 'safe' && site.riskLevel !== 'safe') return false;
      if (this.currentFilter === 'recent') {
        const lastVisited = new Date(site.lastVisited);
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        if (lastVisited < oneDayAgo) return false;
      }

      return true;
    });

    // Sort sites
    filteredSites.sort((a, b) => {
      if (this.currentFilter === 'recent') {
        return new Date(b.lastVisited) - new Date(a.lastVisited);
      }
      return b.privacyScore - a.privacyScore;
    });

    if (filteredSites.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <i class="fas fa-search"></i>
          </div>
          <div class="empty-text">No sites found</div>
          <div class="empty-hint">Try adjusting your search or filters</div>
        </div>
      `;
      return;
    }

    container.innerHTML = filteredSites.map(site => this.renderSiteRow(site)).join('');
  }

  renderSiteRow(site) {
    const domain = site.domain;
    const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    
    return `
      <div class="site-row" data-domain="${domain}">
        <div class="site-info">
          <div class="site-icon">
            <img src="${favicon}" alt="${domain}" style="width: 16px; height: 16px; border-radius: 2px;" onerror="this.onerror=null; this.src='icons/default_favicon.svg';">
          </div>
          <div>
            <div class="site-domain">${domain}</div>
            <div class="site-url">${site.cookies} cookies</div>
          </div>
        </div>
        ${site.unsafe ? `
        <div style="grid-column: 1 / -1; background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; padding: 6px 10px; border-radius: 6px; margin: 6px 0; display: flex; align-items: center; gap: 8px;">
          <span>⚠️</span>
          <span>This website is unsafe. It may contain tracking or phishing risks.</span>
        </div>` : ''}
        
        <div class="permission-status ${this.getStatusClass(site.permissions.geolocation)}">
          <i class="fas fa-map-marker-alt"></i>
          ${site.permissions.geolocation}
        </div>
        
        <div class="permission-status ${this.getStatusClass(site.permissions.notifications)}">
          <i class="fas fa-bell"></i>
          ${site.permissions.notifications}
        </div>
        
        <div class="permission-status ${this.getStatusClass(site.permissions.camera)}">
          <i class="fas fa-video"></i>
          ${site.permissions.camera}
        </div>
        
        <div class="permission-status ${this.getStatusClass(site.permissions.microphone)}">
          <i class="fas fa-microphone"></i>
          ${site.permissions.microphone}
        </div>
        
        <div class="permission-status">
          ${site.cookies}
        </div>
        
        <div class="safety-score">
          <div class="score-circle ${this.getScoreClass(site.privacyScore)}">
            ${this.getScoreEmoji(site.privacyScore)}
          </div>
          ${site.privacyScore}
        </div>
        
        <div class="site-actions">
          <button class="btn-icon btn-primary" data-action="visit-site" data-domain="${domain}" title="Visit site">
            <i class="fas fa-external-link-alt"></i>
          </button>
          <button class="btn-icon btn-danger" data-action="clear-cookies" data-domain="${domain}" title="Clear cookies">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }

  getStatusClass(status) {
    switch (status) {
      case 'allow': return 'status-allow';
      case 'block': return 'status-block';
      default: return 'status-prompt';
    }
  }

  getScoreClass(score) {
    if (score >= 80) return 'score-safe';
    if (score >= 50) return 'score-warning';
    return 'score-danger';
  }

  getScoreEmoji(score) {
    if (score >= 80) return '🟢';
    if (score >= 50) return '🟡';
    return '🔴';
  }

  async addCurrentSite() {
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (tab && tab.url) {
        const url = new URL(tab.url);
        const domain = url.hostname;
        
        // Check if site already exists
        const existingSite = this.sites.find(site => site.domain === domain);
        if (existingSite) {
          this.toast('Site already tracked', 'info');
          return;
        }

        // Add new site
        const newSite = {
          domain: domain,
          cookies: 0,
          permissions: {
            geolocation: 'prompt',
            notifications: 'prompt',
            camera: 'prompt',
            microphone: 'prompt'
          },
          lastVisited: new Date().toISOString(),
          privacyScore: 100,
          riskLevel: 'safe'
        };

        this.sites.unshift(newSite);
        this.updateStatistics();
        this.renderSites();
        
        this.addConsentLog({
          action: this.getMsg('added_domain_tracking', domain),
          details: this.getMsg('site_added_to_monitoring'),
          type: 'site_added'
        });
        
        this.addActivity(this.getMsg('added_domain_tracking', domain), 'success');
        this.toast(`Added ${domain}`, 'success');
      }
    } catch (error) {
      console.error('Error adding current site:', error);
      this.toast('Error adding site', 'error');
    }
  }

  async visitSite(domain) {
    try {
      await chrome.tabs.create({url: `https://${domain}`});
      this.addActivity(this.getMsg('opened_domain', domain), 'info');
    } catch (error) {
      console.error('Error opening site:', error);
    }
  }

  async clearSiteCookies(domain) {
    try {
      const cookies = await chrome.cookies.getAll({domain: domain});
      for (const cookie of cookies) {
        await chrome.cookies.remove({
          url: `https://${domain}`,
          name: cookie.name
        });
      }
      
      // Update site data
      const site = this.sites.find(s => s.domain === domain);
      if (site) {
        site.cookies = 0;
        site.privacyScore = this.calculateSiteScore(site);
        site.riskLevel = this.getRiskLevel(site.privacyScore);
      }
      
      this.updateStatistics();
      this.renderSites();
      
      this.addConsentLog({
        action: this.getMsg('cleared_cookies_for', domain),
        details: this.getMsg('removed_cookies_count', String(cookies.length)),
        type: 'cookies_cleared'
      });
      
      this.addActivity(this.getMsg('cleared_cookies_for', domain), 'danger');
      this.toast(`Cleared cookies for ${domain}`, 'success');
    } catch (error) {
      console.error('Error clearing cookies:', error);
      this.toast('Error clearing cookies', 'error');
    }
  }

  // Policy Analyzer Functions
  async analyzeCurrentSite() {
    try {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      if (tab && tab.url) {
        this.addActivity(this.getMsg('analyzing_current_site'), 'info');
        const hostname = new URL(tab.url).hostname;
        let unsafeInfo = { flagged: false };
        try { unsafeInfo = await this.checkUnsafeStatus(hostname); } catch (e) {}
        
        // Check if we can inject content script
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
          this.addActivity(this.getMsg('cannot_scan_page_type'), 'warning');
          this.addConsentLog({
            action: this.getMsg('cannot_scan_page_type'),
            details: this.getMsg('page_type_not_supported'),
            type: 'policy_analysis'
          });
          if (unsafeInfo.flagged) {
            const results = document.getElementById('analysisResults');
            if (results) {
              results.style.display = 'block';
              results.innerHTML = `
                <div style="background:#fee2e2;border:1px solid #fecaca;color:#991b1b;padding:12px;border-radius:8px;">
                  <strong>⚠️ Privacy policy unavailable or hidden. Treated as unsafe.</strong>
                </div>`;
            }
          }
          return;
        }
        
        // First detect privacy policy
        chrome.tabs.sendMessage(tab.id, {type: "FIND_POLICY"}, (response) => {
          if (chrome.runtime.lastError) {
            // Content script not loaded, try to inject it
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js']
            }, () => {
              if (chrome.runtime.lastError) {
                this.addActivity(this.getMsg('cannot_inject_script'), 'warning');
                this.addConsentLog({
                  action: this.getMsg('cannot_scan_page_type'),
                  details: this.getMsg('script_injection_not_allowed'),
                  type: 'policy_analysis'
                });
                if (unsafeInfo.flagged) {
                  const results = document.getElementById('analysisResults');
                  if (results) {
                    results.style.display = 'block';
                    results.innerHTML = `
                      <div style="background:#fee2e2;border:1px solid #fecaca;color:#991b1b;padding:12px;border-radius:8px;">
                        <strong>⚠️ Privacy policy unavailable or hidden. Treated as unsafe.</strong>
                      </div>`;
                  }
                }
                return;
              }
              
              // Try again after injection
              setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, {type: "FIND_POLICY"}, (response2) => {
                  const policyUrl = (response2 && response2.link) ? response2.link : null;
                  if (policyUrl) {
                    this.addActivity(this.getMsg('privacy_policy_found'), 'success');
                  } else {
                    this.addActivity(this.getMsg('no_privacy_policy_site'), 'warning');
                  }
                  // Deterministic score: permissions, cookies, unsafe flag, policy keywords
                  this.computePolicyAnalysisScore(hostname, unsafeInfo, policyUrl).then(({ score, riskLevel, policyUrl: url }) => {
                    const details = url
                      ? this.getMsg('policy_url_score', url, String(score), riskLevel)
                      : this.getMsg('no_policy_found_score', String(score), riskLevel);
                    this.addConsentLog({
                      action: this.getMsg('analyzed_policy_for', hostname),
                      details: details,
                      type: 'policy_analysis'
                    });
                    this.addActivity(this.getMsg('policy_analysis_complete', String(score), riskLevel), 'success');
                    this.toast(`Policy analysis complete: ${score}/100`, 'success');
                    if (unsafeInfo.flagged && !url) {
                      const results = document.getElementById('analysisResults');
                      if (results) {
                        results.style.display = 'block';
                        results.innerHTML = `
                          <div style="background:#fee2e2;border:1px solid #fecaca;color:#991b1b;padding:12px;border-radius:8px;">
                            <strong>No privacy policy detected – High Risk.</strong>
                          </div>`;
                      }
                    }
                  }).catch((err) => {
                    console.error('Policy analysis failed:', err);
                    this.toast('Policy analysis failed', 'error');
                  });
                });
              }, 500);
            });
            return;
          }
          
          if (response && response.link) {
            this.addActivity(this.getMsg('privacy_policy_found'), 'success');
            const policyUrl = response.link;
            // Deterministic score: permissions, cookies, unsafe flag, policy keywords
            this.computePolicyAnalysisScore(hostname, unsafeInfo, policyUrl).then(({ score, riskLevel }) => {
              this.addConsentLog({
                action: this.getMsg('analyzed_policy_for', hostname),
                details: this.getMsg('policy_url_score', policyUrl, String(score), riskLevel),
                type: 'policy_analysis'
              });
              this.addActivity(this.getMsg('policy_analysis_complete', String(score), riskLevel), 'success');
              this.toast(`Policy analysis complete: ${score}/100`, 'success');
            }).catch((err) => {
              console.error('Policy analysis failed:', err);
              this.toast('Policy analysis failed', 'error');
            });
          } else {
            this.addActivity(this.getMsg('no_privacy_policy_site'), 'warning');
            // Deterministic score: no policy = penalty, plus cookies, permissions, unsafe
            this.computePolicyAnalysisScore(hostname, unsafeInfo, null).then(({ score, riskLevel }) => {
              this.addConsentLog({
                action: this.getMsg('no_policy_found_for', hostname),
                details: this.getMsg('no_policy_site_score', String(score), riskLevel),
                type: 'policy_analysis'
              });
              if (unsafeInfo.flagged) {
                const results = document.getElementById('analysisResults');
                if (results) {
                  results.style.display = 'block';
                  results.innerHTML = `
                    <div style="background:#fee2e2;border:1px solid #fecaca;color:#991b1b;padding:12px;border-radius:8px;">
                      <strong>No privacy policy detected – High Risk.</strong>
                    </div>`;
                }
              }
            }).catch((err) => {
              console.error('Policy analysis failed:', err);
              this.toast('Policy analysis failed', 'error');
            });
          }
        });
      }
    } catch (error) {
      console.error('Error analyzing current site:', error);
      this.toast('Error analyzing site', 'error');
    }
  }

  async analyzeAllSites() {
    this.addActivity(this.getMsg('analyzing_all_sites'), 'info');

    // Use existing deterministic scores from loadSites (cookies, permissions, unsafe)
    const totalSites = this.sites.length;
    const avgScore = totalSites > 0
      ? Math.round(this.sites.reduce((sum, s) => sum + s.privacyScore, 0) / totalSites)
      : 0;
    const highRiskCount = this.sites.filter(s => s.riskLevel === 'high-risk').length;

    this.addConsentLog({
      action: this.getMsg('bulk_analysis_completed'),
      details: this.getMsg('bulk_analysis_details', String(totalSites), String(avgScore), String(highRiskCount)),
      type: 'bulk_analysis'
    });

    this.addActivity(this.getMsg('bulk_analysis_complete'), 'success');
    this.toast(`Bulk analysis complete: ${totalSites} sites`, 'success');
  }

  async exportAnalysis() {
    const analysisData = {
      sites: this.sites.map(site => ({
        domain: site.domain,
        privacyScore: site.privacyScore,
        riskLevel: site.riskLevel,
        cookies: site.cookies,
        permissions: site.permissions
      })),
      exportDate: new Date().toISOString(),
      version: '0.6.1'
    };

    const blob = new Blob([JSON.stringify(analysisData, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consentsync-analysis-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    this.addActivity(this.getMsg('analysis_exported'), 'success');
    this.toast('Analysis exported', 'success');
  }

  // Consent Log Functions
  addConsentLog(logEntry) {
    const entry = {
      ...logEntry,
      timestamp: new Date().toISOString(),
      id: Date.now()
    };
    
    this.consentLog.unshift(entry);
    
    // Keep only last 100 entries
    if (this.consentLog.length > 100) {
      this.consentLog = this.consentLog.slice(0, 100);
    }
    
    // Save to storage
    chrome.storage.local.set({ consentLog: this.consentLog });
    
    // Update UI if on consent tab
    if (this.currentTab === 'consent') {
      this.renderConsentLog();
    }
  }

  renderConsentLog() {
    const container = document.getElementById('consentLogList');
    
    if (this.consentLog.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <i class="fas fa-clipboard-list"></i>
          </div>
          <div class="empty-text">No consent actions recorded</div>
          <div class="empty-hint">Your privacy actions will appear here</div>
        </div>
      `;
      return;
    }
    
    container.innerHTML = this.consentLog.map(entry => this.renderLogEntry(entry)).join('');
  }

  renderLogEntry(entry) {
    const iconMap = {
      'cookies_cleared': 'fas fa-trash',
      'permission_blocked': 'fas fa-ban',
      'policy_analysis': 'fas fa-shield-alt',
      'preference_update': 'fas fa-cog',
      'automation_toggle': 'fas fa-robot',
      'site_added': 'fas fa-plus',
      'bulk_analysis': 'fas fa-globe',
      'auto_clean_executed': 'fas fa-clock'
    };

    const colorMap = {
      'cookies_cleared': 'var(--gradient-success)',
      'permission_blocked': 'var(--gradient-danger)',
      'policy_analysis': 'var(--gradient-warning)',
      'preference_update': 'var(--gradient-info)',
      'automation_toggle': 'var(--gradient-primary)',
      'site_added': 'var(--gradient-success)',
      'bulk_analysis': 'var(--gradient-warning)',
      'auto_clean_executed': 'var(--gradient-info)'
    };

    const icon = iconMap[entry.type] || 'fas fa-info-circle';
    const color = colorMap[entry.type] || 'var(--gradient-info)';
    const timeAgo = this.getTimeAgo(entry.timestamp);
    const isSystemAction = entry.type === 'auto_clean_executed';

    return `
      <div class="log-entry">
        <div class="log-icon" style="background: ${color};">
          <i class="${icon}"></i>
        </div>
        <div class="log-content">
          <div class="log-action">${entry.action}</div>
          <div class="log-details">${entry.details}</div>
        </div>
        <div class="log-time">${isSystemAction ? `<span class="system-badge">System Action</span>` : ''}${timeAgo}</div>
      </div>
    `;
  }

  getTimeAgo(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }

  filterConsentLog(searchTerm) {
    const filteredLog = this.consentLog.filter(entry => 
      entry.action.toLowerCase().includes(searchTerm) ||
      entry.details.toLowerCase().includes(searchTerm)
    );

    const container = document.getElementById('consentLogList');
    if (filteredLog.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">
            <i class="fas fa-search"></i>
          </div>
          <div class="empty-text">No matching actions found</div>
          <div class="empty-hint">Try a different search term</div>
        </div>
      `;
      return;
    }

    container.innerHTML = filteredLog.map(entry => this.renderLogEntry(entry)).join('');
  }

  async clearConsentLog() {
    this.consentLog = [];
    await chrome.storage.local.set({ consentLog: [] });
    this.renderConsentLog();
    this.addActivity(this.getMsg('consent_log_cleared'), 'warning');
    this.toast('Consent log cleared', 'success');
  }

  // GDPR Functions
  async eraseAllData() {
    if (confirm('Are you sure you want to permanently delete all your data? This action cannot be undone.')) {
      try {
        // Clear all storage
        await chrome.storage.local.clear();
        await chrome.storage.sync.clear();
        
        // Reset local data
        this.sites = [];
        this.consentLog = [];
        this.smartPreferences = {};
        this.activityFeed = [];
        
        // Update UI
        this.updateStatistics();
        this.renderSites();
        this.renderConsentLog();
        this.updatePreferenceStatuses();
        
        this.addActivity(this.getMsg('all_data_erased'), 'danger');
        this.toast('All data erased successfully', 'success');
      } catch (error) {
        console.error('Error erasing data:', error);
        this.toast('Error erasing data', 'error');
      }
    }
  }

  openPrivacySettings() {
    // In a real implementation, this would open a settings modal
    this.addActivity(this.getMsg('privacy_settings_opened'), 'info');
    this.toast('Privacy settings feature coming soon', 'info');
  }

  showDataTransparency() {
    const transparencyData = {
      dataCollected: [
        'Privacy preferences (local storage)',
        'Site permissions (local storage)',
        'Consent log entries (local storage)',
        'Automation rules (sync storage)'
      ],
      dataNotCollected: [
        'Browsing history',
        'Personal information',
        'Website content',
        'User behavior patterns'
      ],
      dataProcessing: 'All processing happens locally in your browser',
      dataSharing: 'No data is shared with third parties'
    };

    alert(`Data Transparency Report:\n\n` +
          `Data Collected:\n${transparencyData.dataCollected.join('\n')}\n\n` +
          `Data NOT Collected:\n${transparencyData.dataNotCollected.join('\n')}\n\n` +
          `Processing: ${transparencyData.dataProcessing}\n` +
          `Sharing: ${transparencyData.dataSharing}`);

    this.addActivity(this.getMsg('data_transparency_viewed'), 'info');
  }

  // Recommendation Functions
  /**
   * Count permission blocks from consentLog within the last N days.
   * Only counts entries with type 'permission_blocked' and valid permission field.
   * Maps consentLog permission names (geolocation, camera, etc.) to dashboard names (location, camera, etc.).
   * @param {Array} consentLog
   * @param {number} daysBack - e.g. 7 for "this week"
   * @returns {{ location: number, camera: number, microphone: number, notification: number }}
   */
  countPermissionBlocks(consentLog, daysBack = 7) {
    const counts = { location: 0, camera: 0, microphone: 0, notification: 0 };
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    consentLog.forEach(entry => {
      if (entry.type !== 'permission_blocked' || !entry.permission) return;
      const ts = new Date(entry.timestamp);
      if (ts < cutoff) return;

      // Map consentLog permission names to dashboard preference names
      const map = { geolocation: 'location', camera: 'camera', microphone: 'microphone', notifications: 'notification' };
      const key = map[entry.permission];
      if (key) counts[key]++;
    });

    return counts;
  }

  /**
   * Generate recommendations from block counts using rule-based logic.
   * Rule: if permission blocked >= 3 times in last 7 days → recommend auto-block.
   * @param {{ location: number, camera: number, microphone: number, notification: number }} blockCounts
   * @returns {Array<{ permission: string, count: number, label: string, icon: string, gradient: string }>}
   */
  generateRecommendations(blockCounts) {
    const THRESHOLD = 3;
    const config = [
      { permission: 'location', label: 'Location', icon: 'map-marker-alt', gradient: 'var(--gradient-primary)' },
      { permission: 'camera', label: 'Camera', icon: 'video', gradient: 'var(--gradient-danger)' },
      { permission: 'microphone', label: 'Microphone', icon: 'microphone', gradient: 'var(--gradient-warning)' },
      { permission: 'notification', label: 'Notifications', icon: 'bell', gradient: 'var(--gradient-info)' }
    ];

    const recommendations = [];
    config.forEach(({ permission, label, icon, gradient }) => {
      const count = blockCounts[permission] || 0;
      if (count >= THRESHOLD) {
        recommendations.push({
          permission,
          count,
          label,
          icon,
          gradient,
          text: `You've blocked ${label.toLowerCase()} access ${count} time${count === 1 ? '' : 's'} in the last 7 days. Enable auto-block for ${label.toLowerCase()}?`
        });
      }
    });

    return recommendations;
  }

  /**
   * Render Smart Recommendations into #recommendationsList.
   * Uses real block counts from consentLog. Shows "No recommendations available" if insufficient data.
   */
  renderRecommendations() {
    const container = document.getElementById('recommendationsList');
    if (!container) return;

    const blockCounts = this.countPermissionBlocks(this.consentLog, 7);
    const recommendations = this.generateRecommendations(blockCounts);

    if (recommendations.length === 0) {
      container.innerHTML = `
        <div class="recommendation-item recommendation-empty">
          <div class="recommendation-icon" style="background: var(--gradient-info);">
            <i class="fas fa-info-circle"></i>
          </div>
          <div class="recommendation-text">No recommendations available. Block permissions on sites to get personalized suggestions.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = recommendations.map(rec => `
      <div class="recommendation-item" data-permission="${rec.permission}">
        <div class="recommendation-icon" style="background: ${rec.gradient};">
          <i class="fas fa-${rec.icon}"></i>
        </div>
        <div class="recommendation-text">${rec.text}</div>
        <button class="recommendation-action btn-apply">Apply</button>
      </div>
    `).join('');
  }

  async applyRecommendation(button) {
    const recommendationItem = button.closest('.recommendation-item');
    const text = recommendationItem.querySelector('.recommendation-text').textContent;
    const permission = recommendationItem.dataset.permission;

    // Apply the recommendation: enable auto-block for this permission
    if (permission) {
      await this.updatePreference(permission, true);
    }

    this.addConsentLog({
      action: this.getMsg('applied_recommendation'),
      details: text,
      type: 'recommendation_applied'
    });

    this.addActivity(this.getMsg('recommendation_applied'), 'success');
    this.toast('Recommendation applied', 'success');

    // Remove the recommendation item
    recommendationItem.remove();
  }

  // Utility Functions
  addActivity(text, type = 'info') {
    const activity = {
      text,
      type,
      timestamp: new Date().toLocaleTimeString()
    };
    
    this.activityFeed.unshift(activity);
    
    // Keep only last 20 activities
    if (this.activityFeed.length > 20) {
      this.activityFeed = this.activityFeed.slice(0, 20);
    }
    
    this.renderActivity();
  }

  renderActivity() {
    const container = document.getElementById('dashboardActivity');
    
    if (this.activityFeed.length === 0) {
      container.innerHTML = `
        <div class="feed-item">
          <div class="feed-icon">
            <i class="fas fa-info-circle"></i>
          </div>
          <div class="feed-content">
            <div class="feed-text">No recent activity</div>
            <div class="feed-time">Just now</div>
          </div>
        </div>
      `;
      return;
    }
    
    container.innerHTML = this.activityFeed.map(activity => `
      <div class="feed-item">
        <div class="feed-icon ${activity.type}">
          <i class="fas fa-${this.getActivityIcon(activity.type)}"></i>
        </div>
        <div class="feed-content">
          <div class="feed-text">${activity.text}</div>
          <div class="feed-time">${activity.timestamp}</div>
        </div>
      </div>
    `).join('');
  }

  getActivityIcon(type) {
    const icons = {
      'success': 'check-circle',
      'danger': 'exclamation-triangle',
      'warning': 'exclamation-circle',
      'info': 'info-circle'
    };
    return icons[type] || 'info-circle';
  }

  clearActivity() {
    this.activityFeed = [];
    this.renderActivity();
    this.addActivity(this.getMsg('activity_cleared'), 'info');
  }

  exportToWord() {
    try {
      // Generate Word document content
      const docContent = this.generateWordDocument();
      
      // Create blob and download using Chrome's download API
      const blob = new Blob([docContent], {type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
      const url = URL.createObjectURL(blob);
      
      // Use Chrome's download API if available, otherwise fall back to anchor download
      if (chrome.downloads) {
        chrome.downloads.download({
          url: url,
          filename: `ConsentSync_Report_${new Date().toISOString().split('T')[0]}.docx`,
          saveAs: true
        }, () => {
          URL.revokeObjectURL(url);
        });
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `ConsentSync_Report_${new Date().toISOString().split('T')[0]}.docx`;
        a.click();
        URL.revokeObjectURL(url);
      }
      
      this.addActivity(this.getMsg('consent_log_exported_word'), 'success');
      this.toast('Word document exported successfully', 'success');
    } catch (error) {
      console.error('Error exporting to Word:', error);
      this.toast('Failed to export Word document', 'danger');
    }
  }

  generateWordDocument() {
    const now = new Date();
    const dateStr = now.toLocaleDateString();
    const timeStr = now.toLocaleTimeString();
    
    // Create a simple HTML-based Word document
    const htmlContent = `
      <!DOCTYPE html>
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>ConsentSync Privacy Report</title>
        <style>
          body { font-family: 'Calibri', sans-serif; margin: 40px; }
          h1 { color: #1f2937; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
          h2 { color: #374151; margin-top: 30px; }
          table { border-collapse: collapse; width: 100%; margin: 20px 0; }
          th, td { border: 1px solid #d1d5db; padding: 12px; text-align: left; }
          th { background-color: #f3f4f6; font-weight: bold; }
          .summary { background-color: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .log-entry { margin: 10px 0; padding: 10px; border-left: 4px solid #3b82f6; background-color: #f8fafc; }
          .timestamp { color: #6b7280; font-size: 0.9em; }
        </style>
      </head>
      <body>
        <h1>ConsentSync Privacy Report</h1>
        <p><strong>Generated:</strong> ${dateStr} at ${timeStr}</p>
        
        <div class="summary">
          <h2>Executive Summary</h2>
          <p>This report contains your privacy activity tracked by ConsentSync, including consent actions, site permissions, and privacy preferences.</p>
          <ul>
            <li><strong>Total Sites Tracked:</strong> ${this.sites.length}</li>
            <li><strong>Total Consent Actions:</strong> ${this.consentLog.length}</li>
            <li><strong>Report Period:</strong> All time</li>
          </ul>
        </div>

        <h2>Tracked Websites</h2>
        <table>
          <thead>
            <tr>
              <th>Domain</th>
              <th>Cookies</th>
              <th>Location</th>
              <th>Notifications</th>
              <th>Camera</th>
              <th>Microphone</th>
              <th>Privacy Score</th>
            </tr>
          </thead>
          <tbody>
            ${this.sites.map(site => `
              <tr>
                <td>${site.domain}</td>
                <td>${site.cookies}</td>
                <td>${site.permissions.geolocation}</td>
                <td>${site.permissions.notifications}</td>
                <td>${site.permissions.camera}</td>
                <td>${site.permissions.microphone}</td>
                <td>${site.privacyScore}/100</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <h2>Consent Actions Log</h2>
        ${this.consentLog.length > 0 ? this.consentLog.map(entry => `
          <div class="log-entry">
            <strong>${entry.action}</strong><br>
            <span>${entry.details}</span><br>
            <span class="timestamp">${new Date(entry.timestamp).toLocaleString()}</span>
          </div>
        `).join('') : '<p>No consent actions recorded.</p>'}

        <h2>Smart Preferences</h2>
        <table>
          <thead>
            <tr>
              <th>Preference</th>
              <th>Status</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Auto-Apply Preferences</td>
              <td>${this.smartPreferences.autoApply ? 'Enabled' : 'Disabled'}</td>
              <td>Automatically apply privacy preferences to new sites</td>
            </tr>
            <tr>
              <td>Location Access</td>
              <td>${this.smartPreferences.location ? 'Allowed' : 'Blocked'}</td>
              <td>Default location permission setting</td>
            </tr>
            <tr>
              <td>Camera Access</td>
              <td>${this.smartPreferences.camera ? 'Allowed' : 'Blocked'}</td>
              <td>Default camera permission setting</td>
            </tr>
            <tr>
              <td>Microphone Access</td>
              <td>${this.smartPreferences.microphone ? 'Allowed' : 'Blocked'}</td>
              <td>Default microphone permission setting</td>
            </tr>
            <tr>
              <td>Notifications</td>
              <td>${this.smartPreferences.notification ? 'Allowed' : 'Blocked'}</td>
              <td>Default notification permission setting</td>
            </tr>
          </tbody>
        </table>

        <div class="summary">
          <h2>Privacy Recommendations</h2>
          <ul>
            <li>Regularly review and clear cookies from sites you don't frequently visit</li>
            <li>Consider blocking location access for sites that don't require it</li>
            <li>Review camera and microphone permissions periodically</li>
            <li>Enable auto-apply preferences for consistent privacy protection</li>
          </ul>
        </div>

        <p style="margin-top: 40px; color: #6b7280; font-size: 0.9em;">
          This report was generated by ConsentSync v0.6.1. For more information about your privacy rights, 
          visit the privacy policy of each website you interact with.
        </p>
      </body>
      </html>
    `;
    
    return htmlContent;
  }

  exportData() {
    const data = {
      sites: this.sites,
      consentLog: this.consentLog,
      smartPreferences: this.smartPreferences,
      exportDate: new Date().toISOString(),
      version: '0.6.1'
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consentsync-data-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    this.addActivity(this.getMsg('data_exported'), 'success');
    this.toast('Data exported', 'success');
  }

  toast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.hidden = false;
    setTimeout(() => toast.hidden = true, 3000);
  }
}

// Initialize dashboard
let dashboard;
document.addEventListener('DOMContentLoaded', () => {
  dashboard = new ConsentSyncDashboard();
});
