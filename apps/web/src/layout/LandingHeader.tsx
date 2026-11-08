import { Link } from 'react-router';
import { DOCS_PATH } from '@/app/paths';
import { Button } from '@/ui/Button';
import { Brand } from './Brand';
import { StickyHeader } from './StickyHeader';

const ANCHORS = [
  { href: '#how', label: 'How to play' },
  { href: '#last-law', label: 'The last law' },
  { href: '#season', label: 'Season' },
] as const;

/** The landing header: logo, three anchors into the page and the way in. No wallet here. */
export function LandingHeader() {
  return (
    <StickyHeader>
      <Brand />
      <nav className="ml-auto hidden items-center gap-5 lg:flex lg:gap-7" aria-label="On this page">
        {ANCHORS.map(a => (
          <a key={a.href} href={a.href} className="nav-link">
            {a.label}
          </a>
        ))}
        <Link to={DOCS_PATH} className="nav-link">
          Docs
        </Link>
      </nav>
      <div className="ml-auto lg:ml-2">
        <Button to="/play" variant="red" size="sm">
          <span className="max-xs:hidden">Enter the game</span>
          <span className="xs:hidden">Play</span>
        </Button>
      </div>
    </StickyHeader>
  );
}
