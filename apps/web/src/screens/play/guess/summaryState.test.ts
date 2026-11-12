import { describe, expect, it } from 'vitest';
import { summaryState } from './summaryState';

describe('summaryState', () => {
  it('waits while a commit is in flight, with or without a drafted guess', () => {
    expect(summaryState(true, true).pose).toBe('pending');
    expect(summaryState(false, true).pose).toBe('pending');
  });
  it('is idle otherwise, and tells a drafted guess from an empty one', () => {
    const empty = summaryState(false, false);
    const drafted = summaryState(true, false);
    expect(empty.pose).toBe('idle');
    expect(drafted.pose).toBe('idle');
    expect(drafted.line).not.toBe(empty.line);
  });
});
