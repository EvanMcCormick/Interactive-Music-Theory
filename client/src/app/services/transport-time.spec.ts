import { clockTimeOf } from './transport-time';

describe('clockTimeOf', () => {
  it('writes minutes and two-digit seconds, rounding down to the second', () => {
    expect(clockTimeOf(0)).toBe('0:00');
    expect(clockTimeOf(65_999)).toBe('1:05');
    expect(clockTimeOf(600_000)).toBe('10:00');
  });

  it('rounds a fraction of a second down, as a clock does', () => {
    expect(clockTimeOf(999.9)).toBe('0:00');
    expect(clockTimeOf(1_000.4)).toBe('0:01');
    expect(clockTimeOf(59_999.99)).toBe('0:59');
  });

  it('keeps counting minutes past the hour, with no hours field', () => {
    expect(clockTimeOf(3_665_000)).toBe('61:05');
  });

  it('never goes below zero', () => {
    expect(clockTimeOf(-500)).toBe('0:00');
  });

  it('reads a time that is not a number as zero rather than writing NaN:NaN', () => {
    expect(clockTimeOf(NaN)).toBe('0:00');
    expect(clockTimeOf(Infinity)).toBe('0:00');
    expect(clockTimeOf(-Infinity)).toBe('0:00');
  });
});
