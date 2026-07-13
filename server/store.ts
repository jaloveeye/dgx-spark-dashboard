import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { HistoryPoint, Snapshot } from '../shared/types.js';

export class MetricsStore {
  private db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS metrics (
        timestamp INTEGER PRIMARY KEY,
        cpu_percent REAL NOT NULL,
        memory_percent REAL NOT NULL,
        gpu_percent REAL,
        gpu_temperature REAL,
        system_temperature REAL,
        disk_percent REAL
      );
      CREATE INDEX IF NOT EXISTS metrics_timestamp ON metrics(timestamp);
    `);
  }

  insert(snapshot: Snapshot) {
    const memoryPercent = snapshot.memory.totalBytes ? snapshot.memory.usedBytes / snapshot.memory.totalBytes * 100 : 0;
    const maxSystemTemperature = snapshot.temperatures.length ? Math.max(...snapshot.temperatures.map((t) => t.celsius)) : null;
    const maxDiskPercent = snapshot.disks.length ? Math.max(...snapshot.disks.map((d) => d.usedPercent)) : null;
    this.db.prepare(`INSERT OR REPLACE INTO metrics VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      snapshot.timestamp, snapshot.cpu.usagePercent, memoryPercent, snapshot.gpu.value?.utilizationPercent ?? null,
      snapshot.gpu.value?.temperatureCelsius ?? null, maxSystemTemperature, maxDiskPercent,
    );
  }

  history(since: number, bucketMs: number): HistoryPoint[] {
    return this.db.prepare(`
      SELECT CAST(timestamp / ? AS INTEGER) * ? AS timestamp,
        AVG(cpu_percent) AS cpuPercent, AVG(memory_percent) AS memoryPercent,
        AVG(gpu_percent) AS gpuPercent, AVG(gpu_temperature) AS gpuTemperature,
        AVG(system_temperature) AS systemTemperature, AVG(disk_percent) AS diskPercent
      FROM metrics WHERE timestamp >= ? GROUP BY CAST(timestamp / ? AS INTEGER) ORDER BY timestamp
    `).all(bucketMs, bucketMs, since, bucketMs) as unknown as HistoryPoint[];
  }

  prune(before: number) { this.db.prepare('DELETE FROM metrics WHERE timestamp < ?').run(before); }
  close() { this.db.close(); }
}
