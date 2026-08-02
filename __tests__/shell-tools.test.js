const { shellTools } = require('../src/modules/shell-tools');

describe('ShellTools', () => {
  describe('detectPlatform', () => {
    test('should detect platform correctly', () => {
      const platform = shellTools.detectPlatform();
      expect(['linux', 'macos', 'windows']).toContain(platform);
    });
  });

  describe('generateScript', () => {
    test('should generate bash script', () => {
      const script = shellTools.generateScript(['echo hello', 'ls -la'], 'bash');
      expect(script).toContain('#!/bin/bash');
      expect(script).toContain('echo hello');
    });

    test('should generate PowerShell script', () => {
      const script = shellTools.generateScript(['Write-Host hello'], 'powershell');
      expect(script).toContain('# PowerShell script');
    });

    test('should generate cmd script', () => {
      const script = shellTools.generateScript(['echo hello'], 'cmd');
      expect(script).toContain('@echo off');
    });
  });

  describe('generateRemoteCommand', () => {
    test('should generate ssh command with private key', () => {
      const config = {
        host: 'example.com',
        port: 22,
        username: 'user',
        privateKeyPath: '/path/to/key',
      };
      const command = shellTools.generateRemoteCommand(config, 'ls -la');
      expect(command).toContain('ssh -i /path/to/key');
      expect(command).toContain('user@example.com');
      expect(command).toContain('"ls -la"');
    });

    test('should generate ssh command without private key', () => {
      const config = {
        host: 'example.com',
        port: 22,
        username: 'user',
      };
      const command = shellTools.generateRemoteCommand(config, 'uptime');
      expect(command).toContain('ssh -p 22');
    });
  });

  describe('environment variables', () => {
    test('should generate environment variables', () => {
      const envVars = shellTools.generateEnvironmentVariables({
        NODE_ENV: 'production',
        API_KEY: 'secret',
      });
      expect(envVars['NODE_ENV']).toBe('production');
      expect(envVars['API_KEY']).toBe('secret');
    });

    test('should generate export commands for bash', () => {
      const commands = shellTools.generateExportCommands({ PATH: '/usr/bin' }, 'bash');
      expect(commands).toContain('export PATH="/usr/bin"');
    });

    test('should generate export commands for PowerShell', () => {
      const commands = shellTools.generateExportCommands({ PATH: 'C:\\\\bin' }, 'powershell');
      expect(commands).toContain('$env:PATH');
    });

    test('should validate environment variable names', () => {
      const result = shellTools.validateEnvironmentVariables({ 'INVALID-NAME': 'value' });
      expect(result.valid).toBe(false);
    });

    test('should merge environment variables', () => {
      const base = { A: '1' };
      const overrides = { A: '2', B: '3' };
      const merged = shellTools.mergeEnvironmentVariables(base, overrides);
      expect(merged['A']).toBe('2');
      expect(merged['B']).toBe('3');
    });
  });

  describe('generateLoadEnvFileCommand', () => {
    test('should generate source command for bash', () => {
      const command = shellTools.generateLoadEnvFileCommand('.env', 'bash');
      expect(command).toBe('source .env');
    });
  });
});
