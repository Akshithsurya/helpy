const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const filePath = path.join(__dirname, 'main.js');

let content;
try {
  content = fs.readFileSync(filePath, 'utf8');
} catch (e) {
  console.error('File error:', e.message);
  process.exit(1);
}

try {
  acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'module' });
  console.log('No syntax errors found');
} catch (e) {
  console.error('Syntax error:', e.message);
  if (e.loc) {
    console.error(`Location: Line ${e.loc.line}, Column ${e.loc.column}`);
  }
}