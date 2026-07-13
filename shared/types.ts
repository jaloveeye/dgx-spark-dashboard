export type Availability<T> = { value: T | null; available: boolean; reason?: string };

export interface TemperatureReading {
  id: string;
  label: string;
  celsius: number;
}

export interface DiskReading {
  mount: string;
  device: string;
  fsType: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
}

export interface NetworkReading {
  interface: string;
  rxBytesPerSecond: number;
  txBytesPerSecond: number;
}

export interface ProcessReading {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryBytes: number;
  elapsedSeconds: number;
  gpuMemoryMiB?: number;
}

export interface GpuReading {
  name: string;
  utilizationPercent: number | null;
  temperatureCelsius: number | null;
  powerWatts: number | null;
  performanceState: string | null;
  memoryNote: string;
}

export interface SoftwareInfo {
  os: Availability<string>;
  kernel: Availability<string>;
  nvidiaDriver: Availability<string>;
  cudaSupport: Availability<string>;
  node: Availability<string>;
  dashboard: Availability<string>;
  nvidiaSmi: Availability<string>;
  cudaToolkit: Availability<string>;
  python: Availability<string>;
  docker: Availability<string>;
  nvidiaContainerToolkit: Availability<string>;
}

export interface Snapshot {
  timestamp: number;
  hostname: string;
  uptimeSeconds: number;
  software: SoftwareInfo;
  cpu: { usagePercent: number; load1: number; load5: number; load15: number; cores: number };
  memory: { totalBytes: number; usedBytes: number; availableBytes: number; swapTotalBytes: number; swapUsedBytes: number };
  gpu: Availability<GpuReading>;
  temperatures: TemperatureReading[];
  disks: DiskReading[];
  network: NetworkReading[];
  topCpu: ProcessReading[];
  topMemory: ProcessReading[];
  gpuProcesses: ProcessReading[];
  errors: string[];
}

export interface HistoryPoint {
  timestamp: number;
  cpuPercent: number;
  memoryPercent: number;
  gpuPercent: number | null;
  gpuTemperature: number | null;
  systemTemperature: number | null;
  diskPercent: number | null;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'starting';
  lastCollectedAt: number | null;
  collectorErrors: string[];
  uptimeSeconds: number;
}
