import { describe, expect, it } from 'vitest';
import { choiceFromSearch } from '@/config/env';
import { inviteAccountFromSearch, inviteLink, joinIdFromSearch, joinStatus, requestLink } from './invite';

describe('inviteLink / joinIdFromSearch', () => {
  it('round-trips a team id through the link and names the deployment', () => {
    const link = inviteLink('http://127.0.0.1:5173', 7, 'demo');
    expect(link).toBe('http://127.0.0.1:5173/play/team/crew?join=7&deployment=demo');
    expect(joinIdFromSearch(new URL(link).search)).toBe(7);
    expect(choiceFromSearch(new URL(link).search)).toBe('demo');
  });

  it('reads only main or demo as a deployment', () => {
    expect(choiceFromSearch('?deployment=main')).toBe('main');
    expect(choiceFromSearch('?deployment=Demo')).toBeNull();
    expect(choiceFromSearch('?deployment=')).toBeNull();
    expect(choiceFromSearch('?join=1')).toBeNull();
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
  const team = { members: ['cap.testnet', 'bob.testnet'], invites: ['alice.testnet'], activeRound: null };
  const alice = { account: 'alice.testnet', teamId: null, isPlayer: true };

  it('lets only an invited, free, registered account join', () => {
    expect(joinStatus(team, alice, 5)).toBe('invited');
    expect(joinStatus(team, { ...alice, account: 'mallory.testnet' }, 5)).toBe('not-invited');
  });

  it('says a member is already in, and that a full team cannot take an invitee', () => {
    expect(joinStatus(team, { ...alice, account: 'bob.testnet', teamId: 3 }, 5)).toBe('member');
    expect(joinStatus(team, alice, 2)).toBe('full');
  });

  it('reports each contract precondition in the order a player fixes them', () => {
    expect(joinStatus(team, { ...alice, teamId: 9 }, 5)).toBe('in-other-team');
    expect(joinStatus({ ...team, activeRound: 340 }, alice, 5)).toBe('locked');
    expect(joinStatus(team, { ...alice, isPlayer: false }, 5)).toBe('no-player');
  });

  it('cannot judge an account that is not connected', () => {
    expect(joinStatus(team, { account: null, teamId: null, isPlayer: false }, 5)).toBe('not-invited');
  });
});

describe('requestLink / inviteAccountFromSearch', () => {
  it('round-trips an account name to the captain with the deployment', () => {
    const link = requestLink('http://127.0.0.1:5199', 'funfield3084.testnet', 'demo');
    expect(link).toBe('http://127.0.0.1:5199/play/team/crew?invite=funfield3084.testnet&deployment=demo');
    expect(inviteAccountFromSearch(new URL(link).search)).toBe('funfield3084.testnet');
  });

  it('refuses anything that is not a plausible account id', () => {
    for (const bad of ['', 'a', 'UPPER.testnet', 'has space', '-lead.testnet', 'x'.repeat(65)])
      expect(inviteAccountFromSearch(`?invite=${encodeURIComponent(bad)}`)).toBeNull();
    expect(inviteAccountFromSearch('')).toBeNull();
  });
});
