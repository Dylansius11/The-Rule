import { useSound } from '@/audio';
import { Art } from '@/art/Art';
import { Button } from '@/ui/Button';
import { InkBox } from '@/ui/InkBox';
import { LiveRegion } from '@/ui/LiveRegion';
import { CONTEXT_PATH, GRAMMAR_PATH, LLMS_PATH } from './agentContext';
import { copyMessage, useCopy, useDocText, useTextLoader } from './data';
import { kilobytes } from './model';

/** "Feed this to your agent": the real CONTEXT.md, one click away, with its size, raw link and download. */
export function AgentCard() {
  const context = useDocText(CONTEXT_PATH);
  const load = useTextLoader();
  const { play } = useSound();
  const { state, busy, copy } = useCopy();
  const size = context.data ? kilobytes(context.data) : context.isError ? 'unavailable' : '…';

  return (
    <InkBox
      as="section"
      fill="var(--color-grape)"
      radius="blob-lg"
      className="doc-agent p-6 text-white md:p-9"
      aria-labelledby="agent-title"
    >
      <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="hand text-[26px] leading-none">for the bots in your life</p>
          <h2 id="agent-title" className="display mt-1 text-[clamp(40px,6vw,64px)] leading-[0.9]">
            Feed this to your agent
          </h2>
          <p className="mt-3 max-w-[56ch] text-[18px] font-bold leading-snug">
            One Markdown file with the game, the grammar, the contract calls and the safety rules, in the
            order an agent needs them. Paste it into your agent’s context, or point your agent at the address.
          </p>
          <p className="mono mt-3 break-all text-[14px] font-bold" data-testid="context-meta">
            {CONTEXT_PATH.slice(1)} · <span data-testid="context-size">{size}</span> · plain Markdown ·{' '}
            <span className="select-all">{`${location.origin}${CONTEXT_PATH}`}</span>
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button
              variant="red"
              size="md"
              busy={busy}
              sound="tap"
              onClick={() => void copy('CONTEXT.md', () => load(CONTEXT_PATH))}
            >
              {state.kind === 'ok' ? 'Copied ✓' : 'Copy CONTEXT.md'}
            </Button>
            <Button variant="paper" size="md" href={CONTEXT_PATH}>
              Open raw
            </Button>
            <a
              href={CONTEXT_PATH}
              download="CONTEXT.md"
              className="btn"
              data-variant="paper"
              data-size="md"
              onClick={() => play('tap')}
            >
              <span className="btn-face">Download</span>
            </a>
          </div>
          <p
            className={`mt-3 min-h-[1.5em] text-[16px] font-extrabold ${state.kind === 'error' ? 'doc-agent-error' : ''}`}
            data-testid="copy-status"
          >
            {copyMessage(state)}
          </p>
          <LiveRegion message={copyMessage(state)} assertive={state.kind === 'error'} />
          <p className="mt-2 text-[16px] font-bold">
            Also for machines:{' '}
            <a className="doc-agent-link" href={LLMS_PATH} target="_blank" rel="noopener noreferrer">
              llms.txt
            </a>
            , a page index for crawlers and agents; and{' '}
            <a className="doc-agent-link" href={GRAMMAR_PATH} target="_blank" rel="noopener noreferrer">
              grammar.json
            </a>
            , every atom and word of the grammar as data.
          </p>
        </div>
        <Art name="scenes/desk" width={210} className="mx-auto max-md:hidden" />
      </div>
    </InkBox>
  );
}
