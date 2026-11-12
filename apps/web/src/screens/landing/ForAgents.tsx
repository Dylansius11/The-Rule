import { useEffect, useState } from 'react';
import { DOCS_PATH } from '@/app/paths';
import { useSound } from '@/audio';
import { Button } from '@/ui/Button';

type Copy = 'idle' | 'busy' | 'ok' | 'error';

const MESSAGE: Record<Copy, string> = {
  idle: '',
  busy: 'Fetching the file…',
  ok: 'Copied CONTEXT.md to the clipboard.',
  error: 'Could not copy. Open /CONTEXT.md and copy it from there.',
};

/** A compact band: the docs for people, and the one file that hands the whole game to an agent. */
export function ForAgents() {
  const { play } = useSound();
  const [state, setState] = useState<Copy>('idle');

  useEffect(() => {
    if (state !== 'ok' && state !== 'error') return;
    const id = setTimeout(() => setState('idle'), 3200);
    return () => clearTimeout(id);
  }, [state]);

  async function copy() {
    setState('busy');
    let ok = false;
    try {
      // The docs chunk loads only now, on the click.
      ok = await (await import('@/screens/docs/agentContext')).copyAgentContext();
    } catch {
      ok = false;
    }
    play(ok ? 'success' : 'error');
    setState(ok ? 'ok' : 'error');
  }

  return (
    <div className="wrap grid items-center gap-5 md:grid-cols-[1fr_auto] md:gap-10">
      <div>
        <span className="hand -rotate-1 mb-1.5 block text-[26px] leading-none text-tomato-deep">
          for humans and agents
        </span>
        <h2 className="display text-[clamp(40px,5.5vw,68px)] leading-[0.9]">
          Read it. Or hand it to your agent.
        </h2>
        <p className="mt-3 max-w-[54ch] text-[18px] font-bold leading-snug">
          Plain-language docs for people, and one Markdown file that gives an agent the whole game: the
          grammar, the contract calls and the safety rules.
        </p>
      </div>
      <div>
        <div className="flex flex-wrap gap-x-5 gap-y-3">
          <Button to={DOCS_PATH} variant="sun" size="md">
            Read the docs
          </Button>
          <Button variant="paper" size="md" busy={state === 'busy'} onClick={() => void copy()}>
            {state === 'ok' ? 'Copied ✓' : 'Copy for agent'}
          </Button>
        </div>
        <p className="mt-3 min-h-[1.5em] text-[15px] font-extrabold" role="status">
          {MESSAGE[state]}
        </p>
      </div>
    </div>
  );
}
