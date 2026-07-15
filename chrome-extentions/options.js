function sanitizeDisplayName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ').slice(0, 40);
}

function getAddressName(displayName) {
  return displayName || 'there';
}

function showMessage(text, isSuccess) {
  try {
    const messageEl = document.getElementById('message');
    messageEl.textContent = text;
    messageEl.className = `message ${isSuccess ? 'message-success' : 'message-error'}`;
    messageEl.style.display = 'block';

    setTimeout(() => {
      try {
        messageEl.style.display = 'none';
      } catch (error) {
        console.error('Error hiding message:', error);
      }
    }, 3000);
  } catch (error) {
    console.error('Error showing message:', error);
  }
}

async function syncSettingsToApp(settings) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'syncSettingsToApp',
      payload: settings,
    });

    if (!response?.success) {
      throw new Error(response?.error || 'Failed to sync with app');
    }

    return true;
  } catch (error) {
    console.log('App not available for sync:', error);
    return false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    // Dark mode toggle
    const darkModeToggle = document.getElementById('darkModeToggle');
    const savedTheme = localStorage.getItem('helpy-theme');
    if (savedTheme === 'dark') {
      document.body.classList.add('dark');
      darkModeToggle.textContent = '☀️';
    }
    darkModeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark');
      const isDark = document.body.classList.contains('dark');
      localStorage.setItem('helpy-theme', isDark ? 'dark' : 'light');
      darkModeToggle.textContent = isDark ? '☀️' : '🌙';
    });

    const displayNameInput = document.getElementById('displayName');
    const emailInput = document.getElementById('email');
    const bioInput = document.getElementById('bio');
    const collectAnalyticsInput = document.getElementById('collectAnalytics');
    const allowPersonalizationInput = document.getElementById('allowPersonalization');
    const inactivityInput = document.getElementById('inactivityMinutes');
    const notificationIntervalInput = document.getElementById('notificationIntervalMinutes');
    const maxTabsInput = document.getElementById('maxTabs');
    const focusMinutesInput = document.getElementById('focusMinutes');
    const breakMinutesInput = document.getElementById('breakMinutes');
    const saveBtn = document.getElementById('saveBtn');
    const testBtn = document.getElementById('testBtn');

    // Load settings
    chrome.storage.sync.get(
      [
        'inactivityMinutes',
        'notificationIntervalMinutes',
        'displayName',
        'bridgeToken',
        'email',
        'bio',
        'collectAnalytics',
        'allowPersonalization',
        'maxTabs',
        'focusMinutes',
        'breakMinutes',
      ],
      (result) => {
        if (chrome.runtime.lastError) {
          showMessage('Error loading settings: ' + chrome.runtime.lastError.message, false);
          return;
        }

        if (result.inactivityMinutes) {
          inactivityInput.value = result.inactivityMinutes;
        }

        if (result.notificationIntervalMinutes) {
          notificationIntervalInput.value = result.notificationIntervalMinutes;
        }

        if (result.displayName) {
          displayNameInput.value = result.displayName;
        }

        if (result.email) {
          emailInput.value = result.email;
        }

        if (result.bio) {
          bioInput.value = result.bio;
        }

        if (result.maxTabs) {
          maxTabsInput.value = result.maxTabs;
        }

        if (result.focusMinutes) {
          focusMinutesInput.value = result.focusMinutes;
        }

        if (result.breakMinutes) {
          breakMinutesInput.value = result.breakMinutes;
        }

        collectAnalyticsInput.checked = result.collectAnalytics !== false;
        allowPersonalizationInput.checked = result.allowPersonalization !== false;
      }
    );

    // Save settings
    saveBtn.addEventListener('click', async () => {
      try {
        const inactivityMinutes = parseInt(inactivityInput.value, 10);
        const notificationIntervalMinutes = parseInt(notificationIntervalInput.value, 10);
        const maxTabs = parseInt(maxTabsInput.value, 10);
        const focusMinutes = parseInt(focusMinutesInput.value, 10);
        const breakMinutes = parseInt(breakMinutesInput.value, 10);
        const displayName = sanitizeDisplayName(displayNameInput.value);
        const email = emailInput.value.trim();
        const bio = bioInput.value.trim();
        const collectAnalytics = collectAnalyticsInput.checked;
        const allowPersonalization = allowPersonalizationInput.checked;

        if (isNaN(inactivityMinutes) || inactivityMinutes < 1 || inactivityMinutes > 1440) {
          showMessage('Please enter a valid inactivity duration (1-1440 minutes)', false);
          return;
        }

        if (
          isNaN(notificationIntervalMinutes) ||
          notificationIntervalMinutes < 1 ||
          notificationIntervalMinutes > 1440
        ) {
          showMessage('Please enter a valid notification interval (1-1440 minutes)', false);
          return;
        }

        if (isNaN(maxTabs) || maxTabs < 1 || maxTabs > 200) {
          showMessage('Please enter a valid maximum tabs (1-200)', false);
          return;
        }

        if (isNaN(focusMinutes) || focusMinutes < 1 || focusMinutes > 120) {
          showMessage('Please enter a valid focus duration (1-120 minutes)', false);
          return;
        }

        if (isNaN(breakMinutes) || breakMinutes < 1 || breakMinutes > 60) {
          showMessage('Please enter a valid break duration (1-60 minutes)', false);
          return;
        }

        // Save to chrome storage
        chrome.storage.sync.set(
          {
            inactivityMinutes,
            notificationIntervalMinutes,
            maxTabs,
            focusMinutes,
            breakMinutes,
            displayName,
            email,
            bio,
            collectAnalytics,
            allowPersonalization,
          },
          async () => {
            if (chrome.runtime.lastError) {
              showMessage('Error saving settings: ' + chrome.runtime.lastError.message, false);
            } else {
              const synced = await syncSettingsToApp({
                inactivityMinutes,
                notificationIntervalMinutes,
                maxTabs,
                focusMinutes,
                breakMinutes,
                displayName,
                email,
                bio,
                collectAnalytics,
                allowPersonalization,
              });
              showMessage(
                synced
                  ? 'Settings saved and synced with the Helpy desktop app.'
                  : 'Settings saved locally. Open the Helpy desktop app to finish secure bridge sync.',
                synced
              );
            }
          }
        );
      } catch (error) {
        console.error('Error saving settings:', error);
        showMessage('An error occurred while saving settings', false);
      }
    });

    // Test notification
    testBtn.addEventListener('click', () => {
      try {
        chrome.storage.sync.get(['displayName'], (result) => {
          if (chrome.runtime.lastError) {
            showMessage(
              'Error loading settings for test: ' + chrome.runtime.lastError.message,
              false
            );
            return;
          }
          const addressName = getAddressName(result.displayName);
          chrome.notifications.create(
            {
              type: 'basic',
              iconUrl: 'icon.png',
              title: result.displayName ? `Test Notification, ${addressName}` : 'Test Notification',
              message: 'This is a Chrome tracking reminder from Helpy Tab Tracker.',
              priority: 2,
            },
            (notificationId) => {
              if (chrome.runtime.lastError) {
                showMessage(
                  'Error creating notification: ' + chrome.runtime.lastError.message,
                  false
                );
              }
            }
          );
        });
      } catch (error) {
        console.error('Error testing notification:', error);
        showMessage('An error occurred while testing notification', false);
      }
    });
  } catch (error) {
    console.error('Error initializing options page:', error);
  }
});
