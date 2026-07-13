import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import type { DiskReading, GpuReading, NetworkReading, ProcessReading, Snapshot, TemperatureReading } from '../shared/types.js';
import { collectSoftwareInfo } from './software.js';

const exec = promisify(execFile);
const excludedFs = new Set(['tmpfs', 'devtmpfs', 'squashfs', 'overlay', 'nsfs', 'proc', 'sysfs', 'efivarfs', 'cgroup2', 'tracefs', 'debugfs', 'fusectl', 'autofs']);
const collectorProcesses = new Set(['ps', 'nvidia-smi']);
let previousCpu = readCpuTicks();
let previousNetwork = new Map<string, { rx: number; tx: number }>();
let previousAt = Date.now();

function readCpuTicks() {
  const cpus = os.cpus();
  const idle = cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0);
  const total = cpus.reduce((sum, cpu) => sum + Object.values(cpu.times).reduce((a, b) => a + b, 0), 0);
  return { idle, total };
}

function bytesFromKiB(value: string | undefined) {
  return Number(value ?? 0) * 1024;
}

async function collectMemory() {
  const lines = (await readFile('/proc/meminfo', 'utf8')).split('\n');
  const values = Object.fromEntries(lines.map((line) => line.split(/:\s+/)).filter((parts) => parts.length === 2).map(([key, value]) => [key, value.split(/\s+/)[0]]));
  const totalBytes = bytesFromKiB(values.MemTotal);
  const availableBytes = bytesFromKiB(values.MemAvailable);
  const swapTotalBytes = bytesFromKiB(values.SwapTotal);
  const swapFreeBytes = bytesFromKiB(values.SwapFree);
  return { totalBytes, availableBytes, usedBytes: totalBytes - availableBytes, swapTotalBytes, swapUsedBytes: swapTotalBytes - swapFreeBytes };
}

async function collectTemperatures(): Promise<TemperatureReading[]> {
  try {
    const zones = (await readdir('/sys/class/thermal')).filter((name) => name.startsWith('thermal_zone'));
    const readings = await Promise.all(zones.map(async (zone, index) => {
      const base = `/sys/class/thermal/${zone}`;
      const [type, temp] = await Promise.all([readFile(`${base}/type`, 'utf8'), readFile(`${base}/temp`, 'utf8')]);
      return { id: zone, label: `${type.trim()} ${index + 1}`, celsius: Number(temp.trim()) / 1000 };
    }));
    return readings.filter((reading) => Number.isFinite(reading.celsius));
  } catch { return []; }
}

async function collectDisks(): Promise<DiskReading[]> {
  const { stdout } = await exec('df', ['-B1', '-P', '-T']);
  return stdout.trim().split('\n').slice(1).flatMap((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7 || excludedFs.has(parts[1]) || parts[6].startsWith('/snap/')) return [];
    const totalBytes = Number(parts[2]);
    const usedBytes = Number(parts[3]);
    return [{ device: parts[0], fsType: parts[1], totalBytes, usedBytes, availableBytes: Number(parts[4]), usedPercent: totalBytes ? usedBytes / totalBytes * 100 : 0, mount: parts.slice(6).join(' ') }];
  });
}

async function collectGpu(): Promise<{ gpu: GpuReading; processes: ProcessReading[] }> {
  const fields = 'name,utilization.gpu,temperature.gpu,power.draw,pstate';
  const { stdout } = await exec('nvidia-smi', [`--query-gpu=${fields}`, '--format=csv,noheader,nounits']);
  const [name, utilization, temperature, power, performanceState] = stdout.trim().split(',').map((v) => v.trim());
  let processes: ProcessReading[] = [];
  try {
    const result = await exec('nvidia-smi', ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits']);
    processes = result.stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [pid, name, memory] = line.split(',').map((v) => v.trim());
      return { pid: Number(pid), name, cpuPercent: 0, memoryBytes: 0, elapsedSeconds: 0, gpuMemoryMiB: Number(memory) };
    });
  } catch { /* no active GPU process */ }
  const numeric = (v: string) => Number.isFinite(Number(v)) ? Number(v) : null;
  return { gpu: { name, utilizationPercent: numeric(utilization), temperatureCelsius: numeric(temperature), powerWatts: numeric(power), performanceState: performanceState || null, memoryNote: 'GB10 통합 메모리: 전체 GPU 메모리는 시스템 메모리에 포함됩니다.' }, processes };
}

async function collectProcesses(): Promise<ProcessReading[]> {
  const { stdout } = await exec('ps', ['-eo', 'pid=,comm=,%cpu=,rss=,etimes=', '--sort=-%cpu']);
  return stdout.trim().split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(\d+)$/);
    if (!match || match[2].startsWith('[') || collectorProcesses.has(match[2])) return [];
    return [{ pid: Number(match[1]), name: match[2], cpuPercent: Number(match[3]), memoryBytes: Number(match[4]) * 1024, elapsedSeconds: Number(match[5]) }];
  });
}

async function collectNetwork(): Promise<NetworkReading[]> {
  const text = await readFile('/proc/net/dev', 'utf8');
  const now = Date.now();
  const seconds = Math.max((now - previousAt) / 1000, 0.1);
  const next = new Map<string, { rx: number; tx: number }>();
  const readings = text.split('\n').slice(2).flatMap((line) => {
    const [namePart, dataPart] = line.split(':');
    if (!dataPart) return [];
    const name = namePart.trim();
    const fields = dataPart.trim().split(/\s+/).map(Number);
    const current = { rx: fields[0], tx: fields[8] };
    next.set(name, current);
    const before = previousNetwork.get(name);
    return name === 'lo' ? [] : [{ interface: name, rxBytesPerSecond: before ? Math.max(0, current.rx - before.rx) / seconds : 0, txBytesPerSecond: before ? Math.max(0, current.tx - before.tx) / seconds : 0 }];
  });
  previousNetwork = next;
  previousAt = now;
  return readings;
}

export async function collectSnapshot(): Promise<Snapshot> {
  const errors: string[] = [];
  const currentCpu = readCpuTicks();
  const totalDelta = currentCpu.total - previousCpu.total;
  const usagePercent = totalDelta ? (1 - (currentCpu.idle - previousCpu.idle) / totalDelta) * 100 : 0;
  previousCpu = currentCpu;
  const safe = async <T>(label: string, task: Promise<T>, fallback: T) => task.catch((error: Error) => { errors.push(`${label}: ${error.message}`); return fallback; });
  const [memory, temperatures, disks, gpuResult, processes, network, software] = await Promise.all([
    collectMemory(), collectTemperatures(), safe('저장소', collectDisks(), []), safe('GPU', collectGpu(), null), safe('프로세스', collectProcesses(), []), safe('네트워크', collectNetwork(), []), collectSoftwareInfo(),
  ]);
  const [load1, load5, load15] = os.loadavg();
  const topCpu = [...processes].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 5);
  const topMemory = [...processes].sort((a, b) => b.memoryBytes - a.memoryBytes).slice(0, 5);
  return {
    timestamp: Date.now(), hostname: os.hostname(), uptimeSeconds: os.uptime(), software,
    cpu: { usagePercent, load1, load5, load15, cores: os.cpus().length }, memory,
    gpu: gpuResult ? { available: true, value: gpuResult.gpu } : { available: false, value: null, reason: 'nvidia-smi를 사용할 수 없습니다.' },
    temperatures, disks, network, topCpu, topMemory, gpuProcesses: gpuResult?.processes ?? [], errors,
  };
}
