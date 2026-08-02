const ACTIVITY_REPORT_INTERVAL_MS = 15 * 1000;
let lastActivityReportAt = 0;

// Small helper: every chrome.runtime.sendMessage call in this file was
// unguarded — if the background service worker is asleep, restarting, or
// was reloaded after this content script was injected, Chrome rejects the
// message with "Could not establish connection. Receiving end does not
// exist." Without a callback (or a .catch), that rejection surfaces as an
// uncaught error in the console — exactly the error from the Errors page.
// Passing a callback and reading chrome.runtime.lastError inside it marks
// the error as handled, so Chrome suppresses it instead of logging it.
function sendMessageSafe(message, onResponse) {
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        // Expected when the background service worker is asleep/restarting
        // or the extension was reloaded after this page was already open.
        // Nothing to recover here — the next event or navigation will retry.
        return;
      }
      if (onResponse) onResponse(response);
    });
  } catch (error) {
    // Page can outlive an extension reload; there's nothing to recover
    // until Chrome injects the refreshed content script on next navigation.
  }
}

function updateActivity() {
  const now = Date.now();
  if (now - lastActivityReportAt < ACTIVITY_REPORT_INTERVAL_MS) {
    return;
  }

  lastActivityReportAt = now;
  sendMessageSafe({ action: 'tabActivity' });
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
    document.addEventListener(event, updateActivity, { capture: true, passive: true });
  } catch (error) {
    // Some restricted pages do not allow the full content-script lifecycle.
  }
});

sendMessageSafe({ action: 'contentScriptReady' });

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

function showBlockNudge(url) {
  if (document.getElementById('helpy-block-nudge')) return;
  const overlay = document.createElement('div');
  overlay.id = 'helpy-block-nudge';
  overlay.innerHTML =
    '<div class="helpy-block-nudge-card"><h2>Return to your focus?</h2><p>This site is on your Helpy blocklist. It will be blocked in <strong id="helpy-nudge-count">10</strong> seconds.</p><div><button id="helpy-stay-blocked">Stay blocked</button><button id="helpy-leave-anyway">Leave anyway</button></div></div>';
  const style = document.createElement('style');
  style.textContent =
    '#helpy-block-nudge{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(15,23,42,.72);font-family:"Segoe UI",sans-serif}#helpy-block-nudge .helpy-block-nudge-card{max-width:420px;padding:28px;border-radius:18px;background:#fff;color:#1f2937;box-shadow:0 20px 60px rgba(15,23,42,.35);text-align:center}#helpy-block-nudge h2{margin:0 0 12px;color:#0f172a}#helpy-block-nudge p{line-height:1.5;color:#475569}#helpy-block-nudge button{border:0;border-radius:8px;padding:10px 16px;margin:8px;font-weight:700;cursor:pointer}#helpy-stay-blocked{background:#2563eb;color:#fff}#helpy-leave-anyway{background:#e2e8f0;color:#1e293b}';
  overlay.appendChild(style);
  document.documentElement.appendChild(overlay);
  let seconds = 10;
  const finish = (decision) => {
    clearInterval(timer);
    overlay.remove();
    sendMessageSafe({ action: 'blockNudgeDecision', decision, url });
  };
  const timer = setInterval(() => {
    seconds -= 1;
    const count = document.getElementById('helpy-nudge-count');
    if (count) count.textContent = String(seconds);
    if (seconds <= 0) finish('block');
  }, 1000);
  overlay.querySelector('#helpy-stay-blocked').addEventListener('click', () => finish('block'));
  overlay.querySelector('#helpy-leave-anyway').addEventListener('click', () => finish('leave'));
}

try {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message.action === 'showNotification') {
        showCustomNotification(message.title, message.body, message.options);
        sendResponse({ success: true });
      } else if (message.action === 'showBlockNudge') {
        showBlockNudge(message.url || window.location.href);
        sendResponse({ success: true });
      } else if (message.action === 'extractPageContent') {
        const title = document.title || 'Untitled Page';
        const url = window.location.href;
        // Basic readable text extraction from article/main/paragraphs
        const article =
          document.querySelector('article') || document.querySelector('main') || document.body;
        const paragraphs = Array.from(article.querySelectorAll('p, h1, h2, h3'))
          .map((el) => el.innerText.trim())
          .filter((text) => text.length > 20);
        const excerpt = paragraphs.slice(0, 15).join('\n\n');
        sendResponse({ success: true, title, url, content: excerpt, length: excerpt.length });
      } else if (message.action === 'toggleReaderMode') {
        let overlay = document.getElementById('helpy-reader-mode-overlay');
        if (overlay) {
          overlay.remove();
          sendResponse({ success: true, active: false });
        } else {
          overlay = document.createElement('div');
          overlay.id = 'helpy-reader-mode-overlay';
          overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: #0f172a; color: #f8fafc; z-index: 2147483646;
            overflow-y: auto; padding: 40px 20%; font-family: Georgia, serif;
            line-height: 1.8; font-size: 19px; box-sizing: border-box;
          `;

          const closeBtn = document.createElement('button');
          closeBtn.textContent = '✕ Exit Reader Mode';
          closeBtn.style.cssText = `
            position: fixed; top: 20px; right: 20px; background: #3b82f6; color: #fff;
            border: none; padding: 10px 18px; border-radius: 8px; font-weight: bold; cursor: pointer; z-index: 2147483647;
          `;
          closeBtn.onclick = () => overlay.remove();

          const article =
            document.querySelector('article') || document.querySelector('main') || document.body;
          const clonedArticle = article.cloneNode(true);
          // clean scripts & images if desired
          clonedArticle
            .querySelectorAll('script, style, iframe, nav, header, footer')
            .forEach((n) => n.remove());

          overlay.appendChild(closeBtn);
          overlay.appendChild(clonedArticle);
          document.body.appendChild(overlay);
          sendResponse({ success: true, active: true });
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  });
} catch (error) {
  console.error('Error adding onMessage listener:', error);
}