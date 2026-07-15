/* global chrome */

let currentPeriod = 1;
let currentChartStats = [];

const colors = [
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
];

function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function getChartColors(count) {
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(colors[i % colors.length]);
  }
  return result;
}

function getReport(days) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getReport', days }, (report) => {
      if (chrome.runtime.lastError) {
        console.error('Error getting report:', chrome.runtime.lastError);
        resolve(null);
        return;
      }
      resolve(report || null);
    });
  });
}

function setViewState({ loading, empty }) {
  const loadingEl = document.getElementById('loading');
  const emptyStateEl = document.getElementById('emptyState');
  const contentEl = document.getElementById('content');

  loadingEl.style.display = loading ? 'flex' : 'none';
  emptyStateEl.style.display = !loading && empty ? 'block' : 'none';
  contentEl.style.display = !loading && !empty ? 'block' : 'none';
}

function createDomainListItem(stat) {
  const item = document.createElement('li');
  item.className = 'domain-item';

  const info = document.createElement('div');
  info.className = 'domain-info';

  const name = document.createElement('div');
  name.className = 'domain-name';
  name.textContent = stat.domain;

  const visits = document.createElement('div');
  visits.className = 'domain-visits';
  visits.textContent = `${stat.visits} visits`;

  info.appendChild(name);
  info.appendChild(visits);

  const time = document.createElement('div');
  time.className = 'domain-time';
  time.textContent = formatDuration(stat.totalTime);

  item.appendChild(info);
  item.appendChild(time);
  return item;
}

function renderDomainList(domainStats) {
  const domainListEl = document.getElementById('domainList');
  const fragment = document.createDocumentFragment();

  domainStats.slice(0, 10).forEach((stat) => {
    fragment.appendChild(createDomainListItem(stat));
  });

  domainListEl.replaceChildren(fragment);
}

function getCanvasContext(canvas) {
  const size = Math.min(canvas.clientWidth || 320, 320);
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = size * pixelRatio;
  canvas.height = size * pixelRatio;
  canvas.style.height = `${size}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, size, size);

  return { ctx, size };
}

function drawChartLabel(ctx, centerX, centerY, totalMinutes) {
  ctx.fillStyle = '#64748b';
  ctx.font = "600 14px 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Tracked', centerX, centerY - 12);

  ctx.fillStyle = '#0f172a';
  ctx.font = "700 24px 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
  ctx.fillText(formatDuration(totalMinutes * 60000), centerX, centerY + 14);
}

function renderDomainChart(domainStats) {
  const canvas = document.getElementById('domainChart');
  if (!canvas) {
    return;
  }

  currentChartStats = domainStats.slice(0, 8);
  const { ctx, size } = getCanvasContext(canvas);

  if (currentChartStats.length === 0) {
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.18, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const values = currentChartStats.map((stat) => Math.max(0, Math.round(stat.totalTime / 60000)));
  const totalMinutes = values.reduce((sum, value) => sum + value, 0);
  const colorsForChart = getChartColors(currentChartStats.length);
  const center = size / 2;
  const radius = size * 0.34;
  const ringWidth = size * 0.16;
  let startAngle = -Math.PI / 2;

  values.forEach((value, index) => {
    const sliceAngle = totalMinutes === 0 ? 0 : (value / totalMinutes) * Math.PI * 2;
    const endAngle = startAngle + sliceAngle;

    ctx.beginPath();
    ctx.arc(center, center, radius, startAngle, endAngle);
    ctx.strokeStyle = colorsForChart[index];
    ctx.lineWidth = ringWidth;
    ctx.lineCap = 'butt';
    ctx.stroke();

    startAngle = endAngle;
  });

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(center, center, radius - ringWidth / 1.8, 0, Math.PI * 2);
  ctx.fill();

  drawChartLabel(ctx, center, center, totalMinutes);
}

async function updateReport(period) {
  setViewState({ loading: true, empty: false });

  const report = await getReport(period);

  if (!report || !report.domainStats || report.domainStats.length === 0) {
    currentChartStats = [];
    setViewState({ loading: false, empty: true });
    return;
  }

  setViewState({ loading: false, empty: false });

  document.getElementById('totalTime').textContent = formatDuration(report.totalTime);
  document.getElementById('switchCount').textContent = report.switchCount || 0;
  document.getElementById('domainCount').textContent = report.domainStats.length;

  renderDomainList(report.domainStats);
  renderDomainChart(report.domainStats);
}

document.querySelectorAll('.date-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.date-btn').forEach((button) => button.classList.remove('active'));
    btn.classList.add('active');
    currentPeriod = parseInt(btn.dataset.period, 10);
    updateReport(currentPeriod);
  });
});

window.addEventListener('resize', () => {
  if (currentChartStats.length > 0) {
    renderDomainChart(currentChartStats);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  updateReport(currentPeriod);
});
