'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.shellTools = exports.ShellTools = void 0;
const logger_1 = require('../utils/logger');
class ShellTools {
  detectPlatform() {
    const platform = process.platform;
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'macos';
    return 'linux';
  }
  detectShell() {
    const platform = this.detectPlatform();
    if (platform === 'windows') {
      return 'powershell';
    }
    return 'bash';
  }
  generateScript(commands, shellType = this.detectShell()) {
    logger_1.logger.info(`Generating ${shellType} script`, commands);
    if (shellType === 'bash') {
      return this.generateBashScript(commands);
    } else if (shellType === 'powershell') {
      return this.generatePowerShellScript(commands);
    } else {
      return this.generateCmdScript(commands);
    }
  }
  generateBashScript(commands) {
    const shebang = '#!/bin/bash\n\n';
    const body = commands.join('\n');
    return shebang + body + '\n';
  }
  generatePowerShellScript(commands) {
    const header = '# PowerShell script\n\n';
    const body = commands.map((cmd) => (cmd.includes('$') ? cmd : cmd)).join('\n');
    return header + body + '\n';
  }
  generateCmdScript(commands) {
    const header = '@echo off\n\n';
    const body = commands.join('\n');
    return header + body + '\n';
  }
  generateRemoteCommand(config, command) {
    logger_1.logger.info('Generating remote command', { config, command });
    if (config.privateKeyPath) {
      return `ssh -i ${config.privateKeyPath} -p ${config.port} ${config.username}@${config.host} "${command}"`;
    }
    return `ssh -p ${config.port} ${config.username}@${config.host} "${command}"`;
  }
  generateEnvironmentVariables(envVars) {
    return { ...envVars };
  }
  generateExportCommands(envVars, shellType = this.detectShell()) {
    logger_1.logger.info('Generating environment variable commands', envVars);
    if (shellType === 'bash') {
      return Object.entries(envVars)
        .map(([key, value]) => `export ${key}="${value}"`)
        .join('\n');
    } else if (shellType === 'powershell') {
      return Object.entries(envVars)
        .map(([key, value]) => `$env:${key} = "${value}"`)
        .join('\n');
    } else {
      return Object.entries(envVars)
        .map(([key, value]) => `set ${key}=${value}`)
        .join('\n');
    }
  }
  generateLoadEnvFileCommand(filePath, shellType = this.detectShell()) {
    logger_1.logger.info('Generating load env file command', filePath);
    if (shellType === 'bash') {
      return `source ${filePath}`;
    } else if (shellType === 'powershell') {
      return `Get-Content ${filePath} | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }`;
    } else {
      return `call ${filePath}`;
    }
  }
  validateEnvironmentVariables(envVars) {
    const errors = [];
    Object.keys(envVars).forEach((key) => {
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
        errors.push(`Invalid environment variable name: ${key}`);
      }
    });
    return { valid: errors.length === 0, errors };
  }
  mergeEnvironmentVariables(base, overrides) {
    return { ...base, ...overrides };
  }
}
exports.ShellTools = ShellTools;
exports.shellTools = new ShellTools();
