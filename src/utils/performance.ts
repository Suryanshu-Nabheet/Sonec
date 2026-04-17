/**
 * SONEC Performance Utilities
 * 
 * Provides high-resolution timing and resource usage tracking.
 */

import { performance } from 'perf_hooks';

/**
 * Advanced performance tracker with support for nested spans.
 */
export class PerformanceTracker {
    private spans: Map<string, number> = new Map();
    private metrics: Map<string, number[]> = new Map();

    /**
     * Start a measurement span.
     * @param name The name of the measurement
     */
    public start(name: string): void {
        this.spans.set(name, performance.now());
    }

    /**
     * End a measurement span and record the duration.
     * @param name The name of the measurement
     * @returns The duration in milliseconds
     */
    public end(name: string): number {
        const startTime = this.spans.get(name);
        if (startTime === undefined) {
            return 0;
        }

        const duration = performance.now() - startTime;
        this.spans.delete(name);

        const currentMetrics = this.metrics.get(name) || [];
        currentMetrics.push(duration);
        this.metrics.set(name, currentMetrics);

        return duration;
    }

    /**
     * Calculates the average duration for a specific metric.
     * @param name The metric name
     */
    public getAverage(name: string): number {
        const durations = this.metrics.get(name);
        if (!durations || durations.length === 0) {
            return 0;
        }
        return durations.reduce((a, b) => a + b, 0) / durations.length;
    }

    /**
     * Resets all tracked metrics.
     */
    public reset(): void {
        this.spans.clear();
        this.metrics.clear();
    }
}

/**
 * Tracks the memory usage of the extension process.
 */
export function getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
        heapUsed: (usage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
        heapTotal: (usage.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
        rss: (usage.rss / 1024 / 1024).toFixed(2) + ' MB'
    };
}
