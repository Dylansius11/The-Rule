import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { roomPath } from '@/app/paths';
import { useSound, type SoundName } from '@/audio';
import { Art } from '@/art/Art';
import { formatNear } from '@/chain/format';
import { useEntity, useLog, usePlay, usePlayer, useParams, useTeam, useWords } from '@/game';
import type { Mode, PlayState, Round } from '@/game/types';
import { useConnect } from '@/layout/useConnect';
import { Blot, type BlotState } from '@/mascot/Blot';
import { Drip } from '@/mascot/Drip';
import { Doodle } from '@/ui/Doodle';
import { useNow } from '@/motion/hooks';
import { useReduced } from '@/motion/prefs';
import { Button } from '@/ui/Button';
import { Amount } from '@/ui/Amount';
import { InkBox } from '@/ui/InkBox';
import { ReelNumber } from '@/ui/Reel';
import { StatSticker } from '@/ui/Sticker';
import { PlaySlip } from '@/ui/Slip';
import { SpeechBubble } from '@/ui/SpeechBubble';
import { timeAgo } from '@/chain/format';
import { modeName, pad3 } from '@/screens/shared/round';
import { ClaimAll } from '@/screens/shared/ClaimAll';
import { RoundTimer } from '@/screens/shared/RoundTimer';
import { WordPicker } from './WordPicker';
import { teamMinted } from './crew/vault';
import { sameFace } from './sameFace';

const BLOT: Record<PlayState['kind'], BlotState> = {
  idle: 'idle',
  prechecking: 'pending',
  signing: 'pending',
  pending: 'pending',
  known: 'already',
  accepted: 'yes',
  rejected: 'no',
  refunded: 'idle',
  error: 'idle',
};

function line(state: PlayState): string {
  switch (state.kind) {
    case 'idle':
      return 'Pick anything. The law stamps it.';
    case 'prechecking':
      return 'Checking the log first. That part is free.';
    case 'signing':
      return 'Sign in your wallet when you are ready.';
    case 'pending':
      return 'Hmm hmm hmm… reading the law. Your fee is safe.';
    case 'known':
      return 'Already tried that one. Free this time.';
    case 'accepted':
      return 'Accepted! The law likes that one.';
    case 'rejected':
      return 'Rejected. The fee joined the pot.';
    case 'refunded':
      return 'The program could not answer. Your fee is back.';
    case 'error':
      return 'That did not go through. Read the slip.';
  }
}

const BUSY: PlayState['kind'][] = ['prechecking', 'signing', 'pending'];

/** The stamp desk (S1): reels, word chips, STAMP, slip, Blot reacting to recorded results only. */
export function PlayDesk({ mode, round }: { mode: Mode; round: Round }) {
  const { wallet, connect, busy: connecting } = useConnect();
  const words = useWords();
  const params = useParams();
  const player = usePlayer(wallet.accountId);
  const entity = useEntity(mode, round.roundId, wallet.accountId);
  const team = useTeam(mode === 1 ? (player.data?.teamId ?? null) : null);
  const play = usePlay(mode, round.roundId);
  const now = useNow(15_000);
  const log = useLog(mode, round.roundId);
  const mintedMine =
    wallet.accountId && player.data?.teamId != null
      ? teamMinted(log.rows, player.data.teamId, wallet.accountId).mine
      : 0n;

  const [number, setNumber] = useState(417);
  const [word, setWord] = useState<string | null>(null);
  const repeats = sameFace(log.rows, number, word);
  const [pressed, setPressed] = useState(false);
  const desk = useRef<HTMLDivElement>(null);
  const reduced = useReduced();

  const list = words.data ?? [];
  useEffect(() => {
    if (word === null && list.length) setWord(list[Math.floor(list.length / 9)] ?? list[0] ?? null);
  }, [list, word]);

  const fee = params.data?.playFee ?? null;
  const balance = mode === 0 ? player.data?.credit : team.data?.vault;
  const left = entity.data ? entity.data.limit - entity.data.attempts : null;
  const inFlight = BUSY.includes(play.state.kind);
  const waiting = !!player.data?.pendingPlay || !!entity.data?.pending;

  // Sounds answer the player's own stamp: the verdict on their play, never page load or polling.
  const sound = useSound();
  const stateKind = play.state.kind;
  const lastKind = useRef(stateKind);
  const minted = play.state.kind === 'accepted' && play.state.row.minted > 0n;
  useEffect(() => {
    if (lastKind.current === stateKind) return;
    lastKind.current = stateKind;
    const cue: Partial<Record<PlayState['kind'], SoundName>> = {
      pending: 'pending',
      accepted: 'yes',
      rejected: 'no',
      known: 'duplicate',
      refunded: 'refund',
      error: 'error',
    };
    const name = cue[stateKind];
    if (name) sound.play(name);
    if (stateKind === 'accepted' && minted) setTimeout(() => sound.play('mint'), 280);
  }, [stateKind, minted, sound]);

  let reason: ReactReason = null;
  if (wallet.status === 'connected') {
    if (waiting && !inFlight)
      reason = { text: 'A play is already waiting for the sealed program. One at a time.' };
    else if (left !== null && left <= 0) reason = { text: 'No attempts left in this round for your line.' };
    else if (fee !== null && balance !== undefined && balance < fee)
      reason = {
        text: `Not enough ${mode === 0 ? 'game credit' : 'team vault'} for the ${formatNear(fee)} NEAR fee.`,
        to: mode === 0 ? '/account' : roomPath(1, 'crew'),
        cta: mode === 0 ? 'Add credit' : 'Open the crew desk',
      };
  }
  const canStamp = wallet.status === 'connected' && !reason && !inFlight && word !== null && fee !== null;

  function stamp() {
    if (!canStamp || word === null) return;
    setPressed(true);
    if (!reduced)
      desk.current?.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(5px)' }, { transform: 'translateY(0)' }],
        { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    setTimeout(() => setPressed(false), 140);
    play.stamp({ number, word });
  }

  const minuteDigit = new Date(now).getUTCMinutes() % 10;
  const hh = String(new Date(now).getUTCHours()).padStart(2, '0');
  const mm = String(new Date(now).getUTCMinutes()).padStart(2, '0');
  const pulse = 'row' in play.state ? play.state.row.seq : play.state.kind;
  const burst = play.state.kind === 'accepted' ? play.state.row.seq : null;
  const slipError = play.state.kind === 'error' ? play.state.error : null;

  const slip = (
    <PlaySlip
      state={play.state}
      onDismissError={play.reset}
      onRetry={slipError?.retryable ? play.reset : undefined}
    />
  );

  return (
    <div ref={desk} className="wrap grid items-start gap-6 md:grid-cols-[0.9fr_1.1fr] md:gap-11">
      <ClaimAll className="md:col-span-2" />
      <InkBox
        className="relative px-5 pb-6 pt-7 text-center md:order-1 md:px-6"
        tilt={-1.2}
        aria-label="Blot's stamp desk"
      >
        <SpeechBubble id={line(play.state)} className="mb-5">
          {line(play.state)}
        </SpeechBubble>
        <div className="mx-auto w-[min(150px,40vw)] md:w-[min(300px,76%)]">
          <Blot state={BLOT[play.state.kind]} width="100%" pulse={pulse} burst={burst} preload />
        </div>
        <div className="hidden md:block">{slip}</div>
      </InkBox>

      <InkBox className="relative p-5 md:order-2 md:p-8" tilt={0.8}>
        <Drip pose="peek" width={104} className="pointer-events-none absolute -top-[46px] right-8 z-10" />
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="display text-[clamp(40px,6vw,52px)]">Make a play</h2>
          <span className="mono rounded-full bg-ink px-2.5 py-1 text-[14px] font-bold text-sun">
            {modeName(mode)} #{round.roundId} · No. {pad3(number)}
          </span>
        </div>
        <RoundTimer round={round} className="mb-3 mt-1" />
        {mode === 1 ? (
          <>
            <p className="mt-1 text-[15px] font-bold">
              Your team plays as one: this play is paid from the team vault and uses the team&apos;s single
              line.
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-3">
              <StatSticker label="Team vault" tone="sun" tilt={-1.5} mono className="!min-w-0">
                {team.data ? <Amount kind="near" value={team.data.vault} digits={3} /> : 'no team'}
              </StatSticker>
              <StatSticker label="Round pot" tone="paper" tilt={1} mono className="!min-w-0">
                <Amount kind="near" value={round.pot} digits={3} />
              </StatSticker>
              <StatSticker label="Your RULE" tone="lime" tilt={-1} mono className="!min-w-0">
                <Amount kind="rule" value={mintedMine} />
              </StatSticker>
            </dl>
          </>
        ) : null}

        <div className="hand mt-3 flex items-baseline gap-3 text-[26px]">
          number <small className="mono text-[13px] font-bold opacity-70">000 to 999</small>
          <span className="whitespace-nowrap md:hidden" aria-hidden="true">
            <Doodle name="doodles/hand" size={26} rot={-10} />{' '}
            <small className="mono text-[12px] font-bold">tap the triangles</small>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <ReelNumber value={number} onChange={setNumber} disabled={inFlight} />
          <div className="ml-auto flex gap-3 max-[420px]:ml-0 max-[420px]:w-full md:flex-col">
            <Button
              variant="paper"
              size="sm"
              disabled={inFlight}
              onClick={() => setNumber(Math.floor(Math.random() * 1000))}
            >
              Random
            </Button>
            <Button
              variant="paper"
              size="sm"
              disabled={inFlight}
              onClick={() => setNumber(n => (n + 1) % 1000)}
            >
              +1
            </Button>
          </div>
        </div>

        <div className="hand mt-4 flex items-baseline gap-3 text-[26px]">
          word{' '}
          <small className="mono text-[13px] font-bold opacity-70">
            {list.length || '…'} words on the list
          </small>
        </div>
        {words.isError ? (
          <p className="font-bold text-tomato-deep">
            The word list could not be loaded. Reload the page to retry.
          </p>
        ) : (
          <WordPicker words={list} value={word} onChange={setWord} disabled={inFlight} />
        )}

        <p
          className="mono my-5 text-[14px] font-bold leading-relaxed text-ink-soft"
          aria-label="Live time context"
        >
          UTC {hh}:{mm} · minute digit {minuteDigit}
          {entity.data?.line
            ? ` · your line: ${pad3(entity.data.line.number)} ${entity.data.line.word}, ${timeAgo(entity.data.line.atMs)}`
            : wallet.status === 'connected'
              ? ' · no accepted line yet'
              : ''}
          {left !== null ? ` · attempts left ${left} of ${entity.data?.limit}` : ''}
        </p>
        {repeats.length > 0 ? (
          <p
            className="mb-4 rounded-2xl border-[3px] border-ink bg-sun px-3 py-2 text-[14px] font-bold"
            role="status"
          >
            {pad3(number)} · {word} was already stamped{' '}
            {repeats.length === 1 ? 'once' : `${repeats.length} times`} this round (last at minute digit{' '}
            {repeats[repeats.length - 1]?.minuteDigit}: {repeats[repeats.length - 1]?.verdict ? 'YES' : 'NO'}
            ). The law can read the minute digit and your previous play, so a repeat in a different context is
            a new paid play. A different pair tells you more.
          </p>
        ) : null}

        {wallet.status === 'connected' ? (
          <Button
            variant="red"
            size="lg"
            block
            pressed={pressed}
            busy={inFlight}
            disabled={!canStamp}
            onClick={stamp}
            sound="stamp"
          >
            {inFlight ? 'Stamping…' : 'STAMP!'}
            {fee !== null && !inFlight ? (
              <span className="mono text-[16px] font-bold tracking-wide">{formatNear(fee)} NEAR</span>
            ) : null}
          </Button>
        ) : (
          <div className="flex items-center gap-4">
            <Art name="stickers/pointing" width={84} />
            <div className="min-w-0 flex-1">
              <p className="mb-2 font-extrabold">Your turn. Connect a testnet wallet to stamp a play.</p>
              <Button
                variant="red"
                size="lg"
                block
                onClick={connect}
                busy={connecting || wallet.status === 'loading'}
              >
                {connecting ? 'Connecting…' : 'Connect wallet'}
              </Button>
            </div>
          </div>
        )}
        {reason ? (
          <p className="mt-3 font-bold" role="status">
            {reason.text}{' '}
            {reason.to ? (
              <Link to={reason.to} className="font-extrabold underline decoration-2 underline-offset-2">
                {reason.cta}
              </Link>
            ) : null}
          </p>
        ) : null}
        <div className="md:hidden">{slip}</div>
      </InkBox>
    </div>
  );
}

type ReactReason = { text: string; to?: string; cta?: string } | null;
