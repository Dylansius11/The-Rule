import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { LiveRegion } from '@/ui/LiveRegion';
import { copyMessage, useCopy } from './data';
import { classifyLink, columnWidths, type Block, type Inline } from './parse';

/** Renders parsed Markdown as React elements. Text is always a text node, never injected HTML. */
export function Markdown({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((block, i) => renderBlock(block, i))}</>;
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.t) {
      case 'text':
        return <Fragment key={i}>{node.v}</Fragment>;
      case 'code':
        return <code key={i}>{node.v}</code>;
      case 'strong':
        return <strong key={i}>{renderInline(node.c)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(node.c)}</em>;
      case 'del':
        return <del key={i}>{renderInline(node.c)}</del>;
      case 'br':
        return <br key={i} />;
      case 'link':
        return (
          <DocLink key={i} href={node.href}>
            {renderInline(node.c)}
          </DocLink>
        );
    }
  });
}

/** Router links for app pages; a safe new-tab anchor for anything else; plain text for an unsafe target. */
function DocLink({ href, children }: { href: string; children: ReactNode }) {
  const target = classifyLink(href);
  if (!target) return <>{children}</>;
  if (target.kind === 'route') return <Link to={target.href}>{children}</Link>;
  if (target.kind === 'hash') return <a href={target.href}>{children}</a>;
  return (
    <a href={target.href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.t) {
    case 'heading':
      return <DocHeading key={key} block={block} />;
    case 'p':
      return <p key={key}>{renderInline(block.c)}</p>;
    case 'hr':
      return <hr key={key} />;
    case 'quote':
      return (
        <blockquote key={key} className="doc-callout">
          <Markdown blocks={block.c} />
        </blockquote>
      );
    case 'code':
      return <CodeBlock key={key} lang={block.lang} code={block.v} />;
    case 'table':
      return <TableBlock key={key} block={block} />;
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag key={key} start={block.ordered && block.start !== 1 ? block.start : undefined}>
          {block.items.map((item, i) => (
            <li key={i}>
              {block.tight
                ? item.map((child, c) =>
                    child.t === 'p' ? (
                      <Fragment key={c}>{renderInline(child.c)}</Fragment>
                    ) : (
                      renderBlock(child, c)
                    ),
                  )
                : item.map((child, c) => renderBlock(child, c))}
            </li>
          ))}
        </Tag>
      );
    }
  }
}

function DocHeading({ block }: { block: Extract<Block, { t: 'heading' }> }) {
  const Tag = `h${Math.min(6, Math.max(2, block.depth))}` as 'h2';
  return (
    <Tag id={block.id ?? undefined} className="doc-h">
      {renderInline(block.c)}
      {block.id ? <HeadingAnchor id={block.id} text={block.text} /> : null}
    </Tag>
  );
}

/** A button beside a heading: moves the URL to that heading and copies the full link. */
function HeadingAnchor({ id, text }: { id: string; text: string }) {
  const navigate = useNavigate();
  const { state, copy } = useCopy();
  return (
    <>
      <button
        type="button"
        className="doc-anchor"
        data-state={state.kind}
        aria-label={`Copy link to “${text}”`}
        onClick={() => {
          void navigate({ hash: `#${id}` }, { replace: true });
          void copy('the link', () => `${location.origin}${location.pathname}#${id}`);
        }}
      >
        <span aria-hidden="true">{state.kind === 'ok' ? '✓' : '#'}</span>
      </button>
      <LiveRegion message={copyMessage(state)} />
    </>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const { state, copy } = useCopy();
  return (
    <figure className="doc-code">
      <figcaption>
        <span className="mono">{lang || 'text'}</span>
        <button
          type="button"
          className="doc-copy"
          data-state={state.kind}
          aria-label={`Copy ${lang || 'code'} block`}
          onClick={() => void copy('the code', () => code)}
        >
          {state.kind === 'ok' ? 'Copied' : state.kind === 'error' ? 'Failed' : 'Copy'}
        </button>
      </figcaption>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
      <LiveRegion message={copyMessage(state)} />
    </figure>
  );
}

/** Columns size to their longest cell; a table wider than the article scrolls inside its own frame, with a hint. */
function TableBlock({ block }: { block: Extract<Block, { t: 'table' }> }) {
  const widths = columnWidths(block.head, block.rows);
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);
  return (
    <div className="doc-table" data-more={more}>
      <div
        ref={scroller}
        className="doc-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Table, scrolls sideways"
      >
        <table style={{ minWidth: `${widths.reduce((a, b) => a + b, 0)}rem` }}>
          <thead>
            <tr>
              {block.head.map((cell, c) => (
                <th
                  key={c}
                  scope="col"
                  style={{ textAlign: block.align[c] ?? undefined, minWidth: `${widths[c]}rem` }}
                >
                  {renderInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} style={{ textAlign: block.align[c] ?? undefined }}>
                    {renderInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more ? (
        <p className="doc-table-hint" aria-hidden="true">
          Scrolls sideways →
        </p>
      ) : null}
    </div>
  );
}
