const fs = require('fs');
const path = require('path');

try {
  const content = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  eval(`(function() { ${content} })`);
  console.log('No syntax errors found');
} catch (e) {
  console.error('Syntax error:', e.message);
  console.error('Stack:', e.stack);
}
