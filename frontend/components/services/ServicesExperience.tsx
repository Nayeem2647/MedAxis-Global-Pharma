'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  Globe,
  Languages,
  Package,
  Snowflake,
  Zap,
} from 'lucide-react';
import type { ContactConfig } from '../../lib/public-config';
import { SampleCoaModal, ServiceQuickQuoteModal } from './ServiceModals';
import { HeroVisual, ServiceVisual } from './ServiceVisuals';
import { SERVICES_COPY, type ServiceId, type ServiceLang } from './services-copy';

const SERVICE_ICONS = {
  'cold-chain': Snowflake,
  sourcing: Globe,
  'coa-support': FileCheck2,
  'emergency-delivery': Zap,
  'bulk-order': Package,
} as const;

const HASH_ALIAS_MAP: Record<string, ServiceId> = {
  'cold-chain': 'cold-chain',
  sourcing: 'sourcing',
  'coa-support': 'coa-support',
  compliance: 'coa-support',
  'emergency-delivery': 'emergency-delivery',
  delivery: 'emergency-delivery',
  'bulk-order': 'bulk-order',
  bulk: 'bulk-order',
};

export function ServicesExperience({
  routeLocale,
  detail = false,
  contact,
  breadcrumbs,
}: {
  routeLocale: string;
  detail?: boolean;
  contact?: ContactConfig;
  breadcrumbs?: ReactNode;
}) {
  const [lang, setLang] = useState<ServiceLang>(routeLocale === 'zh-CN' ? 'zh' : 'en');
  const [activeTab, setActiveTab] = useState<ServiceId>(detail ? 'sourcing' : 'cold-chain');
  const [coaModalOpen, setCoaModalOpen] = useState(false);
  const [quoteModalService, setQuoteModalService] = useState<ServiceId | null>(null);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  useEffect(() => {
    setLang(routeLocale === 'zh-CN' ? 'zh' : 'en');
  }, [routeLocale]);

  useEffect(() => {
    const syncHash = () => {
      const hash = window.location.hash.replace(/^#/, '');
      const mapped = HASH_ALIAS_MAP[hash];
      if (mapped) setActiveTab(mapped);
    };
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  useEffect(() => {
    const ids: ServiceId[] = ['cold-chain', 'sourcing', 'coa-support', 'emergency-delivery', 'bulk-order'];
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) {
          setActiveTab(visible[0].target.id as ServiceId);
        }
      },
      { rootMargin: '-18% 0px -58% 0px', threshold: [0.1, 0.35, 0.6] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const copy = SERVICES_COPY[lang];
  const heroTitle = copy.hero.title;
  const heroSubtitle = detail && copy.hero.detailSubtitle ? copy.hero.detailSubtitle : copy.hero.subtitle;
  const heroBadge = detail && copy.hero.detailBadge ? copy.hero.detailBadge : copy.hero.badge;
  const canonicalLocale = routeLocale === 'zh-CN' ? 'zh-CN' : 'en';
  const basePath = `/${canonicalLocale}/services${detail ? '/pharmaceutical-sourcing' : ''}`;

  function scrollToSection(id: ServiceId) {
    setActiveTab(id);
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.history.replaceState(null, '', `${basePath}#${id}`);
    }
  }

  return (
    <main id="main-content" className="services-experience">
      {/* Breadcrumb strip aligned with site container */}
      {breadcrumbs && (
        <div className="svc-breadcrumb-band">
          <div className="site-container">{breadcrumbs}</div>
        </div>
      )}

      {/* Section 1: Dark Navy/Teal Hero Banner */}
      <section className="svc-hero" aria-labelledby="svc-hero-title">
        <div className="site-container svc-hero-grid">
          <div className="svc-hero-copy">
            <div className="svc-hero-badge">
              <span className="svc-badge-dot" aria-hidden="true" />
              <span>{heroBadge}</span>
            </div>

            <h1 id="svc-hero-title" className="svc-hero-title">
              {heroTitle}
            </h1>

            <p className="svc-hero-subtitle">{heroSubtitle}</p>

            <div className="svc-hero-actions">
              <button
                type="button"
                className="svc-btn svc-btn-primary svc-btn-lg"
                onClick={() => setQuoteModalService(detail ? 'sourcing' : 'cold-chain')}
              >
                <span>{copy.hero.primaryCta}</span>
                <ArrowRight size={17} aria-hidden="true" />
              </button>
              <a
                href="#cold-chain"
                className="svc-btn svc-btn-ghost svc-btn-lg"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection(detail ? 'sourcing' : 'cold-chain');
                }}
              >
                <span>{copy.hero.secondaryCta}</span>
              </a>
            </div>
          </div>

          <HeroVisual hero={copy.hero} />
        </div>
      </section>

      {/* Section 2: Sticky Anchor Sub-Navigation Bar + Bilingual Toggle */}
      <div className="svc-sticky-nav" role="region" aria-label={copy.tabsAriaLabel}>
        <div className="site-container svc-sticky-inner">
          <nav className="svc-tabs-scroll" aria-label={copy.tabsAriaLabel}>
            {copy.tabs.map((tab) => {
              const Icon = SERVICE_ICONS[tab.id];
              const active = activeTab === tab.id;
              return (
                <a
                  key={tab.id}
                  href={`#${tab.id}`}
                  className={`svc-tab-link${active ? ' is-active' : ''}`}
                  aria-current={active ? 'location' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection(tab.id);
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{tab.label}</span>
                </a>
              );
            })}
          </nav>

          <div className="svc-lang-toggle" role="group" aria-label={copy.langToggleLabel}>
            <Languages size={14} className="svc-lang-icon" aria-hidden="true" />
            <button
              type="button"
              className={lang === 'en' ? 'is-active' : undefined}
              aria-pressed={lang === 'en'}
              onClick={() => setLang('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={lang === 'zh' ? 'is-active' : undefined}
              aria-pressed={lang === 'zh'}
              onClick={() => setLang('zh')}
            >
              简体中文
            </button>
          </div>
        </div>
      </div>

      {/* Section 3: Detailed 5 Service Blocks (Alternating Zig-Zag 2-Column Layout) */}
      <div className="svc-sections-stack">
        {copy.services.map((service, index) => {
          const Icon = SERVICE_ICONS[service.id];
          const isEven = index % 2 === 1;
          return (
            <section
              key={service.id}
              id={service.id}
              className={`svc-service-section${isEven ? ' is-alt-bg' : ' is-white-bg'}${isEven ? ' is-reversed' : ''}`}
              aria-labelledby={`heading-${service.id}`}
            >
              {service.aliasId && (
                <span id={service.aliasId} className="svc-anchor-alias" aria-hidden="true" />
              )}
              <div className="site-container svc-service-grid">
                <div className="svc-service-copy">
                  <div className="svc-service-kicker-row">
                    <span className="svc-icon-box">
                      <Icon size={22} aria-hidden="true" />
                    </span>
                    <span className="svc-eyebrow">{service.stepCode} · {service.eyebrow}</span>
                  </div>

                  <h2 id={`heading-${service.id}`} className="svc-section-heading">
                    {service.title}
                  </h2>

                  <p className="svc-section-lead">{service.summary}</p>

                  <ul className="svc-highlight-list">
                    {service.highlights.map((item) => (
                      <li key={item}>
                        <CheckCircle2 size={18} className="svc-check-icon" aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="svc-service-actions">
                    {service.id === 'coa-support' && service.primaryActionLabel && (
                      <button
                        type="button"
                        className="svc-btn svc-btn-primary"
                        onClick={() => setCoaModalOpen(true)}
                      >
                        <FileCheck2 size={16} aria-hidden="true" />
                        <span>{service.primaryActionLabel}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className={`svc-btn ${service.id === 'coa-support' ? 'svc-btn-outline' : 'svc-btn-primary'}`}
                      onClick={() => setQuoteModalService(service.id)}
                    >
                      <span>{service.id === 'bulk-order' && service.primaryActionLabel ? service.primaryActionLabel : service.quoteActionLabel}</span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </button>

                    {service.id === 'sourcing' && !detail && service.secondaryLinkLabel && (
                      <Link
                        href={`/${canonicalLocale}/services/pharmaceutical-sourcing`}
                        className="svc-text-action"
                      >
                        <span>{service.secondaryLinkLabel}</span>
                        <ArrowRight size={15} aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                </div>

                <div className="svc-service-visual">
                  <ServiceVisual serviceId={service.id} visuals={copy.visuals} />
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* Section 4: 4-Step Export Workflow ("How It Works") */}
      <section className="svc-workflow-section" aria-labelledby="svc-workflow-heading">
        <div className="site-container">
          <header className="svc-centered-header">
            <span className="svc-eyebrow">{copy.workflow.eyebrow}</span>
            <h2 id="svc-workflow-heading">{copy.workflow.title}</h2>
            <p>{copy.workflow.subtitle}</p>
          </header>

          <ol className="svc-workflow-grid">
            {copy.workflow.steps.map((step, index) => (
              <li key={step.number} className="svc-workflow-card">
                <div className="svc-workflow-top">
                  <span className="svc-step-num">{step.number}</span>
                  {index < copy.workflow.steps.length - 1 && (
                    <ArrowRight size={18} className="svc-workflow-arrow" aria-hidden="true" />
                  )}
                </div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Section 5: B2B Service FAQ Accordion */}
      <section className="svc-faq-section" aria-labelledby="svc-faq-heading">
        <div className="site-container svc-faq-shell">
          <header className="svc-centered-header">
            <span className="svc-eyebrow">{copy.faq.eyebrow}</span>
            <h2 id="svc-faq-heading">{copy.faq.title}</h2>
            <p>{copy.faq.subtitle}</p>
          </header>

          <div className="svc-faq-list">
            {copy.faq.items.map((item, idx) => {
              const expanded = openFaqIndex === idx;
              return (
                <div key={item.question} className={`svc-faq-item${expanded ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="svc-faq-trigger"
                    aria-expanded={expanded}
                    onClick={() => setOpenFaqIndex(expanded ? null : idx)}
                  >
                    <span>{item.question}</span>
                    <ChevronDown size={18} className="svc-faq-chevron" aria-hidden="true" />
                  </button>
                  {expanded && (
                    <div className="svc-faq-panel">
                      <p>{item.answer}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Section 6: Bottom Conversion Banner */}
      <section className="svc-bottom-cta-wrap" aria-labelledby="svc-bottom-cta-heading">
        <div className="site-container">
          <div className="svc-bottom-cta-card">
            <div className="svc-bottom-cta-copy">
              <span className="svc-bottom-eyebrow">{copy.bottomCta.eyebrow}</span>
              <h2 id="svc-bottom-cta-heading">{copy.bottomCta.title}</h2>
              <p>{copy.bottomCta.subtitle}</p>
            </div>
            <div className="svc-bottom-cta-actions">
              <button
                type="button"
                className="svc-btn svc-btn-primary svc-btn-lg"
                onClick={() => setQuoteModalService('bulk-order')}
              >
                <span>{copy.bottomCta.primaryCta}</span>
                <ArrowRight size={17} aria-hidden="true" />
              </button>
              <Link href={`/${canonicalLocale}/products`} className="svc-btn svc-btn-ghost svc-btn-lg">
                {copy.bottomCta.secondaryCta}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Modals */}
      {coaModalOpen && (
        <SampleCoaModal
          copy={copy.coaModal}
          onClose={() => setCoaModalOpen(false)}
          onRequestQuote={() => setQuoteModalService('coa-support')}
        />
      )}

      {quoteModalService && (
        <ServiceQuickQuoteModal
          copy={copy.quoteModal}
          tabs={copy.tabs}
          initialService={quoteModalService}
          locale={canonicalLocale}
          contact={contact}
          onClose={() => setQuoteModalService(null)}
        />
      )}
    </main>
  );
}
