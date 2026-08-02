const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const wasmDir = path.join(__dirname, '..', 'src', 'wasm');
const buildDir = path.join(wasmDir, 'build');
const cppFile = path.join(wasmDir, 'plan_calculator.cpp');
const outputFile = path.join(buildDir, 'plan_calculator.js');

// Ensure build directory exists
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

console.log('Checking if Emscripten is available...');
try {
  execSync('emcc --version', { stdio: 'inherit' });
} catch (e) {
  console.warn('⚠️ Emscripten (emcc) not found in PATH.');
  console.warn('Skipping WASM build - will use JavaScript fallback implementation.');
  console.warn(
    'To enable WASM, install Emscripten SDK: https://emscripten.org/docs/getting_started/downloads.html'
  );
  process.exit(0); // Exit with success to not break build process
}

console.log('Compiling C++ to WASM...');
try {
  const command = [
    'emcc',
    cppFile,
    '-o',
    outputFile,
    '-s',
    'EXPORTED_RUNTIME_METHODS=["ccall", "cwrap", "UTF8ToString", "stringToUTF8"]',
    '-s',
    'EXPORTED_FUNCTIONS=["_calculate_num_chunks", "_calculate_chunk_duration", "_generate_task_title", "_free_string", "_malloc", "_free", "_validate_plan", "_calculate_num_breaks", "_calculate_total_duration_with_breaks", "_generate_full_plan_json", "_optimize_chunk_size", "_optimize_break_duration", "_calculate_productivity_score", "_validate_dependencies", "_topological_sort_check", "_get_work_duration_for_mode", "_get_break_duration_for_mode", "_get_long_break_for_mode", "_get_long_break_interval_for_mode", "_generate_timer_plan", "_generate_pomodoro_plan", "_suggest_total_duration", "_generate_optimization_suggestion", "_calculate_productivity_trend", "_find_optimal_work_hour", "_generate_behavior_insights", "_fast_average", "_fast_median", "_fast_std_dev", "_parse_plan_arguments_json", "_analyze_plan_smart", "_validate_task_dependencies", "_optimize_plan_times", "_create_full_plan_json", "_generate_smart_plan_recommendation"]',
    '-s',
    'MODULARIZE=1',
    '-s',
    'EXPORT_ES6=1',
    '-O3',
    '-flto',
    '--closure=1',
    '-s',
    'ENVIRONMENT=web,worker,node',
    '-s',
    'ALLOW_MEMORY_GROWTH=1',
  ].join(' ');

  console.log('Running command:', command);
  execSync(command, { stdio: 'inherit' });

  console.log('✅ WASM compilation successful!');
  console.log('Output files:', outputFile, outputFile.replace('.js', '.wasm'));
} catch (e) {
  console.error('❌ WASM compilation failed:', e.message);
  console.warn('Will use JavaScript fallback implementation.');
  process.exit(0); // Exit with success to not break build process
}
