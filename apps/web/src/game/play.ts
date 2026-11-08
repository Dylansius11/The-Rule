import { useEffect, useReducer, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWallet } from '@/app/providers';
import * as calls from '@/chain/calls';
import { LocalPlayError, toUiError, UnknownPlayAcknowledgement } from '@/chain/errors';
import { getFinalBlock } from '@/chain/rpc';
import * as views from '@/chain/views';
import type { LogRow, Mode, PlayInput, PlayState } from './types';
import { buildPlayContext, detectRefund, findPlayRow, parsePlayAck, type PlayAck } from './play-helpers';
import { playReducer } from './play-state';

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, 4000);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function readMatchingRow(
  mode: Mode,
  roundId: number,
  words: string[],
  ack: PlayAck,
  initialLogLength: number,
  currentLogLength: number,
  signal: AbortSignal,
): Promise<LogRow | undefined> {
  const start = ack.status === 'Known' ? ack.logIdx : initialLogLength;
  const end = ack.status === 'Known' ? ack.logIdx + 1 : currentLogLength;
  for (let from = start; from < end && !signal.aborted; from += 200) {
    const rows = await views.getLog(mode, roundId, from, Math.min(200, end - from), words);
    if (signal.aborted) return undefined;
    const row = findPlayRow(rows, ack);
    if (row) return row;
  }
  return undefined;
}

export function usePlay(mode: Mode, roundId: number) {
  const [state, dispatch] = useReducer(playReducer, { kind: 'idle' } as PlayState);
  const { accountId } = useWallet();
  const query = useQueryClient();
  const operation = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      operation.current?.abort();
      operation.current = null;
    },
    [],
  );

  function reset() {
    operation.current?.abort();
    operation.current = null;
    dispatch({ type: 'reset' });
  }

  function stamp(input: PlayInput) {
    if (operation.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    operation.current = controller;
    dispatch({ type: 'start', input });

    void (async () => {
      let transactionStarted = false;
      try {
        if (!accountId) throw new LocalPlayError('wallet');
        const [words, player, round, block] = await Promise.all([
          views.getWords(),
          views.getPlayer(accountId),
          views.getRound(mode, roundId),
          getFinalBlock(),
        ]);
        if (signal.aborted) return;
        if (!round || round.phase !== 'Investigation') throw new LocalPlayError('round');
        const entity = await views.getEntity(mode, roundId, accountId, words);
        if (signal.aborted) return;
        const play = buildPlayContext(input, words, entity.line, block.timestampMs);
        const known = await views.getVerdict(mode, roundId, play, words);
        if (signal.aborted) return;
        if (known) {
          dispatch({ type: 'known', row: known });
          return;
        }
        const team = mode === 1 && player?.teamId != null ? await views.getTeam(player.teamId) : null;
        if (signal.aborted) return;
        const balance = mode === 0 ? player?.credit : team?.vault;
        dispatch({ type: 'sign' });
        transactionStarted = true;
        const outcome = await calls.play(mode, input);
        if (signal.aborted) return;
        const status = outcome.status;
        if (typeof status === 'object' && 'Failure' in status) {
          throw new Error(JSON.stringify(status.Failure));
        }
        const txHash = outcome.transaction?.hash ?? null;
        let ack: PlayAck | null = null;
        if (typeof status === 'object' && 'SuccessValue' in status && status.SuccessValue) {
          try {
            ack = parsePlayAck(JSON.parse(atob(status.SuccessValue)));
          } catch {
            ack = null;
          }
        }
        if (!ack) throw new UnknownPlayAcknowledgement(txHash);
        dispatch({ type: 'pending', txHash, sinceMs: Date.now() });

        while (!signal.aborted) {
          const [currentEntity, currentPlayer] = await Promise.all([
            views.getEntity(mode, roundId, accountId, words),
            views.getPlayer(accountId),
          ]);
          if (signal.aborted) return;
          // Read the round after the entity, so a cleared flag cannot race an older log length.
          const current = await views.getRound(mode, roundId);
          if (signal.aborted) return;
          const row = await readMatchingRow(
            mode,
            roundId,
            words,
            ack,
            round.logLen,
            current?.logLen ?? round.logLen,
            signal,
          );
          if (signal.aborted) return;
          if (row) {
            dispatch({ type: ack.status === 'Known' ? 'known' : 'row', row });
            break;
          }
          const currentTeam =
            mode === 1 && player?.teamId != null ? await views.getTeam(player.teamId) : null;
          if (signal.aborted) return;
          const currentBalance = mode === 0 ? currentPlayer?.credit : currentTeam?.vault;
          if (detectRefund(ack, currentEntity.pending, currentPlayer?.pendingPlay, balance, currentBalance)) {
            dispatch({ type: 'refund' });
            break;
          }
          await waitForPoll(signal);
        }
        if (!signal.aborted) await query.invalidateQueries();
      } catch (error) {
        if (signal.aborted) return;
        const mapped =
          transactionStarted || error instanceof LocalPlayError ? error : new LocalPlayError('precheck');
        dispatch({ type: 'error', error: toUiError(mapped) });
      } finally {
        if (operation.current === controller) operation.current = null;
      }
    })();
  }

  return { state, stamp, reset };
}
