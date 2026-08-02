"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.perfMonitor = exports.PerformanceMonitor = void 0;
exports.debounce = debounce;
exports.throttle = throttle;
exports.cyrb53 = cyrb53;
const MAX_SAMPLES_PER_MARK = 1000;
const SAMPLE_INTERVAL_MS = 10;
const JANK_THRESHOLD_MS = 50;
const FRAME_TIME_TARGET_MS = 16.67;
class PerformanceMonitor {
    constructor() {
        this.marks = new Map();
        this.samples = new Map();
        this.sampleTimers = new Map();
        this.flameMarks = [];
        this.fpsHandle = null;
        this.fpsLastFrameTime = 0;
        this.fpsFrameCount = 0;
        this.fpsDroppedFrames = 0;
        this.fpsJankCount = 0;
        this.fpsListeners = [];
        this.fpsThresholdMs = JANK_THRESHOLD_MS;
    }
    startMark(name) {
        this.marks.set(name, performance.now());
    }
    endMark(name) {
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
    getFlameMarks() {
        return this.flameMarks.slice();
    }
    clearFlameMarks() {
        this.flameMarks.length = 0;
    }
    measure(name, fn) {
        this.startMark(name);
        try {
            return fn();
        }
        finally {
            const duration = this.endMark(name);
            console.log(`[Performance] ${name}: ${duration.toFixed(2)}ms`);
        }
    }
    async measureAsync(name, fn) {
        this.startMark(name);
        try {
            return await fn();
        }
        finally {
            const duration = this.endMark(name);
            console.log(`[Performance] ${name}: ${duration.toFixed(2)}ms`);
        }
    }
    startSampling(name, valueFn = performance.now.bind(performance)) {
        if (this.sampleTimers.has(name)) {
            return;
        }
        if (!this.samples.has(name)) {
            this.samples.set(name, []);
        }
        const timer = setInterval(() => {
            const arr = this.samples.get(name);
            let value;
            try {
                value = valueFn();
            }
            catch {
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
    stopSampling(name) {
        const timer = this.sampleTimers.get(name);
        if (timer) {
            clearInterval(timer);
            this.sampleTimers.delete(name);
        }
        return (this.samples.get(name) || []).slice();
    }
    getSamples(name) {
        return (this.samples.get(name) || []).slice();
    }
    clearSamples(name) {
        if (name) {
            this.stopSampling(name);
            this.samples.delete(name);
        }
        else {
            for (const n of Array.from(this.sampleTimers.keys())) {
                this.stopSampling(n);
            }
            this.samples.clear();
        }
    }
    memorySnapshot() {
        const perfMemory = performance.memory;
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
    startFrameRateMonitor(onReport, thresholdMs = JANK_THRESHOLD_MS) {
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
        const tick = (now) => {
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
                const report = {
                    fps: Math.round(fps * 10) / 10,
                    droppedFrames: this.fpsDroppedFrames,
                    totalFrames: this.fpsFrameCount,
                    jankCount: this.fpsJankCount,
                };
                for (const listener of this.fpsListeners) {
                    try {
                        listener(report);
                    }
                    catch { /* ignore */ }
                }
                reportAccumulator = 0;
                this.fpsFrameCount = 0;
            }
        };
        this.fpsHandle = requestAnimationFrame(tick);
    }
    stopFrameRateMonitor() {
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
    aggregateStats(samples) {
        if (samples.length === 0)
            return null;
        const values = samples.map(s => s.value).sort((a, b) => a - b);
        const count = values.length;
        const sum = values.reduce((a, b) => a + b, 0);
        const pct = (p) => values[Math.min(count - 1, Math.floor(count * p))];
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
exports.PerformanceMonitor = PerformanceMonitor;
exports.perfMonitor = new PerformanceMonitor();
function debounce(fn, waitMs, opts = {}) {
    let timeoutId = null;
    let maxTimeoutId = null;
    let lastArgs = null;
    let lastThis = null;
    const invoke = () => {
        const args = lastArgs || [];
        const ctx = lastThis;
        lastArgs = null;
        lastThis = null;
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        if (maxTimeoutId) {
            clearTimeout(maxTimeoutId);
            maxTimeoutId = null;
        }
        return fn.apply(ctx, args);
    };
    const debounced = function (...args) {
        lastArgs = args;
        lastThis = this;
        if (timeoutId)
            clearTimeout(timeoutId);
        timeoutId = setTimeout(invoke, waitMs);
        if (opts.maxWaitMs !== undefined && maxTimeoutId === null) {
            maxTimeoutId = setTimeout(invoke, opts.maxWaitMs);
        }
    };
    debounced.flush = () => invoke();
    debounced.cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        if (maxTimeoutId) {
            clearTimeout(maxTimeoutId);
            maxTimeoutId = null;
        }
        lastArgs = null;
        lastThis = null;
    };
    return debounced;
}
function throttle(fn, waitMs) {
    let lastCall = 0;
    let pendingTimeout = null;
    let pendingArgs = null;
    let pendingThis = null;
    const invoke = () => {
        lastCall = Date.now();
        const args = pendingArgs || [];
        const ctx = pendingThis;
        pendingArgs = null;
        pendingThis = null;
        if (pendingTimeout) {
            clearTimeout(pendingTimeout);
            pendingTimeout = null;
        }
        return fn.apply(ctx, args);
    };
    const throttled = function (...args) {
        const now = Date.now();
        const remaining = waitMs - (now - lastCall);
        pendingArgs = args;
        pendingThis = this;
        if (remaining <= 0) {
            if (pendingTimeout) {
                clearTimeout(pendingTimeout);
                pendingTimeout = null;
            }
            invoke();
        }
        else if (!pendingTimeout) {
            pendingTimeout = setTimeout(invoke, remaining);
        }
    };
    throttled.flush = () => {
        if (pendingArgs !== null)
            invoke();
    };
    throttled.cancel = () => {
        if (pendingTimeout) {
            clearTimeout(pendingTimeout);
            pendingTimeout = null;
        }
        pendingArgs = null;
        pendingThis = null;
    };
    return throttled;
}
function cyrb53(str, seed = 0) {
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
