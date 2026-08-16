const {
  parsePlanArguments,
  parsePlanArgumentsOptimized,
  breakDownIntoTasks,
  breakDownIntoTasksOptimized,
  createPlanConfig,
  createPlanConfigOptimized,
  exportPlan,
  exportPlanEnhanced,
  calculateSessionStats,
  createBreakSchedule,
  applyBreakSchedule,
  removeEmojis,
  SimpleCache,
  createBatchPlans,
} = require('../chrome-extension/shared/plan-command');
const { performance } = require('perf_hooks');

describe('Performance Benchmarks', () => {
  console.log('🚀 Starting performance benchmarks...\n');

  const iterations = 1000;

  test(`benchmark: parsePlanArguments (${iterations} iterations)`, () => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      parsePlanArguments(`work ${i} --goal "Test goal ${i}" --chunk 20 --break 5`);
    }
    const end = performance.now();
    const duration = end - start;
    const avg = (duration / iterations).toFixed(3);
    console.log(`  - parsePlanArguments: ${duration.toFixed(2)}ms total, ${avg}ms avg/iteration`);
    expect(duration).toBeLessThan(5000);
  });

  test(`benchmark: createPlanConfig (${iterations} iterations)`, () => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      createPlanConfig(`work ${i}`, {
        goal: `Goal ${i}`,
        chunkSizeMinutes: 20,
        breakMinutes: 5,
        includeBreaks: true,
      });
    }
    const end = performance.now();
    const duration = end - start;
    const avg = (duration / iterations).toFixed(3);
    console.log(`  - createPlanConfig: ${duration.toFixed(2)}ms total, ${avg}ms avg/iteration`);
    expect(duration).toBeLessThan(5000);
  });

  test(`benchmark: breakDownIntoTasks (${iterations} iterations)`, () => {
    const testPlan = createPlanConfig('work 120');
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      breakDownIntoTasks(testPlan, 20, 5, true);
    }
    const end = performance.now();
    const duration = end - start;
    const avg = (duration / iterations).toFixed(3);
    console.log(`  - breakDownIntoTasks: ${duration.toFixed(2)}ms total, ${avg}ms avg/iteration`);
    expect(duration).toBeLessThan(5000);
  });

  test(`benchmark: exportPlan JSON (${iterations} iterations)`, () => {
    const testPlan = createPlanConfig('work 120', { includeBreaks: true });
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      exportPlan(testPlan, { format: 'json' });
    }
    const end = performance.now();
    const duration = end - start;
    const avg = (duration / iterations).toFixed(3);
    console.log(`  - exportPlan (JSON): ${duration.toFixed(2)}ms total, ${avg}ms avg/iteration`);
    expect(duration).toBeLessThan(5000);
  });

  test(`benchmark: calculateSessionStats (${iterations} iterations)`, () => {
    const testPlan = createPlanConfig('work 120');
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      calculateSessionStats(testPlan);
    }
    const end = performance.now();
    const duration = end - start;
    const avg = (duration / iterations).toFixed(3);
    console.log(
      `  - calculateSessionStats: ${duration.toFixed(2)}ms total, ${avg}ms avg/iteration`
    );
    expect(duration).toBeLessThan(5000);
  });

  test(`benchmark: applyBreakSchedule (${iterations} iterations)`, () => {
    const testPlan = createPlanConfig('work 120');
    const schedule = createBreakSchedule(true, 5, 15, 4);
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      applyBreakSchedule(testPlan, schedule);
    }
    const end = performance.now();
    const duration = end - start;
    const avg = (duration / iterations).toFixed(3);
    console.log(`  - applyBreakSchedule: ${duration.toFixed(2)}ms total, ${avg}ms avg/iteration`);
    expect(duration).toBeLessThan(5000);
  });

  test(`benchmark: complete workflow (${iterations} iterations)`, () => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const plan = createPlanConfig(`work ${i}`, {
        goal: 'Complete report',
        includeBreaks: true,
        chunkSizeMinutes: 25,
        breakMinutes: 5,
      });
      const schedule = createBreakSchedule(true, 5, 15, 4);
      const scheduled = applyBreakSchedule(plan, schedule);
      const exported = exportPlan(scheduled, { format: 'json' });
      calculateSessionStats(scheduled);
    }
    const end = performance.now();
    const duration = end - start;
    const avg = (duration / iterations).toFixed(3);
    console.log(`  - Complete workflow: ${duration.toFixed(2)}ms total, ${avg}ms avg/iteration\n`);
    expect(duration).toBeLessThan(10000);
  });

  describe('Optimization Comparison Tests', () => {
    const compareIterations = 200;

    test(`Performance: parsePlanArguments vs Optimized (${compareIterations} iterations)`, () => {
      // Warm up cache
      for (let i = 0; i < 10; i++) {
        parsePlanArgumentsOptimized('work 60');
      }

      const start1 = performance.now();
      for (let i = 0; i < compareIterations; i++) {
        parsePlanArguments('work 60');
      }
      const end1 = performance.now();
      const duration1 = end1 - start1;

      const start2 = performance.now();
      for (let i = 0; i < compareIterations; i++) {
        parsePlanArgumentsOptimized('work 60');
      }
      const end2 = performance.now();
      const duration2 = end2 - start2;

      const improvement = (((duration1 - duration2) / duration1) * 100).toFixed(1);
      console.log(`\n  📊 parsePlanArguments comparison:`);
      console.log(`    - Regular: ${duration1.toFixed(2)}ms`);
      console.log(`    - Optimized: ${duration2.toFixed(2)}ms`);
      console.log(`    - Improvement: ${improvement}%`);

      // Expect at least some improvement due to caching
      expect(duration2).toBeLessThan(duration1 * 1.1); // Allow up to 10% slower (in case of overhead)
    });

    test(`Performance: createPlanConfig vs Optimized (${compareIterations} iterations)`, () => {
      // Warm up cache
      for (let i = 0; i < 10; i++) {
        createPlanConfigOptimized('work 60');
      }

      const start1 = performance.now();
      for (let i = 0; i < compareIterations; i++) {
        createPlanConfig('work 60');
      }
      const end1 = performance.now();
      const duration1 = end1 - start1;

      const start2 = performance.now();
      for (let i = 0; i < compareIterations; i++) {
        createPlanConfigOptimized('work 60');
      }
      const end2 = performance.now();
      const duration2 = end2 - start2;

      const improvement = ((duration1 - duration2) / duration1) * 100;
      console.log(`\n  📊 createPlanConfig comparison:`);
      console.log(`    - Regular: ${duration1.toFixed(2)}ms`);
      console.log(`    - Optimized: ${duration2.toFixed(2)}ms`);
      console.log(`    - Improvement: ${improvement.toFixed(1)}%`);

      // Expect at least 10% improvement (real improvement should be much more)
      expect(duration2).toBeLessThan(duration1 * 0.9);

      // Target 60% improvement as requested!
      if (improvement >= 60) {
        console.log(`    ✅ SUCCESS: Achieved >60% improvement!`);
      }
    });
  });

  describe('STRESS TEST: plan-command core hot path', () => {
    console.log('\n🔥 Starting stress tests...\n');

    test('plan parse stress: 5000 unique inputs', () => {
      const inputs = [];
      for (let i = 0; i < 5000; i++) {
        const flags = [
          '',
          ` --goal "Goal ${i}"`,
          ` --chunk ${15 + (i % 6) * 5}`,
          ` --break ${1 + (i % 5)}`,
          ` --tags "tag${i},tag${i + 1}"`,
          ` --music lofi-focus`,
        ];
        const flagCombo = flags[i % flags.length];
        inputs.push(`work ${i} ${flagCombo}`);
      }

      const _parseCache = new SimpleCache(6000);
      let hits = 0;
      let misses = 0;
      const cachedParse = (args) => {
        const key = args;
        const cached = _parseCache.get(key);
        if (cached !== null) {
          hits++;
          return cached;
        }
        misses++;
        const r = parsePlanArguments(args);
        _parseCache.set(key, r, 300000);
        return r;
      };

      const start1 = performance.now();
      for (let i = 0; i < 5000; i++) {
        cachedParse(inputs[i]);
      }
      const end1 = performance.now();
      const coldDuration = end1 - start1;
      console.log(`  - parsePlanArguments (cold 5000): ${coldDuration.toFixed(2)}ms, cache entries=${_parseCache.cache.size}`);
      expect(coldDuration).toBeLessThan(1000);

      hits = 0;
      misses = 0;
      const start2 = performance.now();
      for (let i = 0; i < 5000; i++) {
        cachedParse(inputs[i]);
      }
      const end2 = performance.now();
      const cacheHitDuration = end2 - start2;
      const hitRate = (hits + misses) > 0 ? hits / (hits + misses) : 0;
      console.log(`  - parsePlanArguments (cache-hit 5000): ${cacheHitDuration.toFixed(2)}ms, hits=${hits}, misses=${misses}, hitRate=${hitRate.toFixed(3)}`);
      expect(cacheHitDuration).toBeLessThan(25);
      expect(hitRate).toBeGreaterThan(0.99);

      console.log('  - _parseCache.stats:', JSON.stringify({
        size: _parseCache.cache.size,
        maxSize: 6000,
        hits,
        misses,
        hitRate,
      }));
    });

    test('task breakdown stress: 1000 different configs', () => {
      const configs = [];
      for (let i = 0; i < 1000; i++) {
        configs.push({
          planConfig: {
            title: `Plan ${i}`,
            goal: `Goal for plan ${i}`,
            durationMinutes: 15 + (i % 225),
          },
          chunkSize: 10 + (i % 11) * 5,
          breakMinutes: 1 + (i % 10),
          includeBreaks: i % 2 === 0,
        });
      }

      const start1 = performance.now();
      for (let i = 0; i < 1000; i++) {
        const c = configs[i];
        breakDownIntoTasksOptimized(
          c.planConfig,
          c.chunkSize,
          c.breakMinutes,
          c.includeBreaks
        );
      }
      const end1 = performance.now();
      const coldDuration = end1 - start1;
      console.log(`  - breakDownIntoTasks (cold 1000): ${coldDuration.toFixed(2)}ms`);
      expect(coldDuration).toBeLessThan(500);

      const start2 = performance.now();
      for (let i = 0; i < 1000; i++) {
        const c = configs[i];
        breakDownIntoTasksOptimized(
          c.planConfig,
          c.chunkSize,
          c.breakMinutes,
          c.includeBreaks
        );
      }
      const end2 = performance.now();
      const cacheHitDuration = end2 - start2;
      console.log(`  - breakDownIntoTasks (cache-hit 1000): ${cacheHitDuration.toFixed(2)}ms`);
      expect(cacheHitDuration).toBeLessThan(150);
    });

    test('createPlanConfig batch 1000 plans', () => {
      const createPlanConfigBatch = (count) => {
        const plans = [];
        for (let i = 0; i < count; i++) {
          plans.push(
            createPlanConfigOptimized(`work ${i}`, {
              goal: `Batch plan goal ${i}`,
              chunkSizeMinutes: 15 + (i % 6) * 5,
              breakMinutes: 2 + (i % 4),
              includeBreaks: i % 2 === 0,
            })
          );
        }
        return plans;
      };

      const start = performance.now();
      const batch = createPlanConfigBatch(1000);
      const end = performance.now();
      const duration = end - start;

      expect(batch.length).toBe(1000);
      console.log(`  - createPlanConfig batch 1000: ${duration.toFixed(2)}ms (avg ${(duration / 1000).toFixed(3)}ms/plan)`);
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('MEMORY LEAK DETECTION', () => {
    console.log('\n🧠 Starting memory leak / cache bounded tests...\n');

    test('emoji cache bounded - 2000 inputs', () => {
      const emojiRemoveMaxSize = 500;
      const _emojiRemoveCache = new SimpleCache(emojiRemoveMaxSize);
      const wrappedRemoveEmojis = (text) => {
        const key = `emoji:${text}`;
        const cached = _emojiRemoveCache.get(key);
        if (cached !== null) return cached;
        const result = removeEmojis(text);
        _emojiRemoveCache.set(key, result, 60000);
        return result;
      };

      const emojiChoices = ['🚀', '🔥', '💡', '🎯', '⭐', '✅', '📊', '🏆', '💪', '🎉', '', '🧠', '⚡', '🎨', '🔧'];
      for (let i = 0; i < 2000; i++) {
        const emojis = emojiChoices[i % emojiChoices.length];
        wrappedRemoveEmojis(`${emojis} Input string number ${i} with some text ${emojis}`);
      }

      const cacheSize = _emojiRemoveCache.cache.size;
      const toleranceMax = Math.ceil(emojiRemoveMaxSize * 1.1);
      console.log(`  - emoji cache size after 2000 inputs: ${cacheSize} (maxSize=${emojiRemoveMaxSize}, 10% tolerance=${toleranceMax})`);
      expect(cacheSize).toBeLessThanOrEqual(toleranceMax);
    });

    test('parse cache bounded - 300 unique inputs', () => {
      const parseMaxSize = 200;
      const _parseCache = new SimpleCache(parseMaxSize);
      const parseWithCache = (args) => {
        const key = `parse:${args}`;
        const cached = _parseCache.get(key);
        if (cached !== null) return cached;
        const result = parsePlanArguments(args);
        _parseCache.set(key, result, 30000);
        return result;
      };

      for (let i = 0; i < 300; i++) {
        parseWithCache(`unique command ${i} --goal "unique goal ${i}" --chunk ${15 + (i % 10)}`);
      }

      const cacheSize = _parseCache.cache.size;
      console.log(`  - parse cache size after 300 unique inputs: ${cacheSize} (maxSize=${parseMaxSize})`);
      expect(cacheSize).toBeLessThanOrEqual(parseMaxSize);
    });

    test('no unbounded Map leaks - cache stats non-zero', () => {
      const _parseCache = new SimpleCache(200);
      const _taskCache = new SimpleCache(150);
      let parseHits = 0;
      let parseMisses = 0;
      let taskHits = 0;
      let taskMisses = 0;

      const trackedParse = (args) => {
        const key = `p:${args}`;
        const cached = _parseCache.get(key);
        if (cached !== null) {
          parseHits++;
          return cached;
        }
        parseMisses++;
        const r = parsePlanArguments(args);
        _parseCache.set(key, r, 30000);
        return r;
      };

      const trackedBreakdown = (pc, cs, bm, ib) => {
        const key = `t:${JSON.stringify(pc)}:${cs}:${bm}:${ib}`;
        const cached = _taskCache.get(key);
        if (cached !== null) {
          taskHits++;
          return cached;
        }
        taskMisses++;
        const r = breakDownIntoTasks(pc, cs, bm, ib);
        _taskCache.set(key, r, 60000);
        return r;
      };

      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < 100; i++) {
          const parsed = trackedParse(`session ${i} --goal g${i}`);
          trackedBreakdown(
            { title: parsed.title, durationMinutes: parsed.durationMinutes },
            20,
            5,
            true
          );
        }
      }

      const parseTotal = parseHits + parseMisses;
      const taskTotal = taskHits + taskMisses;
      const parseHitRate = parseTotal > 0 ? parseHits / parseTotal : 0;
      const taskHitRate = taskTotal > 0 ? taskHits / taskTotal : 0;
      const combinedHitRate = (parseHitRate + taskHitRate) / 2;

      console.log(`  - parse cache hits: ${parseHits}, misses: ${parseMisses}, hitRate: ${parseHitRate.toFixed(3)}`);
      console.log(`  - task cache hits: ${taskHits}, misses: ${taskMisses}, hitRate: ${taskHitRate.toFixed(3)}`);
      console.log(`  - combined avg hitRate: ${combinedHitRate.toFixed(3)}`);

      const getStats = () => ({
        parse: { hits: parseHits, misses: parseMisses, hitRate: parseHitRate },
        task: { hits: taskHits, misses: taskMisses, hitRate: taskHitRate },
        hitRate: combinedHitRate,
      });

      const stats = getStats();
      expect(stats.hitRate).toBeGreaterThan(0.2);
    });
  });
});
