import { resolveFrequency } from '../src/helpers/rrule';
import { RRule } from 'rrule';

describe('resolveFrequency', () => {
  it('should return RRule.YEARLY for "yearly"', () => {
    expect(resolveFrequency('yearly')).toBe(RRule.YEARLY);
  });

  it('should return RRule.MONTHLY for "monthly"', () => {
    expect(resolveFrequency('monthly')).toBe(RRule.MONTHLY);
  });

  it('should return RRule.WEEKLY for "weekly"', () => {
    expect(resolveFrequency('weekly')).toBe(RRule.WEEKLY);
  });

  it('should return RRule.DAILY for "daily"', () => {
    expect(resolveFrequency('daily')).toBe(RRule.DAILY);
  });

  it('should throw an error for an invalid frequency', () => {
    expect(() => resolveFrequency('invalid')).toThrow('Invalid frequency: invalid');
  });
});
