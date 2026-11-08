import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { Button } from '@/ui/Button';
import { LandingFooter } from './LandingFooter';
import { LandingHeader } from './LandingHeader';

/** Frame around the landing page: landing header, full footer and, on phones, an Enter the game bar once the hero scrolls away. */
export function LandingShell() {
  return (
    <div className="pb-[88px] md:pb-0">
      <LandingHeader />
      <main id="main" tabIndex={-1} className="overflow-x-clip outline-none">
        <Outlet />
      </main>
      <LandingFooter />
      <StickyCta />
    </div>
  );
}

function StickyCta() {
  const [pastHero, setPastHero] = useState(false);
  useEffect(() => {
    const hero = document.getElementById('landing-hero');
    if (!hero) return;
    const io = new IntersectionObserver(([entry]) => setPastHero(!!entry && !entry.isIntersecting));
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t-[3.5px] border-ink bg-paper px-4 pt-3 md:hidden"
      style={{
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)',
        transform: pastHero ? 'none' : 'translateY(110%)',
        transition: 'transform 0.25s var(--ease-out)',
        visibility: pastHero ? 'visible' : 'hidden',
      }}
    >
      <Button to="/play" variant="red" size="lg" block>
        Enter the game
      </Button>
    </div>
  );
}
