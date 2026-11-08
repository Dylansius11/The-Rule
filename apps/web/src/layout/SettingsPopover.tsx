import { useEffect, useId, useRef, useState } from 'react';
import { useSound } from '@/audio';
import { SettingsPanel } from './SettingsPanel';

/** Gear button with a small panel under it. Closes on Esc and on a click outside, and hands focus back to the gear. */
export function SettingsPopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { play } = useSound();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        className="icon-btn"
        aria-label="Settings"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          play(open ? 'close' : 'open');
          setOpen(o => !o);
        }}
      >
        <svg viewBox="0 0 28 28" aria-hidden="true">
          <circle cx="14" cy="14" r="4" />
          <path d="M14 3v4M14 21v4M3 14h4M21 14h4M6.2 6.2l2.8 2.8M19 19l2.8 2.8M21.8 6.2 19 9M9 19l-2.8 2.8" />
        </svg>
      </button>
      {open ? (
        <div
          id={panelId}
          role="group"
          aria-label="Settings"
          className="popover absolute right-0 top-[calc(100%+10px)] z-50 w-[min(340px,calc(100vw-24px))] p-4"
        >
          <h2 className="display mb-2 text-[30px] leading-none">Settings</h2>
          <SettingsPanel onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
