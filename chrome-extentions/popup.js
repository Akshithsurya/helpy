let pomodoroInterval = null;

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
        ${googleUser.picture ? `<img src="${googleUser.picture}" style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid var(--border-ink); box-shadow: 2px 2px 0 var(--border-ink);" onerror="this.style.display='none'" />` : `<div style="width:44px;height:44px;border-radius:50%;background:var(--accent-1);display:flex;align-items:center;justify-content:center;font-size:1.4rem;border:2px solid var(--border-ink);">👤</div>`}
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
      if (btn) { btn.textContent = 'Signing out…'; btn.disabled = true; }
      chrome.runtime.sendMessage({ action: 'googleLogout' }, () => {
        loadState();
      });
    });
  } else {
    // Signed out state
    const errorHtml = error && error !== 'Login cancelled'
      ? `<div style="font-size: 0.78rem; color: var(--accent-2); margin-top: 6px; padding: 4px 8px; background: #fff5f5; border: 1px solid var(--accent-2); border-radius: 4px;">${escapeHtml(error)}</div>`
      : '';

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
        btn.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;">⟳</span> Signing in…';
        btn.disabled = true;
      }
      chrome.runtime.sendMessage({ action: 'googleLogin' }, (response) => {
        if (response && !response.success && response.error) {
          // Show error and re-enable
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
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}



function updatePopup(state) {
  try {
    updateGoogleAuthUI(state.googleUser);

    const statusEl = document.getElementById('connectionStatus');
    const statusMessageEl = document.getElementById('statusMessage');
    const toggleBtn = document.getElementById('toggleBtn');
    const tabsListEl = document.getElementById('tabsList');
    const subtitleEl = document.getElementById('subtitle');
    const focusTaskEl = document.getElementById('focusTaskBanner');

    const addressName = getAddressName(state.displayName);

    // Update subtitle
    subtitleEl.textContent = state.displayName
      ? `Keeping an eye on your Chrome tabs, ${state.displayName}.`
      : 'Keeping an eye on your Chrome tabs.';

    // Focus task banner
    if (focusTaskEl) {
      if (state.activeFocusTask) {
        focusTaskEl.textContent = `🎯 Focusing on: ${state.activeFocusTask}`;
        focusTaskEl.style.display = 'block';
      } else {
        focusTaskEl.style.display = 'none';
      }
    }

    // Update Pomodoro UI
    updatePomodoroUI(state.pomodoroState);

    // Update status
    if (state.isPaused) {
      statusEl.className = 'connection-status status-paused';
      statusEl.textContent = '⏸ Tracking paused';
      toggleBtn.className = 'btn btn-secondary';
      toggleBtn.textContent = 'Resume Tracking';
    } else if (state.bridgeStatus === 'unauthorized') {
      statusEl.className = 'connection-status status-disconnected';
      statusEl.textContent = '⚠ Bridge needs refresh';
      toggleBtn.className = 'btn btn-secondary';
      toggleBtn.textContent = 'Reconnect';
    } else {
      statusEl.className = state.appConnected
        ? 'connection-status status-connected'
        : 'connection-status status-disconnected';
      statusEl.textContent = state.appConnected ? '✓ App connected' : '✗ App unavailable';
      toggleBtn.className = 'btn btn-primary';
      toggleBtn.textContent = 'Pause Tracking';
    }

    // Update status message
    if (state.isPaused) {
      statusMessageEl.textContent = personalizeLabel(
        'Tracking is currently paused',
        state.displayName
      );
    } else if (state.bridgeStatus === 'unauthorized') {
      statusMessageEl.textContent =
        'Helpy needs to refresh the secure bridge token. Open Settings or click Reconnect.';
    } else if (state.appConnected) {
      statusMessageEl.textContent = personalizeLabel(
        'Live Chrome tab updates are active through the secure local bridge',
        state.displayName
      );
    } else {
      statusMessageEl.textContent =
        'Open the Helpy desktop app to reconnect the secure local bridge and resume synced activity.';
    }
    announcePopupMessage(statusMessageEl.textContent);

    // Update tabs list
    tabsListEl.innerHTML = '';

    if (state.tabs.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'empty-state';
      emptyEl.textContent = state.appConnected
        ? `No tabs being tracked right now, ${addressName}.`
        : 'No tabs to display yet.';
      tabsListEl.appendChild(emptyEl);
      return;
    }

    const inactiveTabs = state.tabs.filter((tab) => tab.isInactive);
    const activeTabs = state.tabs.filter((tab) => !tab.isInactive);
    const sortedTabs = [...inactiveTabs, ...activeTabs];

    sortedTabs.forEach((tab) => {
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
      // Show just the domain
      try {
        urlEl.textContent = new URL(tab.url).hostname;
      } catch {
        urlEl.textContent = tab.url;
      }

      const metaEl = document.createElement('div');
      metaEl.className = 'tab-meta';

      const timeEl = document.createElement('div');
      timeEl.className = `tab-status ${tab.isInactive ? 'inactive' : ''}`;
      timeEl.textContent = `${tab.isInactive ? '⚠ Inactive ' : ''}${formatInactiveTime(tab.inactiveTime)}`;

      const activeEl = document.createElement('div');
      activeEl.className = 'tab-status';
      activeEl.textContent = tab.active ? '● Active' : 'Background';

      metaEl.appendChild(timeEl);
      metaEl.appendChild(activeEl);

      tabItem.appendChild(titleEl);
      tabItem.appendChild(urlEl);
      tabItem.appendChild(metaEl);
      tabsListEl.appendChild(tabItem);
    });
  } catch (error) {
    console.error('Error updating popup:', error);
  }
}

function loadState() {
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
}

// Listen for background STATE_UPDATE messages
chrome.runtime.onMessage.addListener((message) => {
  if (message && (message.type === 'STATE_UPDATE' || message.type === 'POMODORO_STATE_UPDATE')) {
    loadState();
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
      loadState();
    });
  });

  document.getElementById('pomodoroBreak').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'pomodoroBreak' }, () => {
      loadState();
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
if (savedTheme === 'dark') {
  document.body.classList.add('dark');
  darkModeBtn.textContent = '☀️';
}

darkModeBtn.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.setItem('helpy-theme', isDark ? 'dark' : 'light');
  darkModeBtn.textContent = isDark ? '☀️' : '🌙';
});

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
    const duration = i < numChunks - 1 ? chunkSize : totalDuration - (i * chunkSize);
    tasks.push({
      id: `task-${Date.now()}-${i}`,
      title: `${planConfig.title} - Part ${i + 1}`,
      durationMinutes: duration,
      completed: false,
      completedAt: null
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
  const completedTasks = currentPopupPlan.tasks.filter(t => t.completed).length;
  const totalTasks = currentPopupPlan.tasks.length;
  const progressPercent = Math.round((completedTasks / totalTasks) * 100);

  planContent.innerHTML = `
    <div style="font-weight: 700; font-size: 0.9rem; margin-bottom: 0.3rem; color: #1e293b;">${currentPopupPlan.title}</div>
    <div style="font-size: 0.8rem; color: #64748b; margin-bottom: 0.5rem;">${progressPercent}% complete (${completedTasks}/${totalTasks})</div>
    <div style="display: flex; flex-direction: column; gap: 0.4rem;">
      ${currentPopupPlan.tasks.map((task, idx) => `
        <div class="popup-task-item" data-index="${idx}" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; border-radius: 8px; background: ${task.completed ? '#dcfce7' : '#f8fafc'}; cursor: pointer; border: 1px solid ${task.completed ? '#166534' : 'rgba(148,163,184,0.3)'}; transition: all 0.2s;">
          <input type="checkbox" ${task.completed ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;" />
          <div style="flex: 1; font-size: 0.8rem; ${task.completed ? 'text-decoration: line-through; opacity: 0.7;' : ''}">
            <div style="font-weight: 600;">${task.title}</div>
            <div style="font-size: 0.7rem; color: #64748b;">${task.durationMinutes} min</div>
          </div>
        </div>
      `).join('')}
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
      createdAt: new Date().toISOString()
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
      chrome.runtime.sendMessage({ action: 'pomodoroStart', duration: currentPopupPlan.durationMinutes }, () => {
        loadState();
        window.close();
      });
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

// Initial load
loadState();
// Fallback refresh every 10s for pomodoro updates
setInterval(loadState, 10000);
