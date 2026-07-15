const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const lines = content.split('\n');

for (let i = 1199; i < 1250; i++) {
  console.log(`${i + 1}: ${lines[i]}`);
}
