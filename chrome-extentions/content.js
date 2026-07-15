function updateActivity() {
  try {
    chrome.runtime.sendMessage({ action: 'tabActivity' });
  } catch (error) {
    console.error('Error updating tab activity:', error);
  }
}

const events = [
  'mousemove',
  'mousedown',
  'keydown',
  'keyup',
  'scroll',
  'wheel',
  'touchstart',
  'touchmove',
];
events.forEach((event) => {
  try {
    document.addEventListener(event, updateActivity, true);
  } catch (error) {
    console.error(`Error adding event listener for ${event}:`, error);
  }
});

try {
  chrome.runtime.sendMessage({ action: 'contentScriptReady' });
} catch (error) {
  console.error('Error sending contentScriptReady message:', error);
}

const notificationQueue = [];
let activeNotification = null;

function createNotificationStyles() {
  try {
    if (document.getElementById('helpy-notification-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'helpy-notification-styles';
    style.textContent = `
      .helpy-notification-container {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        gap: 12px;
        pointer-events: none;
      }
      
      .helpy-notification {
        pointer-events: auto;
        width: 360px;
        padding: 16px 20px;
        background: rgba(255, 255, 255, 0.98);
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 16px;
        box-shadow: 0 10px 35px rgba(15, 23, 42, 0.12);
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        color: #1f2937;
        animation: helpy-slide-in 0.4s ease-out;
        position: relative;
      }
      
      .helpy-notification-title {
        font-size: 14px;
        font-weight: 700;
        margin: 0 0 8px 0;
        color: #111827;
      }
      
      .helpy-notification-body {
        font-size: 13px;
        line-height: 1.6;
        margin: 0;
        color: #475569;
        white-space: normal;
      }
      
      .helpy-notification-close {
        position: absolute;
        top: 10px;
        right: 12px;
        background: none;
        border: none;
        font-size: 20px;
        color: #9ca3af;
        cursor: pointer;
        padding: 4px 8px;
        line-height: 1;
        border-radius: 8px;
        transition: background 0.2s ease, color 0.2s ease;
      }
      
      .helpy-notification-close:hover {
        color: #475569;
        background: #f3f4f6;
      }
      
      @keyframes helpy-slide-in {
        from {
          transform: translateX(420px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      
      @keyframes helpy-slide-out {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(420px);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  } catch (error) {
    console.error('Error creating notification styles:', error);
  }
}

function createNotificationContainer() {
  try {
    let container = document.getElementById('helpy-notification-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'helpy-notification-container';
      container.className = 'helpy-notification-container';
      document.body.appendChild(container);
    }
    return container;
  } catch (error) {
    console.error('Error creating notification container:', error);
    return null;
  }
}

function showCustomNotification(title, body, options = {}) {
  try {
    createNotificationStyles();
    const container = createNotificationContainer();
    if (!container) {
      return null;
    }

    const notification = document.createElement('div');
    notification.className = 'helpy-notification';
    notification.style.position = 'relative';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'helpy-notification-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => dismissNotification(notification));

    const titleEl = document.createElement('div');
    titleEl.className = 'helpy-notification-title';
    titleEl.textContent = title;

    const bodyEl = document.createElement('div');
    bodyEl.className = 'helpy-notification-body';
    bodyEl.textContent = body;

    notification.appendChild(closeBtn);
    notification.appendChild(titleEl);
    notification.appendChild(bodyEl);

    container.appendChild(notification);

    const duration = options.duration || 5000;
    setTimeout(() => dismissNotification(notification), duration);

    return notification;
  } catch (error) {
    console.error('Error showing custom notification:', error);
    return null;
  }
}

function dismissNotification(notification) {
  try {
    if (!notification || notification.parentNode === null) {
      return;
    }

    notification.style.animation = 'helpy-slide-out 0.3s ease-in forwards';
    setTimeout(() => {
      try {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      } catch (error) {
        console.error('Error removing notification:', error);
      }
    }, 300);
  } catch (error) {
    console.error('Error dismissing notification:', error);
  }
}

try {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message.action === 'showNotification') {
        showCustomNotification(message.title, message.body, message.options);
        sendResponse({ success: true });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  });
} catch (error) {
  console.error('Error adding onMessage listener:', error);
}
