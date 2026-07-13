import { describe, expect, it } from 'vitest';
import { calculateCpuUsage, parseCpuTicks } from './collector';

describe('CPU collection', () => {
  it('treats idle and iowait as idle and excludes guest counters', () => {
    expect(parseCpuTicks('cpu  100 10 20 800 50 5 10 5 30 2\n')).toEqual({ idle: 850, total: 1000 });
  });

  it('calculates bounded utilization from tick deltas', () => {
    expect(calculateCpuUsage({ idle: 850, total: 1000 }, { idle: 940, total: 1100 })).toBeCloseTo(10);
    expect(calculateCpuUsage({ idle: 10, total: 10 }, { idle: 5, total: 5 })).toBe(0);
  });
});
