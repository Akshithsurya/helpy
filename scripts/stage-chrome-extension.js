const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(projectRoot, 'chrome-extension');
const targetDir = path.join(projectRoot, 'release', 'chrome-extension');
const ignoredEntries = new Set(['.DS_Store', 'Thumbs.db']);

function ensureExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function shouldCopy(sourcePath) {
  return !ignoredEntries.has(path.basename(sourcePath));
}

function compileTypeScript() {
  console.log('Compiling TypeScript files...');

  // Compile src/types and src/utils
  execSync(
    'npx tsc src/types/index.ts src/utils/yaml-loader.ts src/utils/performance.ts src/utils/cache.ts --outDir src --target ES2020 --module commonjs --esModuleInterop --skipLibCheck --forceConsistentCasingInFileNames --allowJs',
    {
      cwd: projectRoot,
      stdio: 'inherit',
    }
  );

  // Copy src to chrome-extension/shared/src temporarily
  const tempSrcDir = path.join(sourceDir, 'shared', 'src');
  const planCommandTsPath = path.join(sourceDir, 'shared', 'plan-command.ts');
  const originalPlanCommandTs = fs.readFileSync(planCommandTsPath, 'utf8');
  if (fs.existsSync(tempSrcDir)) {
    fs.rmSync(tempSrcDir, { recursive: true, force: true });
  }
  try {
    fs.cpSync(path.join(projectRoot, 'src'), tempSrcDir, { recursive: true });

    // Temporarily update plan-command.ts imports
    let planCommandTsContent = originalPlanCommandTs;
  planCommandTsContent = planCommandTsContent
    .replace(
      "import { Task, FocusPlan, PlanPreset } from '../../src/types';",
      "import { Task, FocusPlan, PlanPreset } from './src/types';"
    )
    .replace(
      "import { loadPlanPresets, getPlanPresetByName } from '../../src/utils/yaml-loader';",
      "import { loadPlanPresets, getPlanPresetByName } from './src/utils/yaml-loader';"
    )
    .replace(
      "import { cyrb53, debounce as makeDebounce } from '../../src/utils/performance';",
      "import { cyrb53, debounce as makeDebounce } from './src/utils/performance';"
    )
    .replace(
      "import { Cache } from '../../src/utils/cache';",
      "import { Cache } from './src/utils/cache';"
    );
  fs.writeFileSync(planCommandTsPath, planCommandTsContent);

  // Compile plan-command.ts
  execSync(
    'npx tsc chrome-extension/shared/plan-command.ts chrome-extension/shared/src/types/index.ts chrome-extension/shared/src/utils/yaml-loader.ts --outDir chrome-extension/shared --target ES2020 --module commonjs --esModuleInterop --skipLibCheck --forceConsistentCasingInFileNames --allowJs',
    {
      cwd: projectRoot,
      stdio: 'inherit',
    }
  );

  // Move compiled plan-command.js up if needed
  const nestedPlanCommandJs = path.join(
    sourceDir,
    'shared',
    'chrome-extension',
    'shared',
    'plan-command.js'
  );
  if (fs.existsSync(nestedPlanCommandJs)) {
    fs.renameSync(nestedPlanCommandJs, path.join(sourceDir, 'shared', 'plan-command.js'));
    fs.rmSync(path.join(sourceDir, 'shared', 'chrome-extension'), { recursive: true, force: true });
  }

  } finally {
    // Never leave generated source files or rewritten imports after a failed build.
    fs.writeFileSync(planCommandTsPath, originalPlanCommandTs);
    fs.rmSync(tempSrcDir, { recursive: true, force: true });
  }

  console.log('TypeScript compiled successfully!');
}

function stageChromeExtension() {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Chrome extension source not found: ${sourceDir}`);
  }

  compileTypeScript();

  ensureExists(path.dirname(targetDir));
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: shouldCopy,
  });

  // plan-command.js is compiled with local ./src imports for the extension.
  // Include those runtime dependencies in the staged package.
  fs.cpSync(path.join(projectRoot, 'src'), path.join(targetDir, 'shared', 'src'), {
    recursive: true,
    filter: shouldCopy,
  });

  // Keep the source copy usable by Node-based tests after staging. The staged
  // copy above intentionally retains its local ./src imports.
  const sourcePlanCommandJs = path.join(sourceDir, 'shared', 'plan-command.js');
  if (fs.existsSync(sourcePlanCommandJs)) {
    const sourcePlanCommandJsContent = fs
      .readFileSync(sourcePlanCommandJs, 'utf8')
      .replace(/require\((['"])\.\/src\/utils\/yaml-loader\1\)/g, 'require("../../src/utils/yaml-loader")')
      .replace(/require\((['"])\.\/src\/utils\/performance\1\)/g, 'require("../../src/utils/performance")')
      .replace(/require\((['"])\.\/src\/utils\/cache\1\)/g, 'require("../../src/utils/cache")');
    fs.writeFileSync(sourcePlanCommandJs, sourcePlanCommandJsContent);
  }

  console.log(`Staged Chrome extension to ${targetDir}`);
}

stageChromeExtension();
