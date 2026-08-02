'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'chrome-extension');
const key = process.env.HELPY_CRX_KEY;
if (!key || !path.isAbsolute(key) || !fs.existsSync(key)) {
  throw new Error(
    'Set HELPY_CRX_KEY to the absolute path of a private key stored outside this repository.'
  );
}
const chrome = process.env.CHROME_PATH || 'chrome';
execFileSync(chrome, [`--pack-extension=${extension}`, `--pack-extension-key=${key}`], {
  stdio: 'inherit',
});
