import { describe, expect, it } from 'vitest';
import { parseAptUpgradable } from './updates.js';

describe('APT update parsing', () => {
  it('parses versions and classifies security and DGX packages', () => {
    expect(parseAptUpgradable(`Listing...
cifs-utils/noble-updates,noble-security 2:7.0-2ubuntu0.5 arm64 [upgradable from: 2:7.0-2ubuntu0.4]
dgx-dashboard/noble-updates 0.29.1 arm64 [upgradable from: 0.29.0]
libnvidia-compute-580/noble-updates,noble-security 580.1 arm64 [upgradable from: 580.0]`)).toEqual([
      { name: 'cifs-utils', currentVersion: '2:7.0-2ubuntu0.4', availableVersion: '2:7.0-2ubuntu0.5', architecture: 'arm64', security: true, dgxNvidia: false },
      { name: 'dgx-dashboard', currentVersion: '0.29.0', availableVersion: '0.29.1', architecture: 'arm64', security: false, dgxNvidia: true },
      { name: 'libnvidia-compute-580', currentVersion: '580.0', availableVersion: '580.1', architecture: 'arm64', security: true, dgxNvidia: true },
    ]);
  });

  it('ignores headings and malformed lines', () => {
    expect(parseAptUpgradable('Listing...\nnot an update\n')).toEqual([]);
  });
});
