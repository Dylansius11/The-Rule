import { NavLink } from 'react-router';
import { DOCS_PATH, roomPath, useNavMode } from '@/app/paths';
import { Brand } from './Brand';
import { useGuide } from './guide';
import { SettingsPopover } from './SettingsPopover';
import { StickyHeader } from './StickyHeader';
import { WalletChip } from './WalletChip';

/** The game's header: logo, Play / Season / Account, guide, settings and the wallet. Under it, the deployment strip. */
export function AppHeader() {
  const mode = useNavMode();
  const { show } = useGuide();
  return (
    <StickyHeader>
      <Brand />
      <nav className="ml-auto hidden items-center gap-3.5 md:flex lg:gap-7" aria-label="Main">
        <NavLink to={roomPath(mode)} className="nav-link">
          Play
        </NavLink>
        <NavLink to="/season" className="nav-link">
          Season
        </NavLink>
        <NavLink to="/account" className="nav-link">
          Account
        </NavLink>
        <NavLink to={DOCS_PATH} className="nav-link">
          Docs
        </NavLink>
      </nav>
      <button type="button" className="icon-btn hidden lg:grid" aria-label="How to play" onClick={show}>
        <span aria-hidden="true" className="display text-[28px] leading-none">
          ?
        </span>
      </button>
      <div className="hidden md:block">
        <SettingsPopover />
      </div>
      <div className="ml-auto md:ml-0">
        <WalletChip />
      </div>
    </StickyHeader>
  );
}
