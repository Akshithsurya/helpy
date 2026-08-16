import { logger } from '../utils/logger';

export type CompilerType = 'gcc' | 'clang' | 'msvc';

export interface CompilerConfig {
  type: CompilerType;
  path: string;
  version: string;
  flags: string[];
  standard: string;
}

export interface BuildConfig {
  compiler: CompilerConfig;
  sourceFiles: string[];
  outputFile: string;
  includeDirs: string[];
  libraryDirs: string[];
  libraries: string[];
  debugBuild: boolean;
}

export interface MemoryLeakReport {
  hasLeaks: boolean;
  summary: string;
  details: string[];
}

export class CppTools {
  private defaultConfigs: Record<CompilerType, CompilerConfig> = {
    gcc: {
      type: 'gcc',
      path: 'g++',
      version: '11.0.0',
      flags: ['-Wall', '-Wextra'],
      standard: 'c++17'
    },
    clang: {
      type: 'clang',
      path: 'clang++',
      version: '14.0.0',
      flags: ['-Wall', '-Wextra'],
      standard: 'c++17'
    },
    msvc: {
      type: 'msvc',
      path: 'cl',
      version: '19.0',
      flags: ['/W4'],
      standard: 'c++17'
    }
  };

  getCompilerConfig(type: CompilerType): CompilerConfig {
    logger.info(`Getting compiler config for ${type}`);
    return { ...this.defaultConfigs[type] };
  }

  setCompilerConfig(type: CompilerType, config: Partial<CompilerConfig>): void {
    logger.info(`Updating compiler config for ${type}`, config);
    this.defaultConfigs[type] = { ...this.defaultConfigs[type], ...config };
  }

  createBuildConfig(
    compilerType: CompilerType,
    sourceFiles: string[],
    outputFile: string
  ): BuildConfig {
    logger.info(`Creating build config for ${compilerType}`, { sourceFiles, outputFile });
    return {
      compiler: this.getCompilerConfig(compilerType),
      sourceFiles,
      outputFile,
      includeDirs: [],
      libraryDirs: [],
      libraries: [],
      debugBuild: true
    };
  }

  generateCompileCommand(config: BuildConfig): string {
    logger.debug('Generating compile command', config);
    const { compiler, sourceFiles, outputFile, includeDirs, libraryDirs, libraries, debugBuild } = config;
    
    let command = compiler.path;
    
    command += ` -std=${compiler.standard}`;
    
    compiler.flags.forEach(flag => {
      command += ` ${flag}`;
    });
    
    if (debugBuild) {
      if (compiler.type === 'msvc') {
        command += ' /Zi /Od';
      } else {
        command += ' -g -O0';
      }
    }
    
    includeDirs.forEach(dir => {
      if (compiler.type === 'msvc') {
        command += ` /I${dir}`;
      } else {
        command += ` -I${dir}`;
      }
    });
    
    libraryDirs.forEach(dir => {
      if (compiler.type === 'msvc') {
        command += ` /LIBPATH:${dir}`;
      } else {
        command += ` -L${dir}`;
      }
    });
    
    libraries.forEach(lib => {
      if (compiler.type === 'msvc') {
        command += ` ${lib}.lib`;
      } else {
        command += ` -l${lib}`;
      }
    });
    
    if (compiler.type === 'msvc') {
      command += ` /Fe:${outputFile}`;
    } else {
      command += ` -o ${outputFile}`;
    }
    
    sourceFiles.forEach(file => {
      command += ` ${file}`;
    });
    
    logger.info('Generated compile command', { command });
    return command;
  }

  enableMemoryLeakDetection(config: BuildConfig): BuildConfig {
    logger.info('Enabling memory leak detection', config);
    const newConfig = { ...config };
    
    if (config.compiler.type !== 'msvc') {
      newConfig.compiler.flags = [...config.compiler.flags, '-fsanitize=address'];
    }
    
    return newConfig;
  }

  generateMemoryLeakCheckCommand(binaryPath: string): string {
    logger.info('Generating memory leak check command', { binaryPath });
    return `valgrind --leak-check=full --show-leak-kinds=all ${binaryPath}`;
  }

  parseMemoryLeakReport(valgrindOutput: string): MemoryLeakReport {
    logger.debug('Parsing memory leak report');
    const hasLeaks = valgrindOutput.includes('definitely lost') || 
                     valgrindOutput.includes('indirectly lost');
    
    const lines = valgrindOutput.split('\n');
    const details = lines.filter(line => 
      line.includes('lost') || line.includes('ERROR')
    );
    
    return {
      hasLeaks,
      summary: hasLeaks ? 'Memory leaks detected' : 'No memory leaks found',
      details
    };
  }

  batchCompile(
    sourcePatterns: string[],
    outputDir: string,
    compilerType: CompilerType = 'gcc'
  ): BuildConfig[] {
    logger.info('Batch compiling source files', { sourcePatterns, outputDir, compilerType });
    const configs: BuildConfig[] = [];
    
    sourcePatterns.forEach((pattern, index) => {
      const sourceFiles = [pattern];
      const outputFile = `${outputDir}/output_${index}`;
      configs.push(this.createBuildConfig(compilerType, sourceFiles, outputFile));
    });
    
    return configs;
  }
}

export const cppTools = new CppTools();
