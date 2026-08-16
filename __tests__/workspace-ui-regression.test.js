const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(projectRoot, 'renderer.js'), 'utf8');

describe('Workspace UI regression coverage', () => {
  test('keeps both profile entry points wired to the profile panel', () => {
    expect(renderer).toContain("bindClickAction('openProfileSettingsBtn', () => revealMorePanel('moreProfilePanel'))");
    expect(renderer).toContain("bindClickAction('openProfileFromMoreBtn', () => revealMorePanel('moreProfilePanel'))");
  });

  test('keeps the More insights action wired to the insights panel', () => {
    expect(renderer).toContain("bindClickAction('openInsightsFromMoreBtn', () => revealMorePanel('moreInsightsPanel'))");
    expect(renderer).toContain("activateTab('more');");
  });

  test('uses the More button as the assistant entry point and removes the floating trigger', () => {
    expect(html).toContain('id="openBotFromMoreBtn"');
    expect(html).toContain('aria-controls="bot-drawer"');
    expect(html).not.toContain('id="bot-toggle-btn"');
    expect(renderer).toContain("const moreAssistantBtn = document.getElementById('openBotFromMoreBtn');");
    expect(renderer).toContain('openAssistantDrawer(moreAssistantBtn);');
  });

  test('keeps the balanced workspace layout hooks in the Focus and More tabs', () => {
    expect(html).toContain('class="focus-primary-grid"');
    expect(html).toContain('class="section focus-hero-section focus-grid-primary"');
    expect(html).toContain('class="section focus-grid-secondary" id="focus-session-panel"');
    expect(html).toContain('class="more-actions-grid"');
    expect(html).toContain('class="more-insights-grid"');
    expect(html).toContain('class="more-insights-column"');
    expect(html).toContain('class="section nested-section"');
  });

  test('redraws the weekly focus chart when the More tab is visible during resize', () => {
    expect(renderer).toContain("const moreTab = document.getElementById('more-tab');");
    expect(renderer).toContain("if (moreTab && !moreTab.hasAttribute('hidden')) {");
    expect(renderer).not.toContain("const statsTab = document.getElementById('stats-tab');");
  });

  test('does not create a duplicate appearance menu container in the header', () => {
    expect(renderer).toContain("const appearancePreferences = document.getElementById('appearancePreferences');");
    expect(renderer).not.toContain("document.createElement('details')");
  });
});
