import { TestBed } from '@angular/core/testing';

import { KEY_PLATFORM, keyPlatformOf } from './composer-key-platform';

describe('keyPlatformOf', () => {
  it('is a Mac by the user-agent data\'s platform where there is one, and by navigator.platform where there is not', () => {
    expect(keyPlatformOf({ userAgentData: { platform: 'macOS' }, platform: '' })).toBe('mac');
    expect(keyPlatformOf({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe('other');
    expect(keyPlatformOf({ platform: 'MacIntel' })).toBe('mac');
    expect(keyPlatformOf({ platform: 'iPad' })).toBe('mac');
    expect(keyPlatformOf({ platform: 'Win32' })).toBe('other');
    expect(keyPlatformOf({ platform: 'Linux x86_64' })).toBe('other');
    expect(keyPlatformOf(null)).toBe('other');
  });

  it('is read from the browser once, as KEY_PLATFORM', () => {
    TestBed.configureTestingModule({});

    expect(TestBed.inject(KEY_PLATFORM)).toBe(keyPlatformOf(navigator));
  });
});
