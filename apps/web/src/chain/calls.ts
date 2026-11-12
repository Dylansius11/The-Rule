import { active } from '@/config/env';
import type { Mode, PlayInput } from '@/game/types';
import { sendCall } from './wallet';

const game = (method: string, args: object = {}, deposit = 0n) =>
  sendCall(active.game, method, args, deposit);
export const play = (mode: Mode, input: PlayInput) =>
  game('play', { mode, number: input.number, word: input.word });
export const depositCredit = (amount: bigint) => game('deposit_credit', {}, amount);
export const withdrawCredit = (amount: bigint) => game('withdraw_credit', { amount: amount.toString() }, 1n);
export const commitGuess = (mode: Mode, hash: string) => game('commit_guess', { mode, hash });
export const revealGuess = (mode: Mode, commitSeq: number, guess: string, salt: string) =>
  game('reveal_guess', { mode, commit_seq: commitSeq, guess, salt });
export const claim = (mode: Mode, roundId: number) => game('claim', { mode, round_id: roundId });
export const advance = (mode: Mode, roundId: number) => game('advance', { mode, round_id: roundId });
export const finalize = (mode: Mode, roundId: number) => game('finalize', { mode, round_id: roundId });
export const claimTeam = (mode: Mode, roundId: number, teamId: number) =>
  game('claim_team', { mode, round_id: roundId, team_id: teamId });
export const createTeam = (name: string) => game('create_team', { name });
export const invite = (account: string) => game('invite', { account });
export const joinTeam = (teamId: number) => game('join_team', { team_id: teamId });
export const leaveTeam = () => game('leave_team');
export const removeMember = (account: string) => game('remove_member', { account });
export const teamDeposit = (teamId: number, amount: bigint) =>
  game('team_deposit', { team_id: teamId }, amount);
export const teamWithdraw = (teamId: number) => game('team_withdraw', { team_id: teamId }, 1n);
export const settleTeam = (teamId: number) => game('settle_team', { team_id: teamId });
export const lock = (mode: Mode, roundId: number, amount: bigint) =>
  sendCall(
    active.token,
    'ft_transfer_call',
    {
      receiver_id: active.game,
      amount: amount.toString(),
      msg: JSON.stringify({ lock: { mode, round_id: roundId } }),
    },
    1n,
  );
export const unlock = (mode: Mode, roundId: number) => game('unlock', { mode, round_id: roundId }, 1n);
export const retryTokenOperation = (requestId: number) =>
  game('retry_token_operation', { request_id: requestId });
export const registerToken = () => game('register_token');
