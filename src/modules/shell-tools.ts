import { logger } from '../utils/logger';

export type PlatformType = 'linux' | 'macos' | 'windows';
export type ShellType = 'bash' | 'powershell' | 'cmd';

export interface RemoteServerConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  password?: string;
}

export interface EnvironmentVariables {
  [key: string]: string;
}

export class ShellTools {
  detectPlatform(): PlatformType {
    const platform = process.platform;
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'macos';
    return 'linux';
  }

  detectShell(): ShellType {
    const platform = this.detectPlatform();
    if (platform === 'windows') {
      return 'powershell';
    }
    return 'bash';
  }

  generateScript(
    commands: string[],
    shellType: ShellType = this.detectShell()
  ): string {
    logger.info(`Generating ${shellType} script`, commands);

    if (shellType === 'bash') {
      return this.generateBashScript(commands);
    } else if (shellType === 'powershell') {
      return this.generatePowerShellScript(commands);
    } else {
      return this.generateCmdScript(commands);
    }
  }

  private generateBashScript(commands: string[]): string {
    const shebang = '#!/bin/bash\n\n';
    const body = commands.join('\n');
    return shebang + body + '\n';
  }

  private generatePowerShellScript(commands: string[]): string {
    const header = '# PowerShell script\n\n';
    const body = commands.map(cmd => 
      cmd.includes('$') ? cmd : cmd
    ).join('\n');
    return header + body + '\n';
  }

  private generateCmdScript(commands: string[]): string {
    const header = '@echo off\n\n';
    const body = commands.join('\n');
    return header + body + '\n';
  }

  generateRemoteCommand(
    config: RemoteServerConfig,
    command: string
  ): string {
    logger.info('Generating remote command', { config, command });

    if (config.privateKeyPath) {
      return `ssh -i ${config.privateKeyPath} -p ${config.port} ${config.username}@${config.host} "${command}"`;
    }
    return `ssh -p ${config.port} ${config.username}@${config.host} "${command}"`;
  }

  generateEnvironmentVariables(envVars: EnvironmentVariables): EnvironmentVariables {
    return { ...envVars };
  }

  generateExportCommands(envVars: EnvironmentVariables, shellType: ShellType = this.detectShell()): string {
    logger.info('Generating environment variable commands', envVars);

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

  generateLoadEnvFileCommand(
    filePath: string,
    shellType: ShellType = this.detectShell()
  ): string {
    logger.info('Generating load env file command', filePath);
    if (shellType === 'bash') {
      return `source ${filePath}`;
    } else if (shellType === 'powershell') {
      return `Get-Content ${filePath} | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }`;
    } else {
      return `call ${filePath}`;
    }
  }

  validateEnvironmentVariables(envVars: EnvironmentVariables): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    Object.keys(envVars).forEach(key => {
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
        errors.push(`Invalid environment variable name: ${key}`);
      }
    });

    return { valid: errors.length === 0, errors };
  }

  mergeEnvironmentVariables(
    base: EnvironmentVariables,
    overrides: EnvironmentVariables
  ): EnvironmentVariables {
    return { ...base, ...overrides };
  }
}

export const shellTools = new ShellTools();
