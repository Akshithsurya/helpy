// blocked.js — runs on the blocked.html redirect page.
// Reads the originally-blocked URL from the query string and displays it.

(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const blockedUrl = params.get('url') || '';
  const activeRule = params.get('rule') || 'Helpy Blocklist';

  // Display the blocked domain
  const domainEl = document.getElementById('blocked-domain');
  if (domainEl && blockedUrl) {
    try {
      const hostname = new URL(blockedUrl).hostname.replace(/^www\./, '');
      domainEl.textContent = hostname;
    } catch {
      domainEl.textContent = blockedUrl.slice(0, 60);
    }
  }

  // Display the active rule name
  const ruleEl = document.getElementById('active-rule');
  if (ruleEl) {
    ruleEl.textContent = activeRule;
  }

  // "Go Back" button — if there's no history, close the tab
  const backBtn = document.getElementById('btn-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
      } else if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.update({ url: 'chrome://newtab/' });
      }
    });
  }

  // "New Tab" button
  const newTabBtn = document.getElementById('btn-newtab');
  if (newTabBtn) {
    newTabBtn.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.update({ url: 'chrome://newtab/' });
      } else {
        window.location.href = 'chrome://newtab/';
      }
    });
  }
})();
