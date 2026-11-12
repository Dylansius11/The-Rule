import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Art } from '@/art/Art';
import { InkBox } from '@/ui/InkBox';
import { AgentCard } from './AgentCard';
import { useDocsOutlet } from './data';
import { DocsSearch } from './DocsSearch';
import { useDocumentTitle } from './hooks';
import { docRoute, docTitle, SECTION_BLURB } from './model';
import { TrustCallout } from './TrustCallout';

/** `/docs`: what the docs are, the agent file, the trust sentence, then every section from the index. */
export function DocsHome() {
  const { index } = useDocsOutlet();
  const heading = useRef<HTMLHeadingElement>(null);
  useDocumentTitle(docTitle('Docs'));
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  const pages = index.sections.reduce((n, s) => n + s.entries.length, 0);

  return (
    <div className="doc-home">
      <header className="wrap pb-6 pt-8 md:pb-10 md:pt-14">
        <div className="grid items-end gap-6 md:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <p className="hand -rotate-1 text-[28px] leading-none text-tomato-deep">for humans and agents</p>
            <h1
              ref={heading}
              tabIndex={-1}
              className="display poster text-[clamp(72px,14vw,150px)] leading-[0.84] outline-none"
            >
              <span className="text-sun">THE</span> <span className="text-tomato">DOCS</span>
            </h1>
            <p className="mt-4 max-w-[58ch] text-[clamp(18px,2vw,21px)] font-bold leading-snug">
              How THE RULE works, what a play costs, what the replay proves and where the limits are. {pages}{' '}
              short pages, written for people and for the agents that read for them.
            </p>
            <div className="mt-6 max-w-[620px]">
              <DocsSearch large />
            </div>
          </div>
          <Art name="blot/idle" width={190} eager className="mx-auto max-md:hidden" />
        </div>
      </header>

      <div className="wrap grid gap-8 pb-16 md:gap-10">
        <AgentCard />
        <TrustCallout />

        <section aria-labelledby="sections-title" className="grid gap-5">
          <h2 id="sections-title" className="display text-[clamp(36px,5vw,56px)]">
            Browse by topic
          </h2>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {index.sections.map((section, i) => (
              <InkBox
                key={section.id}
                as="section"
                id={`section-${section.id}`}
                aria-labelledby={`title-${section.id}`}
                tilt={i % 2 === 0 ? -0.5 : 0.5}
                className="doc-card p-5 md:p-6"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 id={`title-${section.id}`} className="display text-[clamp(36px,4vw,46px)]">
                    {section.title}
                  </h3>
                  <span className="mono text-[13px] font-bold">
                    {section.entries.length} {section.entries.length === 1 ? 'page' : 'pages'}
                  </span>
                </div>
                {SECTION_BLURB[section.id] ? (
                  <p className="mt-1 text-[16px] font-semibold text-ink-soft">{SECTION_BLURB[section.id]}</p>
                ) : null}
                <ul className="doc-card-list">
                  {section.entries.map(entry => (
                    <li key={entry.slug}>
                      <Link to={docRoute(entry)}>
                        <span className="doc-card-title">{entry.title}</span>
                        <span className="doc-card-summary">{entry.summary}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </InkBox>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
