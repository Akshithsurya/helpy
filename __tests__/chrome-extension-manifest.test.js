const fs = require('fs');
const path = require('path');

describe('Chrome extension manifest', () => {
  const manifestPath = path.join(__dirname, '..', 'chrome-extension', 'manifest.json');
  const reportsHtmlPath = path.join(__dirname, '..', 'chrome-extension', 'reports.html');

  test('keeps an MV3-compliant extension pages CSP', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const extensionPagesPolicy = manifest.content_security_policy.extension_pages;

    expect(manifest.manifest_version).toBe(3);
    expect(extensionPagesPolicy).toContain("script-src 'self'");
    expect(extensionPagesPolicy).not.toContain("'unsafe-eval'");
    expect(extensionPagesPolicy).not.toMatch(/https?:\/\//);
    expect(manifest.background).toEqual({ service_worker: 'background.js' });
    expect(manifest.action.default_popup).toBe('popup.html');
  });

  test('does not load remote scripts from the reports page', () => {
    const reportsHtml = fs.readFileSync(reportsHtmlPath, 'utf8');

    expect(reportsHtml).not.toMatch(/<script[^>]+src="https?:\/\//i);
    expect(reportsHtml).not.toContain('cdn.jsdelivr.net');
    expect(reportsHtml).not.toContain('fonts.googleapis.com');
    expect(reportsHtml).toContain('<script src="reports.js"></script>');
  });

  test('does not load remote stylesheets from the popup page', () => {
    const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'chrome-extension', 'popup.html'), 'utf8');

    expect(popupHtml).not.toMatch(/<link[^>]+href="https?:\/\//i);
    expect(popupHtml).not.toContain('fonts.googleapis.com');
    expect(popupHtml).toContain('--font-sans:');
  });
});
