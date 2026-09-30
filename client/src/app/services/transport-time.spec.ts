import { clockTimeOf } from './transport-time';

describe('clockTimeOf', () => {
  it('writes minutes and two-digit seconds, rounding down to the second', () => {
    expect(clockTimeOf(0)).toBe('0:00');
    expect(clockTimeOf(65_999)).toBe('1:05');
    expect(clockTimeOf(600_000)).toBe('10:00');
  });

  it('never goes below zero', () => {
    expect(clockTimeOf(-500)).toBe('0:00');
  });
});
