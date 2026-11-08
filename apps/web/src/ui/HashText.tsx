import { useEffect, useState } from 'react';
import { shortHash } from '@/chain/format';
import { config } from '@/config/env';

type Kind = 'tx' | 'account' | 'block' | 'plain';

interface HashTextProps {
  value: string;
  kind?: Kind;
  /** Full value on wide screens, shortened on small ones. */
  full?: boolean;
  label?: string;
  className?: string;
}

function href(kind: Kind, value: string) {
  if (kind === 'tx') return config.explorerTx(value);
  if (kind === 'account') return config.explorerAccount(value);
  if (kind === 'block') return config.explorerBlock(value);
  return null;
}

/** A hash, account or block: mono text, copy button, explorer link. Never shown unless observed. */
export function HashText({ value, kind = 'plain', full = false, label, className = '' }: HashTextProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);
  const link = href(kind, value);
  const text = full ? value : shortHash(value);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      /* clipboard can be blocked; the full value stays selectable */
    }
  }
  return (
    <span className={`inline-flex max-w-full flex-wrap items-center gap-1.5 align-middle ${className}`}>
      <code className="mono break-all rounded bg-paper-2 px-1.5 py-0.5 text-[13px] font-bold" title={value}>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-[44px] items-center underline decoration-2 underline-offset-2"
          >
            {text}
            <span className="sr-only"> (opens the explorer)</span>
          </a>
        ) : (
          text
        )}
      </code>
      <button
        type="button"
        onClick={copy}
        className="mono inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border-2 border-ink bg-paper px-2 text-[12px] font-bold uppercase tracking-wide"
        aria-label={`Copy ${label ?? (kind === 'plain' ? 'value' : kind)}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}
