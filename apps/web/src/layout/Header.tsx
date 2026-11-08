import { Link, NavLink } from 'react-router';
import { config, deploymentLabel } from '@/config/env';
import { BlotPeek } from '@/mascot/Blot';
import { DESKTOP_NAV } from './nav';
import { WalletChip } from './WalletChip';

/** Sticky header: Blot peeks over the rule beside the THE RULE wordmark, nav, wallet. Under it the deployment strip is always visible. */
export function Header() {
  const demo = config.main.kind === 'demo';
  return (
    <header className="sticky top-0 z-30 bg-paper">
      <div
        className="flex items-center gap-3 border-b-[3.5px] border-ink px-3.5 md:gap-5 md:px-7"
        style={{ height: 'var(--header-bar-h)' }}
      >
        <Link
          to="/"
          className="flex items-end gap-2.5 self-end"
          aria-label="THE RULE, home"
          style={{ marginBottom: -4 }}
        >
          <span className="block w-[78px] shrink-0 md:w-[104px]">
            <BlotPeek width={104} />
          </span>
          <span
            className="display poster mb-2 text-[32px] leading-none md:mb-3 md:text-[42px]"
            aria-hidden="true"
          >
            <span className="text-sun">THE</span> <span className="text-tomato">RULE</span>
          </span>
        </Link>
        <nav className="ml-auto hidden items-center gap-6 md:flex" aria-label="Main">
          {DESKTOP_NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto md:ml-2">
          <WalletChip />
        </div>
      </div>
      <div
        role="note"
        data-demo={demo ? 'true' : undefined}
        className={`relative flex min-h-[32px] items-center justify-center border-b-[3px] border-ink px-3 py-1 text-center ${
          demo ? 'bg-tomato' : 'bg-paper-2'
        }`}
      >
        <span
          className={
            demo
              ? 'display text-[22px] leading-none tracking-wide'
              : 'mono text-[13px] font-bold leading-tight'
          }
        >
          {demo ? '' : <span aria-hidden="true">● </span>}
          {deploymentLabel(config.main.kind)}
        </span>
        <button
          type="button"
          disabled
          title={
            config.demo
              ? 'Demo switching needs the demo deployment context'
              : 'No demo instance is deployed yet'
          }
          className="mono absolute right-3 top-1/2 hidden min-h-[28px] -translate-y-1/2 rounded-full border-2 border-ink bg-paper px-3 text-[12px] font-bold opacity-70 md:block"
        >
          {config.demo ? 'Demo instance configured' : 'Demo Mode: not deployed'}
        </button>
      </div>
    </header>
  );
}
