import { describe, expect, it } from 'vitest';
import { summaryState } from './summaryState';

describe('summaryState', () => {
  it('waits while a commit is in flight, whatever the check says', () => {
    const s = summaryState(true, { kind: 'done', consistent: false, mismatches: [1], rows: 4 }, true);
    expect(s.pose).toBe('pending');
    expect(s.disagrees).toBe(false);
  });
  it('asks for a guess first when there is no rule', () => {
    const s = summaryState(false, { kind: 'idle' }, false);
    expect(s.pose).toBe('idle');
    expect(s.status).toMatch(/write your guess first/i);
  });
  it('shows pending while the check runs', () => {
    expect(summaryState(true, { kind: 'running' }, false).pose).toBe('pending');
  });
  it('says a consistent guess is not proof and does not celebrate', () => {
    const s = summaryState(true, { kind: 'done', consistent: true, mismatches: [], rows: 12 }, false);
    expect(s.pose).toBe('idle');
    expect(s.status).toContain('all 12 logged verdicts');
    expect(s.line).toMatch(/not proof/);
  });
  it('flags a disagreement with the right count and the NO pose', () => {
    const one = summaryState(true, { kind: 'done', consistent: false, mismatches: [3], rows: 9 }, false);
    expect(one.pose).toBe('no');
    expect(one.disagrees).toBe(true);
    expect(one.status).toContain('1 logged verdict,');
    const two = summaryState(true, { kind: 'done', consistent: false, mismatches: [3, 4], rows: 9 }, false);
    expect(two.status).toContain('2 logged verdicts,');
  });
  it('reports a failed check without claiming anything was sent', () => {
    const s = summaryState(true, { kind: 'error', message: 'wasm missing' }, false);
    expect(s.pose).toBe('idle');
    expect(s.status).toContain('Nothing was sent');
  });
  it('is neutral before any check', () => {
    expect(summaryState(true, { kind: 'idle' }, false)).toMatchObject({ pose: 'idle', disagrees: false });
  });
});
