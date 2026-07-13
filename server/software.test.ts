import { describe, expect, it } from 'vitest';
import { parseCudaToolkitVersion, parseNvidiaSmiVersions, reasonForCommandError } from './software.js';

describe('software version parsing', () => {
  it('parses NVIDIA-SMI, driver, and supported CUDA versions', () => {
    expect(parseNvidiaSmiVersions(`NVIDIA-SMI version  : 580.159.03
NVML version        : 580.159
DRIVER version      : 580.159.03
CUDA Version        : 13.0`)).toEqual({ nvidiaSmi: '580.159.03', driver: '580.159.03', cudaSupport: '13.0' });
  });

  it('parses the installed CUDA Toolkit version', () => {
    expect(parseCudaToolkitVersion('Cuda compilation tools, release 13.0, V13.0.88')).toBe('13.0');
  });

  it('distinguishes a missing command from other failures', () => {
    expect(reasonForCommandError({ code: 'ENOENT' })).toBe('미설치');
    expect(reasonForCommandError({ code: 'EACCES' })).toBe('조회 불가');
    expect(reasonForCommandError(new Error('failed'))).toBe('조회 불가');
  });
});
