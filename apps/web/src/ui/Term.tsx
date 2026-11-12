import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { DOCS_PATH } from '@/app/paths';

/** One-sentence plain-English definitions. Source of truth: the verified facts of the game rules. */
export const GLOSSARY = {
  atom: 'One building block of a law, such as “the number is even”. A law is one atom, or two atoms joined by AND or OR. You can flip any atom to its opposite.',
  commit:
    'Sealing your guess on the chain as a hash, together with a stake. Nobody can read it until you reveal it.',
  salt: 'A random secret mixed into your guess before it is hashed, so the hash cannot be worked back into the guess. It is stored only in this browser.',
  stake:
    'The NEAR you lock when you commit a guess. A correct guess gets it all back; a wrong or unrevealed one gets half back and the other half joins the pot.',
  reveal: 'Opening your sealed guess, with its salt, so the sealed program can check it against the law.',
  ledger:
    'The public list of every play in a round and its YES or NO verdict. Anyone can read it and test a guess against it.',
  'contributor share':
    'One share for each unique paid play, YES or NO alike, up to a cap per round. Shares divide the contributors’ part of the final pot.',
  attempt: 'One paid play you may still make in a round. Locking RULE before a round adds more attempts.',
} as const;

export type TermKey = keyof typeof GLOSSARY;

/** Where each term is explained in the docs: a page, and the heading on it when the term has its own section. */
export const TERM_DOCS: Record<TermKey, string> = {
  atom: `${DOCS_PATH}/play/the-law-and-the-grammar`,
  commit: `${DOCS_PATH}/play/how-to-play#guess-in-three-steps`,
  salt: `${DOCS_PATH}/play/how-to-play#guess-in-three-steps`,
  stake: `${DOCS_PATH}/play/costs-and-payouts#guess-stakes`,
  reveal: `${DOCS_PATH}/play/how-to-play#guess-in-three-steps`,
  ledger: `${DOCS_PATH}/play/how-to-play#stamp-and-read`,
  'contributor share': `${DOCS_PATH}/play/costs-and-payouts#pot-split`,
  attempt: `${DOCS_PATH}/rule/locking-for-attempts`,
};

interface TermProps {
  /** Which glossary entry to explain. */
  term: TermKey;
  /** What to show in the sentence; defaults to the term itself. */
  children?: ReactNode;
}

/**
 * An inline glossary word. Hover, tap, or Enter/Space opens a short definition; Esc, a tap elsewhere, scrolling
 * or moving focus away closes it. The definition is always in the DOM, so `aria-describedby` reads it to screen
 * readers whether or not it is drawn. The bubble is drawn on the page body, so a clipped or tilted card around
 * the word never cuts it off.
 */
export function Term({ term, children }: TermProps) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({ left: 0, top: 0 });
  const open = hover || pinned;

  const close = useCallback(() => {
    setHover(false);
    setPinned(false);
  }, []);

  // Below the word, kept inside the viewport; above it when there is no room below.
  useLayoutEffect(() => {
    const b = button.current;
    const t = tip.current;
    if (!open || !b || !t) return;
    const r = b.getClientRects()[0] ?? b.getBoundingClientRect();
    const margin = 8;
    const vw = document.documentElement.clientWidth;
    const width = t.offsetWidth;
    const left = Math.max(margin, Math.min(r.left, vw - width - margin));
    const fitsBelow = r.bottom + t.offsetHeight < window.innerHeight - margin;
    const top = fitsBelow || r.top - t.offsetHeight < margin ? r.bottom : r.top - t.offsetHeight;
    setPlace({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!button.current?.contains(n) && !tip.current?.contains(n)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => (pinned ? close() : setPinned(true))}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onBlur={e => {
          if (!tip.current?.contains(e.relatedTarget as Node | null)) close();
        }}
        onKeyDown={e => {
          // Tab from an open definition goes to its Read more link (the bubble lives at the end of the page).
          if (e.key === 'Tab' && !e.shiftKey && open) {
            const link = tip.current?.querySelector('a');
            if (link) {
              e.preventDefault();
              link.focus();
            }
          }
        }}
        className="cursor-help rounded-sm font-extrabold underline decoration-ink/60 decoration-dotted decoration-2 underline-offset-4"
      >
        {children ?? term}
      </button>
      {createPortal(
        <span
          ref={tip}
          id={id}
          role="tooltip"
          style={place}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          className={`fixed z-[60] w-[min(300px,calc(100vw-16px))] pt-1.5 ${open ? 'block' : 'hidden'}`}
        >
          <span className="block rounded-lg border-[3px] border-ink bg-white p-3 text-left text-[15px] font-semibold leading-snug text-ink shadow-[4px_4px_0_var(--color-ink)]">
            <b className="hand mb-0.5 block text-[20px] capitalize leading-none text-tomato-deep">{term}</b>
            {GLOSSARY[term]}
            <span className="mt-1 block">
              <Link
                to={TERM_DOCS[term]}
                onClick={close}
                onBlur={e => {
                  if (!button.current?.contains(e.relatedTarget as Node | null)) close();
                }}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    close();
                    button.current?.focus();
                  }
                }}
                className="inline-flex items-center py-1 font-extrabold underline decoration-2 underline-offset-4 pointer-coarse:min-h-[44px]"
              >
                Read more<span className="sr-only"> about {term} in the docs</span>
                <span aria-hidden="true">&nbsp;→</span>
              </Link>
            </span>
          </span>
        </span>,
        document.body,
      )}
    </>
  );
}
