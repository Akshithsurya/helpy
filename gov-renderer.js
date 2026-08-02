/**
 * Government-grade Task Management System - Renderer Script
 */

console.log('Government-grade Task Management System started');

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initForms();
  initSystemInfo();
  startHealthMonitoring();
});

// Navigation function
function initNavigation() {
  const navLinks = document.querySelectorAll('.gov-nav-link');

  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();

      // Remove all active classes
      navLinks.forEach((l) => l.classList.remove('active'));

      // Add active class to current link
      link.classList.add('active');

      // Show corresponding page
      const page = link.dataset.page;
      showPage(page);
    });
  });
}

// Show page
function showPage(pageName) {
  // Hide all pages
  const pages = document.querySelectorAll('.gov-page');
  pages.forEach((page) => {
    page.style.display = 'none';
  });

  // Show target page
  const targetPage = document.getElementById(`page-${pageName}`);
  if (targetPage) {
    targetPage.style.display = 'block';
  }
}

// Initialize forms
function initForms() {
  // Task form
  const taskFormGov = document.getElementById('taskFormGov');
  if (taskFormGov) {
    taskFormGov.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('govTaskTitle').value;
      const priority = document.getElementById('govTaskPriority').value;
      const desc = document.getElementById('govTaskDesc').value;
      const owner = document.getElementById('govTaskOwner').value;
      const deadline = document.getElementById('govTaskDeadline').value;

      console.log('Creating government task:', { title, priority, desc, owner, deadline });
      alert(`Task created successfully: ${title}`);
      taskFormGov.reset();
    });
  }

  // Plan form
  const planFormGov = document.getElementById('planFormGov');
  if (planFormGov) {
    planFormGov.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('govPlanTitle').value;
      const duration = document.getElementById('govPlanDuration').value;
      const goal = document.getElementById('govPlanGoal').value;

      console.log('Creating government plan:', { title, duration, goal });
      alert(`Plan created successfully: ${title}`);
      planFormGov.reset();
    });
  }

  // Audit search button
  const auditSearchBtn = document.getElementById('auditSearchBtn');
  if (auditSearchBtn) {
    auditSearchBtn.addEventListener('click', () => {
      console.log('Searching audit logs');
      alert('Audit log search function');
    });
  }

  // Audit export button
  const auditExportBtn = document.getElementById('auditExportBtn');
  if (auditExportBtn) {
    auditExportBtn.addEventListener('click', () => {
      console.log('Exporting audit logs');
      alert('Audit log export function');
    });
  }

  // Refresh button
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      console.log('Refreshing page');
      updateLastCheckTime();
    });
  }
}

// Initialize system info
function initSystemInfo() {
  updateLastCheckTime();
  simulateSystemStats();
}

// Update last check time
function updateLastCheckTime() {
  const lastCheckTime = document.getElementById('lastCheckTime');
  if (lastCheckTime) {
    const now = new Date();
    lastCheckTime.textContent = now.toLocaleString('en-US');
  }
}

// Simulate system stats data
function simulateSystemStats() {
  // CPU Usage
  const cpuUsage = document.getElementById('cpuUsage');
  if (cpuUsage) {
    cpuUsage.textContent = `${Math.floor(Math.random() * 30 + 25)}%`;
  }

  // Memory Usage
  const memoryUsage = document.getElementById('memoryUsage');
  if (memoryUsage) {
    memoryUsage.textContent = `${Math.floor(Math.random() * 20 + 50)}%`;
  }

  // Disk Usage
  const diskUsage = document.getElementById('diskUsage');
  if (diskUsage) {
    diskUsage.textContent = `${Math.floor(Math.random() * 10 + 40)}%`;
  }
}

// Start health monitoring
function startHealthMonitoring() {
  // Update system status every 30 seconds
  setInterval(() => {
    updateLastCheckTime();
    simulateSystemStats();
  }, 30000);
}

// Utility function: show notification
function showNotification(message, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${message}`);

  const notification = document.createElement('div');
  notification.className = `gov-alert gov-alert-${type}`;
  notification.style.position = 'fixed';
  notification.style.top = '80px';
  notification.style.right = '20px';
  notification.style.zIndex = '1000';
  notification.style.animation = 'slideIn 0.3s ease';

  notification.innerHTML = `
    <div>
      <strong>${type === 'success' ? 'Success' : type === 'warning' ? 'Warning' : type === 'error' ? 'Error' : 'Info'}</strong><br>
      ${message}
    </div>
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Add simple animation styles
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
`;
document.head.appendChild(style);
