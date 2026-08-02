const { cppTools } = require('../src/modules/cpp-tools');

describe('CppTools', () => {
  describe('getCompilerConfig', () => {
    test('should return default gcc config', () => {
      const config = cppTools.getCompilerConfig('gcc');
      expect(config.type).toBe('gcc');
      expect(config.path).toBe('g++');
      expect(config.standard).toBe('c++17');
    });

    test('should return default clang config', () => {
      const config = cppTools.getCompilerConfig('clang');
      expect(config.type).toBe('clang');
      expect(config.path).toBe('clang++');
    });

    test('should return default msvc config', () => {
      const config = cppTools.getCompilerConfig('msvc');
      expect(config.type).toBe('msvc');
    });
  });

  describe('setCompilerConfig', () => {
    test('should update compiler config', () => {
      cppTools.setCompilerConfig('gcc', { version: '12.0.0' });
      const config = cppTools.getCompilerConfig('gcc');
      expect(config.version).toBe('12.0.0');
    });
  });

  describe('createBuildConfig', () => {
    test('should create valid build config', () => {
      const config = cppTools.createBuildConfig('gcc', ['main.cpp', 'utils.cpp'], 'output');
      expect(config.compiler.type).toBe('gcc');
      expect(config.sourceFiles).toEqual(['main.cpp', 'utils.cpp']);
      expect(config.outputFile).toBe('output');
    });
  });

  describe('generateCompileCommand', () => {
    test('should generate gcc compile command', () => {
      const buildConfig = cppTools.createBuildConfig('gcc', ['main.cpp'], 'program');
      const command = cppTools.generateCompileCommand(buildConfig);
      expect(command).toContain('g++');
      expect(command).toContain('main.cpp');
      expect(command).toContain('-o program');
    });

    test('should include debug flags in debug build', () => {
      const buildConfig = cppTools.createBuildConfig('gcc', ['main.cpp'], 'program');
      buildConfig.debugBuild = true;
      const command = cppTools.generateCompileCommand(buildConfig);
      expect(command).toContain('-g');
    });
  });

  describe('memory leak detection', () => {
    test('should enable memory leak detection', () => {
      const config = cppTools.createBuildConfig('gcc', ['main.cpp'], 'program');
      const newConfig = cppTools.enableMemoryLeakDetection(config);
      expect(newConfig.compiler.flags).toContain('-fsanitize=address');
    });

    test('should generate valgrind command', () => {
      const command = cppTools.generateMemoryLeakCheckCommand('program');
      expect(command).toContain('valgrind');
      expect(command).toContain('program');
    });

    test('should parse memory leak report correctly', () => {
      const report = cppTools.parseMemoryLeakReport('No leaks found');
      expect(report.hasLeaks).toBe(false);
    });
  });

  describe('batchCompile', () => {
    test('should create multiple build configs', () => {
      const configs = cppTools.batchCompile(['src1.cpp', 'src2.cpp'], 'build', 'gcc');
      expect(configs.length).toBe(2);
    });
  });
});
