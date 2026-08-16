// i18n helper functions
let currentLang = 'en';
let translationsCache = {};

async function t(key, params = {}) {
  return window.electronAPI ? await window.electronAPI.t(key, params) : key;
}

async function initI18n() {
  try {
    currentLang = await window.electronAPI.getLanguage();
    const supportedLanguages = await window.electronAPI.getSupportedLanguages();
    initLanguageSelector(supportedLanguages);
    await updateAllTranslations();
  } catch (error) {
    console.error('Failed to initialize i18n:', error);
  }
}

async function initLanguageSelector(languages) {
  const selector = document.getElementById('languageSelector');
  if (!selector) return;

  selector.innerHTML = languages
    .map((lang) => `<option value="${lang.code}">${lang.name}</option>`)
    .join('');
  selector.value = currentLang;

  selector.addEventListener('change', async (e) => {
    const newLang = e.target.value;
    await window.electronAPI.setLanguage(newLang);
    currentLang = newLang;
    await updateAllTranslations();
  });
}

// ADHD Soundscapes & Audio Synthesizer Engine
let currentTrackIndex = 0;
let currentSoundscape = 'brown'; // 'brown', 'pink', 'rain', 'binaural', 'music'
const musicTracks = [
  { name: 'Ambient Chill 1', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { name: 'Ambient Chill 2', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { name: 'Ambient Chill 3', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
];

let audioCtx = null;
let noiseNode = null;
let synthOsc1 = null;
let synthOsc2 = null;
let synthGain = null;
let isSynthPlaying = false;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playDopamineSparkSound() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.15); // C6

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  } catch (e) {
    console.warn('Spark sound error:', e);
  }
}

function playSyntheticAmbient(type = 'brown') {
  try {
    const ctx = getAudioContext();
    if (isSynthPlaying) stopSyntheticAmbient();

    synthGain = ctx.createGain();
    const volumeVal = (document.getElementById('music-volume')?.value || 50) / 100;
    synthGain.gain.setValueAtTime(volumeVal * 0.15, ctx.currentTime);

    if (type === 'brown' || type === 'pink' || type === 'rain') {
      const bufferSize = 2 * ctx.sampleRate;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let lastOut = 0.0;

      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        if (type === 'brown' || type === 'rain') {
          // Brown noise integration filter
          output[i] = (lastOut + 0.02 * white) / 1.02;
          lastOut = output[i];
          output[i] *= 3.5;
        } else {
          // Pink noise filter approximation
          output[i] = white * 0.5;
        }
      }

      noiseNode = ctx.createBufferSource();
      noiseNode.buffer = noiseBuffer;
      noiseNode.loop = true;

      if (type === 'rain') {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 800;
        noiseNode.connect(filter);
        filter.connect(synthGain);
      } else {
        noiseNode.connect(synthGain);
      }

      synthGain.connect(ctx.destination);
      noiseNode.start();
    } else if (type === 'binaural') {
      // 40Hz Binaural Beat (Left 200Hz, Right 240Hz for gamma focus)
      const merger = ctx.createChannelMerger(2);
      synthOsc1 = ctx.createOscillator();
      synthOsc2 = ctx.createOscillator();

      synthOsc1.frequency.setValueAtTime(200, ctx.currentTime);
      synthOsc2.frequency.setValueAtTime(240, ctx.currentTime);

      synthOsc1.connect(merger, 0, 0);
      synthOsc2.connect(merger, 0, 1);
      merger.connect(synthGain);
      synthGain.connect(ctx.destination);

      synthOsc1.start();
      synthOsc2.start();
    }
    isSynthPlaying = true;
  } catch (e) {
    console.warn('Audio Context Soundscape failed:', e);
  }
}

function stopSyntheticAmbient() {
  if (isSynthPlaying) {
    try {
      if (noiseNode) {
        noiseNode.stop();
        noiseNode.disconnect();
        noiseNode = null;
      }
      if (synthOsc1 && synthOsc2) {
        synthOsc1.stop();
        synthOsc2.stop();
        synthOsc1.disconnect();
        synthOsc2.disconnect();
        synthOsc1 = null;
        synthOsc2 = null;
      }
      if (synthGain) {
        synthGain.disconnect();
        synthGain = null;
      }
    } catch (e) {}
    isSynthPlaying = false;
  }
}

function initMusicPlayer() {
  const audio = document.getElementById('music-audio');
  const playPauseBtn = document.getElementById('music-play-pause');
  const prevBtn = document.getElementById('music-prev');
  const nextBtn = document.getElementById('music-next');
  const volumeSlider = document.getElementById('music-volume');
  const headerMusicToggle = document.getElementById('music-toggle');
  const trackNameDisplay = document.getElementById('music-track-name');

  if (!audio || !playPauseBtn || !prevBtn || !nextBtn || !volumeSlider) return;

  function updateTrackInfo() {
    if (trackNameDisplay) {
      trackNameDisplay.textContent = musicTracks[currentTrackIndex].name;
    }
  }

  function updateUIState(isPlaying) {
    const playPauseIcon = document.getElementById('playPauseIcon');
    const playPauseLabel = document.getElementById('playPauseLabel');
    const musicToggle = document.getElementById('music-toggle');
    if (isPlaying) {
      if (playPauseIcon) playPauseIcon.querySelector('use').setAttribute('href', '#icon-pause');
      if (playPauseLabel) playPauseLabel.textContent = 'Pause';
      if (musicToggle) {
        musicToggle.querySelector('use').setAttribute('href', '#icon-music-on');
        musicToggle.classList.add('active');
      }
    } else {
      if (playPauseIcon) playPauseIcon.querySelector('use').setAttribute('href', '#icon-play');
      if (playPauseLabel) playPauseLabel.textContent = 'Play Soundscape';
      if (musicToggle) {
        musicToggle.querySelector('use').setAttribute('href', '#icon-music');
        musicToggle.classList.remove('active');
      }
    }
  }

  // Soundscape selector buttons
  const soundscapeBtns = document.querySelectorAll('.soundscape-btn');
  soundscapeBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      soundscapeBtns.forEach((b) => b.classList.remove('active'));
      const type = e.target.getAttribute('data-type');
      e.target.classList.add('active');
      currentSoundscape = type;

      const titleMap = {
        brown: 'Brown Noise (Deep ADHD Focus)',
        pink: 'Pink Noise (Balanced Focus)',
        rain: 'Soft Rain Synth (Calming Ambience)',
        binaural: '40Hz Gamma Focus (Binaural Beats)',
        music: musicTracks[currentTrackIndex].name,
      };

      if (trackNameDisplay) {
        trackNameDisplay.textContent = titleMap[type] || 'Soundscape Active';
      }

      if (!audio.paused || isSynthPlaying) {
        audio.pause();
        stopSyntheticAmbient();
        if (type === 'music') {
          audio.play().catch(() => playSyntheticAmbient('brown'));
        } else {
          playSyntheticAmbient(type);
        }
        updateUIState(true);
      }
    });
  });

  async function togglePlay() {
    if (audio.paused && !isSynthPlaying) {
      if (currentSoundscape === 'music') {
        audio.src = musicTracks[currentTrackIndex].url;
        try {
          await audio.play();
          updateUIState(true);
        } catch (err) {
          console.warn('Remote audio playback failed, switching to ambient synth fallback', err);
          playSyntheticAmbient('brown');
          updateUIState(true);
        }
      } else {
        playSyntheticAmbient(currentSoundscape);
        updateUIState(true);
      }
    } else {
      audio.pause();
      stopSyntheticAmbient();
      updateUIState(false);
    }
  }

  // Initial volume
  audio.volume = volumeSlider.value / 100;
  audio.src = musicTracks[currentTrackIndex].url;
  updateTrackInfo();

  playPauseBtn.addEventListener('click', togglePlay);

  if (headerMusicToggle) {
    headerMusicToggle.addEventListener('click', togglePlay);
  }

  prevBtn.addEventListener('click', () => {
    currentTrackIndex = (currentTrackIndex - 1 + musicTracks.length) % musicTracks.length;
    audio.src = musicTracks[currentTrackIndex].url;
    updateTrackInfo();
    if (!audio.paused || isSynthPlaying) {
      stopSyntheticAmbient();
      audio.play().catch(() => playSyntheticAmbient());
      updateUIState(true);
    }
  });

  nextBtn.addEventListener('click', () => {
    currentTrackIndex = (currentTrackIndex + 1) % musicTracks.length;
    audio.src = musicTracks[currentTrackIndex].url;
    updateTrackInfo();
    if (!audio.paused || isSynthPlaying) {
      stopSyntheticAmbient();
      audio.play().catch(() => playSyntheticAmbient());
      updateUIState(true);
    }
  });

  volumeSlider.addEventListener('input', (e) => {
    const vol = e.target.value / 100;
    audio.volume = vol;
    if (synthGain && audioCtx) {
      synthGain.gain.setValueAtTime(vol * 0.1, audioCtx.currentTime);
    }
  });

  audio.addEventListener('ended', () => {
    currentTrackIndex = (currentTrackIndex + 1) % musicTracks.length;
    audio.src = musicTracks[currentTrackIndex].url;
    updateTrackInfo();
    audio.play().catch(() => playSyntheticAmbient());
  });

  audio.addEventListener('error', (e) => {
    console.warn('Audio element error, using ambient sound generator', e);
  });
}

// ADHD Dyslexia Font & Distraction Focus Shield Setup
function initADHDFocusTools() {
  const fontBtn = document.getElementById('fontToggle');

  let fontStateIndex = 0;
  const fontFamilies = [
    { name: 'Font: Inter', value: "'Inter', sans-serif" },
    { name: 'Font: Dyslexic/Clean', value: "'Segoe UI', system-ui, sans-serif" },
    { name: 'Font: Outfit', value: "'Outfit', sans-serif" },
  ];

  if (fontBtn) {
    fontBtn.addEventListener('click', () => {
      fontStateIndex = (fontStateIndex + 1) % fontFamilies.length;
      document.body.style.fontFamily = fontFamilies[fontStateIndex].value;
      const label = fontBtn.querySelector('.btn-label');
      if (label) label.textContent = fontFamilies[fontStateIndex].name;
      showToast(`Switched font to ${fontFamilies[fontStateIndex].name}`, 'info');
    });
  }
}

// Global Command Palette Integration
let paletteEngine = null;

function initCommandPalette() {
  if (typeof CommandPaletteEngine === 'undefined') return;
  paletteEngine = new CommandPaletteEngine({
    onExecute: () => closeCommandPalette(),
  });

  const modal = document.getElementById('command-palette-modal');
  const input = document.getElementById('command-palette-input');
  const resultsContainer = document.getElementById('command-palette-results');
  if (!modal || !input || !resultsContainer) return;

  function renderPaletteResults(query = '') {
    const results = paletteEngine.search(query);
    if (!results.length) {
      resultsContainer.innerHTML = `<div style="padding:1rem;text-align:center;opacity:0.6;">No matching commands found</div>`;
      return;
    }

    resultsContainer.innerHTML = results
      .map(
        (item, idx) => `
      <div class="command-palette-item ${idx === paletteEngine.selectedIndex ? 'selected' : ''}" data-id="${item.id}">
        <div class="command-item-left">
          <span class="command-item-icon">${item.icon || '⚡'}</span>
          <span class="command-item-title">${item.title}</span>
        </div>
        <span class="command-item-category">${item.category}</span>
      </div>
    `
      )
      .join('');

    // Attach click handlers
    resultsContainer.querySelectorAll('.command-palette-item').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        paletteEngine.execute(id);
      });
    });
  }

  function openCommandPalette() {
    paletteEngine.selectedIndex = 0;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    input.value = '';
    renderPaletteResults('');
    setTimeout(() => input.focus(), 50);
  }

  function closeCommandPalette() {
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  // Keyboard Navigation
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (modal.classList.contains('is-hidden')) {
        openCommandPalette();
      } else {
        closeCommandPalette();
      }
    } else if (e.key === 'Escape' && !modal.classList.contains('is-hidden')) {
      closeCommandPalette();
    }
  });

  input.addEventListener('input', (e) => {
    paletteEngine.selectedIndex = 0;
    renderPaletteResults(e.target.value);
  });

  input.addEventListener('keydown', (e) => {
    const items = resultsContainer.querySelectorAll('.command-palette-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      paletteEngine.selectedIndex = (paletteEngine.selectedIndex + 1) % items.length;
      renderPaletteResults(input.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      paletteEngine.selectedIndex = (paletteEngine.selectedIndex - 1 + items.length) % items.length;
      renderPaletteResults(input.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selectedEl = items[paletteEngine.selectedIndex];
      if (selectedEl) {
        const id = selectedEl.getAttribute('data-id');
        paletteEngine.execute(id);
      }
    }
  });
}

async function updateAllTranslations() {
  // Update static text elements
  updateTabText();
  updatePlanSection();
  updateTaskSection();
  updateTimerSection();
  updateHabitSection();
  updateNotificationsSection();
  updateStatsSection();
  updateAuthSection();
  updateUiElements();
  updateMusicSection();
}

async function updateMusicSection() {
  const musicTitle = document.querySelector('#focus-tab .section:nth-child(3) h2');
  if (musicTitle) musicTitle.textContent = await t('music.title');
}

async function updateTabText() {
  const focusTab = document.getElementById('tab-focus');
  const tasksTab = document.getElementById('tab-tasks');
  const habitsTab = document.getElementById('tab-habits');
  const notificationsTab = document.getElementById('tab-notifications');
  const statsTab = document.getElementById('tab-stats');
  const accountTab = document.getElementById('tab-account');

  if (focusTab) focusTab.textContent = await t('tabs.focus');
  if (tasksTab) tasksTab.textContent = await t('tabs.tasks');
  if (habitsTab) habitsTab.textContent = await t('tabs.habits');
  if (notificationsTab) notificationsTab.textContent = await t('tabs.notifications');
  if (statsTab) statsTab.textContent = await t('tabs.stats');
  if (accountTab) accountTab.textContent = await t('tabs.account');
}

async function updatePlanSection() {
  const quickCommands = document.querySelector('#focus-tab h2');
  const commandInput = document.getElementById('commandInput');
  const createPlan = document.querySelector('#focus-tab .section:nth-child(2) h2');
  const presetSearch = document.getElementById('presetSearch');
  const presetFilterAll = document.querySelector('[data-tag="all"]');
  const presetFilterWork = document.querySelector('[data-tag="work"]');
  const presetFilterStudy = document.querySelector('[data-tag="study"]');
  const presetFilterFocus = document.querySelector('[data-tag="focus"]');
  const presetFilterSpace = document.querySelector('[data-tag="space"]');
  const presetFilterCreative = document.querySelector('[data-tag="creative"]');
  const planTitleLabel = document.querySelector('label[for="planTitle"]');
  const planTitleInput = document.getElementById('planTitle');
  const planDurationLabel = document.querySelector('label[for="planDuration"]');
  const planGoalLabel = document.querySelector('label[for="planGoal"]');
  const planGoalInput = document.getElementById('planGoal');
  const planChunkSizeLabel = document.querySelector('label[for="planChunkSize"]');
  const planTemplateLabel = document.querySelector('label[for="planTemplate"]');
  const createPlanBtn = document.querySelector('#planForm button[type="submit"]');
  const recentPlans = document.getElementById('recentPlansSection h2');
  const planHistory = document.querySelector('#focus-tab .section:last-child h2');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  if (quickCommands) quickCommands.textContent = await t('plan.quickCommands');
  if (commandInput) commandInput.placeholder = await t('plan.commandPlaceholder');
  if (createPlan) createPlan.textContent = await t('plan.title');
  if (presetSearch) presetSearch.placeholder = await t('plan.searchPresets');
  if (presetFilterAll) presetFilterAll.textContent = await t('plan.presetFilterAll');
  if (presetFilterWork) presetFilterWork.textContent = await t('plan.presetFilterWork');
  if (presetFilterStudy) presetFilterStudy.textContent = await t('plan.presetFilterStudy');
  if (presetFilterFocus) presetFilterFocus.textContent = await t('plan.presetFilterFocus');
  if (presetFilterSpace) presetFilterSpace.textContent = await t('plan.presetFilterSpace');
  if (presetFilterCreative) presetFilterCreative.textContent = await t('plan.presetFilterCreative');
  if (planTitleLabel) planTitleLabel.textContent = await t('plan.planTitle');
  if (planTitleInput) planTitleInput.placeholder = await t('plan.planTitlePlaceholder');
  if (planDurationLabel) planDurationLabel.textContent = await t('plan.planDuration');
  if (planGoalLabel) planGoalLabel.textContent = await t('plan.planGoal');
  if (planGoalInput) planGoalInput.placeholder = await t('plan.planGoalPlaceholder');
  if (planChunkSizeLabel) planChunkSizeLabel.textContent = await t('plan.planChunkSize');
  if (planTemplateLabel) planTemplateLabel.textContent = await t('plan.planTemplate');
  if (createPlanBtn) createPlanBtn.textContent = await t('plan.createPlan');
  if (recentPlans) recentPlans.textContent = await t('plan.recentPlans');
  if (planHistory) planHistory.textContent = await t('plan.planHistory');
  if (clearHistoryBtn) clearHistoryBtn.textContent = await t('plan.clearHistory');
}

async function updateTaskSection() {
  const addNewTask = document.querySelector('#tasks-tab h2');
  const taskTitleLabel = document.querySelector('label[for="taskTitle"]');
  const taskTitleInput = document.getElementById('taskTitle');
  const taskDescLabel = document.querySelector('label[for="taskDescription"]');
  const taskDescInput = document.getElementById('taskDescription');
  const taskPriorityLabel = document.querySelector('label[for="taskPriority"]');
  const taskTagsLabel = document.querySelector('label[for="taskTags"]');
  const taskTagsInput = document.getElementById('taskTags');
  const taskDeadlineLabel = document.querySelector('label[for="taskDeadline"]');
  const addTaskBtn = document.querySelector('#taskForm button[type="submit"]');
  const yourTasks = document.querySelector('#tasks-tab .section:last-child h2');

  if (addNewTask) addNewTask.textContent = await t('tasks.addNewTask');
  if (taskTitleLabel) taskTitleLabel.textContent = await t('tasks.taskTitle');
  if (taskTitleInput) taskTitleInput.placeholder = await t('tasks.taskTitlePlaceholder');
  if (taskDescLabel) taskDescLabel.textContent = await t('tasks.taskDescription');
  if (taskDescInput) taskDescInput.placeholder = await t('tasks.taskDescriptionPlaceholder');
  if (taskPriorityLabel) taskPriorityLabel.textContent = await t('tasks.taskPriority');
  if (taskTagsLabel) taskTagsLabel.textContent = await t('tasks.taskTags');
  if (taskTagsInput) taskTagsInput.placeholder = await t('tasks.taskTagsPlaceholder');
  if (taskDeadlineLabel) taskDeadlineLabel.textContent = await t('tasks.taskDeadline');
  if (addTaskBtn) addTaskBtn.textContent = await t('tasks.addTask');
  if (yourTasks) yourTasks.textContent = await t('tasks.yourTasks');
}

async function updateTimerSection() {
  const timerTitle = document.querySelector('#focus-tab .section:nth-child(3) h2');
  const timerModeIndicator = document.getElementById('timer-mode-indicator');
  const timerModeWork = document.getElementById('timer-mode-work');
  const timerModeShort = document.getElementById('timer-mode-short-break');
  const timerModeLong = document.getElementById('timer-mode-long-break');
  const timerDurationLabel = document.querySelector('label[for="timer-duration"]');
  const startBtn = document.getElementById('start-timer-btn');

  if (timerTitle) timerTitle.textContent = await t('timer.title');
  if (timerModeIndicator) timerModeIndicator.textContent = await t('timer.workMode');
  if (timerModeWork) timerModeWork.textContent = await t('timer.workMode');
  if (timerModeShort) timerModeShort.textContent = await t('timer.shortBreakMode');
  if (timerModeLong) timerModeLong.textContent = await t('timer.longBreakMode');
  if (timerDurationLabel) timerDurationLabel.textContent = await t('timer.duration');
  if (startBtn) startBtn.textContent = await t('timer.start');
}

async function updateHabitSection() {
  const addNewHabit = document.querySelector('#habits-tab h2');
  const habitNameLabel = document.querySelector('label[for="habitName"]');
  const habitNameInput = document.getElementById('habitName');
  const habitDescLabel = document.querySelector('label[for="habitDescription"]');
  const habitDescInput = document.getElementById('habitDescription');
  const habitFreqLabel = document.querySelector('label[for="habitFrequency"]');
  const habitTargetLabel = document.querySelector('label[for="habitTargetCount"]');
  const addHabitBtn = document.querySelector('#habitForm button[type="submit"]');
  const yourHabits = document.querySelector('#habits-tab .section:last-child h2');
  const habitsSummary = document.getElementById('habitsSummary');

  if (addNewHabit) addNewHabit.textContent = await t('habits.addNewHabit');
  if (habitNameLabel) habitNameLabel.textContent = await t('habits.habitName');
  if (habitNameInput) habitNameInput.placeholder = await t('habits.habitNamePlaceholder');
  if (habitDescLabel) habitDescLabel.textContent = await t('habits.habitDescription');
  if (habitDescInput) habitDescInput.placeholder = await t('habits.habitDescriptionPlaceholder');
  if (habitFreqLabel) habitFreqLabel.textContent = await t('habits.habitFrequency');
  if (habitTargetLabel) habitTargetLabel.textContent = await t('habits.habitTargetCount');
  if (addHabitBtn) addHabitBtn.textContent = await t('habits.addHabit');
  if (yourHabits) yourHabits.textContent = await t('habits.yourHabits');
  if (habitsSummary && habitsSummary.previousElementSibling)
    habitsSummary.previousElementSibling.textContent = await t('habits.habitsSummary');
}

async function updateNotificationsSection() {
  const settingsTitle = document.querySelector('#notifications-tab .section:first-child h2');
  const enableNotif = document.querySelector('[for="desktopNotificationsToggle"]');
  const yourNotifs = document.querySelector('#notifications-tab .section:last-child header h2');
  const markAllRead = document.getElementById('markAllReadBtn');
  const clearAll = document.getElementById('clearAllNotificationsBtn');

  if (settingsTitle) settingsTitle.textContent = await t('notifications.settings');
  if (enableNotif) enableNotif.textContent = await t('notifications.enableDesktopNotifications');
  if (yourNotifs) yourNotifs.textContent = await t('notifications.yourNotifications');
  if (markAllRead) markAllRead.textContent = await t('notifications.markAllRead');
  if (clearAll) clearAll.textContent = await t('notifications.clearAll');
}

async function updateStatsSection() {
  const focusStats = document.querySelector('#stats-tab .section:first-child h2');
  const weeklyChart = document.querySelector('#stats-tab .section:nth-child(2) h2');
  const browserBridge = document.querySelector('#stats-tab .section:nth-child(3) h2');
  const systemMonitor = document.querySelector('#stats-tab .section:nth-child(4) h2');
  const activityTracking = document.querySelector('#stats-tab .section:last-child h2');
  const appUsageStats = document.querySelector('#stats-tab h3');

  if (focusStats) focusStats.textContent = await t('stats.focusStatistics');
  if (weeklyChart) weeklyChart.textContent = await t('stats.weeklyFocusChart');
  if (browserBridge) browserBridge.textContent = await t('stats.browserBridge');
  if (systemMonitor) systemMonitor.textContent = await t('stats.systemMonitor');
  if (activityTracking) activityTracking.textContent = await t('stats.activityTracking');
  if (appUsageStats) appUsageStats.textContent = await t('stats.appUsageStats');
}

async function updateAuthSection() {
  const signIn = document.getElementById('login-container h2');
  const createAccount = document.getElementById('register-container h2');
  const emailLabel = document.querySelector('label[for="loginEmail"]');
  const emailInput = document.getElementById('loginEmail');
  const passwordLabel = document.querySelector('label[for="loginPassword"]');
  const passwordInput = document.getElementById('loginPassword');
  const signInBtn = document.querySelector('#loginForm button[type="submit"]');
  const dontHaveAccount = document.querySelector('.auth-toggle-text');
  const registerHere = document.getElementById('showRegisterBtn');

  if (signIn) signIn.textContent = await t('auth.signIn');
  if (createAccount) createAccount.textContent = await t('auth.createAccount');
  if (emailLabel) emailLabel.textContent = await t('auth.email');
  if (emailInput) emailInput.placeholder = await t('auth.emailPlaceholder');
  if (passwordLabel) passwordLabel.textContent = await t('auth.password');
  if (passwordInput) passwordInput.placeholder = await t('auth.passwordPlaceholder');
  if (signInBtn) signInBtn.textContent = await t('auth.signInButton');
  if (dontHaveAccount) dontHaveAccount.textContent = await t('auth.dontHaveAccount');
  if (registerHere) registerHere.textContent = await t('auth.registerHere');
}

async function updateUiElements() {
  const calmModeBtn = document.getElementById('calmModeToggle');
  const darkModeBtn = document.getElementById('darkModeToggle');

  if (calmModeBtn)
    calmModeBtn.innerHTML = document.body.classList.contains('calm-mode')
      ? await t('ui.normalMode')
      : await t('ui.calmMode');
  // Keep the icon markup intact when translations refresh. Replacing the
  // button's innerHTML used to remove the SVG and made the theme control
  // inconsistent after a language change.
  const darkModeLabel = darkModeBtn?.querySelector('.btn-label');
  if (darkModeLabel) {
    darkModeLabel.textContent = document.body.classList.contains('dark')
      ? await t('ui.lightMode')
      : await t('ui.darkMode');
  }
}

// Sanitize HTML to prevent XSS
function sanitizeHTML(str) {
  if (typeof str !== 'string') return '';
  const tempDiv = document.createElement('div');
  tempDiv.textContent = str;
  return tempDiv.innerHTML;
}

// Toast notification system
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // Auto remove after 3 seconds
  setTimeout(() => {
    toast.style.animation = 'slideInUp 0.3s ease-out reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Confetti celebration function
function launchConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);

  const colors = ['#e67e22', '#c0392b', '#27ae60', '#f39c12', '#3498db', '#9b59b6'];
  const numPieces = 50;

  for (let i = 0; i < numPieces; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.left = Math.random() * 100 + '%';
    piece.style.animationDuration = Math.random() * 2 + 2 + 's';
    piece.style.animationDelay = Math.random() * 0.5 + 's';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    container.appendChild(piece);
  }

  // Remove container after animation completes
  setTimeout(() => {
    container.remove();
  }, 4000);
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
  const profilePhotoInput = document.getElementById('profilePhotoInput');
  const profilePhotoStatus = document.getElementById('profilePhotoStatus');
  if (profilePhotoInput) {
    profilePhotoInput.addEventListener('change', async () => {
      const [file] = profilePhotoInput.files || [];
      if (!file) return;
      if (!file.type.startsWith('image/') || file.size > 3 * 1024 * 1024) {
        if (profilePhotoStatus) profilePhotoStatus.textContent = 'Choose an image smaller than 3 MB.';
        profilePhotoInput.value = '';
        return;
      }
      try {
        if (profilePhotoStatus) profilePhotoStatus.textContent = 'Uploading photo…';
        const picture = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Unable to read the selected image.'));
          reader.readAsDataURL(file);
        });
        const result = await window.electronAPI.updateProfilePicture(picture);
        if (!result.success) throw new Error(result.error || 'Unable to save your profile photo.');
        updateAuthUI(result.user);
        if (profilePhotoStatus) profilePhotoStatus.textContent = 'Profile photo saved.';
      } catch (error) {
        if (profilePhotoStatus) profilePhotoStatus.textContent = error.message || 'Unable to upload the photo.';
      } finally {
        profilePhotoInput.value = '';
      }
    });
  }

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

// Calm mode toggle
function setupCalmMode() {
  const calmModeToggle = document.getElementById('calmModeToggle');
  if (!calmModeToggle) return;

  // Load saved calm mode state from localStorage
  const savedCalmMode = localStorage.getItem('calmMode') === 'true';
  if (savedCalmMode) {
    document.body.classList.add('calm-mode');
    calmModeToggle.querySelector('.btn-label').textContent = 'Normal Mode';
  }

  calmModeToggle.addEventListener('click', () => {
    const isCalmMode = document.body.classList.toggle('calm-mode');
    localStorage.setItem('calmMode', isCalmMode);
    calmModeToggle.querySelector('.btn-label').textContent = isCalmMode ? 'Normal Mode' : 'Calm Mode';
  });
}

// Dark mode toggle
function setupDarkMode() {
  const darkModeToggle = document.getElementById('darkModeToggle');
  if (!darkModeToggle) return;

  // Check for system preference and saved preference
  const savedDarkMode = localStorage.getItem('darkMode');
  const systemPrefersDark =
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  // Apply initial theme
  function applyTheme(isDark) {
    const darkModeIconEl = document.getElementById('darkModeIcon');
    const darkModeLabelEl = darkModeToggle.querySelector('.btn-label');
    if (isDark) {
      document.body.classList.add('dark');
      if (darkModeIconEl) darkModeIconEl.querySelector('use').setAttribute('href', '#icon-sun');
      if (darkModeLabelEl) darkModeLabelEl.textContent = 'Light Mode';
      else darkModeToggle.textContent = 'Light Mode';
    } else {
      document.body.classList.remove('dark');
      if (darkModeIconEl) darkModeIconEl.querySelector('use').setAttribute('href', '#icon-moon');
      if (darkModeLabelEl) darkModeLabelEl.textContent = 'Dark Mode';
      else darkModeToggle.textContent = 'Dark Mode';
    }
  }

  // Determine initial state
  let isDark = savedDarkMode === 'true' || (savedDarkMode === null && systemPrefersDark);
  applyTheme(isDark);

  // Toggle on button click
  darkModeToggle.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark');
    localStorage.setItem('darkMode', isDark);
    applyTheme(isDark);
  });

  // Listen for system preference changes
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (localStorage.getItem('darkMode') === null) {
        applyTheme(e.matches);
      }
    });
  }
}

// No Animation mode toggle
function setupNoAnimationMode() {
  const noAnimationToggle = document.getElementById('noAnimationToggle');
  if (!noAnimationToggle) return;

  // Load saved no animation state from localStorage
  const savedNoAnimation = localStorage.getItem('noAnimation') === 'true';
  if (savedNoAnimation) {
    document.body.classList.add('no-animation');
    noAnimationToggle.querySelector('.btn-label').textContent = 'Animations On';
  }

  noAnimationToggle.addEventListener('click', () => {
    const isNoAnimation = document.body.classList.toggle('no-animation');
    localStorage.setItem('noAnimation', isNoAnimation);
    noAnimationToggle.querySelector('.btn-label').textContent = isNoAnimation
      ? 'Animations On'
      : 'No Animation';
  });
}

function setupWorkspaceMotion() {
  const animatedItems = document.querySelectorAll(
    '.app-header, .tabs, .tab-content.active > .section, .tab-content.active > .focus-primary-grid > .section'
  );

  animatedItems.forEach((item, index) => item.style.setProperty('--enter-index', String(index)));
  requestAnimationFrame(() => document.body.classList.add('app-ready'));
}

// Notification settings
function setupNotificationSettings() {
  const notificationFrequency = document.getElementById('notificationFrequency');
  const silentDuringFocusToggle = document.getElementById('silentDuringFocusToggle');

  if (notificationFrequency) {
    // Load saved frequency preference
    const savedFrequency = localStorage.getItem('notificationFrequency');
    if (savedFrequency) {
      notificationFrequency.value = savedFrequency;
    }

    notificationFrequency.addEventListener('change', (e) => {
      localStorage.setItem('notificationFrequency', e.target.value);
      if (window.electronAPI) {
        window.electronAPI.updateNotificationSettings({
          frequency: e.target.value,
        });
      }
    });
  }

  if (silentDuringFocusToggle) {
    // Load saved silent during focus preference
    const savedSilentDuringFocus = localStorage.getItem('silentDuringFocus') === 'true';
    if (savedSilentDuringFocus) {
      silentDuringFocusToggle.checked = true;
    }

    silentDuringFocusToggle.addEventListener('change', (e) => {
      localStorage.setItem('silentDuringFocus', e.target.checked);
      if (window.electronAPI) {
        window.electronAPI.updateNotificationSettings({
          silentDuringFocus: e.target.checked,
        });
      }
    });
  }
}

// Keyboard shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Tab navigation with Ctrl/Cmd + number
    if (
      (e.ctrlKey || e.metaKey) &&
      !isNaN(parseInt(e.key)) &&
      parseInt(e.key) >= 1 &&
      parseInt(e.key) <= 6
    ) {
      const tabButtons = document.querySelectorAll('.tab-button');
      const index = parseInt(e.key) - 1;
      if (tabButtons[index]) {
        tabButtons[index].click();
      }
    }

    // Toggle calm mode with Ctrl/Cmd + Shift + C
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
      const calmModeToggle = document.getElementById('calmModeToggle');
      if (calmModeToggle) {
        calmModeToggle.click();
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize i18n
  await initI18n();

  // Initialize music player & soundscapes
  initMusicPlayer();

  // Initialize ADHD Focus Tools & Font Toggle
  initADHDFocusTools();

  // Initialize Command Palette
  initCommandPalette();

  // Initialize app
  await initApp();

  // Set up tabs
  setupTabs();
  setupFocusSessionControls();
  setupWorkspaceQuickActions();
  setupWorkspaceMotion();

  // Set up calm mode
  setupCalmMode();

  // Theme setup is handled by the notebook-theme initializer below. Keeping
  // one click handler prevents a click from toggling light/dark twice.

  // Set up no animation mode
  setupNoAnimationMode();

  // Set up notification settings
  setupNotificationSettings();

  // Set up keyboard shortcuts
  setupKeyboardShortcuts();

  // Set up easter egg
  setupEasterEgg();

  // Record user activity on interactions
  const recordActivity = () => {
    window.electronAPI.recordActivity();
  };
  document.addEventListener('keydown', recordActivity);
  document.addEventListener('mousemove', recordActivity);
  document.addEventListener('click', recordActivity);

  // Listen for language change events
  if (window.electronAPI) {
    window.electronAPI.onLanguageChanged(async (lang) => {
      await updateAllTranslations();
    });
  }

  // Listen for events from main process
  if (window.electronAPI) {
    window.electronAPI.onPlanUpdated(async (payload) => {
      const updatedPlan =
        payload?.plan ||
        (payload?.channel === 'create-plan' && payload?.result ? payload.result : null);
      if (updatedPlan && typeof updatedPlan === 'object') {
        currentPlan = updatedPlan;
        renderCurrentPlan(currentPlan);
      }
      await refreshPlanViews({ silent: true });
    });

    window.electronAPI.onFocusTimerComplete(async (_state) => {
      updateTimerDisplay(0);
      updateTimerControls(null);
    });
    window.electronAPI.onFocusSessionUpdated((state) => renderFocusSession(state));

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

let focusSessionDisplayInterval = null;
function renderFocusSession(state) {
  const status = document.getElementById('focus-session-status');
  const display = document.getElementById('focus-session-display');
  if (!status || !display) return;
  if (!state?.active) {
    status.textContent = 'No active session';
    display.textContent = '00:00';
    return;
  }
  status.textContent = `${state.phase === 'work' ? 'Work phase' : 'Break phase'}${state.paused ? ' paused' : ''}${state.editsLocked ? ' - blocklist locked' : ''}`;
  display.textContent = formatTime(state.remainingMs || 0);
}

async function renderFocusReport() {
  const report = await window.electronAPI.getFocusReport();
  const target = document.getElementById('focus-report');
  if (!target) return;
  const minutes = Math.round((report.todayFocusedMs || 0) / 60000);
  const trend = (report.weeklyTrend || [])
    .map((day) => `${day.date.slice(5)}: ${Math.round(day.durationMs / 60000)}m`)
    .join(' | ');
  const sites =
    (report.topBlockedAttempts || []).map((site) => `${site.domain} (${site.count})`).join(', ') ||
    'None';
  target.textContent = `Today: ${minutes} minutes. Streak: ${report.streak || 0} days. Week: ${trend}. Blocked attempts: ${sites}.`;
}

function setupFocusSessionControls() {
  const start = document.getElementById('start-focus-session');
  const pause = document.getElementById('pause-focus-session');
  const resume = document.getElementById('resume-focus-session');
  const stop = document.getElementById('stop-focus-session');
  if (!start) return;
  start.addEventListener('click', async () => {
    const state = await window.electronAPI.startFocusSession({
      workMinutes: document.getElementById('session-work-minutes').value,
      breakMinutes: document.getElementById('session-break-minutes').value,
      strict: document.getElementById('session-strict').checked,
    });
    renderFocusSession(state);
    await renderFocusReport();
  });
  pause.addEventListener('click', async () =>
    renderFocusSession(await window.electronAPI.pauseFocusSession())
  );
  resume.addEventListener('click', async () =>
    renderFocusSession(await window.electronAPI.resumeFocusSession())
  );
  stop.addEventListener('click', async () => {
    renderFocusSession(await window.electronAPI.stopFocusSession());
    await renderFocusReport();
  });
  window.electronAPI.getFocusSessionState().then(renderFocusSession);
  window.electronAPI.onFocusSessionUpdated((state) => {
    renderFocusSession(state);
    if (isFocusShieldActive) renderFocusShield(state);
  });
  renderFocusReport();
  if (focusSessionDisplayInterval) clearInterval(focusSessionDisplayInterval);
  focusSessionDisplayInterval = setInterval(
    async () => renderFocusSession(await window.electronAPI.getFocusSessionState()),
    1000
  );
}

function activateTab(tabId) {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  if (!tabId) return null;

  tabButtons.forEach((button) => {
    const isActive = button.getAttribute('data-tab') === tabId;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });

  tabContents.forEach((content) => {
    const isActive = content.id === `${tabId}-tab`;
    content.classList.toggle('active', isActive);
    if (isActive) {
      content.removeAttribute('hidden');
    } else {
      content.setAttribute('hidden', '');
    }
  });

  const activeContent = document.getElementById(`${tabId}-tab`);
  if (tabId === 'more') {
    requestAnimationFrame(() => drawFocusChart(latestPlanStatistics, latestFocusReport));
    loadStatistics({ silent: true }).catch((error) => {
      console.warn('Unable to refresh More insights panel:', error);
    });
  }

  return activeContent;
}

function revealMorePanel(panelId) {
  const targetPanel = document.getElementById(panelId);
  if (!targetPanel) return;

  activateTab('more');

  ['moreInsightsPanel', 'moreProfilePanel'].forEach((id) => {
    const panel = document.getElementById(id);
    if (panel) {
      panel.open = id === panelId;
    }
  });

  requestAnimationFrame(() => {
    targetPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const summary = targetPanel.querySelector('summary');
    if (summary && typeof summary.focus === 'function') {
      summary.focus({ preventScroll: true });
    }
  });
}

function bindClickAction(elementId, handler) {
  const element = document.getElementById(elementId);
  if (!element) return;

  element.addEventListener('click', (event) => {
    event.preventDefault();
    handler(event);
  });
}

function setupWorkspaceQuickActions() {
  bindClickAction('openProfileSettingsBtn', () => revealMorePanel('moreProfilePanel'));
  bindClickAction('openProfileFromMoreBtn', () => revealMorePanel('moreProfilePanel'));
  bindClickAction('openInsightsFromMoreBtn', () => revealMorePanel('moreInsightsPanel'));
}

// Tab navigation
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activateTab(button.getAttribute('data-tab'));
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

async function loadTasks() {
  try {
    const tasks = await window.electronAPI.getTasks();
    const searchVal = (document.getElementById('taskFilterSearch')?.value || '')
      .toLowerCase()
      .trim();
    const priorityVal = document.getElementById('taskFilterPriority')?.value || 'all';
    const statusVal = document.getElementById('taskFilterStatus')?.value || 'open';
    const sortOrder = document.getElementById('taskSortOrder')?.value || 'priority';

    const filtered = tasks.filter((task) => {
      const matchSearch =
        !searchVal ||
        task.title.toLowerCase().includes(searchVal) ||
        (task.description && task.description.toLowerCase().includes(searchVal)) ||
        (task.tags && task.tags.some((tg) => tg.toLowerCase().includes(searchVal)));
      const matchPriority = priorityVal === 'all' || task.priority === priorityVal;
      const matchStatus =
        statusVal === 'all' ||
        (statusVal === 'completed' && task.completed) ||
        (statusVal === 'open' && !task.completed);
      return !task.archived && matchSearch && matchPriority && matchStatus;
    });

    const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 };
    filtered.sort((a, b) => {
      if (sortOrder === 'deadline') {
        const aDeadline = a.deadline ? new Date(a.deadline).getTime() : Number.MAX_SAFE_INTEGER;
        const bDeadline = b.deadline ? new Date(b.deadline).getTime() : Number.MAX_SAFE_INTEGER;
        return aDeadline - bDeadline;
      }
      if (sortOrder === 'newest') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      if (sortOrder === 'oldest') return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      return (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2);
    });

    renderTasks(filtered);
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

    const deadline = task.deadline ? new Date(task.deadline) : null;
    const isOverdue = Boolean(deadline && !task.completed && deadline.getTime() < Date.now());
    const deadlineStr = deadline ? deadline.toLocaleString() : 'No deadline';
    const tags = task.tags ? task.tags.filter((tag) => tag.trim()) : [];
    const subtaskCount = task.subtasks?.length || 0;
    const completedSubtasks = task.subtasks?.filter((subtask) => subtask.completed).length || 0;

    taskItem.innerHTML = `
      <div class="task-info">
        <div class="task-title">${sanitizeHTML(task.title)}</div>
        ${task.description ? `<div style="font-size:0.88rem; color:var(--ink-light); margin-top:0.25rem;">${sanitizeHTML(task.description)}</div>` : ''}
        <div class="task-deadline${isOverdue ? ' task-overdue' : ''}">Deadline: ${sanitizeHTML(deadlineStr)}${isOverdue ? ' — Overdue' : ''}</div>
        ${subtaskCount ? `<div class="task-progress" aria-label="Micro-step progress">Micro-steps: ${completedSubtasks}/${subtaskCount} complete</div>` : ''}
        ${
          tags.length > 0
            ? `
          <div class="task-tags">
            ${tags.map((tag) => `<span class="task-tag">${sanitizeHTML(tag.trim())}</span>`).join('')}
          </div>
        `
            : ''
        }
        ${
          task.subtasks && task.subtasks.length > 0
            ? `
          <div class="subtasks-container" style="margin-top: 0.75rem; background: rgba(0,0,0,0.04); padding: 0.5rem; border-radius: 8px;">
            <div style="font-size: 0.8rem; font-weight: 600; text-transform: uppercase; color: var(--accent-1); margin-bottom: 0.4rem;">Micro-Steps (ADHD Chunking)</div>
            ${task.subtasks
              .map(
                (st, sIdx) => `
              <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; margin-bottom: 0.25rem;">
                <input type="checkbox" ${st.completed ? 'checked' : ''} class="subtask-checkbox" data-task-id="${sanitizeHTML(task.id)}" data-sub-idx="${sIdx}">
                <span style="${st.completed ? 'text-decoration: line-through; opacity: 0.7;' : ''}">${sanitizeHTML(st.title)}</span>
              </div>
            `
              )
              .join('')}
          </div>
        `
            : ''
        }
      </div>
      <div class="task-actions" style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
        <button class="chunk-btn secondary-btn" data-id="${sanitizeHTML(task.id)}" title="1-Click ADHD Micro-Task Breakdown">Chunk</button>
        <button class="toggle-btn ${task.completed ? 'secondary-btn' : 'primary-btn'}" data-id="${sanitizeHTML(task.id)}">
          ${task.completed ? 'Undo' : 'Complete'}
        </button>
        <button class="delete-btn danger-btn" data-id="${sanitizeHTML(task.id)}">Delete</button>
      </div>
    `;

    taskList.appendChild(taskItem);
  });

  // Add event listeners to buttons
  document.querySelectorAll('.chunk-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      try {
        const id = e.target.dataset.id;
        const tasksList = await window.electronAPI.getTasks();
        const task = tasksList.find((t) => t.id === id);
        if (!task) return;

        // Auto-generate ADHD Chunked steps
        const subtasks = [
          {
            title: `Open & prepare workspace for "${task.title.slice(0, 20)}..."`,
            completed: false,
          },
          { title: `Draft first 5 minutes focus outline`, completed: false },
          { title: `Execute core goal block`, completed: false },
          { title: `Final review & clean up`, completed: false },
        ];

        await window.electronAPI.updateTask(id, { subtasks });
        showToast('Task chunked into 4 micro-steps!', 'success');
        playDopamineSparkSound();
        await loadTasks();
      } catch (error) {
        console.error('Error chunking task:', error);
      }
    });
  });

  document.querySelectorAll('.subtask-checkbox').forEach((cb) => {
    cb.addEventListener('change', async (e) => {
      try {
        const taskId = e.target.dataset.taskId;
        const subIdx = parseInt(e.target.dataset.subIdx, 10);
        const tasksList = await window.electronAPI.getTasks();
        const task = tasksList.find((t) => t.id === taskId);
        if (!task || !task.subtasks) return;

        task.subtasks[subIdx].completed = e.target.checked;
        if (e.target.checked) {
          playDopamineSparkSound();
        }
        await window.electronAPI.updateTask(taskId, { subtasks: task.subtasks });
        await loadTasks();
      } catch (error) {
        console.error('Error updating subtask:', error);
      }
    });
  });

  document.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      try {
        const id = e.target.dataset.id;
        const tasksList = await window.electronAPI.getTasks();
        const task = tasksList.find((t) => t.id === id);
        const willComplete = !task.completed;
        if (willComplete) {
          launchConfetti();
          playDopamineSparkSound();
          showToast('Awesome progress! Micro-reward unlocked!', 'success');
        }
        await window.electronAPI.updateTask(id, { completed: willComplete });
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
let latestPlanStatistics = null;
let latestFocusReport = null;
let escapeHtml = sanitizeHTML; // Use existing sanitizeHTML as escapeHtml

function getStatusElement(elementId) {
  return document.getElementById(elementId);
}

function setStatusMessage(elementId, message = '', type = 'info') {
  const element = getStatusElement(elementId);
  if (!element) {
    return;
  }

  if (!message) {
    element.textContent = '';
    element.className = 'status-message is-hidden';
    return;
  }

  element.textContent = message;
  element.className = `status-message status-${type}`;
}

function getErrorMessage(error, fallbackMessage) {
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
}

function setButtonBusy(button, isBusy, busyLabel) {
  if (!button) {
    return;
  }

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent;
  }

  button.disabled = isBusy;
  button.textContent = isBusy ? busyLabel : button.dataset.defaultLabel;
}

let buildWeeklyFocusChartData = () => [];
try {
  ({ buildWeeklyFocusSeries: buildWeeklyFocusChartData } = require('./src/coffee-compiled/focus-chart-data'));
} catch (error) {
  console.warn('Focus chart data helper could not load:', error.message);
}

async function refreshPlanViews(options = {}) {
  const normalizedOptions = options && typeof options === 'object' ? options : {};
  await Promise.all([
    loadPlanHistory({ silent: Boolean(normalizedOptions.silent) }),
    loadStatistics({ silent: Boolean(normalizedOptions.silent) }),
  ]);
}

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
  // Play gentle sound and launch confetti when task completes
  if (currentPlan.tasks[taskIndex].completed) {
    // Launch confetti for celebration
    launchConfetti();

    // Play gentle sound
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

async function loadPlanHistory(options = {}) {
  const silent = Boolean(options && options.silent);
  try {
    if (!silent) {
      setStatusMessage('planHistoryStatus', 'Loading focus plans...', 'info');
    }
    const history = await window.electronAPI.getPlanHistory();
    renderRecentPlans(history.slice(0, 5)); // Show last 5 plans in recent section
    renderPlanHistory(history);
    if (!silent) {
      setStatusMessage('planHistoryStatus', '', 'info');
    }
  } catch (error) {
    console.error('Error loading plan history:', error);
    renderRecentPlans([]);
    renderPlanHistory([]);
    setStatusMessage(
      'planHistoryStatus',
      `Failed to load focus plans. ${getErrorMessage(error, 'Please try again.')}`,
      'error'
    );
  }
}

function renderRecentPlans(plans) {
  const container = document.getElementById('recentPlansList');
  if (!container) return;

  if (plans.length === 0) {
    container.innerHTML = '<p>No recent plans yet. Create one above!</p>';
    return;
  }

  container.innerHTML = plans
    .map(
      (plan, index) => `
    <div class="recent-plan-item" data-plan-index="${index}">
      <div class="recent-plan-info">
        <h4>${escapeHtml(plan.title)}</h4>
        <p>${plan.durationMinutes} min • ${new Date(plan.createdAt).toLocaleString()}</p>
      </div>
      <button class="secondary-btn recent-plan-use-btn" style="padding: 8px 16px; font-size: 1rem;">Use</button>
    </div>
  `
    )
    .join('');

  // Add click listeners
  container.querySelectorAll('.recent-plan-item').forEach((item, index) => {
    item.addEventListener('click', async (e) => {
      if (e.target.tagName === 'BUTTON') {
        const useButton = e.target;
        setButtonBusy(useButton, true, 'Using...');
        setStatusMessage('planFormStatus', 'Loading selected plan...', 'info');

        try {
          const historyPlan = plans[index];
          const newPlan = await window.electronAPI.createPlan({
            title: historyPlan.title,
            goal: historyPlan.goal,
            durationMinutes: historyPlan.durationMinutes,
            tasks: historyPlan.tasks
              ? historyPlan.tasks.map((task) => ({
                  ...task,
                  completed: false,
                  completedAt: null,
                }))
              : undefined,
            source: 'recent-plan',
          });
          currentPlan = newPlan;
          renderCurrentPlan(currentPlan);
          await window.electronAPI.addPlanToHistory(newPlan, { source: 'recent-plan' });
          await refreshPlanViews({ silent: true });
          setStatusMessage('planFormStatus', 'Plan loaded from recent history.', 'success');
          setStatusMessage('planHistoryStatus', '', 'info');
        } catch (error) {
          console.error('Error loading recent plan:', error);
          setStatusMessage(
            'planFormStatus',
            `Failed to load recent plan. ${getErrorMessage(error, 'Please try again.')}`,
            'error'
          );
        } finally {
          setButtonBusy(useButton, false, 'Using...');
        }
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

// Global variables for presets and filters
let allPresets = [];
let currentFilterTag = 'all';
let currentSearchTerm = '';

// Load and render plan presets
async function loadAndRenderPresets() {
  try {
    // First, load the presets from the yaml file
    const presetsContainer = document.getElementById('planPresetsContainer');
    if (!presetsContainer) return;

    // For now, use the presets from the config file
    // We'll use the ones defined in plan-presets.yaml
    allPresets = [
      {
        name: 'work',
        title: 'Work Session',
        goal: 'Focus on work tasks',
        durationMinutes: 60,
        tags: ['work', 'productivity'],
        icon: 'briefcase',
        theme: 'professional',
      },
      {
        name: 'study',
        title: 'Study Session',
        goal: 'Focus on studying',
        durationMinutes: 45,
        tags: ['study', 'learning'],
        icon: 'book',
        theme: 'academic',
      },
      {
        name: 'focus',
        title: 'Deep Focus',
        goal: 'Deep focus session',
        durationMinutes: 25,
        tags: ['focus', 'deep-work'],
        icon: 'target',
        theme: 'minimal',
      },
      {
        name: 'code',
        title: 'Coding Session',
        goal: 'Write code and solve problems',
        durationMinutes: 90,
        tags: ['coding', 'development'],
        icon: 'code',
        theme: 'hacker',
      },
      {
        name: 'design',
        title: 'Design Session',
        goal: 'Create and refine designs',
        durationMinutes: 60,
        tags: ['design', 'creative'],
        icon: 'palette',
        theme: 'creative',
      },
      {
        name: 'write',
        title: 'Writing Session',
        goal: 'Write articles, docs, or content',
        durationMinutes: 45,
        tags: ['writing', 'content'],
        icon: 'pen',
        theme: 'cozy',
      },
      {
        name: 'read',
        title: 'Reading Session',
        goal: 'Read and learn new things',
        durationMinutes: 30,
        tags: ['reading', 'learning'],
        icon: 'book',
        theme: 'cozy',
      },
      {
        name: 'exercise',
        title: 'Exercise Session',
        goal: 'Physical activity or workout',
        durationMinutes: 45,
        tags: ['exercise', 'health'],
        icon: 'dumbbell',
        theme: 'energetic',
      },
      {
        name: 'meditate',
        title: 'Meditation Session',
        goal: 'Practice mindfulness and meditation',
        durationMinutes: 15,
        tags: ['meditation', 'mindfulness'],
        icon: 'feather',
        theme: 'zen',
      },
      {
        name: 'clean',
        title: 'Cleaning Session',
        goal: 'Clean and organize space',
        durationMinutes: 30,
        tags: ['cleaning', 'organization'],
        icon: 'broom',
        theme: 'fresh',
      },
      {
        name: 'review',
        title: 'Review Session',
        goal: 'Review work or materials',
        durationMinutes: 45,
        tags: ['review', 'planning'],
        icon: 'clipboard',
        theme: 'academic',
      },
      {
        name: 'plan',
        title: 'Planning Session',
        goal: 'Plan and organize tasks',
        durationMinutes: 30,
        tags: ['planning', 'organization'],
        icon: 'calendar',
        theme: 'organized',
      },
      {
        name: 'sprint',
        title: 'Quick Focus Sprint',
        goal: 'Short, focused burst of work',
        durationMinutes: 25,
        tags: ['sprint', 'quick-task'],
        icon: 'zap-preset',
        theme: 'energetic',
      },
      {
        name: 'blitz',
        title: 'Task Blitz',
        goal: 'Knock out small tasks quickly',
        durationMinutes: 15,
        tags: ['blitz', 'quick-task'],
        icon: 'zap-preset',
        theme: 'energetic',
      },
      {
        name: 'micro',
        title: 'Micro Focus',
        goal: 'Ultra-short focus session',
        durationMinutes: 10,
        tags: ['micro', 'quick-task', 'focus'],
        icon: 'target',
        theme: 'minimal',
      },
      {
        name: 'deep',
        title: 'Deep Dive',
        goal: 'Extended focused work',
        durationMinutes: 45,
        tags: ['deep-work', 'focus'],
        icon: 'rocket',
        theme: 'minimal',
      },
      {
        name: 'space-research',
        title: 'Space Research Session',
        goal: 'Research space science topics',
        durationMinutes: 60,
        tags: ['space', 'research', 'science'],
        icon: 'rocket',
        theme: 'space',
      },
      {
        name: 'satellite-design',
        title: 'Satellite Design Session',
        goal: 'Design satellite or space hardware',
        durationMinutes: 90,
        tags: ['space', 'hardware', 'design', 'creative'],
        icon: 'satellite',
        theme: 'space',
      },
      {
        name: 'data-analysis',
        title: 'Space Data Analysis',
        goal: 'Analyze space mission data',
        durationMinutes: 45,
        tags: ['space', 'data', 'analysis'],
        icon: 'bar-chart',
        theme: 'space',
      },
      {
        name: 'mission-planning',
        title: 'Space Mission Planning',
        goal: 'Plan space mission objectives',
        durationMinutes: 30,
        tags: ['space', 'planning', 'mission'],
        icon: 'map',
        theme: 'space',
      },
      {
        name: 'space-adventure',
        title: 'Space Adventure Mini-Game',
        goal: 'Play a quick space-themed mini-game (Easter egg!)',
        durationMinutes: 20,
        tags: ['game', 'easter-egg', 'space'],
        icon: 'gamepad',
        theme: 'space',
      },
    ];

    renderPresets();
  } catch (error) {
    console.error('Error loading presets:', error);
  }
}

// Render presets based on current filters
function renderPresets() {
  const presetsContainer = document.getElementById('planPresetsContainer');
  if (!presetsContainer) return;

  let filteredPresets = allPresets;

  // Apply tag filter
  if (currentFilterTag !== 'all') {
    filteredPresets = filteredPresets.filter(
      (preset) =>
        preset.tags &&
        preset.tags.some((tag) => tag.toLowerCase() === currentFilterTag.toLowerCase())
    );
  }

  // Apply search filter
  if (currentSearchTerm) {
    const searchLower = currentSearchTerm.toLowerCase();
    filteredPresets = filteredPresets.filter(
      (preset) =>
        preset.title.toLowerCase().includes(searchLower) ||
        preset.goal.toLowerCase().includes(searchLower) ||
        (preset.tags && preset.tags.some((tag) => tag.toLowerCase().includes(searchLower)))
    );
  }

  if (filteredPresets.length === 0) {
    presetsContainer.innerHTML =
      '<p style="text-align: center; padding: 2rem;">No presets found matching your criteria.</p>';
    return;
  }

  presetsContainer.innerHTML = filteredPresets
    .map((preset) => {
      const isSpaceTheme = preset.theme === 'space';
      const themeColorMap = {
        professional: '#4a90e2',
        academic: '#7c5cbf',
        minimal: '#2d9b7a',
        hacker: '#22863a',
        creative: '#e85d9a',
        cozy: '#b87333',
        energetic: '#e8572d',
        zen: '#6b9eaf',
        fresh: '#3d9970',
        organized: '#5b68c0',
        space: '#38bdf8',
      };
      const accentColor = themeColorMap[preset.theme] || 'var(--accent-1)';
      return `
      <button 
        class="plan-preset-btn ${isSpaceTheme ? 'space-theme' : ''}" 
        data-preset="${preset.name}"
        style="--preset-accent: ${accentColor};"
      >
        <span class="preset-icon-wrap">
          <svg class="preset-svg-icon" aria-hidden="true"><use href="#icon-${preset.icon}"/></svg>
        </span>
        <span class="preset-title">${sanitizeHTML(preset.title)}</span>
        <span class="preset-duration">${preset.durationMinutes} min</span>
      </button>
    `;
    })
    .join('');

  // Add event listeners to preset buttons
  presetsContainer.querySelectorAll('.plan-preset-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const presetName = btn.dataset.preset;
      const preset = allPresets.find((p) => p.name === presetName);
      if (preset) {
        const plan = await window.electronAPI.createPlan({
          title: preset.title,
          goal: preset.goal,
          durationMinutes: preset.durationMinutes,
          chunkSizeMinutes: 15,
          source: 'preset',
        });
        currentPlan = plan;
        renderCurrentPlan(plan);
        await window.electronAPI.addPlanToHistory(plan, { source: 'preset' });
        await refreshPlanViews({ silent: true });
        showToast(`Created plan: ${plan.title}`, 'success');
      }
    });
  });
}

// Setup preset filter and search
function setupPresetFilters() {
  // Setup filter tags
  const filterTags = document.querySelectorAll('.preset-filter-tag');
  filterTags.forEach((tag) => {
    tag.addEventListener('click', () => {
      filterTags.forEach((t) => t.classList.remove('active'));
      tag.classList.add('active');
      currentFilterTag = tag.dataset.tag;
      renderPresets();
    });
  });

  // Setup search input
  const searchInput = document.getElementById('presetSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearchTerm = e.target.value;
      renderPresets();
    });
  }
}

function setupPlanForm() {
  // Load and render presets
  loadAndRenderPresets();
  setupPresetFilters();

  const form = document.getElementById('planForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    try {
      setButtonBusy(submitButton, true, 'Creating...');

      const title = document.getElementById('planTitle').value.trim();
      const goal = document.getElementById('planGoal').value.trim();
      const durationMinutes = parseInt(document.getElementById('planDuration').value, 10);
      const chunkSizeMinutes = parseInt(document.getElementById('planChunkSize').value, 10);

      const plan = await window.electronAPI.createPlan({
        title,
        goal,
        durationMinutes,
        chunkSizeMinutes,
        source: 'ui',
      });

      currentPlan = plan;
      renderCurrentPlan(currentPlan);

      await window.electronAPI.addPlanToHistory(plan, {
        source: 'ui',
      });

      form.reset();
      document.getElementById('planChunkSize').value = '15';
      await refreshPlanViews({ silent: true });
      showToast('Focus plan created successfully!', 'success');
    } catch (error) {
      console.error('Error creating plan:', error);
      showToast('Failed to create focus plan. Please try again.', 'error');
    } finally {
      setButtonBusy(submitButton, false, 'Creating...');
    }
  });

  // Setup current plan buttons
  setupCurrentPlanButtons();

  // Setup edit modal
  setupEditPlanModal();
}

function setupCurrentPlanButtons() {
  const startBtn = document.getElementById('startCurrentPlanBtn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      if (!currentPlan) return;
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
      if (confirm('Are you sure you want to clear this plan?')) {
        currentPlan = null;
        renderCurrentPlan(null);
        showToast('Plan cleared', 'info');
      }
    });
  }

  const editBtn = document.getElementById('editCurrentPlanBtn');
  if (editBtn) {
    editBtn.addEventListener('click', openEditPlanModal);
  }

  const exportBtn = document.getElementById('exportCurrentPlanBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportCurrentPlan);
  }

  const saveTemplateBtn = document.getElementById('saveAsTemplateBtn');
  if (saveTemplateBtn) {
    saveTemplateBtn.addEventListener('click', savePlanAsTemplate);
  }
}

function setupEditPlanModal() {
  const modal = document.getElementById('editPlanModal');
  const closeBtn = document.getElementById('closeEditModalBtn');
  const cancelBtn = document.getElementById('cancelEditBtn');
  const editForm = document.getElementById('editPlanForm');
  const addTaskBtn = document.getElementById('addEditTaskBtn');

  if (closeBtn) {
    closeBtn.addEventListener('click', closeEditPlanModal);
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeEditPlanModal);
  }
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeEditPlanModal();
      }
    });
  }

  if (editForm) {
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveEditPlanChanges();
    });
  }

  if (addTaskBtn) {
    addTaskBtn.addEventListener('click', addEditTaskRow);
  }
}

function openEditPlanModal() {
  if (!currentPlan) return;

  const modal = document.getElementById('editPlanModal');
  const titleInput = document.getElementById('editPlanTitle');
  const goalInput = document.getElementById('editPlanGoal');
  const tasksContainer = document.getElementById('editPlanTasksContainer');

  if (titleInput) titleInput.value = currentPlan.title || '';
  if (goalInput) goalInput.value = currentPlan.goal || '';

  // Render tasks
  if (tasksContainer) {
    tasksContainer.innerHTML = '';
    if (currentPlan.tasks && currentPlan.tasks.length > 0) {
      currentPlan.tasks.forEach((task, index) => {
        addEditTaskRow(task);
      });
    } else {
      addEditTaskRow();
    }
  }

  if (modal) {
    modal.style.display = 'flex';
  }
}

function closeEditPlanModal() {
  const modal = document.getElementById('editPlanModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function addEditTaskRow(task = null) {
  const container = document.getElementById('editPlanTasksContainer');
  if (!container) return;

  const taskId = task?.id || `new-${Date.now()}`;
  const row = document.createElement('div');
  row.className = 'edit-task-row';
  row.dataset.taskId = taskId;
  row.innerHTML = `
    <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; padding: 0.5rem 0; border-bottom: 1px solid var(--line-color);">
      <input type="text" class="edit-task-title" placeholder="Task title" value="${sanitizeHTML(task?.title || '')}" style="flex: 1; min-width: 150px;" />
      <input type="number" class="edit-task-duration" placeholder="Duration" value="${task?.durationMinutes || 15}" min="1" max="120" style="width: 80px;" />
      <select class="edit-task-priority" style="width: 100px;">
        <option value="low" ${task?.priority === 'low' ? 'selected' : ''}>Low</option>
        <option value="medium" ${!task?.priority || task?.priority === 'medium' ? 'selected' : ''}>Medium</option>
        <option value="high" ${task?.priority === 'high' ? 'selected' : ''}>High</option>
      </select>
      <button type="button" class="remove-edit-task-btn danger-btn" style="padding: 0.25rem 0.5rem; font-size: 0.9rem;">✕</button>
    </div>
  `;

  container.appendChild(row);

  // Add remove button listener
  const removeBtn = row.querySelector('.remove-edit-task-btn');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      row.remove();
    });
  }
}

async function saveEditPlanChanges() {
  if (!currentPlan) return;

  const titleInput = document.getElementById('editPlanTitle');
  const goalInput = document.getElementById('editPlanGoal');
  const tasksContainer = document.getElementById('editPlanTasksContainer');

  if (!titleInput || !tasksContainer) return;

  // Collect tasks
  const taskRows = tasksContainer.querySelectorAll('.edit-task-row');
  const tasks = [];
  let taskIndex = 0;

  taskRows.forEach((row) => {
    const titleInput = row.querySelector('.edit-task-title');
    const durationInput = row.querySelector('.edit-task-duration');
    const prioritySelect = row.querySelector('.edit-task-priority');

    const title = titleInput?.value?.trim();
    if (title) {
      tasks.push({
        id: row.dataset.taskId || `task-${taskIndex++}`,
        title,
        durationMinutes: parseInt(durationInput?.value || '15', 10),
        priority: prioritySelect?.value || 'medium',
        completed: false,
        completedAt: null,
      });
    }
  });

  // Update current plan
  currentPlan.title = titleInput.value.trim();
  currentPlan.goal = goalInput?.value?.trim() || '';
  if (tasks.length > 0) {
    currentPlan.tasks = tasks;
  }

  renderCurrentPlan(currentPlan);
  closeEditPlanModal();
  showToast('Plan updated successfully!', 'success');
}

function exportCurrentPlan() {
  if (!currentPlan) return;

  const dataStr = JSON.stringify(currentPlan, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

  const exportFileDefaultName = `plan-${currentPlan.title.toLowerCase().replace(/\s+/g, '-')}.json`;

  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();

  showToast('Plan exported successfully!', 'success');
}

function savePlanAsTemplate() {
  if (!currentPlan) return;

  const templateName = prompt('Enter a name for this template:', currentPlan.title);
  if (!templateName?.trim()) return;

  // For now, just save to localStorage as a simple implementation
  // In a real app, this would use the file store
  try {
    const templates = JSON.parse(localStorage.getItem('planTemplates') || '[]');
    templates.push({
      id: Date.now().toString(),
      name: templateName.trim(),
      title: currentPlan.title,
      goal: currentPlan.goal,
      durationMinutes: currentPlan.durationMinutes,
      tasks: currentPlan.tasks,
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem('planTemplates', JSON.stringify(templates));
    showToast('Template saved successfully!', 'success');
  } catch (error) {
    console.error('Error saving template:', error);
    showToast('Failed to save template', 'error');
  }
}

// Enhance renderCurrentPlan to show more details
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
      <div class="plan-header">
        <div>
          <h3 style="margin: 0;">${sanitizeHTML(plan.title)}</h3>
          ${plan.goal ? `<p style="margin: 0.5rem 0 0 0; opacity: 0.8;">${sanitizeHTML(plan.goal)}</p>` : ''}
        </div>
      </div>
      <div class="plan-progress-container">
        <div class="plan-progress-header">
          <span>Progress</span>
          <span>${progressPercent}% (${completedTasks}/${totalTasks})</span>
        </div>
        <div class="plan-progress-bar">
          <div class="plan-progress-fill" style="width: ${progressPercent}%;"></div>
        </div>
      </div>
      <div class="task-list">
        ${plan.tasks
          .map(
            (task, index) => `
          <div class="task-item ${task.completed ? 'task-completed' : ''}" 
               data-task-id="${task.id}"
               data-task-index="${index}"
               style="cursor: pointer;"
          >
            <input type="checkbox" class="task-checkbox" 
                   ${task.completed ? 'checked' : ''} />
            <div style="flex: 1;">
              <div style="font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
                ${sanitizeHTML(task.title)}
                ${task.priority ? `<span class="task-priority ${task.priority}">${task.priority}</span>` : ''}
              </div>
            </div>
            <span class="task-duration">${task.durationMinutes} min</span>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  // Add event listeners for task toggling
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

function setupClearHistoryBtn() {
  const btn = document.getElementById('clearHistoryBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      if (confirm('Are you sure you want to clear all focus plan history?')) {
        setButtonBusy(btn, true, 'Clearing...');
        setStatusMessage('planHistoryStatus', 'Clearing focus plan history...', 'info');
        await window.electronAPI.clearPlanHistory();
        await refreshPlanViews({ silent: true });
        setStatusMessage('planHistoryStatus', 'Focus plan history cleared.', 'success');
      }
    } catch (error) {
      console.error('Error clearing history:', error);
      setStatusMessage(
        'planHistoryStatus',
        `Failed to clear focus plan history. ${getErrorMessage(error, 'Please try again.')}`,
        'error'
      );
    } finally {
      setButtonBusy(btn, false, 'Clearing...');
    }
  });
}

// Statistics
async function loadStatistics(options = {}) {
  const silent = Boolean(options && options.silent);
  try {
    if (!silent) {
      setStatusMessage('planStatsStatus', 'Loading focus statistics...', 'info');
    }
    const [stats, focusReport] = await Promise.all([
      window.electronAPI.getPlanStatistics(),
      window.electronAPI.getFocusReport(),
    ]);
    latestPlanStatistics = stats || null;
    latestFocusReport = focusReport || null;
    renderStatistics(stats);
    drawFocusChart(stats, focusReport);
    if (!silent) {
      setStatusMessage('planStatsStatus', '', 'info');
    }
  } catch (error) {
    console.error('Error loading statistics:', error);
    latestPlanStatistics = null;
    latestFocusReport = null;
    renderStatistics(null);
    drawFocusChart(null);
    setStatusMessage(
      'planStatsStatus',
      `Failed to load statistics. ${getErrorMessage(error, 'Please try again.')}`,
      'error'
    );
  }
}

function renderStatistics(stats) {
  const container = document.getElementById('statisticsData');
  if (!container) return;
  container.innerHTML = '';

  if (!stats || !stats.totalPlans) {
    container.innerHTML =
      '<p style="text-align: center; padding: 2rem;">No statistics yet. Create some focus plans!</p>';
    return;
  }

  // Calculate additional stats
  const totalHours = Math.round(stats.totalMinutes / 60);
  const avgMinutes = stats.averageDuration || 0;

  // Get weekly trend from dailyStats
  let weeklyMinutes = 0;
  let weeklyPlans = 0;
  if (stats.dailyStats) {
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      if (stats.dailyStats[dateKey]) {
        weeklyMinutes += stats.dailyStats[dateKey].minutes || 0;
        weeklyPlans += stats.dailyStats[dateKey].count || 0;
      }
    }
  }

  container.innerHTML = `
    <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem;">
      <div class="stat-item" style="transform: rotate(-1deg);">
        <div class="stat-value" style="background: linear-gradient(135deg, #e67e22, #c0392b);">${sanitizeHTML(stats.totalPlans.toString())}</div>
        <div class="stat-label">Total Plans</div>
      </div>
      <div class="stat-item" style="transform: rotate(0.5deg);">
        <div class="stat-value" style="background: linear-gradient(135deg, #27ae60, #2ecc71);">${sanitizeHTML(stats.totalMinutes.toString())}</div>
        <div class="stat-label">Total Minutes</div>
      </div>
      <div class="stat-item" style="transform: rotate(-0.5deg);">
        <div class="stat-value" style="background: linear-gradient(135deg, #3498db, #2980b9);">${sanitizeHTML(avgMinutes.toString())}</div>
        <div class="stat-label">Avg Duration</div>
      </div>
      <div class="stat-item" style="transform: rotate(1deg);">
        <div class="stat-value" style="background: linear-gradient(135deg, #9b59b6, #8e44ad);">${totalHours}</div>
        <div class="stat-label">Total Hours</div>
      </div>
      ${
        weeklyMinutes > 0
          ? `
      <div class="stat-item" style="transform: rotate(-0.8deg);">
        <div class="stat-value" style="background: linear-gradient(135deg, #f39c12, #d68910);">${Math.round((weeklyMinutes / 60) * 10) / 10}</div>
        <div class="stat-label">This Week (h)</div>
      </div>
      <div class="stat-item" style="transform: rotate(0.8deg);">
        <div class="stat-value" style="background: linear-gradient(135deg, #1abc9c, #16a085);">${weeklyPlans}</div>
        <div class="stat-label">This Week Plans</div>
      </div>
      `
          : ''
      }
    </div>
  `;
}

function drawFocusChart(stats = latestPlanStatistics, focusReport = latestFocusReport) {
  const canvas = document.getElementById('focusChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const displayWidth = Math.max(320, Math.floor(canvas.getBoundingClientRect().width || canvas.width));
  const displayHeight = 300;
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(displayWidth * pixelRatio);
  canvas.height = Math.floor(displayHeight * pixelRatio);
  canvas.style.height = `${displayHeight}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  // Clear canvas
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  const chartPoints = buildWeeklyFocusChartData(stats || {}, focusReport || {}, 7);
  const days = chartPoints.map((point) => point.label);
  const minutes = chartPoints.map((point) => point.minutes);
  const maxMinutes = Math.max(...minutes, 60);

  const chartHeight = displayHeight - 76;
  const baseline = displayHeight - 36;
  const slotWidth = displayWidth / days.length;
  const barWidth = Math.min(56, slotWidth * 0.64);
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(16, baseline + 0.5);
  ctx.lineTo(displayWidth - 16, baseline + 0.5);
  ctx.stroke();

  days.forEach((day, index) => {
    const barHeight = (minutes[index] / maxMinutes) * chartHeight;
    const x = index * slotWidth + (slotWidth - barWidth) / 2;
    const y = baseline - barHeight;

    // Gradient for bar
    const gradient = ctx.createLinearGradient(x, y, x, baseline);
    gradient.addColorStop(0, '#7c3aed');
    gradient.addColorStop(1, '#ec4899');

    ctx.fillStyle = gradient;
    ctx.shadowColor = 'rgba(124, 58, 237, 0.3)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 5;
    if (barHeight > 0) ctx.fillRect(x, y, barWidth, barHeight);

    // Draw day label
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 14px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(day, x + barWidth / 2, displayHeight - 12);

    // Draw value label
    if (minutes[index] > 0) {
      ctx.fillStyle = '#7c3aed';
      ctx.font = 'bold 12px Inter';
      ctx.fillText(`${minutes[index]}m`, x + barWidth / 2, y - 10);
    }
  });
  if (minutes.every((value) => value === 0)) {
    ctx.fillStyle = '#64748b';
    ctx.font = '600 14px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('Complete a focus session to see your weekly progress.', displayWidth / 2, 30);
  }
  canvas.setAttribute('aria-label', `Weekly focus minutes: ${chartPoints.map((point) => `${point.label} ${point.minutes}`).join(', ')}`);
}

window.addEventListener('resize', () => {
  const moreTab = document.getElementById('more-tab');
  if (moreTab && !moreTab.hasAttribute('hidden')) {
    drawFocusChart(latestPlanStatistics, latestFocusReport);
  }
});

// Slash commands
const PLAN_PRESETS = {
  work:             { title: 'Work Session',        duration: 60,  goal: 'Focus on work tasks',                           icon: '💼' },
  study:            { title: 'Study Session',       duration: 45,  goal: 'Focus on studying',                             icon: '📚' },
  focus:            { title: 'Deep Focus',          duration: 25,  goal: 'Deep focus session',                            icon: '🎯' },
  code:             { title: 'Coding Session',      duration: 90,  goal: 'Write code and solve problems',                 icon: '💻' },
  design:           { title: 'Design Session',      duration: 60,  goal: 'Create and refine designs',                     icon: '🎨' },
  write:            { title: 'Writing Session',     duration: 45,  goal: 'Write articles, docs, or content',              icon: '✍️' },
  read:             { title: 'Reading Session',     duration: 30,  goal: 'Read and learn new things',                     icon: '📖' },
  exercise:         { title: 'Exercise Session',    duration: 45,  goal: 'Physical activity or workout',                   icon: '🏃' },
  meditate:         { title: 'Meditation Session',  duration: 15,  goal: 'Practice mindfulness and meditation',           icon: '🧘' },
  clean:            { title: 'Cleaning Session',    duration: 30,  goal: 'Clean and organize space',                       icon: '🧹' },
  review:           { title: 'Review Session',      duration: 45,  goal: 'Review work or materials',                      icon: '🔍' },
  plan:             { title: 'Planning Session',    duration: 30,  goal: 'Plan and organize tasks',                        icon: '📋' },
  sprint:           { title: 'Quick Focus Sprint',  duration: 25,  goal: 'Short, focused burst of work',                   icon: '⚡' },
  blitz:            { title: 'Task Blitz',          duration: 15,  goal: 'Knock out small tasks quickly',                  icon: '💥' },
  micro:            { title: 'Micro Focus',         duration: 10,  goal: 'Ultra-short focus session',                      icon: '🔬' },
  deep:             { title: 'Deep Dive',           duration: 45,  goal: 'Extended focused work',                          icon: '🌊' },
  'quick task':     { title: 'Quick Task Blitz',    duration: 10,  goal: 'Tackle one small task',                          icon: '✅' },
  'lofi-focus':     { title: 'Lo-fi Focus',         duration: 90,  goal: 'Deep focus with lo-fi beats',                   icon: '🎧', music: 'lofi',     genre: 'ambient' },
  'classical-study':{ title: 'Classical Study',     duration: 60,  goal: 'Study with classical music',                     icon: '🎻', music: 'classical',genre: 'classical' },
  'white-noise':    { title: 'White Noise Session', duration: 120, goal: 'Focus masking',                                  icon: '📻', music: 'noise',    genre: 'noise' },
  binaural:         { title: 'Binaural Focus',      duration: 45,  goal: 'Binaural beats focus session',                   icon: '👂', music: 'binaural', genre: 'binaural' },
  'ambient-code':   { title: 'Ambient Coding',      duration: 120, goal: 'Coding with ambient backdrop',                   icon: '🌌', music: 'ambient',  genre: 'electronic' },
  energize:         { title: 'Energize Sprint',     duration: 25,  goal: 'High-energy sprint',                            icon: '🔥', music: 'upbeat',   genre: 'electronic' },
};
const PLAN_PRESET_KEYS_BY_LENGTH = Object.keys(PLAN_PRESETS).sort((a, b) => b.length - a.length);

const PLAN_PRESET_ICONS = { work: '💼', study: '📚', focus: '🎯', code: '💻', design: '🎨', write: '✍️', read: '📖', exercise: '🏃', meditate: '🧘', clean: '🧹', review: '🔍', plan: '📋', sprint: '⚡', blitz: '💥', micro: '🔬', deep: '🌊', 'quick task': '✅', 'lofi-focus': '🎧', 'classical-study': '🎻', 'white-noise': '📻', binaural: '👂', 'ambient-code': '🌌', energize: '🔥' };

function clampInt(v, min, max) { v = parseInt(v, 10); if (isNaN(v)) return min; return Math.max(min, Math.min(max, v)); }

function parsePlanString(input) {
  const result = {
    title: 'Planned session',
    goal: '',
    durationMinutes: 30,
    usedPreset: null,
    chunkSizeMinutes: 15,
    breakMinutes: 5,
    tags: [],
    musicPreset: null,
    genre: null,
  };

  if (!input) return result;
  let remaining = String(input).trim();

  const flagPatterns = {
    goal:     /--goal(?:\s+|[=:]\s*)(?:"([^"]+)"|'([^']+)'|(\S+))/i,
    chunk:    /--chunk(?:\s+|[=:]\s*)(\d+)/i,
    break:    /--break(?:\s+|[=:]\s*)(\d+)/i,
    tags:     /--tags(?:\s+|[=:]\s*)(?:"([^"]+)"|'([^']+)'|(\S+))/i,
    music:    /--music(?:\s+|[=:]\s*)(?:"([^"]+)"|'([^']+)'|(\S+))/i,
    genre:    /--genre(?:\s+|[=:]\s*)(?:"([^"]+)"|'([^']+)'|(\S+))/i,
  };

  const extractFlagMatch = (m) => (m[1] ?? m[2] ?? m[3] ?? '').trim();

  for (const [name, re] of Object.entries(flagPatterns)) {
    const m = remaining.match(re);
    if (!m) continue;
    if (name === 'chunk') result.chunkSizeMinutes = clampInt(m[1], 1, 120);
    else if (name === 'break') result.breakMinutes = clampInt(m[1], 0, 30);
    else if (name === 'tags') {
      result.tags = extractFlagMatch(m).split(',').map(s => s.trim()).filter(Boolean);
    } else {
      const val = extractFlagMatch(m);
      if (val) result[name] = val;
    }
    remaining = remaining.replace(re, '').replace(/\s{2,}/g, ' ').trim();
  }

  const lowerRemaining = remaining.toLowerCase();
  let matchedPresetKey = null;
  for (const key of PLAN_PRESET_KEYS_BY_LENGTH) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    if (new RegExp('^' + escaped + '\\b', 'i').test(lowerRemaining)) {
      matchedPresetKey = key;
      const overlap = lowerRemaining.match(new RegExp('^(' + escaped + ')\\b', 'i'))[1].length;
      remaining = remaining.slice(overlap).trim();
      break;
    }
  }
  if (matchedPresetKey) {
    const def = PLAN_PRESETS[matchedPresetKey];
    result.usedPreset = matchedPresetKey;
    result.title = def.title;
    result.goal = def.goal;
    result.durationMinutes = def.duration;
    if (def.music && !result.musicPreset) result.musicPreset = def.music;
    if (def.genre && !result.genre) result.genre = def.genre;
  }

  const durationPatterns = [
    [/\b(\d+)\s*h(?:ours?)?\s*(\d+)\s*m(?:in(?:utes?)?)?/i, m => parseInt(m[1]) * 60 + parseInt(m[2])],
    [/\b(\d+)\s*h(?:ours?)?\s*(\d+)/i, m => parseInt(m[1]) * 60 + parseInt(m[2])],
    [/\b(\d+)\s*h(?:ours?)?/i, m => parseInt(m[1]) * 60],
    [/\b(\d+)\s*m(?:in(?:utes?)?)?/i, m => parseInt(m[1])],
  ];
  let durationMinutes = null;
  for (const [re, calc] of durationPatterns) {
    const m = remaining.match(re);
    if (m) {
      durationMinutes = calc(m);
      remaining = remaining.replace(re, '').replace(/\s{2,}/g, ' ').trim();
      break;
    }
  }
  if (durationMinutes === null) {
    const m = remaining.match(/^(\d+)\s+/);
    if (m) {
      const v = parseInt(m[1]);
      if (v >= 5 && v <= 240) {
        durationMinutes = v;
        remaining = remaining.slice(m[0].length).trim();
      }
    }
  }
  if (durationMinutes === null && /^\d+$/.test(remaining.trim())) {
    const v = parseInt(remaining.trim());
    if (v >= 5 && v <= 240) durationMinutes = v;
  }
  if (durationMinutes !== null) {
    result.durationMinutes = clampInt(durationMinutes, 5, 240);
  }

  if (remaining.trim()) {
    result.title = remaining.trim();
  }

  result.chunkSizeMinutes = clampInt(result.chunkSizeMinutes, 1, 120);
  result.breakMinutes = clampInt(result.breakMinutes, 0, 30);
  return result;
}

function renderPlanPreview(parsed) {
  const card = document.getElementById('planPreviewCard');
  if (!card) return;
  card.style.display = 'block';

  const titleEl = document.getElementById('planPreviewTitle');
  const goalEl = document.getElementById('planPreviewGoal');
  const presetEl = document.getElementById('planPreviewPreset');
  const durEl = document.getElementById('planPreviewDuration');
  const chunkEl = document.getElementById('planPreviewChunks');
  const breakEl = document.getElementById('planPreviewBreak');
  const tagsEl = document.getElementById('planPreviewTags');
  const musicWrap = document.getElementById('planPreviewMusic');
  const musicText = document.getElementById('planPreviewMusicText');

  if (titleEl) titleEl.textContent = parsed.title;
  if (goalEl) goalEl.textContent = parsed.goal || '';
  if (presetEl) {
    presetEl.textContent = parsed.usedPreset ? `Preset: ${parsed.usedPreset}` : '';
  }
  if (durEl) durEl.textContent = `${parsed.durationMinutes} min`;
  if (chunkEl) {
    const n = Math.max(1, Math.ceil(parsed.durationMinutes / parsed.chunkSizeMinutes));
    chunkEl.textContent = `${n} × ${parsed.chunkSizeMinutes}m`;
  }
  if (breakEl) breakEl.textContent = `${parsed.breakMinutes} min`;

  if (tagsEl) {
    tagsEl.innerHTML = '';
    (parsed.tags || []).forEach(tag => {
      const span = document.createElement('span');
      span.className = 'plan-preview-tag';
      span.textContent = `#${tag}`;
      tagsEl.appendChild(span);
    });
  }

  if (musicWrap && musicText) {
    const hasMusic = !!parsed.musicPreset || !!parsed.genre;
    musicWrap.style.display = hasMusic ? 'flex' : 'none';
    if (hasMusic) {
      const parts = [];
      if (parsed.musicPreset) parts.push(`preset: ${parsed.musicPreset}`);
      if (parsed.genre) parts.push(`genre: ${parsed.genre}`);
      musicText.textContent = parts.join(' · ');
    }
  }
}

function hidePlanPreview() {
  const card = document.getElementById('planPreviewCard');
  if (card) card.style.display = 'none';
}

let autocompleteHighlightIndex = -1;
let autocompleteItems = [];

function renderAutocomplete(items, queryLower) {
  const wrap = document.getElementById('commandAutocomplete');
  if (!wrap) return;
  if (!items.length) {
    wrap.classList.remove('is-visible');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = '';
    autocompleteItems = [];
    autocompleteHighlightIndex = -1;
    return;
  }
  autocompleteItems = items;
  if (autocompleteHighlightIndex >= items.length) autocompleteHighlightIndex = 0;
  wrap.innerHTML = items.map((it, i) => {
    const icon = it.icon || '✨';
    return `<div class="autocomplete-item ${i === autocompleteHighlightIndex ? 'is-highlighted' : ''}" data-index="${i}" data-key="${it.key}">
      <div class="autocomplete-left">
        <span class="autocomplete-icon">${icon}</span>
        <span class="autocomplete-name">${it.displayName}</span>
      </div>
      <span class="autocomplete-meta">${it.meta}</span>
    </div>`;
  }).join('');
  wrap.classList.add('is-visible');
  wrap.setAttribute('aria-hidden', 'false');

  wrap.querySelectorAll('.autocomplete-item').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const idx = parseInt(el.getAttribute('data-index'), 10);
      autocompleteHighlightIndex = idx;
      applyAutocompleteSelection();
    });
  });
}

function applyAutocompleteSelection() {
  if (autocompleteHighlightIndex < 0 || !autocompleteItems.length) return;
  const input = document.getElementById('commandInput');
  if (!input) return;
  const chosen = autocompleteItems[autocompleteHighlightIndex];
  const current = input.value;
  const match = current.match(/^(\/plan\s+)(.*)$/i);
  if (match) {
    input.value = `${match[1]}${chosen.insertAfterCommand}`;
  } else {
    input.value = `/plan ${chosen.insertAfterCommand}`;
  }
  document.getElementById('commandAutocomplete').classList.remove('is-visible');
  autocompleteItems = [];
  autocompleteHighlightIndex = -1;
  handleCommandInputLive();
  input.focus();
}

function handleCommandInputLive() {
  const input = document.getElementById('commandInput');
  const resultDiv = document.getElementById('commandResult');
  if (!input || !resultDiv) return;
  const raw = input.value;

  if (!raw.startsWith('/')) {
    hidePlanPreview();
    renderAutocomplete([], '');
    return;
  }

  const m = raw.match(/^\/(\w+)(?:\s+(.*))?$/s);
  if (!m) {
    hidePlanPreview();
    renderAutocomplete([], '');
    return;
  }
  const cmd = m[1].toLowerCase();
  const args = m[2] ?? '';

  if (cmd === 'plan') {
    const parsed = parsePlanString(args);
    renderPlanPreview(parsed);

    let query = args.trim().toLowerCase();
    const items = [];
    if (!query || /\s/.test(args) === false) {
      for (const key of PLAN_PRESET_KEYS_BY_LENGTH) {
        const def = PLAN_PRESETS[key];
        if (!query || key.startsWith(query) || def.title.toLowerCase().includes(query)) {
          items.push({
            key,
            displayName: def.title,
            meta: `${def.duration} min`,
            icon: PLAN_PRESET_ICONS[key] || '✨',
            insertAfterCommand: key,
          });
        }
        if (items.length >= 8) break;
      }
    }
    renderAutocomplete(items, query);
  } else {
    hidePlanPreview();
    renderAutocomplete([], '');
  }
}

function setupCommandInput() {
  const input = document.getElementById('commandInput');
  const resultDiv = document.getElementById('commandResult');
  if (!input || !resultDiv) return;

  input.addEventListener('input', () => {
    handleCommandInputLive();
  });

  input.addEventListener('keydown', (e) => {
    const wrap = document.getElementById('commandAutocomplete');
    const isACVisible = wrap && wrap.classList.contains('is-visible') && autocompleteItems.length;
    if (isACVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        autocompleteHighlightIndex = (autocompleteHighlightIndex + 1) % autocompleteItems.length;
        const idx = autocompleteHighlightIndex;
        wrap.querySelectorAll('.autocomplete-item').forEach((el, i) => {
          el.classList.toggle('is-highlighted', i === idx);
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        autocompleteHighlightIndex = (autocompleteHighlightIndex - 1 + autocompleteItems.length) % autocompleteItems.length;
        const idx = autocompleteHighlightIndex;
        wrap.querySelectorAll('.autocomplete-item').forEach((el, i) => {
          el.classList.toggle('is-highlighted', i === idx);
        });
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        applyAutocompleteSelection();
        return;
      }
    }

    if (e.key === 'Escape') {
      hidePlanPreview();
      renderAutocomplete([], '');
      return;
    }

    if (e.key === 'Enter') {
      if (isACVisible && autocompleteHighlightIndex >= 0) {
        e.preventDefault();
        applyAutocompleteSelection();
        return;
      }
      e.preventDefault();
      const commandText = input.value.trim();
      input.value = '';
      hidePlanPreview();
      renderAutocomplete([], '');

      if (!commandText.startsWith('/')) {
        resultDiv.textContent = 'Commands must start with /';
        return;
      }

      (async () => {
        try {
          const result = await handleCommand(commandText);
          resultDiv.textContent = result;
        } catch (error) {
          resultDiv.textContent = 'Error: ' + error.message;
        }
      })();
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
    case 'task':
      return await handleTaskCommand(args);
    case 'habit':
      return await handleHabitCommand(args);
    case 'help':
      return handleHelpCommand();
    default:
      return `Unknown command: /${commandName}. Type /help for available commands.`;
  }
}

async function handleTaskCommand(args) {
  const taskTitle = args.trim();
  if (!taskTitle) {
    return 'Please provide a task title, e.g., /task Finish report';
  }

  try {
    await window.electronAPI.addTask({
      title: taskTitle,
    });
    await loadTasks();
    return `Added task: "${taskTitle}"`;
  } catch (error) {
    console.error('Error adding task:', error);
    throw new Error('Failed to add task. Please try again.');
  }
}

async function handleHabitCommand(args) {
  const habitTitle = args.trim();
  if (!habitTitle) {
    return 'Please provide a habit name, e.g., /habit Read 30 minutes';
  }

  try {
    await window.electronAPI.createHabit({
      name: habitTitle,
    });
    await loadHabits();
    await loadHabitsSummary();
    return `Added habit: "${habitTitle}"`;
  } catch (error) {
    console.error('Error adding habit:', error);
    throw new Error('Failed to add habit. Please try again.');
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
  return 'Available commands: /plan [preset or title] [duration] - Create a focus plan; /task [title] - Add a new task; /habit [name] - Add a new habit; /help - Show this help';
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
    system: '⚙️',
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

// Supercharged Features Event Bindings
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('taskFilterSearch');
  const prioritySelect = document.getElementById('taskFilterPriority');
  const statusSelect = document.getElementById('taskFilterStatus');
  const sortSelect = document.getElementById('taskSortOrder');

  if (searchInput) {
    searchInput.addEventListener('input', loadTasks);
  }
  if (prioritySelect) {
    prioritySelect.addEventListener('change', loadTasks);
  }
  if (statusSelect) {
    statusSelect.addEventListener('change', loadTasks);
  }
  if (sortSelect) {
    sortSelect.addEventListener('change', loadTasks);
  }

  // Export Analytics Handlers
  const csvBtn = document.getElementById('exportCsvBtn');
  if (csvBtn) {
    csvBtn.addEventListener('click', async () => {
      try {
        const stats = await window.electronAPI.getPlanStatistics();
        const history = await window.electronAPI.getPlanHistory();
        let csvContent = 'data:text/csv;charset=utf-8,Type,Title,DurationMinutes,Date\n';

        if (stats) {
          csvContent += `Summary,Total plans,${stats.totalPlans || 0},\n`;
          csvContent += `Summary,Total focus minutes,${stats.totalMinutes || 0},\n`;
          csvContent += `Summary,Average plan duration,${stats.averageDuration || 0},\n`;
        }

        history.forEach((h) => {
          csvContent += `FocusPlan,"${(h.title || '').replace(/"/g, '""')}",${h.durationMinutes || 0},"${h.date || ''}"\n`;
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `helpy_focus_report_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if (typeof showToast === 'function') showToast('Exported CSV Analytics Report!', 'success');
      } catch (err) {
        console.error('CSV Export Error:', err);
      }
    });
  }

  const jsonBtn = document.getElementById('exportJsonBtn');
  if (jsonBtn) {
    jsonBtn.addEventListener('click', async () => {
      try {
        const stats = await window.electronAPI.getPlanStatistics();
        const history = await window.electronAPI.getPlanHistory();
        const tasks = await window.electronAPI.getTasks();
        const dataStr =
          'data:text/json;charset=utf-8,' +
          encodeURIComponent(JSON.stringify({ stats, history, tasks }, null, 2));
        const link = document.createElement('a');
        link.setAttribute('href', dataStr);
        link.setAttribute('download', `helpy_analytics_backup_${Date.now()}.json`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if (typeof showToast === 'function')
          showToast('Exported JSON Analytics Report!', 'success');
      } catch (err) {
        console.error('JSON Export Error:', err);
      }
    });
  }
});

// ============================================================
// HELPY COMPANION BOT INTEGRATION
// ============================================================
const botAPI = window.electronAPI &&
  typeof window.electronAPI.processBotQuery === 'function' &&
  typeof window.electronAPI.getBotMemorySummary === 'function'
  ? window.electronAPI
  : null;

function formatBotMessage(text) {
  const safeText = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return safeText
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
}

function appendBotMessage(sender, text, isUser = false, actionChips = []) {
  const chatHistory = document.getElementById('bot-chat-history');
  if (!chatHistory) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `bot-msg ${isUser ? 'user-msg' : ''}`;

  const senderSpan = document.createElement('span');
  senderSpan.className = 'bot-sender';
  senderSpan.textContent = sender;

  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = 'bot-bubble';
  bubbleDiv.innerHTML = formatBotMessage(text);

  if (!isUser && Array.isArray(actionChips) && actionChips.length > 0) {
    const chipsDiv = document.createElement('div');
    chipsDiv.style.marginTop = '0.5rem';
    actionChips.forEach((chipText) => {
      const chipBtn = document.createElement('button');
      chipBtn.className = 'bot-chip-btn';
      chipBtn.textContent = chipText;
      chipBtn.addEventListener('click', () => {
        const cleanPrompt = chipText.replace(/^[^\w\s]+/, '').trim();
        if (typeof window.triggerBotQuery === 'function') {
          window.triggerBotQuery(cleanPrompt);
        }
      });
      chipsDiv.appendChild(chipBtn);
    });
    bubbleDiv.appendChild(chipsDiv);
  }

  msgDiv.appendChild(senderSpan);
  msgDiv.appendChild(bubbleDiv);
  chatHistory.appendChild(msgDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

let isFocusShieldActive = false;
function formatShieldTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function renderFocusShield(state) {
  const overlay = document.getElementById('focusShieldOverlay');
  const toggleBtn = document.getElementById('shieldToggle');
  const activeTaskEl = document.getElementById('shieldActiveTask');
  const active = Boolean(state?.active);
  const paused = Boolean(state?.paused);

  if (overlay) {
    overlay.style.display = isFocusShieldActive && active ? 'flex' : 'none';
    overlay.setAttribute('aria-hidden', String(!(isFocusShieldActive && active)));
  }

  if (toggleBtn) {
    if (isFocusShieldActive && active) toggleBtn.classList.add('active');
    else toggleBtn.classList.remove('active');
    toggleBtn.setAttribute('aria-pressed', String(isFocusShieldActive && active));
  }

  if (active) {
    const activeTask = window.currentPlan?.title || window.activeFocusTaskTitle || 'Deep Focus Session';
    if (activeTaskEl) activeTaskEl.textContent = activeTask;
    const goal = document.getElementById('shieldActiveGoal');
    const timer = document.getElementById('shieldTimerDisplay');
    const mode = document.getElementById('shieldModeBadge');
    const pause = document.getElementById('shieldPauseBtn');
    const notes = document.getElementById('shieldNotesList');
    if (goal) goal.textContent = paused ? 'Shield paused. Resume when you are ready.' : 'Distractions are blocked while you work on one thing.';
    if (timer) timer.textContent = formatShieldTime(state.remainingMs);
    if (mode) mode.textContent = paused ? 'PAUSED' : state.phase === 'break' ? 'BREAK MODE' : 'WORK MODE';
    if (pause) pause.textContent = paused ? 'Resume Timer' : 'Pause Timer';
    if (notes) {
      notes.replaceChildren();
      (state.interruptionNotes || []).forEach((note) => {
        const item = document.createElement('div');
        item.className = 'shield-note-item';
        item.textContent = `• ${note}`;
        notes.appendChild(item);
      });
      if (!(state.interruptionNotes || []).length) {
        const empty = document.createElement('div');
        empty.className = 'shield-note-empty';
        empty.textContent = 'Nothing parked yet — your mind is clear.';
        notes.appendChild(empty);
      }
    }
  }
}

async function toggleFocusShield(forceState = null) {
  const shouldActivate = forceState !== null ? Boolean(forceState) : !isFocusShieldActive;
  let state;
  if (shouldActivate) {
    const workMinutes = Number(document.getElementById('session-work-minutes')?.value) || 25;
    const breakMinutes = Number(document.getElementById('session-break-minutes')?.value) || 5;
    state = await window.electronAPI.startFocusSession({ workMinutes, breakMinutes, strict: true });
    isFocusShieldActive = true;
    if (typeof showToast === 'function') showToast('🛡️ Focus Shield enabled. Your blocklist is now enforced.', 'success');
  } else {
    state = await window.electronAPI.stopFocusSession();
    isFocusShieldActive = false;
    if (typeof showToast === 'function') showToast('Focus Shield ended.', 'info');
  }
  renderFocusShield(state);
  renderFocusSession(state);

  // Keep the browser extension in sync without starting a second session.
  fetch('http://localhost:3456/api/shield-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: isFocusShieldActive, syncOnly: true }),
  }).catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
  // Focus Shield Header Button & Hotkey
  const shieldBtn = document.getElementById('shieldToggle');
  if (shieldBtn) {
    shieldBtn.addEventListener('click', () => toggleFocusShield());
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyS') {
      e.preventDefault();
      toggleFocusShield();
    }
  });

  // Shield Modal Action Buttons
  const shieldExitBtn = document.getElementById('shieldExitBtn');
  const shieldCompleteBtn = document.getElementById('shieldCompleteBtn');
  const shieldPauseBtn = document.getElementById('shieldPauseBtn');
  const shieldNoteInput = document.getElementById('shieldQuickNote');
  if (shieldExitBtn) shieldExitBtn.addEventListener('click', () => toggleFocusShield(false));
  if (shieldCompleteBtn) {
    shieldCompleteBtn.addEventListener('click', async () => {
      await toggleFocusShield(false);
      if (typeof showToast === 'function') showToast('🎉 Focus session finished. Nice work!', 'success');
    });
  }
  if (shieldPauseBtn) {
    shieldPauseBtn.addEventListener('click', async () => {
      const state = await window.electronAPI.getFocusSessionState();
      const updated = state?.paused
        ? await window.electronAPI.resumeFocusSession()
        : await window.electronAPI.pauseFocusSession();
      renderFocusShield(updated);
      renderFocusSession(updated);
    });
  }

  if (shieldNoteInput) {
    shieldNoteInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && shieldNoteInput.value.trim()) {
        e.preventDefault();
        const noteText = shieldNoteInput.value.trim();
        const state = await window.electronAPI.addFocusSessionNote(noteText);
        shieldNoteInput.value = '';
        renderFocusShield(state);
      }
    });
  }

  // --- Dark / Light Mode Notebook Theme Toggle ---
  const darkModeToggle = document.getElementById('darkModeToggle');
  const darkModeIcon = document.getElementById('darkModeIcon');
  const darkModeLabel = darkModeToggle ? darkModeToggle.querySelector('.btn-label') : null;

  const updateThemeUI = (isDark) => {
    if (isDark) {
      document.body.classList.add('dark');
      if (darkModeIcon) darkModeIcon.innerHTML = '<use href="#icon-sun"/>';
      if (darkModeLabel) darkModeLabel.textContent = 'Light Mode';
    } else {
      document.body.classList.remove('dark');
      if (darkModeIcon) darkModeIcon.innerHTML = '<use href="#icon-moon"/>';
      if (darkModeLabel) darkModeLabel.textContent = 'Dark Mode';
    }
    if (darkModeToggle) darkModeToggle.setAttribute('aria-pressed', String(isDark));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#18171a' : '#fcf8f2');
  };

  const savedTheme = localStorage.getItem('helpy-theme') || 'light';
  updateThemeUI(savedTheme === 'dark');

  const appearancePreferences = document.getElementById('appearancePreferences');
  const appearanceMenu = appearancePreferences?.querySelector('.preference-menu');
  const advancedControls = [
    document.getElementById('fontToggle'),
    document.getElementById('calmModeToggle'),
    document.getElementById('noAnimationToggle'),
  ].filter(Boolean);
  if (appearanceMenu && advancedControls.length) {
    advancedControls.forEach((control) => {
      if (control.parentElement !== appearanceMenu) {
        appearanceMenu.appendChild(control);
      }
    });
  }

  if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
      const isDark = !document.body.classList.contains('dark');
      localStorage.setItem('helpy-theme', isDark ? 'dark' : 'light');
      updateThemeUI(isDark);
      if (typeof showToast === 'function') {
        showToast(isDark ? '🌙 Dark Leather Notebook Mode' : '☀️ Light Cream Paper Notebook Mode', 'info');
      }
    });
  }

  // Floating Chatbot Drawer & Embedded Bot elements
  const toggleBtn = document.getElementById('bot-toggle-btn');
  const moreAssistantBtn = document.getElementById('openBotFromMoreBtn');
  const drawer = document.getElementById('bot-drawer');
  const closeBtn = document.getElementById('bot-close-btn');
  const chatSendBtn = document.getElementById('bot-chat-send-btn');
  const chatInput = document.getElementById('bot-chat-input');
  const chatHistory = document.getElementById('bot-drawer-chat-history');
  const chipBtns = document.querySelectorAll('.bot-chip-btn');

  // Embedded bot elements
  const sendBtn = document.getElementById('bot-send-btn');
  const userInput = document.getElementById('bot-user-input');
  const embeddedHistory = document.getElementById('bot-chat-history');
  const factBtn = document.getElementById('bot-btn-fact');
  const motBtn = document.getElementById('bot-btn-motivation');
  const memBtn = document.getElementById('bot-btn-memory');

  // Fallback local BotCompanion if electronAPI is unavailable
  const fallbackCompanion = typeof BotCompanion !== 'undefined' ? new BotCompanion() : null;

  const getBotAPI = () => {
    if (window.electronAPI && typeof window.electronAPI.processBotQuery === 'function') {
      return window.electronAPI;
    }
    if (fallbackCompanion) {
      return {
        processBotQuery: (prompt, ctx) => fallbackCompanion.processQueryDetailed(prompt, ctx),
        getBotMemorySummary: () => fallbackCompanion.getMemorySummary(),
        getBotRandomFact: () => fallbackCompanion.getRandomFact(),
        getBotMotivation: () => fallbackCompanion.getMotivation(),
        logBotAction: (type, detail, meta) => fallbackCompanion.logAction(type, detail, meta),
      };
    }
    return null;
  };

  let assistantTrigger = null;
  const openAssistantDrawer = (trigger = null) => {
    if (!drawer) return;
    assistantTrigger = trigger || assistantTrigger || moreAssistantBtn || toggleBtn || null;
    drawer.classList.remove('is-hidden');
    drawer.setAttribute('aria-hidden', 'false');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
    if (moreAssistantBtn) moreAssistantBtn.setAttribute('aria-expanded', 'true');
    if (chatInput) {
      chatInput.focus();
    }
  };

  const closeAssistantDrawer = () => {
    if (!drawer) return;
    drawer.classList.add('is-hidden');
    drawer.setAttribute('aria-hidden', 'true');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    if (moreAssistantBtn) moreAssistantBtn.setAttribute('aria-expanded', 'false');
    if (assistantTrigger && typeof assistantTrigger.focus === 'function') {
      assistantTrigger.focus();
    }
  };

  if (toggleBtn && drawer) {
    toggleBtn.addEventListener('click', () => {
      if (drawer.classList.contains('is-hidden')) {
        openAssistantDrawer(toggleBtn);
      } else {
        closeAssistantDrawer();
      }
    });
  }

  if (moreAssistantBtn && drawer) {
    moreAssistantBtn.addEventListener('click', () => {
      openAssistantDrawer(moreAssistantBtn);
    });
  }

  if (closeBtn && drawer) {
    closeBtn.addEventListener('click', () => {
      closeAssistantDrawer();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawer && !drawer.classList.contains('is-hidden')) {
      closeAssistantDrawer();
    }
  });

  // Helper to append message to Floating Drawer History
  const appendDrawerMessage = (sender, text, isUser = false) => {
    if (!chatHistory) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `bot-msg ${isUser ? 'bot-msg-user' : 'bot-msg-assistant'}`;

    const bubble = document.createElement('div');
    bubble.className = 'bot-msg-bubble';
    bubble.innerHTML = formatBotMessage(text);

    const timeDiv = document.createElement('div');
    timeDiv.className = 'bot-msg-time';
    timeDiv.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgDiv.appendChild(bubble);
    msgDiv.appendChild(timeDiv);
    chatHistory.appendChild(msgDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
  };

  // Helper to append message to Embedded Chat History (Bot Tab)
  const appendBotMessage = (sender, text, isUser = false, actionChips = []) => {
    if (!embeddedHistory) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `bot-msg ${isUser ? 'bot-msg-user' : 'bot-msg-assistant'}`;

    const senderSpan = document.createElement('span');
    senderSpan.className = 'bot-sender';
    senderSpan.textContent = sender;

    const bubble = document.createElement('div');
    bubble.className = 'bot-bubble';
    bubble.innerHTML = formatBotMessage(text);

    msgDiv.appendChild(senderSpan);
    msgDiv.appendChild(bubble);

    if (Array.isArray(actionChips) && actionChips.length > 0) {
      const chipsContainer = document.createElement('div');
      chipsContainer.className = 'bot-message-chips';
      actionChips.forEach((chipText) => {
        const btn = document.createElement('button');
        btn.className = 'secondary-btn pill-btn bot-inline-chip';
        btn.textContent = chipText;
        btn.addEventListener('click', () => {
          handleUserBotQuery(chipText);
        });
        chipsContainer.appendChild(btn);
      });
      msgDiv.appendChild(chipsContainer);
    }

    embeddedHistory.appendChild(msgDiv);
    embeddedHistory.scrollTop = embeddedHistory.scrollHeight;
  };

  const refreshBotMemoryUI = async () => {
    const summaryBox = document.getElementById('bot-memory-summary-box');
    const recentList = document.getElementById('bot-recent-actions-list');
    if (!summaryBox) return;

    const api = getBotAPI();
    if (!api || typeof api.getBotMemorySummary !== 'function') {
      summaryBox.textContent = 'Session memory ready.';
      return;
    }

    try {
      const memRes = await api.getBotMemorySummary();
      if (memRes && memRes.summary) {
        summaryBox.innerHTML = `<strong>Session Memory:</strong> ${memRes.summary}`;
        if (recentList && Array.isArray(memRes.recentActions)) {
          recentList.innerHTML = memRes.recentActions.length === 0
            ? '<p class="text-muted">No actions logged yet in session.</p>'
            : memRes.recentActions
                .map(
                  (act) => `
              <div class="memory-item sticky-note-item">
                <span class="memory-tag tag-${act.type}">${act.type ? act.type.replace('_', ' ') : 'action'}</span>
                <span class="memory-detail">${act.detail || 'Completed action'}</span>
                <span class="memory-time">${new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            `
                )
                .join('');
        }
      }
    } catch (err) {
      console.warn('Failed to refresh bot memory UI:', err);
    }
  };

  window.refreshBotMemoryUI = refreshBotMemoryUI;

  let isBotReplyPending = false;
  const botConversation = [];
  const setBotBusy = (isBusy) => {
    isBotReplyPending = isBusy;
    [chatSendBtn, sendBtn, ...chipBtns].forEach((button) => {
      if (button) button.disabled = isBusy;
    });
    if (chatInput) chatInput.disabled = isBusy;
    if (userInput) userInput.disabled = isBusy;
  };

  const removeThinkingMessages = () => {
    document.querySelectorAll('.bot-msg-bubble, #bot-chat-history .bot-bubble').forEach((bubble) => {
      if (bubble.textContent === 'Thinking…') bubble.closest('.bot-msg')?.remove();
    });
  };

  const handleUserBotQuery = async (queryText) => {
    if (isBotReplyPending) return;
    if (!queryText || !queryText.trim()) return;
    const cleanPrompt = queryText.trim();
    botConversation.push({ role: 'user', content: cleanPrompt });
    if (botConversation.length > 10) botConversation.splice(0, botConversation.length - 10);

    // Append to drawer if open / used
    appendDrawerMessage('You', cleanPrompt, true);
    if (chatInput) chatInput.value = '';

    // Append to embedded bot window if available
    appendBotMessage('You', cleanPrompt, true);
    if (userInput) userInput.value = '';

    const api = getBotAPI();
    if (!api) {
      const reply = 'The Helpy assistant could not be started. Please try again.';
      appendDrawerMessage('Helpy Assistant', reply, false);
      appendBotMessage('Helpy Bot', reply, false);
      return;
    }

    setBotBusy(true);
    appendDrawerMessage('Helpy Assistant', 'Thinking…', false);
    appendBotMessage('Helpy Bot', 'Thinking…', false);
    try {
      const tasks = window.electronAPI && typeof window.electronAPI.getTasks === 'function'
        ? await window.electronAPI.getTasks().catch(() => [])
        : [];
      const response = await api.processBotQuery(cleanPrompt, {
        source: 'desktop',
        conversation: botConversation.slice(0, -1),
        tasks: Array.isArray(tasks) ? tasks.slice(0, 8) : [],
        current_plan: currentPlan || null,
        focus_shield_active: isFocusShieldActive,
      });
      removeThinkingMessages();

      const answerText = typeof response === 'string' ? response : (response?.answer || 'Response received.');
      botConversation.push({ role: 'assistant', content: answerText });
      if (botConversation.length > 10) botConversation.splice(0, botConversation.length - 10);
      const chips = response && Array.isArray(response.actionChips) ? response.actionChips : [];

      appendDrawerMessage('Helpy Assistant', answerText, false);
      appendBotMessage('Helpy Bot', answerText, false, chips);

      // Process Action Intent
      if (response && response.action) {
        if (response.action === 'toggle_focus_shield') {
          toggleFocusShield(true);
        } else if (response.action === 'start_timer') {
          const minutes = response.actionData?.durationMinutes || 25;
          const startTimerBtn = document.getElementById('start-timer-btn');
          const durationInput = document.getElementById('timer-duration');
          if (durationInput) durationInput.value = minutes;
          if (startTimerBtn) startTimerBtn.click();
        } else if (response.action === 'add_task' && response.actionData?.title) {
          if (window.electronAPI && typeof window.electronAPI.addTask === 'function') {
            window.electronAPI.addTask({ title: response.actionData.title, priority: 'medium' });
          }
        }
      }

      await refreshBotMemoryUI();
    } catch (error) {
      console.warn('Bot query failed:', error);
      const reply = 'I could not process that message. Please try again.';
      removeThinkingMessages();
      appendDrawerMessage('Helpy Assistant', reply, false);
      appendBotMessage('Helpy Bot', reply, false);
    } finally {
      setBotBusy(false);
      if (chatInput) chatInput.focus();
    }
  };

  window.triggerBotQuery = handleUserBotQuery;

  if (chatSendBtn && chatInput) {
    chatSendBtn.addEventListener('click', () => handleUserBotQuery(chatInput.value));
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleUserBotQuery(chatInput.value);
      }
    });
  }

  chipBtns.forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt') || chip.textContent.trim();
      if (prompt) handleUserBotQuery(prompt);
    });
  });

  if (sendBtn && userInput) {
    sendBtn.addEventListener('click', () => handleUserBotQuery(userInput.value));
    userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleUserBotQuery(userInput.value);
      }
    });
  }

  if (factBtn) {
    factBtn.addEventListener('click', async () => {
      const api = getBotAPI();
      if (api && typeof api.getBotRandomFact === 'function') {
        const factRes = await api.getBotRandomFact();
        const msg = `💡 Did you know?\n${factRes.fact}`;
        appendBotMessage('Helpy Bot', msg, false, ['Give Motivation', 'Start Focus']);
        appendDrawerMessage('Helpy Assistant', msg);
      }
    });
  }

  if (motBtn) {
    motBtn.addEventListener('click', async () => {
      const api = getBotAPI();
      if (api && typeof api.getBotMotivation === 'function') {
        const motRes = await api.getBotMotivation();
        const msg = `🔥 ${motRes.motivation}`;
        appendBotMessage('Helpy Bot', msg, false, ['Focus Shield', 'Start Focus']);
        appendDrawerMessage('Helpy Assistant', msg);
      }
    });
  }

  if (memBtn) {
    memBtn.addEventListener('click', async () => {
      const api = getBotAPI();
      if (api && typeof api.getBotMemorySummary === 'function') {
        const memRes = await api.getBotMemorySummary();
        const msg = `🧠 What I Remember:\n${memRes.summary}`;
        appendBotMessage('Helpy Bot', msg, false, ['Give Motivation', 'Tell me a Fact']);
        appendDrawerMessage('Helpy Assistant', msg);
        refreshBotMemoryUI();
      }
    });
  }

  // Initial refresh of memory UI
  refreshBotMemoryUI();

  // Initialize Interactive Focus Room Hub
  initInteractiveRoom();
});

/* ==========================================================================
   INTERACTIVE FOCUS ROOM LOGIC
   ========================================================================== */
function initInteractiveRoom() {
  const roomHub = document.getElementById('interactiveRoomHub');
  if (!roomHub) return;

  // 1. Theme Lighting Modes Toggle
  const lampBtn = document.getElementById('roomLampBtn');
  const ambianceLabel = document.getElementById('roomAmbianceLabel');
  const lightingModes = [
    { class: 'lighting-warm', name: 'Warm Study' },
    { class: 'lighting-neon', name: 'Neon Cyberpunk' },
    { class: 'lighting-void', name: 'Deep Void' },
    { class: 'lighting-aurora', name: 'Daylight Aurora' },
  ];
  let currentLightingIdx = 0;

  if (lampBtn) {
    lampBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      roomHub.classList.remove(lightingModes[currentLightingIdx].class);
      currentLightingIdx = (currentLightingIdx + 1) % lightingModes.length;
      const nextMode = lightingModes[currentLightingIdx];
      roomHub.classList.add(nextMode.class);
      if (ambianceLabel) ambianceLabel.textContent = `Focus Ambiance: ${nextMode.name}`;
      showToast(`Ambiance theme changed to ${nextMode.name}`);
      recordActionScore(1, 0.2);
    });
  }

  // 2. Focus Metrics & Archetypes
  const avatarSwitchBtn = document.getElementById('roomAvatarSwitchBtn');
  const archetypeLabel = document.getElementById('currentArchetypeLabel');
  const stepsVal = document.getElementById('roomStepsVal');
  const distVal = document.getElementById('roomDistVal');

  const avatarCharacters = [
    { id: 'bot', name: 'Helpy Bot', label: 'Bot' },
    { id: 'engineer', name: 'Lead Engineer', label: 'Engineer' },
    { id: 'researcher', name: 'Scholar', label: 'Scholar' },
    { id: 'creative', name: 'Designer', label: 'Designer' },
    { id: 'astronaut', name: 'Explorer', label: 'Explorer' },
  ];
  let currentAvatarIdx = 0;
  let totalActions = 0;
  let focusScore = 0.0;

  function recordActionScore(actionsInc = 1, scoreInc = 0.5) {
    totalActions += actionsInc;
    focusScore += scoreInc;
    if (stepsVal) stepsVal.textContent = totalActions;
    if (distVal) distVal.textContent = focusScore.toFixed(1);
  }

  if (avatarSwitchBtn) {
    avatarSwitchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentAvatarIdx = (currentAvatarIdx + 1) % avatarCharacters.length;
      const nextChar = avatarCharacters[currentAvatarIdx];
      if (archetypeLabel) archetypeLabel.textContent = nextChar.label;
      showToast(`Focus archetype switched to ${nextChar.name}`);
      recordActionScore(1, 0.3);
    });
  }

  // 3. Focus Action Button Handlers
  function playCoffeeChime() {
    try {
      initAudioContext();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.18);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.36);

      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1174.66, now + 0.08);
      osc2.frequency.exponentialRampToValueAtTime(1760, now + 0.28);
      gain2.gain.setValueAtTime(0.1, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.41);
    } catch (e) {
      console.warn('Audio feedback failed:', e);
    }
  }

  function triggerCoffeeBreak() {
    playCoffeeChime();
    recordActionScore(1, 1.0);

    const mugParticles = document.querySelectorAll('.coffee-steam-particles');
    mugParticles.forEach(p => {
      p.style.filter = 'drop-shadow(0 0 8px rgba(245, 158, 11, 0.9))';
      setTimeout(() => { p.style.filter = ''; }, 2500);
    });

    const mugBtn = document.getElementById('roomMugBtn');
    if (mugBtn) {
      mugBtn.style.transform = 'scale(1.04) translateY(-2px)';
      mugBtn.style.borderColor = 'rgba(245, 158, 11, 0.8)';
      setTimeout(() => {
        mugBtn.style.transform = '';
        mugBtn.style.borderColor = '';
      }, 500);
    }

    showToast('Fresh roast brewed — Starting 5-minute coffee recharge break');
    const timerInput = document.getElementById('timerMinutes');
    if (timerInput) timerInput.value = '5';
    const startTimerBtn = document.getElementById('startTimerBtn');
    if (startTimerBtn) startTimerBtn.click();
  }

  function triggerDeskFocus() {
    recordActionScore(1, 2.5);
    showToast('Engaging Deep Work Focus Sprint (25 min)...');
    const timerInput = document.getElementById('timerMinutes');
    if (timerInput) timerInput.value = '25';
    const startTimerBtn = document.getElementById('startTimerBtn');
    if (startTimerBtn) startTimerBtn.click();
  }

  const bookshelfFacts = [
    "Erlang OTP Pattern: Gen_server handles request-response patterns with isolate process heaps.",
    "Productivity Insight: 25 minutes of single-task focus restores executive function by 40%.",
    "Tech Knowledge: BEAM VM runs lightweight green threads per CPU core with reduction-based preemptive scheduling.",
    "Focus Science: Atomic habits build momentum through compounding daily micro-wins.",
    "Cognitive Health: Interleaving deep sprints with short pauses increases retention by 35%.",
  ];
  let factIdx = 0;

  function triggerBookshelfTips() {
    recordActionScore(1, 0.5);
    const fact = bookshelfFacts[factIdx % bookshelfFacts.length];
    factIdx++;
    showToast(fact);
  }

  const windowScenes = ['Sunrise', 'Midnight Stars', 'Rainy Afternoon', 'Golden Hour'];
  let sceneIdx = 0;

  function triggerWindowScene() {
    recordActionScore(1, 0.4);
    sceneIdx = (sceneIdx + 1) % windowScenes.length;
    const sceneBadge = document.getElementById('currentSceneBadge');
    if (sceneBadge) sceneBadge.textContent = windowScenes[sceneIdx];
    showToast(`Atmosphere scenery set to ${windowScenes[sceneIdx]}`);
  }

  function triggerCompanionTalk() {
    recordActionScore(1, 0.5);
    const botDrawer = document.getElementById('bot-drawer');
    const botToggleBtn = document.getElementById('bot-toggle-btn') || document.getElementById('openBotFromMoreBtn');
    if (botToggleBtn) {
      botToggleBtn.click();
    } else if (botDrawer) {
      botDrawer.classList.toggle('open');
    }
    showToast('Helpy assistant ready for task support');
  }

  // Hook up Action Deck Buttons
  const coffeeBtn = document.getElementById('roomMugBtn');
  if (coffeeBtn) coffeeBtn.addEventListener('click', (e) => { e.stopPropagation(); triggerCoffeeBreak(); });

  const deskBtn = document.getElementById('actionDeskBtn');
  if (deskBtn) deskBtn.addEventListener('click', (e) => { e.stopPropagation(); triggerDeskFocus(); });

  const bookBtn = document.getElementById('actionBookshelfBtn');
  if (bookBtn) bookBtn.addEventListener('click', (e) => { e.stopPropagation(); triggerBookshelfTips(); });

  const winBtn = document.getElementById('actionWindowBtn');
  if (winBtn) winBtn.addEventListener('click', (e) => { e.stopPropagation(); triggerWindowScene(); });

  const compBtn = document.getElementById('actionCompanionBtn');
  if (compBtn) compBtn.addEventListener('click', (e) => { e.stopPropagation(); triggerCompanionTalk(); });

  const soundDeckBtn = document.getElementById('actionSoundDeckBtn');
  if (soundDeckBtn) soundDeckBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSoundscape(); });

  // 4. Web Audio Ambient Soundscape Synthesizer
  let audioCtx = null;
  let noiseNode = null;
  let gainNode = null;
  let filterNode = null;
  let isSoundPlaying = false;

  const playBtn = document.getElementById('roomSoundPlayBtn');
  const presetSelect = document.getElementById('roomSoundPresetSelect');
  const volumeSlider = document.getElementById('roomSoundVolumeSlider');
  const eqBars = document.getElementById('roomEqualizerBars');
  const soundDeckStatus = document.getElementById('soundDeckStatusLabel');
  const soundDeckBadge = document.getElementById('soundDeckPlayBadge');

  function initAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
  }

  function toggleSoundscape() {
    if (playBtn) playBtn.click();
  }

  function startAmbientSynth(preset = 'rain', volume = 0.7) {
    initAudioContext();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    stopAmbientSynth();

    const bufferSize = audioCtx.sampleRate * 2;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = noiseBuffer;
    noiseNode.loop = true;

    filterNode = audioCtx.createBiquadFilter();

    if (preset === 'rain') {
      filterNode.type = 'lowpass';
      filterNode.frequency.setValueAtTime(800, audioCtx.currentTime);
    } else if (preset === 'forest') {
      filterNode.type = 'bandpass';
      filterNode.frequency.setValueAtTime(1200, audioCtx.currentTime);
      filterNode.Q.setValueAtTime(1.5, audioCtx.currentTime);
    } else if (preset === 'waves') {
      filterNode.type = 'lowpass';
      filterNode.frequency.setValueAtTime(400, audioCtx.currentTime);
      const lfo = audioCtx.createOscillator();
      lfo.frequency.setValueAtTime(0.15, audioCtx.currentTime);
      const lfoGain = audioCtx.createGain();
      lfoGain.gain.setValueAtTime(300, audioCtx.currentTime);
      lfo.connect(lfoGain);
      lfoGain.connect(filterNode.frequency);
      lfo.start();
    } else if (preset === 'lofi') {
      filterNode.type = 'lowpass';
      filterNode.frequency.setValueAtTime(600, audioCtx.currentTime);
    } else if (preset === 'whitenoise') {
      filterNode.type = 'lowpass';
      filterNode.frequency.setValueAtTime(3000, audioCtx.currentTime);
    }

    gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);

    noiseNode.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    noiseNode.start();
    isSoundPlaying = true;

    if (eqBars) eqBars.classList.add('playing');
    if (playBtn) playBtn.innerHTML = '<svg class="pause-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  }

  function stopAmbientSynth() {
    if (noiseNode) {
      try { noiseNode.stop(); noiseNode.disconnect(); } catch (e) {}
      noiseNode = null;
    }
    isSoundPlaying = false;
    if (eqBars) eqBars.classList.remove('playing');
    if (playBtn) playBtn.innerHTML = '<svg class="play-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  }

  if (playBtn) {
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSoundPlaying) {
        stopAmbientSynth();
      } else {
        const preset = presetSelect ? presetSelect.value : 'rain';
        const vol = volumeSlider ? Number(volumeSlider.value) / 100 : 0.7;
        startAmbientSynth(preset, vol);
      }
    });
  }

  if (presetSelect) {
    presetSelect.addEventListener('change', () => {
      if (isSoundPlaying) {
        const vol = volumeSlider ? Number(volumeSlider.value) / 100 : 0.7;
        startAmbientSynth(presetSelect.value, vol);
      }
    });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
      if (gainNode && audioCtx) {
        gainNode.gain.setValueAtTime(Number(volumeSlider.value) / 100, audioCtx.currentTime);
      }
    });
  }

  // 4. Room Sticky Wall Notes
  const addNoteBtn = document.getElementById('addStickyNoteBtn');
  const stickyContainer = document.getElementById('stickyNotesContainer');
  const colors = ['note-yellow', 'note-blue', 'note-pink', 'note-green'];

  if (addNoteBtn && stickyContainer) {
    addNoteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = colors[Math.floor(Math.random() * colors.length)];
      const noteDiv = document.createElement('div');
      noteDiv.className = `sticky-note ${color}`;
      noteDiv.innerHTML = `
        <div class="sticky-note-pin"></div>
        <textarea class="sticky-note-input" placeholder="Type a note..." rows="2"></textarea>
      `;
      stickyContainer.appendChild(noteDiv);
      const input = noteDiv.querySelector('textarea');
      if (input) input.focus();
    });
  }
}

// Helper for other services to log actions into bot memory
window.logBotAction = function (type, detail) {
  const api = window.electronAPI || (typeof BotCompanion !== 'undefined' ? new BotCompanion() : null);
  if (api) {
    const fn = api.logBotAction || api.logAction;
    if (typeof fn === 'function') {
      Promise.resolve(fn.call(api, type, detail)).then(() => {
        if (typeof window.refreshBotMemoryUI === 'function') {
          window.refreshBotMemoryUI();
        }
      }).catch((error) => {
        console.warn('Bot action logging failed:', error);
      });
    }
  }
};
