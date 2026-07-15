// Sanitize HTML to prevent XSS
function sanitizeHTML(str) {
  if (typeof str !== 'string') return '';
  const tempDiv = document.createElement('div');
  tempDiv.textContent = str;
  return tempDiv.innerHTML;
}

// Format time from milliseconds to MM:SS
function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

let timerUpdateInterval = null;
let latestBridgeTabs = [];
let latestBridgeHistory = [];
let latestBridgePomodoroState = null;

// Update auth UI based on user state
function updateAuthUI(user) {
  const loggedOutContainer = document.getElementById('auth-logged-out');
  const loggedInContainer = document.getElementById('auth-logged-in');

  if (user) {
    loggedOutContainer.style.display = 'none';
    loggedInContainer.style.display = 'block';

    const userAvatar = document.getElementById('userAvatar');
    const profileName = document.getElementById('profileName');
    const profileEmail = document.getElementById('profileEmail');
    const profileProvider = document.getElementById('profileProvider');

    if (userAvatar) {
      if (user.picture) {
        userAvatar.src = user.picture;
        userAvatar.style.display = 'block';
      } else {
        userAvatar.style.display = 'none';
      }
    }
    if (profileName) {
      profileName.textContent = user.displayName || user.email;
    }
    if (profileEmail) {
      profileEmail.textContent = user.email;
    }
    if (profileProvider) {
      profileProvider.textContent = `Signed in with ${user.provider || 'email'}`;
    }
  } else {
    loggedInContainer.style.display = 'none';
    loggedOutContainer.style.display = 'block';
  }
}

// Setup auth UI event listeners
function setupAuthUI() {
  // Login form
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      const result = await window.electronAPI.loginUser(email, password);
      const authErrorMsg = document.getElementById('authErrorMsg');
      if (result.success) {
        authErrorMsg.textContent = '';
        loginForm.reset();
      } else {
        authErrorMsg.textContent = result.error || 'Login failed';
      }
    });
  }

  // Register form
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const displayName = document.getElementById('registerName').value;
      const email = document.getElementById('registerEmail').value;
      const password = document.getElementById('registerPassword').value;
      const result = await window.electronAPI.registerUser(email, password, displayName);
      const authErrorMsg = document.getElementById('authErrorMsg');
      if (result.success) {
        authErrorMsg.textContent = '';
        registerForm.reset();
      } else {
        authErrorMsg.textContent = result.error || 'Registration failed';
      }
    });
  }

  // Toggle between login/register
  const showRegisterBtn = document.getElementById('showRegisterBtn');
  if (showRegisterBtn) {
    showRegisterBtn.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('login-container').style.display = 'none';
      document.getElementById('register-container').style.display = 'block';
    });
  }
  const showLoginBtn = document.getElementById('showLoginBtn');
  if (showLoginBtn) {
    showLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('register-container').style.display = 'none';
      document.getElementById('login-container').style.display = 'block';
    });
  }

  // Google login button
  const googleLoginBtn = document.getElementById('googleAppLoginBtn');
  if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', async () => {
      const authErrorMsg = document.getElementById('authErrorMsg');
      const result = await window.electronAPI.initiateOAuth('google');
      if (!result.success) {
        authErrorMsg.textContent = result.error || 'Google login failed';
      } else {
        authErrorMsg.textContent = '';
      }
    });
  }

  // GitHub login button
  const githubLoginBtn = document.getElementById('githubAppLoginBtn');
  if (githubLoginBtn) {
    githubLoginBtn.addEventListener('click', async () => {
      const authErrorMsg = document.getElementById('authErrorMsg');
      const result = await window.electronAPI.initiateOAuth('github');
      if (!result.success) {
        authErrorMsg.textContent = result.error || 'GitHub login failed';
      } else {
        authErrorMsg.textContent = '';
      }
    });
  }

  // Logout button
  const logoutBtn = document.getElementById('appLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await window.electronAPI.logoutUser();
    });
  }

  // Listen for auth state changes
  window.electronAPI.onAuthStateChanged((data) => {
    updateAuthUI(data.user);
  });
}

// Handle successful app initialization
async function initApp() {
  // Load auth state
  const currentUser = await window.electronAPI.getCurrentUser();
  updateAuthUI(currentUser.user);

  // Load all main app data
  await loadTasks();
  await loadSystemMonitorData();
  await loadPlanHistory();
  await loadStatistics();
  await loadHabits();
  await loadHabitsSummary();
  await loadNotifications();
  await loadNotificationSettings();
  await loadNotificationStats();
  await loadActivityHistory();
  await loadAppUsageStats();

  // Set up main app
  setupAuthUI();
  setupTaskForm();
  setupPlanForm();
  setupClearHistoryBtn();
  setupCommandInput();
  setupHabitForm();
  setupTimerControls();
}

let headerClickCount = 0;
let easterEggActive = false;

function setupEasterEgg() {
  const header = document.querySelector('h1');
  if (header) {
    header.addEventListener('click', () => {
      headerClickCount++;
      if (headerClickCount >= 10 && !easterEggActive) {
        triggerEasterEgg();
      }
    });
  }
}

function triggerEasterEgg() {
  easterEggActive = true;
  const container = document.querySelector('.container');
  if (container) {
    container.style.animation = 'spin 1s ease-in-out 3';
    setTimeout(() => {
      container.style.animation = 'floatIn 0.8s var(--ease-out)';
      easterEggActive = false;
      headerClickCount = 0;
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize app
  await initApp();

  // Set up tabs
  setupTabs();

  // Set up easter egg
  setupEasterEgg();

  // Record user activity on interactions
  const recordActivity = () => {
    window.electronAPI.recordActivity();
  };
  document.addEventListener('keydown', recordActivity);
  document.addEventListener('mousemove', recordActivity);
  document.addEventListener('click', recordActivity);

  // Listen for events from main process
  if (window.electronAPI) {
    window.electronAPI.onPlanUpdated(async () => {
      await loadPlanHistory();
      await loadStatistics();
    });

    window.electronAPI.onFocusTimerComplete(async (_state) => {
      updateTimerDisplay(0);
      updateTimerControls(null);
    });

    window.electronAPI.onTabsUpdated((_event, tabs) => {
      latestBridgeTabs = Array.isArray(tabs) ? tabs : [];
      renderBridgeData();
    });

    window.electronAPI.onTabHistoryUpdated((_event, history) => {
      latestBridgeHistory = Array.isArray(history) ? history : [];
      renderBridgeData();
    });

    window.electronAPI.onPomodoroUpdated((_event, state) => {
      latestBridgePomodoroState = state || null;
      renderBridgeData();
    });
  }

  renderBridgeData();

  // Check for existing timer state
  if (window.electronAPI) {
    const existingTimerState = await window.electronAPI.getFocusTimerState();
    if (existingTimerState) {
      updateTimerControls(existingTimerState);
      startTimerDisplay();
    }
  }
});

// Tab navigation
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons and contents
      tabButtons.forEach((btn) => btn.classList.remove('active'));
      tabContents.forEach((content) => content.classList.remove('active'));

      // Add active class to selected button and content
      button.classList.add('active');
      const tabId = button.getAttribute('data-tab');
      const tabContent = document.getElementById(`${tabId}-tab`);
      if (tabContent) {
        tabContent.classList.add('active');
      }
    });
  });
}

// Pomodoro Timer Modes
let currentTimerMode = 'work'; // 'work', 'shortBreak', 'longBreak'
const timerModeDurations = {
  work: 25,
  shortBreak: 5,
  longBreak: 15,
};

function setupTimerModeControls() {
  const modeButtons = {
    work: document.getElementById('timer-mode-work'),
    shortBreak: document.getElementById('timer-mode-short-break'),
    longBreak: document.getElementById('timer-mode-long-break'),
  };

  Object.entries(modeButtons).forEach(([mode, btn]) => {
    if (btn) {
      btn.addEventListener('click', () => {
        setTimerMode(mode);
      });
    }
  });

  setTimerMode('work'); // Initial mode
}

function setTimerMode(mode) {
  currentTimerMode = mode;

  // Update indicator
  const indicator = document.getElementById('timer-mode-indicator');
  if (indicator) {
    const modeNames = {
      work: 'Work Mode',
      shortBreak: 'Short Break',
      longBreak: 'Long Break',
    };
    indicator.textContent = modeNames[mode];
  }

  // Update button states
  const modeButtons = {
    work: document.getElementById('timer-mode-work'),
    shortBreak: document.getElementById('timer-mode-short-break'),
    longBreak: document.getElementById('timer-mode-long-break'),
  };

  Object.entries(modeButtons).forEach(([m, btn]) => {
    if (btn) {
      btn.classList.toggle('active', m === mode);
      btn.classList.toggle('secondary-btn', m !== mode);
    }
  });

  // Update duration input
  const durationInput = document.getElementById('timer-duration');
  if (durationInput) {
    durationInput.value = timerModeDurations[mode];
  }
}

// Timer functions
function setupTimerControls() {
  // First set up mode controls
  setupTimerModeControls();

  const startBtn = document.getElementById('start-timer-btn');
  const pauseBtn = document.getElementById('pause-timer-btn');
  const resumeBtn = document.getElementById('resume-timer-btn');
  const stopBtn = document.getElementById('stop-timer-btn');

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      const durationInput = document.getElementById('timer-duration');
      const duration = parseInt(
        durationInput ? durationInput.value : timerModeDurations[currentTimerMode],
        10
      );
      const state = await window.electronAPI.startFocusTimer(duration);
      updateTimerControls(state);
      startTimerDisplay();
    });
  }

  if (pauseBtn) {
    pauseBtn.addEventListener('click', async () => {
      const state = await window.electronAPI.pauseFocusTimer();
      updateTimerControls(state);
    });
  }

  if (resumeBtn) {
    resumeBtn.addEventListener('click', async () => {
      const state = await window.electronAPI.resumeFocusTimer();
      updateTimerControls(state);
      startTimerDisplay();
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
      await window.electronAPI.stopFocusTimer();
      updateTimerControls(null);
      stopTimerDisplay();
      updateTimerDisplay(0);
    });
  }
}

async function startTimerDisplay() {
  stopTimerDisplay();
  timerUpdateInterval = setInterval(async () => {
    const state = await window.electronAPI.getFocusTimerState();
    if (state) {
      const remaining = Math.max(0, state.timeoutDuration - state.elapsedTime);
      updateTimerDisplay(remaining);
      if (!state.isRunning && !state.isPaused) {
        stopTimerDisplay();
      }
    } else {
      stopTimerDisplay();
    }
  }, 1000);
}

function stopTimerDisplay() {
  if (timerUpdateInterval) {
    clearInterval(timerUpdateInterval);
    timerUpdateInterval = null;
  }
}

function updateTimerDisplay(remainingMs) {
  const display = document.getElementById('timer-display');
  if (display) {
    display.textContent = formatTime(remainingMs);
  }
}

function updateTimerControls(state) {
  const startBtn = document.getElementById('start-timer-btn');
  const pauseBtn = document.getElementById('pause-timer-btn');
  const resumeBtn = document.getElementById('resume-timer-btn');
  const stopBtn = document.getElementById('stop-timer-btn');

  if (!startBtn || !pauseBtn || !resumeBtn || !stopBtn) return;

  if (state && state.isRunning) {
    startBtn.style.display = 'none';
    pauseBtn.style.display = state.isPaused ? 'none' : 'inline-block';
    resumeBtn.style.display = state.isPaused ? 'inline-block' : 'none';
    stopBtn.style.display = 'inline-block';

    if (!state.isPaused) {
      const remaining = Math.max(0, state.timeoutDuration - state.elapsedTime);
      updateTimerDisplay(remaining);
    }
  } else {
    startBtn.style.display = 'inline-block';
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    updateTimerDisplay(0);
  }
}

function renderBridgeData() {
  const statusContainer = document.getElementById('bridgeStatusCard');
  const tabsContainer = document.getElementById('bridgeTabsData');

  if (!statusContainer || !tabsContainer) {
    return;
  }

  const activeTabCount = latestBridgeTabs.filter((tab) => tab.active).length;
  const recentHistoryCount = latestBridgeHistory.length;
  const pomodoroLabel = latestBridgePomodoroState
    ? `${latestBridgePomodoroState.isBreak ? 'Break' : 'Focus'} / ${
        latestBridgePomodoroState.isRunning ? 'Running' : 'Idle'
      }`
    : 'No extension pomodoro sync yet';

  statusContainer.innerHTML = `
    <p><strong>Tracked tabs:</strong> ${sanitizeHTML(String(latestBridgeTabs.length))}</p>
    <p><strong>Active tabs:</strong> ${sanitizeHTML(String(activeTabCount))}</p>
    <p><strong>History entries:</strong> ${sanitizeHTML(String(recentHistoryCount))}</p>
    <p><strong>Pomodoro sync:</strong> ${sanitizeHTML(pomodoroLabel)}</p>
  `;

  if (latestBridgeTabs.length === 0) {
    tabsContainer.innerHTML = '<p>No browser tabs received from the extension yet.</p>';
    return;
  }

  const visibleTabs = latestBridgeTabs.slice(0, 10);
  tabsContainer.innerHTML = `
    <h3>Latest Tabs</h3>
    <ul>
      ${visibleTabs
        .map((tab) => {
          const title = sanitizeHTML(tab.title || 'Untitled');
          const url = sanitizeHTML(tab.url || '');
          const state = tab.active ? 'Active' : 'Background';
          return `<li><strong>${title}</strong> - ${url} (${sanitizeHTML(state)})</li>`;
        })
        .join('')}
    </ul>
  `;
}

// Tasks functions
async function loadTasks() {
  try {
    const tasks = await window.electronAPI.getTasks();
    renderTasks(tasks);
  } catch (error) {
    console.error('Error loading tasks:', error);
  }
}

function renderTasks(tasks) {
  const taskList = document.getElementById('taskList');
  if (!taskList) return;
  taskList.innerHTML = '';

  if (tasks.length === 0) {
    taskList.innerHTML = '<p>No tasks yet. Add one above!</p>';
    return;
  }

  tasks.forEach((task) => {
    const taskItem = document.createElement('div');
    const priority = task.priority || 'medium';
    taskItem.className = `task-item ${task.completed ? 'completed' : ''}`;
    taskItem.dataset.priority = priority;

    const deadlineStr = task.deadline ? new Date(task.deadline).toLocaleString() : 'No deadline';
    const tags = task.tags ? task.tags.filter((tag) => tag.trim()) : [];

    taskItem.innerHTML = `
      <div class="task-info">
        <div class="task-title">${sanitizeHTML(task.title)}</div>
        <div class="task-deadline">Deadline: ${sanitizeHTML(deadlineStr)}</div>
        ${
          tags.length > 0
            ? `
          <div class="task-tags">
            ${tags.map((tag) => `<span class="task-tag">${sanitizeHTML(tag.trim())}</span>`).join('')}
          </div>
        `
            : ''
        }
      </div>
      <div class="task-actions">
        <button class="toggle-btn" data-id="${sanitizeHTML(task.id)}">
          ${task.completed ? 'Undo' : 'Complete'}
        </button>
        <button class="delete-btn" data-id="${sanitizeHTML(task.id)}">Delete</button>
      </div>
    `;

    taskList.appendChild(taskItem);
  });

  // Add event listeners to buttons
  document.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      try {
        const id = e.target.dataset.id;
        const tasksList = await window.electronAPI.getTasks();
        const task = tasksList.find((t) => t.id === id);
        await window.electronAPI.updateTask(id, { completed: !task.completed });
        await loadTasks();
      } catch (error) {
        console.error('Error toggling task:', error);
      }
    });
  });

  document.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      try {
        const id = e.target.dataset.id;
        await window.electronAPI.deleteTask(id);
        await loadTasks();
      } catch (error) {
        console.error('Error deleting task:', error);
      }
    });
  });
}

function setupTaskForm() {
  const form = document.getElementById('taskForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const title = document.getElementById('taskTitle').value;
      const description = document.getElementById('taskDescription').value;
      const priority = document.getElementById('taskPriority').value;
      const tagsInput = document.getElementById('taskTags').value;
      const deadline = document.getElementById('taskDeadline').value;

      const tags = tagsInput
        ? tagsInput
            .split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag)
        : [];

      await window.electronAPI.addTask({
        title,
        description,
        priority,
        tags,
        deadline: deadline ? new Date(deadline).toISOString() : null,
      });

      form.reset();
      // Reset priority to default
      document.getElementById('taskPriority').value = 'medium';
      await loadTasks();
    } catch (error) {
      console.error('Error adding task:', error);
    }
  });
}

// System monitor
async function loadSystemMonitorData() {
  try {
    const data = await window.electronAPI.getSystemMonitorData();
    renderSystemMonitorData(data);
  } catch (error) {
    console.error('Error loading system monitor data:', error);
  }
}

function renderSystemMonitorData(data) {
  const container = document.getElementById('systemMonitorData');
  if (!container) return;
  container.innerHTML = '';

  if (!data || !data.timestamp) {
    container.innerHTML = '<p>No data collected yet.</p>';
    return;
  }

  container.innerHTML = `
    <p><strong>Last collected:</strong> ${sanitizeHTML(new Date(data.timestamp).toLocaleString())}</p>
    <h3>Active Windows:</h3>
    <ul>
      ${data.windows.map((w) => `<li>${sanitizeHTML(w.owner?.name || 'Unknown')} - ${sanitizeHTML(w.title || 'No title')}</li>`).join('')}
    </ul>
  `;
}

// Focus plans
let currentPlan = null; // New: Current plan state
let escapeHtml = sanitizeHTML; // Use existing sanitizeHTML as escapeHtml

function renderCurrentPlan(plan) {
  const container = document.getElementById('currentPlanContainer');
  const section = document.getElementById('currentPlanSection');
  if (!plan) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  const completedTasks = plan.tasks.filter((task) => task.completed).length;
  const totalTasks = plan.tasks.length;
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  container.innerHTML = `
    <div class="adhd-plan-card">
      <h3>${escapeHtml(plan.title)}</h3>
      ${plan.goal ? `<p>${escapeHtml(plan.goal)}</p>` : ''}
      <div class="plan-progress-container">
        <div class="plan-progress-header">
          <span>Progress</span>
          <span>${progressPercent}%</span>
        </div>
        <div class="plan-progress-bar">
          <div id="planProgressBar" class="plan-progress-fill" style="width: ${progressPercent}%;"></div>
        </div>
      </div>
      <div class="task-list">
        ${plan.tasks
          .map(
            (task, _index) => `
          <div class="task-item ${task.completed ? 'task-completed' : ''}" 
               data-task-id="${task.id}">
            <input type="checkbox" class="task-checkbox" 
                   ${task.completed ? 'checked' : ''}>
            <div style="flex: 1;">
              <div style="font-weight: 600;">${escapeHtml(task.title)}</div>
            </div>
            <span class="task-duration">${task.durationMinutes} min</span>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  // Add event listeners for tasks
  container.querySelectorAll('.task-item').forEach((item, index) => {
    item.addEventListener('click', (e) => {
      if (!e.target.classList.contains('task-checkbox')) {
        toggleTask(index);
      }
    });
    const checkbox = item.querySelector('.task-checkbox');
    checkbox.addEventListener('change', () => toggleTask(index));
  });
}

function toggleTask(taskIndex) {
  if (!currentPlan) return;
  currentPlan.tasks[taskIndex].completed = !currentPlan.tasks[taskIndex].completed;
  if (currentPlan.tasks[taskIndex].completed) {
    currentPlan.tasks[taskIndex].completedAt = new Date().toISOString();
  } else {
    currentPlan.tasks[taskIndex].completedAt = null;
  }
  renderCurrentPlan(currentPlan);
  // Optional: Play gentle sound when task completes
  if (currentPlan.tasks[taskIndex].completed) {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.type = 'sine';
      oscillator.frequency.value = 523.25;
      gainNode.gain.value = 0.1;
      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
      console.error('Failed to play sound:', e);
    }
  }
}

async function loadPlanHistory() {
  try {
    const history = await window.electronAPI.getPlanHistory();
    renderRecentPlans(history.slice(0, 5)); // Show last 5 plans in recent section
    renderPlanHistory(history);
  } catch (error) {
    console.error('Error loading plan history:', error);
  }
}

function renderRecentPlans(plans) {
  const container = document.getElementById('recentPlansList');
  if (!container) return;
  
  if (plans.length === 0) {
    container.innerHTML = '<p>No recent plans yet. Create one above!</p>';
    return;
  }
  
  container.innerHTML = plans.map((plan, index) => `
    <div class="recent-plan-item" data-plan-index="${index}">
      <div class="recent-plan-info">
        <h4>${escapeHtml(plan.title)}</h4>
        <p>${plan.durationMinutes} min • ${new Date(plan.createdAt).toLocaleString()}</p>
      </div>
      <button class="secondary-btn" style="padding: 8px 16px; font-size: 1rem;">Use</button>
    </div>
  `).join('');
  
  // Add click listeners
  container.querySelectorAll('.recent-plan-item').forEach((item, index) => {
    item.addEventListener('click', async (e) => {
      if (e.target.tagName === 'BUTTON') {
        // Recreate the plan from history
        const historyPlan = plans[index];
        const newPlan = await window.electronAPI.createPlan({
          title: historyPlan.title,
          goal: historyPlan.goal,
          durationMinutes: historyPlan.durationMinutes,
          tasks: historyPlan.tasks ? historyPlan.tasks.map(t => ({...t, completed: false})) : undefined,
          source: 'recent-plan'
        });
        currentPlan = newPlan;
        renderCurrentPlan(currentPlan);
        await window.electronAPI.addPlanToHistory(newPlan, { source: 'recent-plan' });
        await loadPlanHistory();
        await loadStatistics();
      }
    });
  });
}

function renderPlanHistory(history) {
  const historyList = document.getElementById('planHistoryList');
  if (!historyList) return;
  historyList.innerHTML = '';

  if (history.length === 0) {
    historyList.innerHTML = '<p>No focus plans yet. Create one above!</p>';
    return;
  }

  history.forEach((entry) => {
    const planItem = document.createElement('div');
    planItem.className = 'plan-item';

    const createdAtStr = new Date(entry.createdAt).toLocaleString();

    planItem.innerHTML = `
      <div class="plan-info">
        <div class="plan-title">${sanitizeHTML(entry.title)}</div>
        <div class="plan-details">
          ${entry.goal ? `<div class="plan-goal">Goal: ${sanitizeHTML(entry.goal)}</div>` : ''}
          <div class="plan-duration">Duration: ${sanitizeHTML(entry.durationMinutes.toString())} min</div>
          <div class="plan-date">Created: ${sanitizeHTML(createdAtStr)}</div>
          <div class="plan-status">Status: ${sanitizeHTML(entry.status)}</div>
        </div>
      </div>
    `;

    historyList.appendChild(planItem);
  });
}

function setupPlanForm() {
  const form = document.getElementById('planForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const title = document.getElementById('planTitle').value;
      const goal = document.getElementById('planGoal').value;
      const durationMinutes = parseInt(document.getElementById('planDuration').value, 10);
      const chunkSizeMinutes = parseInt(document.getElementById('planChunkSize').value, 10);

      const plan = await window.electronAPI.createPlan({
        title,
        goal,
        durationMinutes,
        chunkSizeMinutes,
        source: 'ui',
      });

      currentPlan = plan; // Set as current plan
      renderCurrentPlan(currentPlan); // Render current plan UI

      await window.electronAPI.addPlanToHistory(plan, {
        source: 'ui',
      });

      form.reset();
      document.getElementById('planChunkSize').value = '15'; // Reset chunk size
      await loadPlanHistory();
      await loadStatistics();
    } catch (error) {
      console.error('Error creating plan:', error);
    }
  });

  // New: Add event listeners for current plan buttons
  const startBtn = document.getElementById('startCurrentPlanBtn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      if (!currentPlan) return;
      // Update timer duration to match plan
      const timerDurationInput = document.getElementById('timer-duration');
      if (timerDurationInput) {
        timerDurationInput.value = currentPlan.durationMinutes;
      }
      const state = await window.electronAPI.startFocusTimer(currentPlan.durationMinutes);
      updateTimerControls(state);
      startTimerDisplay();
    });
  }

  const clearBtn = document.getElementById('clearCurrentPlanBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      currentPlan = null;
      renderCurrentPlan(null);
    });
  }
}

function setupClearHistoryBtn() {
  const btn = document.getElementById('clearHistoryBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      if (confirm('Are you sure you want to clear all focus plan history?')) {
        await window.electronAPI.clearPlanHistory();
        await loadPlanHistory();
        await loadStatistics();
      }
    } catch (error) {
      console.error('Error clearing history:', error);
    }
  });
}

// Statistics
async function loadStatistics() {
  try {
    const stats = await window.electronAPI.getPlanStatistics();
    renderStatistics(stats);
    drawFocusChart();
  } catch (error) {
    console.error('Error loading statistics:', error);
  }
}

function renderStatistics(stats) {
  const container = document.getElementById('statisticsData');
  if (!container) return;
  container.innerHTML = '';

  if (!stats || !stats.totalPlans) {
    container.innerHTML = '<p>No statistics yet. Create some focus plans!</p>';
    return;
  }

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-value">${sanitizeHTML(stats.totalPlans.toString())}</div>
        <div class="stat-label">Total Plans</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${sanitizeHTML(stats.totalMinutes.toString())}</div>
        <div class="stat-label">Total Minutes</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${sanitizeHTML(stats.averageDuration.toString())}</div>
        <div class="stat-label">Avg Duration (min)</div>
      </div>
    </div>
  `;
}

function drawFocusChart() {
  const canvas = document.getElementById('focusChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Sample data for last 7 days
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const minutes = [60, 120, 90, 150, 80, 0, 0];
  const maxMinutes = Math.max(...minutes, 60);

  // Draw chart
  const barWidth = (canvas.width / days.length) * 0.7;
  const barSpacing = (canvas.width / days.length) * 0.3;
  const chartHeight = canvas.height - 60;

  days.forEach((day, index) => {
    const barHeight = (minutes[index] / maxMinutes) * chartHeight;
    const x = index * (barWidth + barSpacing) + barSpacing / 2;
    const y = canvas.height - barHeight - 40;

    // Gradient for bar
    const gradient = ctx.createLinearGradient(x, y, x, canvas.height - 40);
    gradient.addColorStop(0, '#7c3aed');
    gradient.addColorStop(1, '#ec4899');

    ctx.fillStyle = gradient;
    ctx.shadowColor = 'rgba(124, 58, 237, 0.3)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 5;
    ctx.fillRect(x, y, barWidth, barHeight);

    // Draw day label
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 14px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(day, x + barWidth / 2, canvas.height - 10);

    // Draw value label
    if (minutes[index] > 0) {
      ctx.fillStyle = '#7c3aed';
      ctx.font = 'bold 12px Inter';
      ctx.fillText(`${minutes[index]}m`, x + barWidth / 2, y - 10);
    }
  });
}

// Slash commands
function setupCommandInput() {
  const input = document.getElementById('commandInput');
  const resultDiv = document.getElementById('commandResult');
  if (!input || !resultDiv) return;

  input.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      const commandText = input.value.trim();
      input.value = '';

      if (!commandText.startsWith('/')) {
        resultDiv.textContent = 'Commands must start with /';
        return;
      }

      try {
        const result = await handleCommand(commandText);
        resultDiv.textContent = result;
      } catch (error) {
        resultDiv.textContent = 'Error: ' + error.message;
      }
    }
  });
}

async function handleCommand(commandText) {
  const parts = commandText.slice(1).split(' ');
  const commandName = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  switch (commandName) {
    case 'plan':
      return await handlePlanCommand(args);
    case 'help':
      return handleHelpCommand();
    default:
      return `Unknown command: /${commandName}. Type /help for available commands.`;
  }
}

async function handlePlanCommand(args) {
  try {
    const plan = await window.electronAPI.createPlanFromCommand(args, {
      source: 'slash-command',
    });
    
    // Set as current plan and render
    currentPlan = plan;
    renderCurrentPlan(currentPlan);
    
    await window.electronAPI.addPlanToHistory(plan, {
      source: 'slash-command',
      status: 'in_progress',
    });

    // Start timer if we're in focus tab
    const focusTab = document.getElementById('focus-tab');
    const isFocusTabActive = focusTab && focusTab.classList.contains('active');
    if (isFocusTabActive) {
      const timerDurationInput = document.getElementById('timer-duration');
      if (timerDurationInput) {
        timerDurationInput.value = plan.durationMinutes;
      }
      const state = await window.electronAPI.startFocusTimer(plan.durationMinutes);
      updateTimerControls(state);
      startTimerDisplay();
    }

    let response = `Created plan: ${plan.title} (${plan.durationMinutes} min)`;

    // If not in Focus tab, add a hint
    if (!isFocusTabActive) {
      response += '\nSwitch to the Focus tab to start the timer.';
    }

    return response;
  } catch (error) {
    console.error('Error creating plan:', error);
    let errorMessage = 'Failed to create plan. ';

    if (error.message) {
      errorMessage += error.message;
    } else {
      errorMessage += 'Please check the console for details.';
    }

    throw new Error(errorMessage);
  }
}

function handleHelpCommand() {
  return 'Available commands: /plan [preset or title] [duration] - Create a focus plan; /help - Show this help';
}

// Habits functions
async function loadHabits() {
  try {
    const habits = await window.electronAPI.getAllHabits('active');
    renderHabits(habits);
  } catch (error) {
    console.error('Error loading habits:', error);
  }
}

async function loadHabitsSummary() {
  try {
    const result = await window.electronAPI.getHabitsSummary();
    if (result && result.success) {
      renderHabitsSummary(result.summary);
    }
  } catch (error) {
    console.error('Error loading habits summary:', error);
  }
}

function renderHabitsSummary(summary) {
  const container = document.getElementById('habitsSummary');
  if (!container) return;

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-value">${sanitizeHTML(summary.totalActiveHabits.toString())}</div>
        <div class="stat-label">Active Habits</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${sanitizeHTML(summary.completedToday.toString())}</div>
        <div class="stat-label">Completed Today</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${sanitizeHTML(summary.completionRateToday.toString())}%</div>
        <div class="stat-label">Completion Rate</div>
      </div>
    </div>
  `;
}

async function renderHabits(habits) {
  const habitList = document.getElementById('habitList');
  if (!habitList) return;
  habitList.innerHTML = '';

  if (habits.length === 0) {
    habitList.innerHTML = '<p>No habits yet. Add one above!</p>';
    return;
  }

  // Use for...of to properly await async operations and prevent race conditions
  for (const habit of habits) {
    const isCompleted = await window.electronAPI.isHabitCompleted(habit.id);
    const habitItem = document.createElement('div');
    habitItem.className = `habit-item ${isCompleted ? 'completed' : ''}`;

    habitItem.innerHTML = `
      <div class="habit-info">
        <div class="habit-name">${sanitizeHTML(habit.name)}</div>
        <div class="habit-streak">Streak: ${sanitizeHTML((habit.streak || 0).toString())} days | Best: ${sanitizeHTML((habit.bestStreak || 0).toString())} days</div>
        <div class="habit-streak">Total completions: ${sanitizeHTML((habit.totalCompletions || 0).toString())}</div>
      </div>
      <div class="habit-actions">
        <button class="complete-btn" data-id="${sanitizeHTML(habit.id)}">
          ${isCompleted ? 'Undo' : 'Complete'}
        </button>
        <button class="delete-btn" data-id="${sanitizeHTML(habit.id)}">Delete</button>
      </div>
    `;

    habitList.appendChild(habitItem);
  }

  // Add event listeners
  document.querySelectorAll('.complete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      try {
        const id = e.target.dataset.id;
        const isCompleted = await window.electronAPI.isHabitCompleted(id);
        if (isCompleted) {
          await window.electronAPI.uncompleteHabit(id);
        } else {
          await window.electronAPI.completeHabit(id);
        }
        await loadHabits();
        await loadHabitsSummary();
      } catch (error) {
        console.error('Error toggling habit:', error);
      }
    });
  });

  document.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      try {
        const id = e.target.dataset.id;
        if (confirm('Are you sure you want to delete this habit?')) {
          await window.electronAPI.deleteHabit(id);
          await loadHabits();
          await loadHabitsSummary();
        }
      } catch (error) {
        console.error('Error deleting habit:', error);
      }
    });
  });
}

function setupHabitForm() {
  const form = document.getElementById('habitForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const name = document.getElementById('habitName').value;
      const description = document.getElementById('habitDescription').value;
      const frequency = document.getElementById('habitFrequency').value;
      const targetCount = parseInt(document.getElementById('habitTargetCount').value, 10);

      const result = await window.electronAPI.createHabit({
        name,
        description,
        frequency,
        targetCount,
      });

      if (result && result.success) {
        form.reset();
        await loadHabits();
        await loadHabitsSummary();
      }
    } catch (error) {
      console.error('Error adding habit:', error);
    }
  });
}

// Notifications functions
async function loadNotifications() {
  try {
    const notifications = await window.electronAPI.getAllNotifications();
    renderNotifications(notifications);
  } catch (error) {
    console.error('Error loading notifications:', error);
  }
}

function renderNotifications(notifications) {
  const list = document.getElementById('notificationList');
  if (!list) return;

  if (notifications.length === 0) {
    list.innerHTML = '<p>No notifications yet.</p>';
    return;
  }

  // Icon map
  const typeIcons = {
    task: '📋',
    reminder: '⏰',
    achievement: '🏆',
    focus: '🎯',
    system: '⚙️'
  };

  list.innerHTML = notifications
    .map(
      (n) => `
    <div class="notification-item ${n.read ? 'read' : 'unread'}" data-id="${sanitizeHTML(n.id)}">
      <div class="notification-type-icon ${sanitizeHTML(n.type)}">${typeIcons[n.type] || '📄'}</div>
      <div class="notification-info">
        <div class="notification-title">${sanitizeHTML(n.title)}</div>
        <div class="notification-body">${sanitizeHTML(n.body)}</div>
        <div class="notification-meta">
          <span class="notification-type">${sanitizeHTML(n.type)}</span>
          <span>${sanitizeHTML(new Date(n.createdAt).toLocaleString())}</span>
        </div>
      </div>
      <div class="notification-actions">
        ${!n.read ? `<button class="mark-read-btn" data-id="${sanitizeHTML(n.id)}">Mark Read</button>` : ''}
        <button class="delete-notification-btn" data-id="${sanitizeHTML(n.id)}">Delete</button>
      </div>
    </div>
  `
    )
    .join('');

  // Add event listeners
  document.querySelectorAll('.mark-read-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      await window.electronAPI.markNotificationRead(id);
      await loadNotifications();
      await loadNotificationStats();
    });
  });

  document.querySelectorAll('.delete-notification-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      await window.electronAPI.deleteNotification(id);
      await loadNotifications();
      await loadNotificationStats();
    });
  });

  // Setup mark all read and clear all
  const markAllReadBtn = document.getElementById('markAllReadBtn');
  if (markAllReadBtn) {
    markAllReadBtn.onclick = async () => {
      await window.electronAPI.markAllNotificationsRead();
      await loadNotifications();
      await loadNotificationStats();
    };
  }

  const clearAllNotificationsBtn = document.getElementById('clearAllNotificationsBtn');
  if (clearAllNotificationsBtn) {
    clearAllNotificationsBtn.onclick = async () => {
      if (confirm('Are you sure you want to clear all notifications?')) {
        await window.electronAPI.clearAllNotifications();
        await loadNotifications();
        await loadNotificationStats();
      }
    };
  }
}

async function loadNotificationSettings() {
  try {
    const settings = await window.electronAPI.getNotificationSettings();
    renderNotificationSettings(settings);
  } catch (error) {
    console.error('Error loading notification settings:', error);
  }
}

function renderNotificationSettings(settings) {
  const toggle = document.getElementById('desktopNotificationsToggle');
  if (toggle) {
    toggle.checked = settings.desktopNotificationsEnabled;
    toggle.onchange = async (e) => {
      await window.electronAPI.updateNotificationSettings({
        desktopNotificationsEnabled: e.target.checked,
      });
    };
  }
}

async function loadNotificationStats() {
  try {
    const stats = await window.electronAPI.getNotificationStats();
    renderNotificationStats(stats);
  } catch (error) {
    console.error('Error loading notification stats:', error);
  }
}

function renderNotificationStats(stats) {
  const container = document.getElementById('notificationsStats');
  if (!container) return;

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-value">${sanitizeHTML(stats.total.toString())}</div>
        <div class="stat-label">Total</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${sanitizeHTML(stats.unread.toString())}</div>
        <div class="stat-label">Unread</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${sanitizeHTML(stats.todayCount.toString())}</div>
        <div class="stat-label">Today</div>
      </div>
    </div>
  `;
}

async function loadActivityHistory() {
  try {
    const history = await window.electronAPI.getActivityHistory(50);
    renderActivityHistory(history);
  } catch (error) {
    console.error('Error loading activity history', error);
  }
}

function renderActivityHistory(history) {
  const container = document.getElementById('activityHistory');
  if (!container) return;

  if (history.length === 0) {
    container.innerHTML = '<p>No activity history yet.</p>';
    return;
  }

  const items = history
    .map((entry) => {
      const start = new Date(entry.startTime).toLocaleString();
      const end = entry.endTime ? new Date(entry.endTime).toLocaleString() : 'Ongoing';
      const durationMinutes = Math.round((entry.duration || 0) / 1000 / 60);
      return `
      <div class="activity-item">
        <div class="activity-info">
          <div class="activity-app">${sanitizeHTML(entry.appName)}</div>
          <div class="activity-time">${sanitizeHTML(start)} - ${sanitizeHTML(end)}</div>
          <div class="activity-duration">Duration: ${sanitizeHTML(durationMinutes.toString())} min</div>
        </div>
      </div>
    `;
    })
    .join('');

  container.innerHTML = items;
}

async function loadAppUsageStats() {
  try {
    const stats = await window.electronAPI.getAppUsageStats(7);
    renderAppUsageStats(stats);
  } catch (error) {
    console.error('Error loading app usage stats', error);
  }
}

function renderAppUsageStats(stats) {
  const container = document.getElementById('appUsageStats');
  if (!container) return;

  const apps = Object.entries(stats);
  if (apps.length === 0) {
    container.innerHTML = '<p>No app usage stats yet.</p>';
    return;
  }

  const items = apps
    .sort((a, b) => b[1].totalDuration - a[1].totalDuration)
    .map(([appName, data]) => {
      const durationMinutes = Math.round(data.totalDuration / 1000 / 60);
      return `
        <div class="app-stat-item">
          <div class="app-stat-info">
            <div class="app-stat-name">${sanitizeHTML(appName)}</div>
            <div class="app-stat-duration">${sanitizeHTML(durationMinutes.toString())} min used</div>
            <div class="app-stat-count">${sanitizeHTML(data.count.toString())} sessions</div>
          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = items;
}
