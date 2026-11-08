import { Art } from '@/art/Art';
import { active, REPLAY_LIMIT, TRUST_SENTENCE } from '@/config/env';
import { HashText } from '@/ui/HashText';
import { Letters } from '@/ui/Letters';
import { WaveEdge } from '@/ui/WaveEdge';

/** The landing sign-off: trust sentence, replay limit, testnet and no-price note, accounts, Blot in the pool. */
export function LandingFooter() {
  return (
    <footer className="relative overflow-x-clip bg-paper px-4 pb-10 pt-16 text-center md:pt-24">
      <WaveEdge fill="#FFFBEA" seed={6} amp={12} />
      <div className="wrap">
        <p className="display poster text-[clamp(80px,17vw,230px)] leading-[0.82] text-sun">
          <Letters text="THE RULE" />
        </p>
        <div className="mx-auto -mt-1 w-[200px]">
          <Art name="scenes/pool" width={200} />
        </div>
        <div className="mx-auto mt-6 grid max-w-[70ch] gap-3 text-[15px] font-semibold text-ink-soft">
          <p className="text-[16px] font-bold text-ink">{TRUST_SENTENCE}</p>
          <p>{REPLAY_LIMIT}</p>
          <p>Testnet play money only. No price, return, liquidity or redemption promise for RULE.</p>
        </div>
        <dl className="mono mx-auto mt-6 flex max-w-[70ch] flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] font-bold">
          <div className="flex items-center gap-2">
            <dt>game</dt>
            <dd>
              <HashText value={active.game} kind="account" full label="game account" />
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt>token</dt>
            <dd>
              <HashText value={active.token} kind="account" full label="token account" />
            </dd>
          </div>
        </dl>
      </div>
    </footer>
  );
}
