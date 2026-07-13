import { describe, expect, it } from 'vitest';
import { createTranslator, initialLocale, localizeAvailabilityReason, localizeCollectorError } from './i18n';

describe('i18n', () => {
  it('uses a saved locale before the browser language', () => {
    expect(initialLocale({ getItem: () => 'en' }, 'ko-KR')).toBe('en');
    expect(initialLocale({ getItem: () => null }, 'ko-KR')).toBe('ko');
    expect(initialLocale({ getItem: () => null }, 'en-US')).toBe('en');
  });

  it('interpolates messages in both languages', () => {
    expect(createTranslator('ko')('logicalCores', { count: 20 })).toBe('20개 논리 코어');
    expect(createTranslator('en')('logicalCores', { count: 20 })).toBe('20 logical cores');
  });

  it('localizes server status reasons and collector labels', () => {
    expect(localizeAvailabilityReason('미설치', 'en')).toBe('Not installed');
    expect(localizeAvailabilityReason('조회 불가', 'en')).toBe('Unavailable');
    expect(localizeCollectorError('저장소: failed', 'en')).toBe('Storage: failed');
    expect(localizeCollectorError('저장소: 실패', 'ko')).toBe('저장소: 실패');
  });
});
