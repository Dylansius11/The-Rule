import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Art } from '@/art/Art';
import { formatNear, shortHash } from '@/chain/format';
import { toUiError } from '@/chain/errors';
import { useCommits, useGuessActions, useLatestRound, useLog, useParams, useWallet } from '@/game';
import type { CanonicalRule, Commit, Mode, Round } from '@/game/types';
import { useConnect } from '@/layout/useConnect';
import { checkConsistent, useAtomCatalog, useRuleText } from '@/verify';
import { ActionSlip } from '@/ui/ActionSlip';
import { Button } from '@/ui/Button';
import { RadioChips } from '@/ui/Chip';
import { Doodle } from '@/ui/Doodle';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorCard } from '@/ui/ErrorCard';
import { InkBox } from '@/ui/InkBox';
import { LiveRegion } from '@/ui/LiveRegion';
import { Tag } from '@/ui/Tag';
import { ModePicker } from './shared/ModePicker';
import { AtomPicker } from './shared/AtomPicker';
import { PageHead } from './shared/PageHead';
import { fmtUtc } from './shared/format';
import { isPlayable, modeName, phaseLabel } from './shared/round';

type Check =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; consistent: boolean; mismatches: number[]; rows: number }
  | { kind: 'error'; message: string };

const STATUS_TONE: Record<Commit['status'], 'soft' | 'sun' | 'yes' | 'no' | 'pink'> = {
  Committed: 'sun',
  Checking: 'pink',
  Correct: 'yes',
  Wrong: 'no',
  Refunded: 'soft',
  Unrevealed: 'soft',
};

function stakeFor(round: Round, mode: Mode, bps: [number, number], min: bigint) {
  const pct = (round.pot * BigInt(bps[mode])) / 10_000n;
  return pct < min ? min : pct;
}

/** S3: build a guess from the published atoms, check it against the log, commit, reveal. */
export function GuessPage() {
  const [mode, setMode] = useState<Mode>(0);
  const latest = useLatestRound(mode);
  const round = latest.data ?? null;
  const params = useParams();
  const catalog = useAtomCatalog();
  const { wallet } = useConnect();
  const { accountId } = useWallet();
  const log = useLog(mode, round?.roundId ?? null);
  const commits = useCommits(mode, round?.roundId ?? null);
  const actions = useGuessActions(mode, round?.roundId ?? 0);

  const [form, setForm] = useState(0);
  const [lits, setLits] = useState<{ atom: number | null; neg: boolean }[]>([
    { atom: null, neg: false },
    { atom: null, neg: false },
  ]);
  const [check, setCheck] = useState<Check>({ kind: 'idle' });

  const slots = form === 0 ? 1 : 2;
  const picked = lits.slice(0, slots);
  const complete = picked.every(l => l.atom !== null) && (slots === 1 || picked[0]!.atom !== picked[1]!.atom);
  const rule: CanonicalRule | null = useMemo(() => {
    if (!complete) return null;
    const pairs = picked
      .map(l => [l.atom!, l.neg ? 1 : 0] as [number, number])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { v: 'g1', form, lits: pairs };
  }, [complete, picked, form]);
  const text = useRuleText(rule);
  useEffect(() => setCheck({ kind: 'idle' }), [rule]);

  async function runCheck() {
    if (!rule) return;
    setCheck({ kind: 'running' });
    try {
      const r = await checkConsistent(rule, log.rows);
      setCheck({ kind: 'done', consistent: r.consistent, mismatches: r.mismatches, rows: log.rows.length });
    } catch (e) {
      setCheck({ kind: 'error', message: toUiError(e).title });
    }
  }

  const open = isPlayable(round);
  const mine = (commits.data ?? []).filter(c => c.actor === accountId);
  const stake =
    round && params.data ? stakeFor(round, mode, params.data.stakeBps, params.data.stakeMin) : null;
  const atoms = catalog.atoms;
  const second = lits[1]!;
  const first = lits[0]!;
  const preview = picked
    .map(l => atoms.find(a => a.id === l.atom))
    .map((a, i) => (a ? (picked[i]!.neg ? a.negated : a.english) : null));

  return (
    <div className="wrap pb-20 pt-8 md:pt-12">
      <PageHead
        title={
          <>
            Make your <span className="text-tomato">guess</span>
          </>
        }
        kicker="seal it, then open it"
        note="a guess is a hash until you reveal it."
        art="scenes/envelope"
        artWidth={170}
      />
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <ModePicker mode={mode} onChange={setMode} />
        {round ? (
          <span className="flex items-center gap-3 font-bold">
            <Tag tone={open ? 'sun' : 'soft'}>{phaseLabel(round.phase)}</Tag>
            <span className="mono text-[14px]">
              {modeName(mode)} round {round.roundId} · pot {formatNear(round.pot, 3)} NEAR
            </span>
          </span>
        ) : null}
      </div>

      {latest.isError ? (
        <div className="mt-6">
          <ErrorCard error={toUiError(latest.error)} onRetry={() => void latest.refetch()} />
        </div>
      ) : null}

      {!open && !latest.isLoading ? (
        <div className="mt-8">
          <EmptyState
            title="No round is taking guesses"
            art="stickers/envelope"
            artWidth={150}
            actions={
              <Button to="/reveal" variant="red">
                See the last opened law
              </Button>
            }
          >
            {round
              ? `${modeName(mode)} round ${round.roundId} is ${phaseLabel(round.phase).toLowerCase()}. `
              : `No ${modeName(mode).toLowerCase()} round has started. `}
            Guesses can be sealed only while plays are open. Your saved guesses and their results stay listed
            below.
          </EmptyState>
        </div>
      ) : null}

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <InkBox className="p-5 md:p-7" fill="#fff" tilt={-0.5}>
          <h2 className="display text-[40px] leading-none">The notebook</h2>
          <p className="mt-1 text-[16px] font-semibold">
            Rules are one or two published atoms. Pick the shape, then the atoms.
          </p>
          <div className="mt-4">
            <RadioChips
              label="Rule shape"
              value={form}
              onChange={f => setForm(f)}
              options={(catalog.forms.length
                ? catalog.forms
                : [
                    { id: 0, name: 'Single' },
                    { id: 1, name: 'AND' },
                    { id: 2, name: 'OR' },
                  ]
              ).map(f => ({ value: f.id, label: f.name }))}
              small
            />
          </div>
          {catalog.atoms.length === 0 ? (
            <p className="mt-4 font-bold" aria-busy="true">
              Loading the published atoms…
            </p>
          ) : (
            <div className="mt-5 grid gap-6">
              <AtomPicker
                label={slots === 1 ? 'Atom' : 'First atom'}
                atoms={atoms}
                atomId={first.atom}
                negated={first.neg}
                taken={slots === 2 ? second.atom : null}
                onChange={(a, n) => setLits([{ atom: a, neg: n }, second])}
              />
              {slots === 2 ? (
                <AtomPicker
                  label="Second atom"
                  atoms={atoms}
                  atomId={second.atom}
                  negated={second.neg}
                  taken={first.atom}
                  onChange={(a, n) => setLits([first, { atom: a, neg: n }])}
                />
              ) : null}
            </div>
          )}

          <div className="mt-6 rounded-lg border-[3px] border-ink bg-paper-2 p-4" aria-live="polite">
            <div className="mono text-[12px] font-bold uppercase tracking-widest text-ink-soft">
              Your guess reads
            </div>
            {rule ? (
              <p className="mt-1 text-[22px] font-extrabold leading-snug">
                {text ? text.english : preview.filter(Boolean).join(form === 1 ? ' and ' : ' or ')}
              </p>
            ) : (
              <p className="mt-1 font-bold">
                {slots === 2 && first.atom !== null && first.atom === second.atom
                  ? 'The two atoms must differ.'
                  : 'Pick the atoms to see the rule in words.'}
              </p>
            )}
            {text ? (
              <code className="mono mt-2 block break-all text-[13px] font-bold">{text.dsl}</code>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Button
              variant="paper"
              disabled={!rule || !log.complete || check.kind === 'running'}
              busy={check.kind === 'running'}
              onClick={() => void runCheck()}
            >
              Check against the log
            </Button>
            <span className="text-[15px] font-bold">
              {log.complete
                ? `${log.rows.length} plays loaded`
                : `Loading the log: ${log.loaded} of ${log.total}`}
            </span>
          </div>
          <div aria-live="polite" className="mt-3">
            {check.kind === 'done' ? (
              check.consistent ? (
                <p className="font-extrabold">
                  <span aria-hidden="true">✓ </span>Consistent with all {check.rows} logged verdicts. That
                  does not make it the rule: other guesses can fit too.
                </p>
              ) : (
                <p className="font-extrabold text-tomato-deep">
                  <span aria-hidden="true">✗ </span>Disagrees with {check.mismatches.length} logged verdict
                  {check.mismatches.length === 1 ? '' : 's'} (first at play{' '}
                  {check.mismatches.slice(0, 5).join(', ')}). It cannot be the rule.
                </p>
              )
            ) : null}
            {check.kind === 'error' ? (
              <p className="font-extrabold text-tomato-deep">
                The local check could not run: {check.message}. Nothing was sent.
              </p>
            ) : null}
          </div>

          <div className="mt-6 border-t-[3px] border-dashed border-ink/40 pt-5">
            <h3 className="display flex items-center gap-2 text-[32px] leading-none">
              Commit <Doodle name="doodles/ribbon" size={64} rot={-4} />
            </h3>
            <p className="mt-1 text-[16px] font-semibold">
              {stake !== null ? (
                <>
                  Stake locked at commit: <b className="mono">{formatNear(stake, 3)} NEAR</b>. Correct returns
                  it; wrong or unrevealed returns half and the other half joins the pot.
                </>
              ) : (
                'Reading the stake from the contract…'
              )}
            </p>
            <p className="mt-1 text-[15px] font-bold">
              The salt for this guess is stored only in this browser. Do not clear site data before you
              reveal.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              {wallet.status !== 'connected' ? (
                <>
                  <Art name="stickers/pointing" width={70} />
                  <span className="font-extrabold">Connect a wallet to commit.</span>
                </>
              ) : (
                <Button
                  variant="red"
                  size="lg"
                  disabled={!rule || !open || !stake}
                  busy={actions.commit.state.kind === 'signing' || actions.commit.state.kind === 'pending'}
                  onClick={() => rule && actions.commit.run(rule)}
                >
                  Seal &amp; commit
                </Button>
              )}
              {!open && wallet.status === 'connected' ? (
                <span className="font-bold">Commits are closed: no round is taking plays.</span>
              ) : null}
            </div>
            <div className="mt-4 flex items-start gap-3">
              {actions.commit.state.kind === 'done' ? (
                <Art name="stickers/envelope" width={84} className="shrink-0" />
              ) : null}
              <div className="min-w-0 flex-1">
                <ActionSlip
                  state={actions.commit.state}
                  doneText="Committed. Your guess is a hash on chain now. Reveal it below after the minimum delay."
                  onReset={actions.commit.reset}
                />
              </div>
            </div>
          </div>
        </InkBox>

        <div className="grid gap-6">
          <InkBox className="p-5" fill="var(--color-paper)" tilt={0.7}>
            <div className="flex items-center gap-3">
              <Doodle name="doodles/envelope" size={56} />
              <h2 className="display text-[36px] leading-none">Your commits</h2>
            </div>
            <LiveRegion
              message={
                actions.reveal.state.kind === 'done' ? 'Guess revealed. The program is checking it.' : ''
              }
            />
            {wallet.status !== 'connected' ? (
              <p className="mt-3 font-bold">Connect a wallet to see your commits.</p>
            ) : mine.length === 0 ? (
              <div className="mt-3 flex items-center gap-4">
                <Art name="stickers/asleep" width={90} />
                <p className="font-bold">No commits from {accountId} in this round.</p>
              </div>
            ) : (
              <ul className="mt-3 grid gap-3">
                {mine.map(c => {
                  const saved = actions.saved.find(s => s.commitSeq === c.commitSeq);
                  return (
                    <li key={c.commitSeq} className="rounded-lg border-[3px] border-ink bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="mono font-bold">commit #{c.commitSeq}</span>
                        <Tag tone={STATUS_TONE[c.status]}>{c.status}</Tag>
                      </div>
                      <div className="mono mt-1 text-[13px] font-bold">
                        hash {shortHash(c.hash)} · stake {formatNear(c.stake, 3)} NEAR
                      </div>
                      {c.status === 'Committed' ? (
                        saved ? (
                          <div className="mt-2">
                            <Button
                              variant="grape"
                              size="sm"
                              busy={
                                actions.reveal.state.kind === 'signing' ||
                                actions.reveal.state.kind === 'pending'
                              }
                              onClick={() => actions.reveal.run(c.commitSeq)}
                            >
                              Reveal this guess
                            </Button>
                            {round?.revealDeadlineMs ? (
                              <p className="mt-1 text-[13px] font-semibold">
                                Reveal deadline {fmtUtc(round.revealDeadlineMs)}.
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-2 text-[14px] font-bold text-tomato-deep">
                            The salt for this commit is not on this device, so it cannot be revealed here.
                          </p>
                        )
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-3">
              <ActionSlip
                state={actions.reveal.state}
                doneText="Reveal sent. The sealed program is checking your guess; the status above will change."
                onReset={actions.reveal.reset}
              />
            </div>
            {commits.isError ? (
              <div className="mt-3">
                <ErrorCard error={toUiError(commits.error)} onRetry={() => void commits.refetch()} />
              </div>
            ) : null}
          </InkBox>
          <p className="text-[14px] font-semibold text-ink-soft">
            New to this?{' '}
            <Link to="/#how" className="font-extrabold underline decoration-2 underline-offset-2">
              How it works
            </Link>
            . Commit order decides ties: the earliest correct commit wins.
          </p>
        </div>
      </div>
    </div>
  );
}
