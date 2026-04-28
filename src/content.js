
(function () {
  // Multilingual privacy policy keywords. English terms from the original
  // list are preserved for backward compatibility.
  const privacyKeywords = [
    // English
    'privacy',
    'privacy policy',
    'privacy-policy',
    'privacy_policy',
    'data policy',
    'data-policy',
    'data_policy',
    'data protection',
    'data-protection',
    'cookie policy',
    'cookie-policy',
    'cookiepolicy',
    'data privacy',

    // Spanish
    'privacidad',
    'política de privacidad',
    'politica de privacidad',
    'proteccion de datos',
    'protección de datos',

    // French
    'confidentialité',
    'confidentialite',
    'politique de confidentialité',
    'politique de confidentialite',

    // German
    'datenschutz',
    'datenschutzerklärung',
    'datenschutzerklarung',

    // Italian
    'politica sulla privacy',
    'informativa sulla privacy',

    // Portuguese
    'política de privacidade',
    'politica de privacidade',

    // Dutch
    'privacybeleid',

    // Japanese
    'プライバシー',

    // Chinese (Simplified)
    '隐私',
    '隱私'
  ];

  // Cache for dynamically detected policy link (MutationObserver)
  // Exposed on window for debugging/inspection without affecting functionality.
  let cachedPolicyLink = null;

  function norm(url) {
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return url;
    }
  }

  function isPrivacyPolicyMatch(textLower, hrefLower) {
    return privacyKeywords.some(keyword => {
      const kw = keyword.toLowerCase();
      return (textLower && textLower.includes(kw)) || (hrefLower && hrefLower.includes(kw));
    });
  }

  function scanAnchors(anchors) {
    let link = null;
    try {
      anchors.forEach(a => {
        if (link) return;
        const hrefAttr = a.getAttribute && a.getAttribute('href') ? a.getAttribute('href') : (a.href || '');
        const fullHref = norm(hrefAttr);
        const hrefLower = (fullHref || hrefAttr || '').toLowerCase();
        const textLower = ((a.innerText || a.textContent || '') + '').toLowerCase();

        if (isPrivacyPolicyMatch(textLower, hrefLower)) {
          link = fullHref;
        }
      });
    } catch (e) {
      // ignore
    }
    return link;
  }

  function scanDoc(doc) {
    let link = null;
    try {
      const anchors = doc.querySelectorAll('a[href]');
      anchors.forEach(a => {
        if (link) return; // keep the first detected policy link

        const hrefAttr = a.getAttribute('href') || '';
        const fullHref = norm(hrefAttr);
        const hrefLower = (fullHref || hrefAttr).toLowerCase();
        const textLower = (a.innerText || '').toLowerCase();

        const isPolicy = isPrivacyPolicyMatch(textLower, hrefLower);

        if (isPolicy) {
          link = fullHref;
        }
      });
    } catch (e) {
      // swallow errors; detection failure should not break the page
    }
    return link;
  }

  // 3️⃣ Footer + navigation scans (more likely places for policy links)
  function scanFooterAndNav() {
    try {
      const doc = document;
      const candidates = [];

      doc.querySelectorAll('footer').forEach(el => candidates.push(el));
      doc.querySelectorAll('nav').forEach(el => candidates.push(el));
      doc.querySelectorAll("[role='contentinfo']").forEach(el => candidates.push(el));

      for (const container of candidates) {
        const link = scanAnchors(Array.from(container.querySelectorAll('a[href]')));
        if (link) return link;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  // 4️⃣ Cookie consent / CMP banner scans
  function scanCookieConsentBanners() {
    try {
      const selectors = [
        "[id*='cookie' i]",
        "[class*='cookie' i]",
        "[id*='consent' i]",
        "[class*='consent' i]"
      ];

      const seen = new Set();
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => seen.add(el));
      }

      for (const container of seen) {
        const link = scanAnchors(Array.from(container.querySelectorAll('a[href]')));
        if (link) return link;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  // 2️⃣ Observe dynamic DOM insertions (cookie banners / lazy footers / menus)
  function setupDynamicObserver() {
    try {
      if (!document || !document.documentElement) return;

      const observer = new MutationObserver(() => {
        try {
          // Only do work if we haven't already found a link.
          if (cachedPolicyLink) return;

          const detected = scanDoc(document);
          if (detected) {
            cachedPolicyLink = detected;
            window.__consentSyncPolicyLink = detected;
            observer.disconnect();
          }
        } catch (e) {
          // ignore
        }
      });

      const target = document.body || document.documentElement;
      observer.observe(target, { childList: true, subtree: true });

      // Safety: stop observing after a short window to avoid long-lived observers.
      setTimeout(() => {
        try { observer.disconnect(); } catch (e) {}
      }, 15000);
    } catch (e) {
      // ignore
    }
  }

  setupDynamicObserver();

  function findAll() {
    // 1️⃣ Normal anchor scan (existing logic)
    let l = scanDoc(document);
    if (l) return l;
    document.querySelectorAll('iframe').forEach(fr => {
      try {
        if (!l && fr.contentDocument) l = scanDoc(fr.contentDocument);
      } catch (e) {
        // ignore cross-origin iframe access errors
      }
    });
    return l;
  }

  // 5️⃣ Fallback URL guessing: only used when normal scans find nothing.
  // Improvements:
  // - Expanded common URL patterns (multi-language + legal pages)
  // - Uses GET instead of HEAD (many sites block HEAD)
  // - Smart discovery: looks for obvious privacy slugs in existing links first
  const fallbackPaths = [
    // English
    '/privacy',
    '/privacy-policy',
    '/privacy-policy.html',
    '/privacy_policy',
    '/privacy-notice',
    '/legal/privacy',

    // Spanish
    '/politica-de-privacidad',
    '/privacidad',
    '/legal/privacidad',

    // French
    '/politique-de-confidentialite',
    '/confidentialite',

    // German
    '/datenschutz',
    '/datenschutzerklaerung',

    // Italian
    '/informativa-privacy',

    // Portuguese
    '/politica-de-privacidade',

    // Generic legal pages
    '/legal',
    '/legal-notice',
    '/terms/privacy'
  ];

  function findSmartPolicyLinkInPage() {
    // Quick scan for common slugs in href (helps when DOM text is not accessible)
    // Keeps this scoped to obvious patterns to avoid false positives.
    try {
      const selectors = [
        "a[href*='privacy' i]",
        "a[href*='privacidad' i]",
        "a[href*='datenschutz' i]",
        "a[href*='confidentialite' i]",
        "a[href*='confidentialit%C3%A9' i]" // URL-encoded "confidentialité"
      ];

      for (const sel of selectors) {
        const anchors = Array.from(document.querySelectorAll(sel));
        const link = scanAnchors(anchors);
        if (link) return link;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  async function validateCandidate(url) {
    // Validate via GET (more compatible than HEAD). Avoid downloading large content:
    // - Use Range when possible to fetch only the first bytes.
    // - Use redirects as success indicators too.
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        headers: { 'Range': 'bytes=0-1023' },
        signal: controller.signal
      });

      clearTimeout(timeout);

      const status = res && typeof res.status === 'number' ? res.status : 0;
      return status === 200 || status === 206 || status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
    } catch (e) {
      return false;
    }
  }

  async function findFallbackPolicyUrl() {
    // 5a) Smart discovery based on existing links
    const smart = findSmartPolicyLinkInPage();
    if (smart) return smart;

    // 5b) Guess common paths on the current origin
    const origin = location && location.origin ? location.origin : '';
    if (!origin) return null;

    for (const path of fallbackPaths) {
      const candidate = `${origin}${path}`;
      try {
        const ok = await validateCandidate(candidate);
        if (ok) return candidate;
      } catch (e) {
        // keep going
      }
    }

    return null;
  }

  chrome.runtime.onMessage.addListener((m, s, send) => {
    if (!(m && m.type === 'FIND_POLICY')) return;

    // 1️⃣ Normal detection (unchanged): DOM scan + iframes
    const found = findAll();
    if (found) {
      send({ link: found });
      return;
    }

    // 2️⃣ Dynamic insertion cache (MutationObserver result)
    if (cachedPolicyLink) {
      send({ link: cachedPolicyLink });
      return;
    }

    // 3️⃣ Footer/nav/contentinfo scan
    const footerNav = scanFooterAndNav();
    if (footerNav) {
      send({ link: footerNav });
      return;
    }

    // 4️⃣ Cookie consent banner scan
    const cookieBanner = scanCookieConsentBanners();
    if (cookieBanner) {
      send({ link: cookieBanner });
      return;
    }

    // 5️⃣ Fallback URL guessing: try common policy paths if nothing found
    findFallbackPolicyUrl()
      .then((candidate) => send({ link: candidate }))
      .catch(() => send({ link: null }));

    // Keep the message channel open for async sendResponse.
    return true;
  });
})();
