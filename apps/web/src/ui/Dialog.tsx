import { useEffect, useRef, type ReactNode } from 'react';
import { useSound, type SoundName } from '@/audio';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name. Use a visible heading plus `labelledBy` when there is one. */
  label?: string;
  labelledBy?: string;
  /** `sheet` sits at the bottom edge on small screens. */
  kind?: 'center' | 'sheet';
  className?: string;
  /** The sound when it opens. `open` by default. */
  openSound?: SoundName;
  children: ReactNode;
}

/**
 * A modal on the native dialog element: the browser traps focus, inerts the page, closes on Esc and puts focus
 * back where it was. Children mount only while open, so a reopened dialog starts fresh.
 */
export function Dialog({
  open,
  onClose,
  label,
  labelledBy,
  kind = 'center',
  className = '',
  openSound = 'open',
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { play } = useSound();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      play(openSound);
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, play, openSound]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-kind={kind}
      className={`dialog ${className}`}
      onClose={() => {
        play('close');
        onClose();
      }}
      onClick={e => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}
