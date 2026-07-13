import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Availability, SoftwareInfo } from '../shared/types.js';

const exec = promisify(execFile);
let cachedSoftware: Promise<SoftwareInfo> | null = null;

const available = (value: string): Availability<string> => ({ available: true, value });
const unavailable = (reason: string): Availability<string> => ({ available: false, value: null, reason });

export function reasonForCommandError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' ? '미설치' : '조회 불가';
}

export function parseNvidiaSmiVersions(text: string) {
  const value = (label: string) => text.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, 'm'))?.[1].trim() ?? null;
  return { nvidiaSmi: value('NVIDIA-SMI version'), driver: value('DRIVER version'), cudaSupport: value('CUDA Version') };
}

export function parseCudaToolkitVersion(text: string) {
  return text.match(/\brelease\s+([^,\s]+)/)?.[1] ?? null;
}

async function runVersion(command: string, args: string[], parser: (text: string) => string | null): Promise<Availability<string>> {
  try {
    const { stdout, stderr } = await exec(command, args, { timeout: 5_000 });
    const value = parser(`${stdout}\n${stderr}`);
    return value ? available(value) : unavailable('조회 불가');
  } catch (error) {
    return unavailable(reasonForCommandError(error));
  }
}

async function readOsVersion(): Promise<Availability<string>> {
  try {
    const text = await readFile('/etc/os-release', 'utf8');
    const value = text.match(/^PRETTY_NAME=(?:"([^"]+)"|'([^']+)'|(.+))$/m);
    return value ? available(value[1] ?? value[2] ?? value[3]) : unavailable('조회 불가');
  } catch {
    return unavailable('조회 불가');
  }
}

async function readDashboardVersion(): Promise<Availability<string>> {
  try {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as { version?: unknown };
    return typeof packageJson.version === 'string' ? available(packageJson.version) : unavailable('조회 불가');
  } catch {
    return unavailable('조회 불가');
  }
}

async function collectSoftwareInfoUncached(): Promise<SoftwareInfo> {
  const cudaCommand = existsSync('/usr/local/cuda/bin/nvcc') ? '/usr/local/cuda/bin/nvcc' : 'nvcc';
  const nvidia = exec('nvidia-smi', ['--version'], { timeout: 5_000 }).then(
    ({ stdout, stderr }) => ({ versions: parseNvidiaSmiVersions(`${stdout}\n${stderr}`), reason: null }),
    (error: unknown) => ({ versions: null, reason: reasonForCommandError(error) }),
  );
  const [osVersion, dashboard, nvidiaResult, cudaToolkit, python, docker, nvidiaContainerToolkit] = await Promise.all([
    readOsVersion(),
    readDashboardVersion(),
    nvidia,
    runVersion(cudaCommand, ['--version'], parseCudaToolkitVersion),
    runVersion('python3', ['--version'], (text) => text.match(/Python\s+(\S+)/)?.[1] ?? null),
    runVersion('docker', ['--version'], (text) => text.match(/Docker version\s+([^,\s]+)/)?.[1] ?? null),
    runVersion('nvidia-container-cli', ['--version'], (text) => text.match(/^cli-version:\s*(\S+)/m)?.[1] ?? null),
  ]);
  const nvidiaValue = (key: 'nvidiaSmi' | 'driver' | 'cudaSupport') => {
    const value = nvidiaResult.versions?.[key];
    return value ? available(value) : unavailable(nvidiaResult.reason ?? '조회 불가');
  };
  return {
    os: osVersion,
    kernel: available(os.release()),
    nvidiaDriver: nvidiaValue('driver'),
    cudaSupport: nvidiaValue('cudaSupport'),
    node: available(process.version.replace(/^v/, '')),
    dashboard,
    nvidiaSmi: nvidiaValue('nvidiaSmi'),
    cudaToolkit,
    python,
    docker,
    nvidiaContainerToolkit,
  };
}

export function collectSoftwareInfo() {
  cachedSoftware ??= collectSoftwareInfoUncached();
  return cachedSoftware;
}
