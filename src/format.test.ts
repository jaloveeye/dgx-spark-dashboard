import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';

describe('formatBytes', () => {
  it('labels binary byte units accurately', () => {
    expect(formatBytes(1024)).toBe('1 KiB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GiB');
    expect(formatBytes(125_442_416 * 1024)).toBe('119.6 GiB');
  });

  it('handles unavailable values', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});
