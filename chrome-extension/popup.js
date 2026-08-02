let pomodoroInterval = null;
let previousTrackedTabCount = null;
let lastRenderedTabIds = [];
let pendingStateUpdate = false;
let lastState = null;

// Smart Recommendation
function generateSmartRecommendation(totalAvailableMinutes, workIntensity, userEnergyLevel) {
  const clampedIntensity = Math.max(1, Math.min(100, workIntensity));
  const clampedEnergy = Math.max(1, Math.min(100, userEnergyLevel));
  const clampedMinutes = Math.max(15, totalAvailableMinutes);

  let optimalWorkMinutes;
  if (clampedEnergy >= 80 && clampedIntensity >= 70) {
    optimalWorkMinutes = 60;
  } else if (clampedEnergy >= 60) {
    optimalWorkMinutes = 45;
  } else if (clampedEnergy >= 40) {
    optimalWorkMinutes = 30;
  } else {
    optimalWorkMinutes = 20;
  }

  if (clampedMinutes < 30) {
    optimalWorkMinutes = Math.min(optimalWorkMinutes, 20);
  } else if (clampedMinutes < 60) {
    optimalWorkMinutes = Math.min(optimalWorkMinutes, 30);
  }

  const optimalBreakMinutes = Math.max(3, Math.min(15, Math.floor(optimalWorkMinutes / 5)));
  const estimatedProductivityGain = Math.min(
    35,
    10 + Math.floor(clampedIntensity / 10) + Math.floor(clampedEnergy / 20)
  );

  let recommendation;
  if (clampedEnergy >= 80 && clampedIntensity >= 70) {
    recommendation =
      "You're in deep work mode! Take advantage of your high energy with longer focus blocks.";
  } else if (clampedEnergy >= 60) {
    recommendation =
      'Balanced energy levels - standard focus blocks with moderate breaks should work well.';
  } else if (clampedEnergy >= 40) {
    recommendation =
      'Lower energy levels - shorter, more frequent focus blocks will help maintain productivity.';
  } else {
    recommendation = 'Low energy - consider light tasks with very short focus bursts.';
  }

  return { optimalWorkMinutes, optimalBreakMinutes, estimatedProductivityGain, recommendation };
}

// Update smart recommendation UI
function updateSmartRecommendation() {
  const duration = parseInt(document.getElementById('popupPlanDuration').value, 10) || 30;
  const intensity = parseInt(document.getElementById('workIntensity').value, 10) || 60;
  const energy = parseInt(document.getElementById('userEnergy').value, 10) || 70;

  const rec = generateSmartRecommendation(duration, intensity, energy);
  document.getElementById('recommendationText').textContent = rec.recommendation;
  document.getElementById('recommendationStats').innerHTML =
    `Recommended: ${rec.optimalWorkMinutes} min work / ${rec.optimalBreakMinutes} min break | Est. productivity gain: ${rec.estimatedProductivityGain}%`;

  // Update chunk size select to match recommendation if possible
  const chunkSelect = document.getElementById('popupChunkSize');
  const validValues = [5, 10, 15, 20, 30];
  const closestChunk = validValues.reduce((prev, curr) =>
    Math.abs(curr - rec.optimalWorkMinutes) < Math.abs(prev - rec.optimalWorkMinutes) ? curr : prev
  );
  chunkSelect.value = closestChunk;
}

function formatInactiveTime(ms) {
  const minutes = Math.floor(ms / (1000 * 60));
  if (minutes < 1) {
    return 'Just now';
  } else if (minutes < 60) {
    return `${minutes} min`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
}

function formatPomodoroTime(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function getAddressName(displayName) {
  return displayName || 'there';
}

function personalizeLabel(baseLabel, displayName) {
  const name = displayName;
  return name ? `${baseLabel}, ${name}` : baseLabel;
}

function announcePopupMessage(message) {
  const liveRegion = document.getElementById('popupAnnouncements');
  if (!liveRegion || !message) {
    return;
  }

  liveRegion.textContent = '';
  requestAnimationFrame(() => {
    liveRegion.textContent = message;
  });
}

function updatePomodoroUI(state) {
  const pomodoroTime = document.getElementById('pomodoroTime');
  const pomodoroLabel = document.getElementById('pomodoroLabel');
  const startBtn = document.getElementById('pomodoroStart');
  const pauseBtn = document.getElementById('pomodoroPause');
  const breakBtn = document.getElementById('pomodoroBreak');
  const stopBtn = document.getElementById('pomodoroStop');

  if (state) {
    pomodoroTime.textContent = formatPomodoroTime(state.remainingTime);
    pomodoroLabel.textContent = state.isBreak ? 'Break Time' : 'Focus Time';

    if (state.isRunning) {
      startBtn.style.display = 'none';
      pauseBtn.style.display = 'block';
      stopBtn.style.display = 'block';
    } else if (state.remainingTime > 0) {
      startBtn.style.display = 'block';
      startBtn.textContent = 'Resume';
      pauseBtn.style.display = 'none';
      stopBtn.style.display = 'block';
    } else {
      startBtn.style.display = 'block';
      startBtn.textContent = 'Start';
      pauseBtn.style.display = 'none';
      stopBtn.style.display = 'none';
    }
  }
}

function updateGoogleAuthUI(googleUser, error) {
  const contentEl = document.getElementById('googleAuthContent');
  if (!contentEl) return;

  if (googleUser) {
    // Signed in state
    contentEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
        ${googleUser.picture ? `<img src="${escapeHtml(googleUser.picture)}" alt="" style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid var(--border-ink); box-shadow: 2px 2px 0 var(--border-ink);" />` : `<div style="width:44px;height:44px;border-radius:50%;background:var(--accent-1);display:flex;align-items:center;justify-content:center;font-size:1.4rem;border:2px solid var(--border-ink);">👤</div>`}
        <div style="flex:1;overflow:hidden;">
          <div style="font-family: var(--font-hand); font-weight: 700; font-size: 1.1rem; white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(googleUser.name || googleUser.email)}</div>
          <div style="font-size: 0.78rem; color: var(--ink-light); white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(googleUser.email)}</div>
        </div>
        <span style="font-size:1.2rem;" title="Signed in">✓</span>
      </div>
      <button id="googleLogoutBtn" class="btn btn-secondary" style="width: 100%; font-size: 1rem;">Sign Out</button>
    `;

    document.getElementById('googleLogoutBtn').addEventListener('click', () => {
      const btn = document.getElementById('googleLogoutBtn');
      if (btn) {
        btn.textContent = 'Signing out…';
        btn.disabled = true;
      }
      chrome.runtime.sendMessage({ action: 'googleLogout' }, () => {
        loadState();
      });
    });
  } else {
    // Determine what kind of error this is to show helpful guidance
    const isNotConfigured =
      error &&
      (error.includes('GOOGLE_CLIENT_ID') ||
        error.includes('not configured') ||
        error.includes('.env'));
    const isAppOffline = error && (error.includes('not running') || error.includes('Start Helpy'));
    const isRedirectError =
      error &&
      (error.includes('redirect') ||
        error.includes('chromiumapp') ||
        error.includes('whitelisted'));

    let errorHtml = '';
    if (error && error !== 'Login cancelled') {
      if (isNotConfigured) {
        errorHtml = `
          <div style="font-size:0.78rem;color:#b45309;margin-top:6px;padding:8px;background:#fffbeb;border:1px solid #f59e0b;border-radius:6px;line-height:1.5;">
            <strong>⚙️ Setup needed:</strong><br>
            Add <code style="background:#fef3c7;padding:1px 4px;border-radius:3px;">GOOGLE_CLIENT_ID=your_id</code> to your <code>.env</code> file, then restart Helpy.
          </div>`;
      } else if (isAppOffline) {
        errorHtml = `
          <div style="font-size:0.78rem;color:#6d28d9;margin-top:6px;padding:8px;background:#f5f3ff;border:1px solid #a78bfa;border-radius:6px;line-height:1.5;">
            <strong>🔌 Helpy is offline</strong><br>
            Start the Helpy desktop app, then click Sign in again.
          </div>`;
      } else if (isRedirectError) {
        const extId =
          typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id
            ? chrome.runtime.id
            : 'YOUR_EXT_ID';
        errorHtml = `
          <div style="font-size:0.78rem;color:#b45309;margin-top:6px;padding:8px;background:#fffbeb;border:1px solid #f59e0b;border-radius:6px;line-height:1.5;">
            <strong>🔑 Redirect URI not whitelisted</strong><br>
            Add <code style="background:#fef3c7;padding:1px 4px;border-radius:3px;">https://${extId}.chromiumapp.org/</code> to your Google Cloud Console OAuth credentials.
          </div>`;
      } else {
        errorHtml = `
          <div style="font-size:0.78rem;color:var(--accent-2);margin-top:6px;padding:6px 8px;background:#fff5f5;border:1px solid var(--accent-2);border-radius:4px;">
            ${escapeHtml(error)}
          </div>`;
      }
    }

    contentEl.innerHTML = `
      <div style="font-family: var(--font-body); font-size: 0.88rem; margin-bottom: 8px; color: var(--ink-light);">Sign in with Google to sync your Helpy account.</div>
      <button id="googleLoginBtn" class="btn btn-primary" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
        <svg width="18" height="18" viewBox="0 0 48 48" style="flex-shrink:0;"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg>
        Sign in with Google
      </button>
      ${errorHtml}
    `;

    document.getElementById('googleLoginBtn').addEventListener('click', () => {
      const btn = document.getElementById('googleLoginBtn');
      if (btn) {
        btn.innerHTML =
          '<span style="display:inline-block;animation:spin 1s linear infinite;">⟳</span> Signing in…';
        btn.disabled = true;
      }
      chrome.runtime.sendMessage({ action: 'googleLogin' }, (response) => {
        if (chrome.runtime.lastError) {
          // Extension context invalidated or background script not ready
          updateGoogleAuthUI(null, 'Extension error: ' + chrome.runtime.lastError.message);
          return;
        }
        if (response && !response.success && response.error) {
          // Show error with helpful guidance
          updateGoogleAuthUI(null, response.error);
        } else {
          loadState();
        }
      });
    });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Diff-based tabs list rendering — reuses existing DOM nodes to prevent jitter
function renderTabsList(tabs, appConnected, displayName) {
  const tabsListEl = document.getElementById('tabsList');
  if (!tabsListEl) return;

  if (tabs.length === 0) {
    if (lastRenderedTabIds.length > 0 || tabsListEl.children.length === 0) {
      tabsListEl.innerHTML = '';
      const emptyEl = document.createElement('div');
      emptyEl.className = 'empty-state';
      emptyEl.textContent = appConnected
        ? `No tabs being tracked right now, ${getAddressName(displayName)}.`
        : 'No tabs to display yet.';
      tabsListEl.appendChild(emptyEl);
      lastRenderedTabIds = [];
    }
    return;
  }

  const inactiveTabs = tabs.filter((tab) => tab.isInactive);
  const activeTabs = tabs.filter((tab) => !tab.isInactive);
  const sortedTabs = [...inactiveTabs, ...activeTabs];

  // If the number of tabs changed, we need to rebuild. Otherwise, update in place.
  const currentTabIds = sortedTabs.map((t) => t.id || t.url);
  const needsFullRebuild =
    lastRenderedTabIds.length !== currentTabIds.length ||
    !currentTabIds.every((id, i) => id === lastRenderedTabIds[i]);

  if (needsFullRebuild) {
    tabsListEl.innerHTML = '';
    sortedTabs.forEach((tab) => {
      const tabItem = createTabItem(tab);
      tabsListEl.appendChild(tabItem);
    });
    lastRenderedTabIds = currentTabIds;
  } else {
    // Update existing tab items in place — no DOM destruction
    const tabItems = tabsListEl.querySelectorAll('.tab-item');
    sortedTabs.forEach((tab, index) => {
      const tabItem = tabItems[index];
      if (!tabItem) return;

      // Update classes
      let className = 'tab-item';
      if (tab.isInactive) className += ' inactive';
      if (tab.active) className += ' active-tab';
      if (tabItem.className !== className) {
        tabItem.className = className;
      }

      // Update text content
      const titleEl = tabItem.querySelector('.tab-title');
      if (titleEl && titleEl.textContent !== tab.title) {
        titleEl.textContent = tab.title;
      }

      const urlEl = tabItem.querySelector('.tab-url');
      let hostname;
      try {
        hostname = new URL(tab.url).hostname;
      } catch {
        hostname = tab.url;
      }
      if (urlEl && urlEl.textContent !== hostname) {
        urlEl.textContent = hostname;
      }

      const timeEl = tabItem.querySelector('.tab-time');
      const timeText = `${tab.isInactive ? 'Inactive ' : ''}${formatInactiveTime(tab.inactiveTime)}`;
      if (timeEl && timeEl.textContent !== timeText) {
        timeEl.textContent = timeText;
      }

      const activeEl = tabItem.querySelector('.tab-active-label');
      const activeText = tab.active ? 'Active' : 'Background';
      if (activeEl && activeEl.textContent !== activeText) {
        activeEl.textContent = activeText;
      }
    });
  }
}

function createTabItem(tab) {
  const tabItem = document.createElement('div');
  let className = 'tab-item';
  if (tab.isInactive) className += ' inactive';
  if (tab.active) className += ' active-tab';
  tabItem.className = className;

  const titleEl = document.createElement('div');
  titleEl.className = 'tab-title';
  titleEl.textContent = tab.title;

  const urlEl = document.createElement('div');
  urlEl.className = 'tab-url';
  try {
    urlEl.textContent = new URL(tab.url).hostname;
  } catch {
    urlEl.textContent = tab.url;
  }

  const metaEl = document.createElement('div');
  metaEl.className = 'tab-meta';

  const timeEl = document.createElement('div');
  timeEl.className = `tab-status tab-time ${tab.isInactive ? 'inactive' : ''}`;
  timeEl.textContent = `${tab.isInactive ? 'Inactive ' : ''}${formatInactiveTime(tab.inactiveTime)}`;

  const activeEl = document.createElement('div');
  activeEl.className = 'tab-status tab-active-label';
  activeEl.textContent = tab.active ? 'Active' : 'Background';

  metaEl.appendChild(timeEl);
  metaEl.appendChild(activeEl);

  tabItem.appendChild(titleEl);
  tabItem.appendChild(urlEl);
  tabItem.appendChild(metaEl);
  return tabItem;
}

function updatePopup(state) {
  try {
    lastState = state;

    updateGoogleAuthUI(state.googleUser);

    const statusEl = document.getElementById('connectionStatus');
    const statusMessageEl = document.getElementById('statusMessage');
    const toggleBtn = document.getElementById('toggleBtn');
    const subtitleEl = document.getElementById('subtitle');
    const focusTaskEl = document.getElementById('focusTaskBanner');
    const quickGlanceText = document.getElementById('quickGlanceText');
    const trackedTabCount = document.getElementById('trackedTabCount');

    const addressName = getAddressName(state.displayName);

    // Update subtitle
    const newSubtitle = state.displayName
      ? `Keeping an eye on your Chrome tabs, ${state.displayName}.`
      : 'Keeping an eye on your Chrome tabs.';
    if (subtitleEl.textContent !== newSubtitle) {
      subtitleEl.textContent = newSubtitle;
    }

    // Focus task banner
    if (focusTaskEl) {
      if (state.activeFocusTask) {
        const newText = `🎯 Focusing on: ${state.activeFocusTask}`;
        if (focusTaskEl.textContent !== newText) {
          focusTaskEl.textContent = newText;
        }
        focusTaskEl.style.display = 'block';
      } else {
        focusTaskEl.style.display = 'none';
      }
    }

    // Update Pomodoro UI
    updatePomodoroUI(state.pomodoroState);

    const activeTabCount = state.tabs.filter((tab) => !tab.isInactive).length;
    if (quickGlanceText) {
      const quickText = state.isPaused
        ? 'Tracking is paused'
        : state.activeFocusTask
          ? `Working on ${state.activeFocusTask}`
          : state.appConnected
            ? `${activeTabCount} tab${activeTabCount === 1 ? '' : 's'} active right now`
            : 'Open Helpy to reconnect';
      if (quickGlanceText.textContent !== quickText) {
        quickGlanceText.textContent = quickText;
      }
    }

    if (trackedTabCount) {
      const countText = `${state.tabs.length} tab${state.tabs.length === 1 ? '' : 's'}`;
      if (trackedTabCount.textContent !== countText) {
        trackedTabCount.textContent = countText;
        if (previousTrackedTabCount !== null && previousTrackedTabCount !== state.tabs.length) {
          trackedTabCount.classList.remove('is-updating');
          void trackedTabCount.offsetWidth;
          trackedTabCount.classList.add('is-updating');
        }
      }
      previousTrackedTabCount = state.tabs.length;
    }

    // Update status
    let newStatusClass, newStatusText, newToggleClass, newToggleText;
    if (state.isPaused) {
      newStatusClass = 'connection-status status-paused';
      newStatusText = 'Tracking paused';
      newToggleClass = 'btn btn-secondary';
      newToggleText = 'Resume Tracking';
    } else if (state.bridgeStatus === 'unauthorized') {
      newStatusClass = 'connection-status status-disconnected';
      newStatusText = 'Bridge needs refresh';
      newToggleClass = 'btn btn-secondary';
      newToggleText = 'Reconnect';
    } else {
      newStatusClass = state.appConnected
        ? 'connection-status status-connected'
        : 'connection-status status-disconnected';
      newStatusText = state.appConnected ? 'App connected' : 'App unavailable';
      newToggleClass = 'btn btn-primary';
      newToggleText = 'Pause Tracking';
    }
    if (statusEl.className !== newStatusClass) statusEl.className = newStatusClass;
    if (statusEl.textContent !== newStatusText) statusEl.textContent = newStatusText;
    if (toggleBtn.className !== newToggleClass) toggleBtn.className = newToggleClass;
    if (toggleBtn.textContent !== newToggleText) toggleBtn.textContent = newToggleText;

    // Update status message
    let newStatusMessage;
    if (state.isPaused) {
      newStatusMessage = personalizeLabel(
        'Tracking is currently paused',
        state.displayName
      );
    } else if (state.bridgeStatus === 'unauthorized') {
      newStatusMessage =
        'Helpy needs to refresh the secure bridge token. Open Settings or click Reconnect.';
    } else if (state.appConnected) {
      newStatusMessage = personalizeLabel(
        'Live Chrome tab updates are active through the secure local bridge',
        state.displayName
      );
    } else {
      newStatusMessage =
        'Open the Helpy desktop app to reconnect the secure local bridge and resume synced activity.';
    }
    if (statusMessageEl.textContent !== newStatusMessage) {
      statusMessageEl.textContent = newStatusMessage;
      announcePopupMessage(newStatusMessage);
    }

    // Update tabs list using diff rendering to prevent jitter
    renderTabsList(state.tabs, state.appConnected, state.displayName);
  } catch (error) {
    console.error('Error updating popup:', error);
  }
}

// Lightweight Pomodoro-only update — avoids rebuilding the tabs list
function updatePomodoroOnly(state) {
  try {
    lastState = state;
    updatePomodoroUI(state.pomodoroState);

    const quickGlanceText = document.getElementById('quickGlanceText');
    if (quickGlanceText && state.activeFocusTask) {
      const quickText = state.isPaused
        ? 'Tracking is paused'
        : `Working on ${state.activeFocusTask}`;
      if (quickGlanceText.textContent !== quickText) {
        quickGlanceText.textContent = quickText;
      }
    }

    const focusTaskEl = document.getElementById('focusTaskBanner');
    if (focusTaskEl && state.activeFocusTask) {
      const newText = `🎯 Focusing on: ${state.activeFocusTask}`;
      if (focusTaskEl.textContent !== newText) {
        focusTaskEl.textContent = newText;
      }
      focusTaskEl.style.display = 'block';
    }
  } catch (error) {
    console.error('Error in Pomodoro-only update:', error);
  }
}

// Debounced full state load — prevents rapid successive re-renders
function loadState() {
  if (pendingStateUpdate) return;
  pendingStateUpdate = true;

  requestAnimationFrame(() => {
    pendingStateUpdate = false;
    try {
      chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error loading state:', chrome.runtime.lastError);
          return;
        }
        if (response) {
          updatePopup(response);
        }
      });
    } catch (error) {
      console.error('Error in loadState:', error);
    }
  });
}

// Lightweight Pomodoro state fetch — does not rebuild tabs list
function loadPomodoroState() {
  try {
    chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading Pomodoro state:', chrome.runtime.lastError);
        return;
      }
      if (response) {
        updatePomodoroOnly(response);
      }
    });
  } catch (error) {
    console.error('Error in loadPomodoroState:', error);
  }
}

// Listen for background STATE_UPDATE messages
// Only rebuild full popup for STATE_UPDATE; use lightweight update for POMODORO_STATE_UPDATE
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'STATE_UPDATE') {
    loadState();
  } else if (message && message.type === 'POMODORO_STATE_UPDATE') {
    loadPomodoroState();
  }
});

try {
  document.getElementById('settingsLink').addEventListener('click', (e) => {
    try {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    } catch (error) {
      console.error('Error opening options page:', error);
    }
  });
} catch (error) {
  console.error('Error adding settingsLink listener:', error);
}

try {
  document.getElementById('reportsLink').addEventListener('click', (e) => {
    try {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('reports.html') });
    } catch (error) {
      console.error('Error opening reports page:', error);
    }
  });
} catch (error) {
  console.error('Error adding reportsLink listener:', error);
}

try {
  document.getElementById('toggleBtn').addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ action: 'getState' }, (state) => {
        if (chrome.runtime.lastError) {
          console.error('Error getting state for toggle:', chrome.runtime.lastError);
          return;
        }
        if (state) {
          const newAction =
            state.bridgeStatus === 'unauthorized'
              ? 'refreshSettings'
              : state.isPaused
                ? 'resumeTracking'
                : 'pauseTracking';
          chrome.runtime.sendMessage({ action: newAction }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('Error toggling tracking:', chrome.runtime.lastError);
              return;
            }
            if (response) {
              loadState();
            }
          });
        }
      });
    } catch (error) {
      console.error('Error in toggleBtn click:', error);
    }
  });
} catch (error) {
  console.error('Error adding toggleBtn listener:', error);
}

// Pomodoro Controls
try {
  document.getElementById('pomodoroStart').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'pomodoroStart' }, () => {
      loadState();
      window.close();
    });
  });

  document.getElementById('pomodoroPause').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'pomodoroPause' }, () => {
      loadPomodoroState();
    });
  });

  document.getElementById('pomodoroBreak').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'pomodoroBreak' }, () => {
      loadPomodoroState();
    });
  });

  document.getElementById('pomodoroStop').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'pomodoroStop' }, () => {
      loadState();
    });
  });
} catch (error) {
  console.error('Error adding pomodoro listeners:', error);
}

// Dark mode handling
const darkModeBtn = document.getElementById('darkModeBtn');
const savedTheme = localStorage.getItem('helpy-theme');
const systemPrefersDark =
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

// Apply initial theme
function applyTheme(isDark) {
  const moonIcon = document.getElementById('moonIcon');
  const sunIcon = document.getElementById('sunIcon');
  if (isDark) {
    document.body.classList.add('dark');
    if (moonIcon) moonIcon.style.display = 'none';
    if (sunIcon) sunIcon.style.display = '';
  } else {
    document.body.classList.remove('dark');
    if (moonIcon) moonIcon.style.display = '';
    if (sunIcon) sunIcon.style.display = 'none';
  }
}

// Determine initial state
let isDark = savedTheme === 'dark' || (savedTheme === null && systemPrefersDark);
applyTheme(isDark);

// Toggle on button click
darkModeBtn.addEventListener('click', () => {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('helpy-theme', isDark ? 'dark' : 'light');
  applyTheme(isDark);
});

// Make clicks feel acknowledged while keeping the popup fast and lightweight.
document.querySelectorAll('button, .btn').forEach((button) => {
  button.addEventListener('click', (event) => {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bounds = button.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'button-ripple';
    ripple.style.left = `${event.clientX - bounds.left}px`;
    ripple.style.top = `${event.clientY - bounds.top}px`;
    button.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
});

// Listen for system preference changes
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (localStorage.getItem('helpy-theme') === null) {
      applyTheme(e.matches);
    }
  });
}

// Export functionality
const exportBtn = document.getElementById('exportBtn');
exportBtn.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.storage.sync.get(null, (data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `helpy-settings-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
});

// Import functionality
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
importBtn.addEventListener('click', (e) => {
  e.preventDefault();
  importFile.click();
});
importFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        chrome.storage.sync.set(data, () => {
          alert('Settings imported successfully!');
          loadState();
        });
      } catch (error) {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  }
});

// Focus Plan Handling (ADHD-Friendly)
let currentPopupPlan = JSON.parse(localStorage.getItem('helpy-current-plan') || 'null');

// Break down plan into tasks
function breakDownPlan(planConfig, chunkSize) {
  const totalDuration = planConfig.durationMinutes || 30;
  const tasks = [];
  const numChunks = Math.ceil(totalDuration / chunkSize);
  for (let i = 0; i < numChunks; i++) {
    const duration = i < numChunks - 1 ? chunkSize : totalDuration - i * chunkSize;
    tasks.push({
      id: `task-${Date.now()}-${i}`,
      title: `${planConfig.title} - Part ${i + 1}`,
      durationMinutes: duration,
      completed: false,
      completedAt: null,
    });
  }
  return tasks;
}

// Render current plan in popup
function renderCurrentPopupPlan() {
  const planContainer = document.getElementById('currentPopupPlan');
  const planContent = document.getElementById('currentPopupPlanContent');

  if (!currentPopupPlan) {
    planContainer.style.display = 'none';
    return;
  }

  planContainer.style.display = 'block';
  const completedTasks = currentPopupPlan.tasks.filter((t) => t.completed).length;
  const totalTasks = currentPopupPlan.tasks.length;
  const progressPercent = Math.round((completedTasks / totalTasks) * 100);

  planContent.innerHTML = `
    <div style="font-weight: 700; font-size: 0.9rem; margin-bottom: 0.3rem; color: var(--paper-text);">${escapeHtml(currentPopupPlan.title)}</div>
    <div style="font-size: 0.8rem; color: var(--ink-light); margin-bottom: 0.5rem;">${progressPercent}% complete (${completedTasks}/${totalTasks})</div>
    <div style="display: flex; flex-direction: column; gap: 0.4rem;">
      ${currentPopupPlan.tasks
        .map(
          (task, idx) => `
        <div class="popup-task-item" data-index="${idx}" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; border-radius: 8px; background: ${task.completed ? 'rgba(68, 215, 173, 0.15)' : '#19191c'}; cursor: pointer; border: 1px solid ${task.completed ? 'rgba(68, 215, 173, 0.7)' : 'rgba(255,255,255,0.13)'}; transition: all 0.2s;">
          <input type="checkbox" ${task.completed ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;" />
          <div style="flex: 1; font-size: 0.8rem; ${task.completed ? 'text-decoration: line-through; opacity: 0.7;' : ''}">
            <div style="font-weight: 600;">${escapeHtml(task.title)}</div>
            <div style="font-size: 0.7rem; color: var(--ink-light);">${task.durationMinutes} min</div>
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `;

  // Add task toggle listeners
  planContent.querySelectorAll('.popup-task-item').forEach((item) => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.index);
      currentPopupPlan.tasks[idx].completed = !currentPopupPlan.tasks[idx].completed;
      if (currentPopupPlan.tasks[idx].completed) {
        currentPopupPlan.tasks[idx].completedAt = new Date().toISOString();
      } else {
        currentPopupPlan.tasks[idx].completedAt = null;
      }
      localStorage.setItem('helpy-current-plan', JSON.stringify(currentPopupPlan));
      renderCurrentPopupPlan();
      window.close();
    });
  });
}

// Plan form submission
try {
  document.getElementById('popupPlanForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('popupPlanTitle').value;
    const duration = parseInt(document.getElementById('popupPlanDuration').value, 10);
    const chunkSize = parseInt(document.getElementById('popupChunkSize').value, 10);

    currentPopupPlan = {
      title,
      durationMinutes: duration,
      chunkSizeMinutes: chunkSize,
      tasks: breakDownPlan({ title, durationMinutes: duration }, chunkSize),
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem('helpy-current-plan', JSON.stringify(currentPopupPlan));
    renderCurrentPopupPlan();
    document.getElementById('popupPlanForm').reset();
    document.getElementById('popupPlanDuration').value = 30;
    document.getElementById('popupChunkSize').value = 15;
    announcePopupMessage(`Plan "${title}" created!`);
    window.close();
  });
} catch (e) {
  console.error('Error setting up popup plan form:', e);
}

// Start plan timer
try {
  document.getElementById('startPopupPlanBtn').addEventListener('click', () => {
    if (currentPopupPlan) {
      chrome.runtime.sendMessage(
        { action: 'pomodoroStart', duration: currentPopupPlan.durationMinutes },
        () => {
          loadState();
          window.close();
        }
      );
    }
  });
} catch (e) {
  console.error('Error setting up start plan button:', e);
}

// Clear plan
try {
  document.getElementById('clearPopupPlanBtn').addEventListener('click', () => {
    currentPopupPlan = null;
    localStorage.removeItem('helpy-current-plan');
    renderCurrentPopupPlan();
  });
} catch (e) {
  console.error('Error setting up clear plan button:', e);
}

// Initial plan render
renderCurrentPopupPlan();

// Initialize smart recommendation
updateSmartRecommendation();

// Add input listeners for smart recommendation
['popupPlanDuration', 'workIntensity', 'userEnergy'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', updateSmartRecommendation);
  }
});

// Language switcher
(function initLangSwitcher() {
  const translations = {
    en: {
      tabTracker: 'Tab Tracker',
      subtitle: 'Keeping an eye on your Chrome tabs.',
      googleAccount: 'Google Account',
      pomodoroTimer: 'Pomodoro Timer',
      focusTime: 'Focus Time',
      start: 'Start',
      pause: 'Pause',
      breakBtn: 'Break',
      stop: 'Stop',
      createFocusPlan: 'Create Focus Plan',
      trackedTabs: 'Tracked Tabs',
      exportData: 'Export Data',
      importData: 'Import Data',
      viewReports: 'View Reports',
      openSettings: 'Open Settings',
      currentPlan: 'Current Plan',
      startTimer: 'Start Timer',
      clear: 'Clear',
      pauseTracking: 'Pause Tracking',
      waitingConn: 'Waiting for connection.',
    },
    es: {
      tabTracker: 'Rastreador de Pestañas',
      subtitle: 'Vigilando tus pestañas de Chrome.',
      googleAccount: 'Cuenta de Google',
      pomodoroTimer: 'Temporizador Pomodoro',
      focusTime: 'Tiempo de Enfoque',
      start: 'Iniciar',
      pause: 'Pausar',
      breakBtn: 'Descanso',
      stop: 'Detener',
      createFocusPlan: 'Crear Plan de Enfoque',
      trackedTabs: 'Pestañas Rastreadas',
      exportData: 'Exportar Datos',
      importData: 'Importar Datos',
      viewReports: 'Ver Informes',
      openSettings: 'Abrir Ajustes',
      currentPlan: 'Plan Actual',
      startTimer: 'Iniciar Temporizador',
      clear: 'Limpiar',
      pauseTracking: 'Pausar Rastreo',
      waitingConn: 'Esperando conexión.',
    },
    fr: {
      tabTracker: 'Suivi des Onglets',
      subtitle: 'Un oeil sur vos onglets Chrome.',
      googleAccount: 'Compte Google',
      pomodoroTimer: 'Minuterie Pomodoro',
      focusTime: 'Temps de Concentration',
      start: 'Démarrer',
      pause: 'Pause',
      breakBtn: 'Pause',
      stop: 'Arrêter',
      createFocusPlan: 'Créer un Plan Focus',
      trackedTabs: 'Onglets Suivis',
      exportData: 'Exporter',
      importData: 'Importer',
      viewReports: 'Voir les Rapports',
      openSettings: 'Paramètres',
      currentPlan: 'Plan Actuel',
      startTimer: 'Démarrer',
      clear: 'Effacer',
      pauseTracking: 'Pause Suivi',
      waitingConn: 'En attente de connexion.',
    },
    de: {
      tabTracker: 'Tab-Tracker',
      subtitle: 'Ihre Chrome-Tabs im Blick.',
      googleAccount: 'Google-Konto',
      pomodoroTimer: 'Pomodoro-Timer',
      focusTime: 'Fokuszeit',
      start: 'Starten',
      pause: 'Pause',
      breakBtn: 'Pause',
      stop: 'Stoppen',
      createFocusPlan: 'Fokusplan erstellen',
      trackedTabs: 'Verfolgte Tabs',
      exportData: 'Exportieren',
      importData: 'Importieren',
      viewReports: 'Berichte',
      openSettings: 'Einstellungen',
      currentPlan: 'Aktueller Plan',
      startTimer: 'Timer starten',
      clear: 'Leeren',
      pauseTracking: 'Tracking pausieren',
      waitingConn: 'Warte auf Verbindung.',
    },
    'zh-CN': {
      tabTracker: '标签追踪器',
      subtitle: '关注您的 Chrome 标签页。',
      googleAccount: 'Google 账户',
      pomodoroTimer: '番茄计时器',
      focusTime: '专注时间',
      start: '开始',
      pause: '暂停',
      breakBtn: '休息',
      stop: '停止',
      createFocusPlan: '创建专注计划',
      trackedTabs: '已追踪标签',
      exportData: '导出数据',
      importData: '导入数据',
      viewReports: '查看报告',
      openSettings: '打开设置',
      currentPlan: '当前计划',
      startTimer: '启动计时器',
      clear: '清除',
      pauseTracking: '暂停追踪',
      waitingConn: '等待连接。',
    },
    ja: {
      tabTracker: 'タブトラッカー',
      subtitle: 'Chromeタブを監視中。',
      googleAccount: 'Googleアカウント',
      pomodoroTimer: 'ポモドーロタイマー',
      focusTime: '集中時間',
      start: '開始',
      pause: '一時停止',
      breakBtn: '休憩',
      stop: '停止',
      createFocusPlan: '集中プランを作成',
      trackedTabs: '追跡タブ',
      exportData: 'データ出力',
      importData: 'データ取込',
      viewReports: 'レポート表示',
      openSettings: '設定を開く',
      currentPlan: '現在のプラン',
      startTimer: 'タイマー開始',
      clear: 'クリア',
      pauseTracking: '追跡を一時停止',
      waitingConn: '接続を待機中。',
    },
  };

  function applyLang(lang) {
    const t = translations[lang] || translations.en;
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== text) el.textContent = text;
    };
    const setText = (selector, text) => {
      const el = document.querySelector(selector);
      if (el && el.textContent !== text) el.textContent = text;
    };

    setText('.eyebrow', t.tabTracker);
    set('subtitle', t.subtitle);

    const gSection = document.querySelector('#googleAuthSection h3');
    if (gSection) gSection.textContent = t.googleAccount;

    document.querySelectorAll('.section h3').forEach((h) => {
      if (h.textContent.trim().match(/pomodoro|timer|temporizador|minuterie|timer/i))
        h.textContent = t.pomodoroTimer;
    });

    set('pomodoroLabel', t.focusTime);
    set('pomodoroStart', t.start);
    set('pomodoroPause', t.pause);
    set('pomodoroBreak', t.breakBtn);
    set('pomodoroStop', t.stop);

    document.querySelectorAll('.section h3').forEach((h) => {
      if (h.textContent.trim().match(/plan|enfoque|focus|fokus|プラン|计划/i))
        h.textContent = t.createFocusPlan;
    });

    document.querySelectorAll('.section h3').forEach((h) => {
      if (h.textContent.trim().match(/tracked|rastreadas|suivis|verfolgte|追踪|追跡/i))
        h.textContent = t.trackedTabs;
    });

    set('exportBtn', t.exportData);
    set('importBtn', t.importData);
    set('reportsLink', t.viewReports);
    set('settingsLink', t.openSettings);

    const startPlanBtn = document.getElementById('startPopupPlanBtn');
    if (startPlanBtn) startPlanBtn.textContent = t.startTimer;
    const clearPlanBtn = document.getElementById('clearPopupPlanBtn');
    if (clearPlanBtn) clearPlanBtn.textContent = t.clear;

    const currentPlanH4 = document.querySelector('#currentPopupPlan h4');
    if (currentPlanH4) currentPlanH4.textContent = t.currentPlan;

    localStorage.setItem('helpy-lang', lang);
  }

  const langSwitcher = document.getElementById('langSwitcher');
  if (langSwitcher) {
    const savedLang = localStorage.getItem('helpy-lang') || 'en';
    langSwitcher.value = savedLang;
    applyLang(savedLang);

    langSwitcher.addEventListener('change', () => {
      applyLang(langSwitcher.value);
    });
  }
})();

// Attach Smart Web Tools Listeners
document.addEventListener('DOMContentLoaded', () => {
  const groupBtn = document.getElementById('groupFocusTabsBtn');
  if (groupBtn) {
    groupBtn.addEventListener('click', async () => {
      try {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const tabIds = tabs.map((t) => t.id).filter(Boolean);
        if (tabIds.length > 0 && chrome.tabs.group) {
          const groupId = await chrome.tabs.group({ tabIds });
          if (chrome.tabGroups) {
            await chrome.tabGroups.update(groupId, { title: 'Helpy Focus', color: 'orange' });
          }
          groupBtn.textContent = '✅ Tabs Grouped!';
          setTimeout(() => (groupBtn.textContent = '📁 Group Focus Tabs'), 2000);
        }
      } catch (err) {
        console.error('Error grouping tabs:', err);
      }
    });
  }

  const readerBtn = document.getElementById('toggleReaderModeBtn');
  if (readerBtn) {
    readerBtn.addEventListener('click', async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.id) {
          chrome.tabs.sendMessage(activeTab.id, { action: 'toggleReaderMode' }, (res) => {
            if (chrome.runtime.lastError) {
              console.info('Reader mode is unavailable on this page.');
              return;
            }
            if (res && res.active !== undefined) {
              readerBtn.textContent = res.active ? '📖 Reader Active' : '📖 Reader Mode';
            }
          });
        }
      } catch (err) {
        console.error('Error toggling reader mode:', err);
      }
    });
  }

  const saveClipBtn = document.getElementById('saveClipperNoteBtn');
  const clipInput = document.getElementById('clipperNoteInput');
  const clipStatus = document.getElementById('clipperStatus');
  if (saveClipBtn && clipInput) {
    saveClipBtn.addEventListener('click', async () => {
      const noteText = clipInput.value.trim();
      if (!noteText) return;

      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const newNote = {
        id: 'clip_' + Date.now(),
        text: noteText,
        url: activeTab ? activeTab.url : '',
        title: activeTab ? activeTab.title : 'Web Note',
        createdAt: new Date().toISOString(),
      };

      const result = await chrome.storage.local.get(['webNotes']);
      const webNotes = result.webNotes || [];
      webNotes.unshift(newNote);
      await chrome.storage.local.set({ webNotes });

      // Send note to Helpy App desktop backend bridge
      fetch('http://localhost:3456/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newNote),
      }).catch((e) => console.log('Desktop app offline, note saved locally'));

      clipInput.value = '';
      if (clipStatus) {
        clipStatus.style.display = 'block';
        setTimeout(() => (clipStatus.style.display = 'none'), 2500);
      }
    });
  }

  // Focus Shield Extension Controller
  const shieldBtn = document.getElementById('extToggleShieldBtn');
  const shieldBadge = document.getElementById('extShieldStatusBadge');

  async function updateShieldUI() {
    try {
      const res = await fetch('http://localhost:3456/api/shield-state');
      if (res.ok) {
        const data = await res.json();
        const active = Boolean(data.active);
        if (shieldBadge) {
          shieldBadge.textContent = active ? 'ON' : 'OFF';
          shieldBadge.style.background = active ? '#e74c3c' : 'rgba(0,0,0,0.1)';
          shieldBadge.style.color = active ? '#ffffff' : 'var(--paper-text)';
        }
        if (shieldBtn) {
          shieldBtn.textContent = active ? 'Deactivate Focus Shield' : 'Activate Focus Shield';
          shieldBtn.className = active ? 'btn btn-secondary' : 'btn btn-primary';
        }
      }
    } catch (_) {}
  }

  if (shieldBtn) {
    shieldBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('http://localhost:3456/api/shield-state');
        let currentActive = false;
        if (res.ok) {
          const data = await res.json();
          currentActive = Boolean(data.active);
        }
        const nextState = !currentActive;
        await fetch('http://localhost:3456/api/shield-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: nextState }),
        });
        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'setShieldState', active: nextState }, () => {
            void chrome.runtime.lastError;
          });
        }
        updateShieldUI();
      } catch (err) {
        console.error('Failed to toggle focus shield:', err);
      }
    });
    updateShieldUI();
  }
});

// Initial load
loadState();

// State-change messages handle normal updates. This is only a safety net for
// countdown display if the service worker has been suspended and restarted.
// Uses lightweight Pomodoro-only update to avoid rebuilding the tabs list.
setInterval(loadPomodoroState, 30000);