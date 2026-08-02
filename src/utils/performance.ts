interface MemorySnapshot {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  timestamp: number;
}

interface SampleEntry {
  timestamp: number;
  value: number;
}

interface FrameRateReport {
  fps: number;
  droppedFrames: number;
  totalFrames: number;
  jankCount: number;
}

interface FlameMark {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
}

type SampleMap = Map<string, SampleEntry[]>;

const MAX_SAMPLES_PER_MARK = 1000;
const SAMPLE_INTERVAL_MS = 10;
const JANK_THRESHOLD_MS = 50;
const FRAME_TIME_TARGET_MS = 16.67;

export class PerformanceMonitor {
  private marks: Map<string, number> = new Map();
  private samples: SampleMap = new Map();
  private sampleTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private flameMarks: FlameMark[] = [];
  private fpsHandle: number | null = null;
  private fpsLastFrameTime: number = 0;
  private fpsFrameCount: number = 0;
  private fpsDroppedFrames: number = 0;
  private fpsJankCount: number = 0;
  private fpsListeners: Array<(report: FrameRateReport) => void> = [];
  private fpsThresholdMs: number = JANK_THRESHOLD_MS;

  startMark(name: string): void {
    this.marks.set(name, performance.now());
  }

  endMark(name: string): number {
    const startTime = this.marks.get(name);
    if (startTime === undefined) {
      console.warn(`Mark "${name}" not found`);
      return 0;
    }
    const endTime = performance.now();
    const duration = endTime - startTime;
    this.marks.delete(name);
    this.flameMarks.push({ name, startTime, endTime, duration });
    if (this.flameMarks.length > 5000) {
      this.flameMarks.splice(0, this.flameMarks.length - 5000);
    }
    return duration;
  }

  getFlameMarks(): FlameMark[] {
    return this.flameMarks.slice();
  }

  clearFlameMarks(): void {
    this.flameMarks.length = 0;
  }

  measure<T>(name: string, fn: () => T): T {
    this.startMark(name);
    try {
      return fn();
    } finally {
      const duration = this.endMark(name);
      console.log(`[Performance] ${name}: ${duration.toFixed(2)}ms`);
    }
  }

  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.startMark(name);
    try {
      return await fn();
    } finally {
      const duration = this.endMark(name);
      console.log(`[Performance] ${name}: ${duration.toFixed(2)}ms`);
    }
  }

  startSampling(name: string, valueFn: () => number = performance.now.bind(performance)): void {
    if (this.sampleTimers.has(name)) {
      return;
    }
    if (!this.samples.has(name)) {
      this.samples.set(name, []);
    }
    const timer = setInterval(() => {
      const arr = this.samples.get(name)!;
      let value: number;
      try {
        value = valueFn();
      } catch {
        value = NaN;
      }
      arr.push({ timestamp: Date.now(), value });
      if (arr.length > MAX_SAMPLES_PER_MARK) {
        arr.splice(0, arr.length - MAX_SAMPLES_PER_MARK);
      }
    }, SAMPLE_INTERVAL_MS);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.sampleTimers.set(name, timer);
  }

  stopSampling(name: string): SampleEntry[] {
    const timer = this.sampleTimers.get(name);
    if (timer) {
      clearInterval(timer);
      this.sampleTimers.delete(name);
    }
    return (this.samples.get(name) || []).slice();
  }

  getSamples(name: string): SampleEntry[] {
    return (this.samples.get(name) || []).slice();
  }

  clearSamples(name?: string): void {
    if (name) {
      this.stopSampling(name);
      this.samples.delete(name);
    } else {
      for (const n of Array.from(this.sampleTimers.keys())) {
        this.stopSampling(n);
      }
      this.samples.clear();
    }
  }

  memorySnapshot(): MemorySnapshot | null {
    const perfMemory = (performance as unknown as { memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    } }).memory;
    if (!perfMemory) {
      return null;
    }
    return {
      usedJSHeapSize: perfMemory.usedJSHeapSize,
      totalJSHeapSize: perfMemory.totalJSHeapSize,
      jsHeapSizeLimit: perfMemory.jsHeapSizeLimit,
      timestamp: Date.now(),
    };
  }

  startFrameRateMonitor(
    onReport?: (report: FrameRateReport) => void,
    thresholdMs: number = JANK_THRESHOLD_MS
  ): void {
    if (this.fpsHandle !== null) {
      return;
    }
    this.fpsThresholdMs = thresholdMs;
    this.fpsLastFrameTime = performance.now();
    this.fpsFrameCount = 0;
    this.fpsDroppedFrames = 0;
    this.fpsJankCount = 0;
    if (onReport) {
      this.fpsListeners.push(onReport);
    }

    let reportAccumulator = 0;
    const tick = (now: number) => {
      this.fpsHandle = requestAnimationFrame(tick);
      const delta = now - this.fpsLastFrameTime;
      this.fpsLastFrameTime = now;
      this.fpsFrameCount++;
      if (delta > FRAME_TIME_TARGET_MS * 1.5) {
        this.fpsDroppedFrames += Math.round(delta / FRAME_TIME_TARGET_MS) - 1;
      }
      if (delta > this.fpsThresholdMs) {
        this.fpsJankCount++;
      }
      reportAccumulator += delta;
      if (reportAccumulator >= 1000) {
        const fps = (this.fpsFrameCount * 1000) / reportAccumulator;
        const report: FrameRateReport = {
          fps: Math.round(fps * 10) / 10,
          droppedFrames: this.fpsDroppedFrames,
          totalFrames: this.fpsFrameCount,
          jankCount: this.fpsJankCount,
        };
        for (const listener of this.fpsListeners) {
          try { listener(report); } catch { /* ignore */ }
        }
        reportAccumulator = 0;
        this.fpsFrameCount = 0;
      }
    };
    this.fpsHandle = requestAnimationFrame(tick);
  }

  stopFrameRateMonitor(): FrameRateReport {
    if (this.fpsHandle !== null) {
      cancelAnimationFrame(this.fpsHandle);
      this.fpsHandle = null;
    }
    this.fpsListeners.length = 0;
    return {
      fps: 0,
      droppedFrames: this.fpsDroppedFrames,
      totalFrames: this.fpsFrameCount,
      jankCount: this.fpsJankCount,
    };
  }

  aggregateStats(samples: SampleEntry[]): {
    count: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    if (samples.length === 0) return null;
    const values = samples.map(s => s.value).sort((a, b) => a - b);
    const count = values.length;
    const sum = values.reduce((a, b) => a + b, 0);
    const pct = (p: number) => values[Math.min(count - 1, Math.floor(count * p))];
    return {
      count,
      min: values[0],
      max: values[count - 1],
      avg: sum / count,
      p50: pct(0.5),
      p95: pct(0.95),
      p99: pct(0.99),
    };
  }
}

export const perfMonitor = new PerformanceMonitor();

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  waitMs: number,
  opts: { maxWaitMs?: number } = {}
): T & { flush: () => void; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let maxTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: unknown[] | null = null;
  let lastThis: unknown = null;

  const invoke = () => {
    const args = lastArgs || [];
    const ctx = lastThis;
    lastArgs = null;
    lastThis = null;
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
    if (maxTimeoutId) { clearTimeout(maxTimeoutId); maxTimeoutId = null; }
    return fn.apply(ctx, args as Parameters<T>);
  };

  const debounced = function (this: unknown, ...args: unknown[]) {
    lastArgs = args;
    lastThis = this;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(invoke, waitMs);
    if (opts.maxWaitMs !== undefined && maxTimeoutId === null) {
      maxTimeoutId = setTimeout(invoke, opts.maxWaitMs);
    }
  } as T & { flush: () => void; cancel: () => void };

  debounced.flush = () => invoke();
  debounced.cancel = () => {
    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
    if (maxTimeoutId) { clearTimeout(maxTimeoutId); maxTimeoutId = null; }
    lastArgs = null;
    lastThis = null;
  };

  return debounced;
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  waitMs: number
): T & { flush: () => void; cancel: () => void } {
  let lastCall = 0;
  let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: unknown[] | null = null;
  let pendingThis: unknown = null;

  const invoke = () => {
    lastCall = Date.now();
    const args = pendingArgs || [];
    const ctx = pendingThis;
    pendingArgs = null;
    pendingThis = null;
    if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
    return fn.apply(ctx, args as Parameters<T>);
  };

  const throttled = function (this: unknown, ...args: unknown[]) {
    const now = Date.now();
    const remaining = waitMs - (now - lastCall);
    pendingArgs = args;
    pendingThis = this;
    if (remaining <= 0) {
      if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
      invoke();
    } else if (!pendingTimeout) {
      pendingTimeout = setTimeout(invoke, remaining);
    }
  } as T & { flush: () => void; cancel: () => void };

  throttled.flush = () => {
    if (pendingArgs !== null) invoke();
  };
  throttled.cancel = () => {
    if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
    pendingArgs = null;
    pendingThis = null;
  };

  return throttled;
}

export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) >>> 0;
}

