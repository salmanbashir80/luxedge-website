import { Fragment, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { SiteFaqItem, SiteSection } from '../content/sitePages';

/**
 * Renders the shared homepage / contact-page copy (src/content/sitePages.ts).
 *
 * These sections are the visitor-side half of content the worker already
 * pre-renders into the crawl HTML. They live in a component rather than inline
 * JSX for the same reason the product and category copy do: the crawl copy and
 * the hydrated copy must come from one module, or Google ends up reading depth
 * that a visitor cannot see (a divergence that has already shipped twice on this
 * site). The site-pages test asserts both renderers emit every string.
 */
export function SiteSections({ sections }: { sections: SiteSection[] }): JSX.Element {
  return (
    <section className="border-t border-gray-100 bg-white">
      <div className="max-w-4xl mx-auto px-4 py-7 sm:py-9 space-y-6">
        {sections.map((s) => (
          <div key={s.heading}>
            <h2 className="font-serif text-xl sm:text-2xl font-bold text-luxe-black">{s.heading}</h2>
            {s.paragraphs?.map((p) => (
              <p key={p} className="mt-2 text-sm leading-relaxed text-luxe-gray">{p}</p>
            ))}
            {s.bullets?.length ? (
              <ul className="mt-2 space-y-1.5 list-disc pl-5 text-sm leading-relaxed text-luxe-gray">
                {s.bullets.map((b) => <li key={b}>{b}</li>)}
              </ul>
            ) : null}
            {s.links?.length ? (
              <p className="mt-2 text-sm leading-relaxed">
                {s.links.map((l, i) => (
                  <Fragment key={l.href}>
                    {i > 0 && ' · '}
                    <Link to={l.href} className="font-semibold text-luxe-gold-dark underline decoration-luxe-gold/40 underline-offset-2 hover:text-luxe-gold">{l.label}</Link>
                  </Fragment>
                ))}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function SiteFaq({ items, title = 'Common questions' }: { items: SiteFaqItem[]; title?: string }): JSX.Element {
  return (
    <section className="border-t border-gray-100 bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-7 sm:py-9">
        <h2 className="font-serif text-xl sm:text-2xl font-bold text-luxe-black">{title}</h2>
        <dl className="mt-4 space-y-5">
          {items.map((f) => (
            <div key={f.q}>
              <dt className="text-sm font-semibold text-luxe-black">{f.q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-luxe-gray">{f.a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-xs text-luxe-gray">
          More detail lives on the <Link to="/faq" className="font-semibold text-luxe-gold-dark underline decoration-luxe-gold/40 underline-offset-2 hover:text-luxe-gold">FAQ page</Link>{' '}
          and on the <Link to="/shipping-policy" className="font-semibold text-luxe-gold-dark underline decoration-luxe-gold/40 underline-offset-2 hover:text-luxe-gold">Shipping</Link>{' '}
          and <Link to="/returns" className="font-semibold text-luxe-gold-dark underline decoration-luxe-gold/40 underline-offset-2 hover:text-luxe-gold">Returns</Link> policies.
        </p>
      </div>
    </section>
  );
}
