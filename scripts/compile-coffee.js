const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const coffeeDir = path.join(__dirname, '..', 'src', 'coffee');
const outputDir = path.join(__dirname, '..', 'src', 'coffee-compiled');

const args = process.argv.slice(2);
const wantsSourceMaps = args.includes('--source-map') || args.includes('-m');
const coffeeBin =
  process.platform === 'win32'
    ? path.join(__dirname, '..', 'node_modules', '.bin', 'coffee.cmd')
    : path.join(__dirname, '..', 'node_modules', '.bin', 'coffee');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const coffeeFiles = fs.readdirSync(coffeeDir).filter((file) => file.endsWith('.coffee'));

if (coffeeFiles.length === 0) {
  console.warn('No .coffee files found in src/coffee — nothing to compile.');
  process.exit(0);
}

console.log(`Compiling ${coffeeFiles.length} CoffeeScript file(s) → src/coffee-compiled/`);
if (wantsSourceMaps) console.log('  (source maps enabled)');

let failures = 0;
let successes = 0;

for (const file of coffeeFiles) {
  const inputFile = path.join(coffeeDir, file);
  const extraArgs = [];
  if (wantsSourceMaps) extraArgs.push('-m');

  console.log(`  • compiling ${file} ...`);
  const result = spawnSync(coffeeBin, ['-c', '-o', outputDir, ...extraArgs, inputFile], {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  const stdout = result.stdout ? result.stdout.toString().trim() : '';
  const stderr = result.stderr ? result.stderr.toString().trim() : '';

  if (result.status === 0) {
    successes++;
    if (stdout) console.log(`    ${stdout}`);
  } else {
    failures++;
    console.error(`    ✗ FAILED (exit ${result.status}) ${file}`);
    if (stderr) console.error(`      ${stderr.replace(/\n/g, '\n      ')}`);
    if (result.error) console.error(`      spawn error: ${result.error.message}`);
  }
}

console.log('');
console.log(`Summary: ${successes} succeeded, ${failures} failed (of ${coffeeFiles.length}).`);

if (failures > 0) {
  process.exit(1);
}

const sourceBarrel = path.join(coffeeDir, 'index.js');
const targetBarrel = path.join(outputDir, 'index.js');
try {
  if (fs.existsSync(sourceBarrel)) {
    fs.copyFileSync(sourceBarrel, targetBarrel);
    console.log(`  • copied barrel index.js → ${path.relative(process.cwd(), targetBarrel)}`);
  }
} catch (copyErr) {
  console.error(`  ✗ failed to copy barrel index.js: ${copyErr.message}`);
  process.exit(1);
}
