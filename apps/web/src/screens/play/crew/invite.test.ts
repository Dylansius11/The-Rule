import { describe, expect, it } from 'vitest';
import { inviteLink, joinIdFromSearch, joinStatus } from './invite';

describe('inviteLink / joinIdFromSearch', () => {
  it('round-trips a team id through the link', () => {
    const link = inviteLink('http://127.0.0.1:5173', 7);
    expect(link).toBe('http://127.0.0.1:5173/play/team/crew?join=7');
    expect(joinIdFromSearch(new URL(link).search)).toBe(7);
  });

  it('accepts only a plain u32 team id', () => {
    expect(joinIdFromSearch('?join=0')).toBe(0);
    expect(joinIdFromSearch('?join=4294967295')).toBe(4_294_967_295);
    expect(joinIdFromSearch('?join=4294967296')).toBeNull();
    expect(joinIdFromSearch('?join=-1')).toBeNull();
    expect(joinIdFromSearch('?join=3abc')).toBeNull();
    expect(joinIdFromSearch('?join=')).toBeNull();
    expect(joinIdFromSearch('')).toBeNull();
  });
});

describe('joinStatus', () => {
  const team = { members: ['cap.testnet', 'bob.testnet'], invites: ['alice.testnet'] };

  it('lets only an invited account join', () => {
    expect(joinStatus(team, 'alice.testnet', 5)).toBe('invited');
    expect(joinStatus(team, 'mallory.testnet', 5)).toBe('not-invited');
  });

  it('says a member is already in, and that a full team cannot take an invitee', () => {
    expect(joinStatus(team, 'bob.testnet', 5)).toBe('member');
    expect(joinStatus(team, 'alice.testnet', 2)).toBe('full');
  });

  it('cannot judge an account that is not connected', () => {
    expect(joinStatus(team, null, 5)).toBe('not-invited');
  });
});
