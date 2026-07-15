const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

try {
  const content = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'script' });
  console.log('No syntax errors found');
} catch (e) {
  console.error('Syntax error:', e.message);
  console.error('Location:', e.loc);
}
