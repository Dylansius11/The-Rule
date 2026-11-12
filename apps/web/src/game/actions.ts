import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWallet } from '@/app/providers';
import * as calls from '@/chain/calls';
import { toUiError } from '@/chain/errors';
import { getFinalBlock, view } from '@/chain/rpc';
import * as views from '@/chain/views';
import { active } from '@/config/env';
import { sendCall } from '@/chain/wallet';
import { TEAM_NAME_HINT, validTeamName } from './team-name';
import type { PayoutItem } from './payouts';
import { commitHash, encodeRuleHex } from '@/verify';
import type { ActionState, CanonicalRule, Mode, SavedGuess } from './types';

type Outcome = Awaited<ReturnType<typeof calls.play>>;

function checked(result: Outcome): { hash: string | null; value: unknown } {
  const status = result.status;
  if (typeof status === 'object' && 'Failure' in status) {
    throw new Error(JSON.stringify(status.Failure));
  }
  let value: unknown = null;
  if (typeof status === 'object' && 'SuccessValue' in status && status.SuccessValue) {
    try {
      value = JSON.parse(atob(status.SuccessValue));
    } catch {
      value = atob(status.SuccessValue);
    }
  }
  return { hash: result.transaction?.hash ?? null, value };
}

function useAction<A>(fn: (arg: A) => Promise<Outcome>) {
  const [state, setState] = useState<ActionState>({ kind: 'idle' });
  const query = useQueryClient();

  function run(arg: A) {
    setState({ kind: 'signing' });
    void fn(arg)
      .then(async result => {
        const { hash, value } = checked(result);
        setState({ kind: 'pending', txHash: hash });
        await query.invalidateQueries();
        setState({ kind: 'done', txHash: hash, value });
      })
      .catch(error => setState({ kind: 'error', error: toUiError(error) }));
  }

  function reset() {
    setState({ kind: 'idle' });
  }

  return { state, run, reset };
}

export function useCreditActions() {
  return { deposit: useAction(calls.depositCredit), withdraw: useAction(calls.withdrawCredit) };
}

export function useClaimActions(mode: Mode, roundId: number) {
  return {
    claim: useAction<void>(() => calls.claim(mode, roundId)),
    claimTeam: useAction<number>(teamId => calls.claimTeam(mode, roundId, teamId)),
  };
}

/**
 * "Claim all": sends the planned unlock and claims one after another and stops at the first failure, so the
 * rest stay listed (the plan is recomputed from the chain). Each step is its own transaction: with a session
 * key they sign silently, otherwise the wallet asks once per step.
 */
export function useClaimAll() {
  const [state, setState] = useState<ActionState>({ kind: 'idle' });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const query = useQueryClient();

  function run(items: readonly PayoutItem[]) {
    if (items.length === 0) return;
    setState({ kind: 'signing' });
    setProgress({ done: 0, total: items.length });
    void (async () => {
      let last: string | null = null;
      for (const [index, item] of items.entries()) {
        const result = checked(await sendPayout(item));
        last = result.hash;
        setProgress({ done: index + 1, total: items.length });
      }
      setState({ kind: 'pending', txHash: last });
      await query.invalidateQueries();
      setState({ kind: 'done', txHash: last, value: null });
    })().catch(error => setState({ kind: 'error', error: toUiError(error) }));
  }

  function reset() {
    setState({ kind: 'idle' });
    setProgress(null);
  }

  return { state, progress, run, reset };
}

function sendPayout(item: PayoutItem): Promise<Outcome> {
  if (item.kind === 'unlock') return calls.settleTeam(item.teamId);
  return item.mode === 1 && item.teamId !== null
    ? calls.claimTeam(1, item.roundId, item.teamId)
    : calls.claim(item.mode, item.roundId);
}

/** The permissionless lifecycle calls the keeper normally sends: `advance` after plays close, `finalize` after the reveal window. */
export function useSettleAction(mode: Mode, roundId: number) {
  return useAction<'advance' | 'finalize'>(step =>
    step === 'advance' ? calls.advance(mode, roundId) : calls.finalize(mode, roundId),
  );
}

export function useTeamActions() {
  return {
    create: useAction<string>(async name => {
      if (!validTeamName(name)) throw new Error(TEAM_NAME_HINT);
      return calls.createTeam(name);
    }),
    invite: useAction(calls.invite),
    join: useAction(calls.joinTeam),
    leave: useAction<void>(() => calls.leaveTeam()),
    remove: useAction(calls.removeMember),
    deposit: useAction<{ teamId: number; amount: bigint }>(arg => calls.teamDeposit(arg.teamId, arg.amount)),
    withdraw: useAction(calls.teamWithdraw),
    settle: useAction(calls.settleTeam),
  };
}

export function useLockActions(mode: Mode, roundId: number) {
  return {
    lock: useAction<bigint>(amount => calls.lock(mode, roundId, amount)),
    unlock: useAction<void>(() => calls.unlock(mode, roundId)),
    retry: useAction(calls.retryTokenOperation),
    register: useAction<void>(() => calls.registerToken()),
    storage: useAction<bigint>(minimum =>
      sendCall(active.token, 'storage_deposit', { registration_only: true }, minimum),
    ),
  };
}

export function useGuessActions(mode: Mode, roundId: number) {
  const { accountId } = useWallet();
  const query = useQueryClient();
  const key = accountId ? `the-rule:guesses:${active.game}:${accountId}:${mode}:${roundId}` : null;
  const [saved, setSaved] = useState<SavedGuess[]>([]);
  const [commitState, setCommitState] = useState<ActionState>({ kind: 'idle' });
  const [revealState, setRevealState] = useState<ActionState>({ kind: 'idle' });

  const load = useCallback((): SavedGuess[] => {
    if (!key) return [];
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as SavedGuess[]) : [];
  }, [key]);

  useEffect(() => {
    const initial = load();
    setSaved(initial);
    if (!accountId || !key || !initial.some(item => item.commitSeq === -1)) return;
    let cancelled = false;
    void (async () => {
      const commits = (await views.getCommits(mode, roundId)).filter(item => item.actor === accountId);
      const recovered = new Map<string, number>();
      for (const draft of initial.filter(item => item.commitSeq === -1)) {
        for (const record of commits) {
          if (record.entityTag !== 0 && record.entityTag !== 1) continue;
          const hash = await commitHash({
            chain: 'testnet',
            game: active.game,
            mode,
            round: roundId,
            actor: accountId,
            entity: { tag: record.entityTag, id: record.entityId },
            guess: draft.guess,
            saltHex: draft.salt,
          });
          if (hash === record.hash) {
            recovered.set(draft.salt, record.commitSeq);
            break;
          }
        }
      }
      if (!cancelled && recovered.size) {
        const rows = load().map(item =>
          recovered.has(item.salt) ? { ...item, commitSeq: recovered.get(item.salt)! } : item,
        );
        localStorage.setItem(key, JSON.stringify(rows));
        setSaved(rows);
      }
    })().catch(error => {
      if (!cancelled) setCommitState({ kind: 'error', error: toUiError(error) });
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, key, load, mode, roundId]);

  function store(rows: SavedGuess[]) {
    if (!key) throw new Error('Wallet is not connected');
    localStorage.setItem(key, JSON.stringify(rows));
    setSaved(rows);
  }

  function commit(guess: CanonicalRule) {
    setCommitState({ kind: 'signing' });
    void (async () => {
      if (!accountId || !key) throw new Error('Connect your wallet first');
      const [player, round] = await Promise.all([
        view<{ index: number; team_id: number | null } | null>('get_player', { account: accountId }),
        views.getRound(mode),
      ]);
      if (!player || !round || round.roundId !== roundId || round.phase !== 'Investigation') {
        throw new Error('E10');
      }
      const entity =
        mode === 0 ? { tag: 0 as const, id: player.index } : { tag: 1 as const, id: player.team_id ?? -1 };
      if (entity.id < 0) throw new Error('E32');
      const salt = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      const hash = await commitHash({
        chain: 'testnet',
        game: active.game,
        mode,
        round: roundId,
        actor: accountId,
        entity,
        guess,
        saltHex: salt,
      });
      // Persist before signing so an interrupted response cannot lose the preimage.
      const draft: SavedGuess = { round: roundId, mode, guess, salt, commitSeq: -1 };
      store([...load(), draft]);
      const result = checked(await calls.commitGuess(mode, hash));
      let seq = (result.value as { commit_seq?: number } | null)?.commit_seq;
      if (seq == null) {
        seq = (await views.getCommits(mode, roundId)).find(
          item => item.actor === accountId && item.hash === hash,
        )?.commitSeq;
      }
      if (seq == null) throw new Error('Commit outcome unavailable; your saved guess remains on this device');
      store(load().map(item => (item.salt === salt ? { ...item, commitSeq: seq! } : item)));
      setCommitState({ kind: 'done', txHash: result.hash, value: seq });
      await query.invalidateQueries();
    })().catch(error => setCommitState({ kind: 'error', error: toUiError(error) }));
  }

  function reveal(seq: number) {
    setRevealState({ kind: 'signing' });
    void (async () => {
      if (!accountId) throw new Error('Connect your wallet first');
      const guess = load().find(item => item.commitSeq === seq);
      if (!guess) throw new Error('Saved guess not found on this device');
      const [commits, params, block] = await Promise.all([
        views.getCommits(mode, roundId),
        views.getParams(),
        getFinalBlock(),
      ]);
      const record = commits.find(item => item.commitSeq === seq && item.actor === accountId);
      if (!record) throw new Error('E17');
      if (block.height < record.block + params.minRevealDelayBlocks) throw new Error('E18');
      const hex = await encodeRuleHex(guess.guess);
      const result = checked(await calls.revealGuess(mode, seq, hex, guess.salt));
      setRevealState({ kind: 'done', txHash: result.hash, value: result.value });
      await query.invalidateQueries();
    })().catch(error => setRevealState({ kind: 'error', error: toUiError(error) }));
  }

  return {
    commit: { state: commitState, run: commit, reset: () => setCommitState({ kind: 'idle' }) },
    reveal: { state: revealState, run: reveal, reset: () => setRevealState({ kind: 'idle' }) },
    saved,
  };
}
