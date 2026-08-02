console.log('Testing import...');

try {
  const planCommand = require('./chrome-extension/shared/plan-command');
  console.log('Import successful!');
  console.log('Available exports:', Object.keys(planCommand));

  // Test loadPlanPresets
  const presets = planCommand.listPresets();
  console.log(
    'Loaded presets:',
    presets.map((p) => p.name)
  );
} catch (error) {
  console.error('Import failed:', error);
  console.error(error.stack);
}
