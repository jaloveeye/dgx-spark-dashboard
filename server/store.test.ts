import { afterEach, describe, expect, it } from 'vitest';
import { unlinkSync } from 'node:fs';
import { MetricsStore } from './store.js';
import type { Snapshot } from '../shared/types.js';

const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) { try { unlinkSync(path); } catch { /* already removed */ } } });

function snapshot(timestamp: number): Snapshot {
  return {
    timestamp, hostname: 'test', uptimeSeconds: 1,
    software: {
      os: { available: true, value: 'Test OS' }, kernel: { available: true, value: '1.0' },
      nvidiaDriver: { available: true, value: '1.0' }, cudaSupport: { available: true, value: '1.0' },
      node: { available: true, value: '24.0.0' }, dashboard: { available: true, value: '1.0.0' },
      nvidiaSmi: { available: true, value: '1.0' },
      cudaToolkit: { available: false, value: null, reason: '미설치' },
      python: { available: true, value: '3.12.0' },
      docker: { available: false, value: null, reason: '미설치' },
      nvidiaContainerToolkit: { available: false, value: null, reason: '미설치' },
    },
    cpu: { usagePercent: 25, load1: 1, load5: 1, load15: 1, cores: 4 },
    memory: { totalBytes: 100, usedBytes: 40, availableBytes: 60, swapTotalBytes: 0, swapUsedBytes: 0 },
    gpu: { available: true, value: { name: 'GPU', utilizationPercent: 50, temperatureCelsius: 60, powerWatts: 4, performanceState: 'P8', memoryNote: '' } },
    temperatures: [{ id: 'zone0', label: 'CPU', celsius: 55 }],
    disks: [{ mount: '/', device: '/dev/x', fsType: 'ext4', totalBytes: 100, usedBytes: 48, availableBytes: 52, usedPercent: 48 }],
    network: [], topCpu: [], topMemory: [], gpuProcesses: [], errors: [],
  };
}

describe('MetricsStore', () => {
  it('stores and returns bucketed history', () => {
    const path = `/tmp/dgx-dashboard-${process.pid}-${Date.now()}.sqlite`; paths.push(path, `${path}-wal`, `${path}-shm`);
    const store = new MetricsStore(path); const now = Date.now(); store.insert(snapshot(now));
    expect(store.history(now - 1_000, 1_000)[0]).toMatchObject({ cpuPercent: 25, memoryPercent: 40, gpuPercent: 50, diskPercent: 48 });
    store.close();
  });
  it('prunes expired samples', () => {
    const path = `/tmp/dgx-dashboard-${process.pid}-${Date.now()}-prune.sqlite`; paths.push(path, `${path}-wal`, `${path}-shm`);
    const store = new MetricsStore(path); store.insert(snapshot(1)); store.prune(2);
    expect(store.history(0, 1_000)).toEqual([]); store.close();
  });
});
