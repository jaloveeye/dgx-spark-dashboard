import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { PackageUpdate, UpdateInfo } from '../shared/types.js';

const exec = promisify(execFile);
const cacheLifetimeMs = 5 * 60 * 1000;
let cached: { expiresAt: number; value: UpdateInfo } | null = null;

const dgxNvidiaPackage = /^(?:dgx|nvidia|libnvidia|cuda|libcuda|linux-(?:headers|image|modules|tools).*nvidia)/i;

export function parseAptUpgradable(text: string): PackageUpdate[] {
  return text.replace(/\u001b\[[0-9;]*m/g, '').split('\n').flatMap((line) => {
    const match = line.trim().match(/^([^/\s]+)\/([^\s]+)\s+(\S+)\s+(\S+)\s+\[upgradable from: (.+)]$/);
    if (!match) return [];
    const [, name, sources, availableVersion, architecture, currentVersion] = match;
    return [{
      name,
      currentVersion,
      availableVersion,
      architecture,
      security: sources.split(',').some((source) => source.includes('-security')),
      dgxNvidia: dgxNvidiaPackage.test(name),
    }];
  });
}

async function packageCacheUpdatedAt() {
  try {
    const directory = '/var/lib/apt/lists';
    const entries = await readdir(directory);
    const timestamps = await Promise.all(entries.filter((name) => name !== 'lock' && name !== 'partial').map(async (name) => (await stat(`${directory}/${name}`)).mtimeMs));
    return timestamps.length ? Math.max(...timestamps) : null;
  } catch {
    return null;
  }
}

export async function collectUpdateInfo(force = false): Promise<UpdateInfo> {
  const now = Date.now();
  if (!force && cached && cached.expiresAt > now) return cached.value;
  const [{ stdout }, cacheUpdatedAt] = await Promise.all([
    exec('apt', ['list', '--upgradable'], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }),
    packageCacheUpdatedAt(),
  ]);
  const packages = parseAptUpgradable(stdout).sort((a, b) => Number(b.dgxNvidia) - Number(a.dgxNvidia) || Number(b.security) - Number(a.security) || a.name.localeCompare(b.name));
  const value: UpdateInfo = {
    checkedAt: Date.now(),
    packageCacheUpdatedAt: cacheUpdatedAt,
    available: packages.length > 0,
    totalCount: packages.length,
    securityCount: packages.filter((item) => item.security).length,
    dgxNvidiaCount: packages.filter((item) => item.dgxNvidia).length,
    rebootRequired: existsSync('/var/run/reboot-required'),
    managementUrl: process.env.DGX_UPDATE_URL?.trim() || null,
    packages,
  };
  cached = { expiresAt: now + cacheLifetimeMs, value };
  return value;
}
