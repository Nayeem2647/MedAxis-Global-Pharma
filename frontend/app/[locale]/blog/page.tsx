import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  FileCheck2,
  Layers,
  Newspaper,
  PackageCheck,
  Snowflake,
  Tag,
  TrendingUp,
} from 'lucide-react';
import { isLocale } from '../../../i18n/routing';
import { buildLocalizedMetadata } from '../../../lib/seo';
import { getBanners, getBlogPosts } from '../../../lib/public-catalog';
import { QuoteButton } from '../../../components/layout/PublicShell';
import { Breadcrumbs } from '../../../components/catalog/Breadcrumbs';
import { PlacementBanner } from '../../../components/home/PlacementBanner';
import { ProductRichDescription } from '../../../components/catalog/ProductRichDescription';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'Blog' });
  return buildLocalizedMetadata({
    locale,
    enPath: '/en/blog',
    zhPath: '/zh-CN/blog',
    title: `${t('title')} | MedAxis Global Pharma`,
    description: t('description'),
  });
}

const categoryIcons: Record<string, React.ComponentType<{ size?: number }>> = {
  GUIDE: ClipboardCheck,
  UPDATE: TrendingUp,
  COMPLIANCE: FileCheck2,
  SOURCING: Snowflake,
};

export default async function BlogPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'Blog' });
  const h = await getTranslations({ locale, namespace: 'Home' });
  const s = await getTranslations({ locale, namespace: 'Shell' });
  const [allBanners, posts] = await Promise.all([getBanners(locale), getBlogPosts(locale)]);
  const blogBanners = allBanners.filter((banner) => banner.placement === 'BLOG_BANNER' && banner.media_url);

  // Count posts per category for sidebar
  const categoryCounts: Record<string, number> = {};
  for (const post of posts) {
    categoryCounts[post.category] = (categoryCounts[post.category] ?? 0) + 1;
  }

  const categories = [
    { key: 'GUIDE', label: t('category_GUIDE'), Icon: ClipboardCheck },
    { key: 'UPDATE', label: t('category_UPDATE'), Icon: TrendingUp },
    { key: 'COMPLIANCE', label: t('category_COMPLIANCE'), Icon: FileCheck2 },
    { key: 'SOURCING', label: t('category_SOURCING'), Icon: Snowflake },
  ];

  return (
    <main id="main-content">
      {/* ── Breadcrumb ── */}
      <div className="section site-container" style={{ paddingBottom: 0 }}>
        <Breadcrumbs locale={locale} entries={[{ name: s('blog'), href: `/${locale}/blog` }]} />
      </div>

      {/* ── Hero ── */}
      {blogBanners.length > 0 ? (
        <div className="blog-banner-slot">
          <PlacementBanner banners={blogBanners} locale={locale} variant="blog" />
          <header className="blog-banner-caption">
            <h1>{t('title')}</h1>
            <p className="muted">{t('description')}</p>
            <div className="state-actions">
              <QuoteButton>{h('request')}</QuoteButton>
              <Link className="button secondary" href={`/${locale}/products`}>{h('browse')}</Link>
            </div>
          </header>
        </div>
      ) : (
        <section className="blog-hero">
          <div className="blog-hero-inner">
            <div className="blog-hero-eyebrow">
              <Newspaper size={13} aria-hidden="true" />
              MedAxis Global Pharma — Insights &amp; Updates
            </div>
            <h1>{t('title')}</h1>
            <p className="blog-hero-desc">{t('description')}</p>
            <div className="blog-hero-actions">
              <QuoteButton>{h('request')}</QuoteButton>
              <Link className="button light" href={`/${locale}/products`}>{h('browse')}</Link>
            </div>
            <div className="blog-hero-stats">
              <div className="blog-hero-stat">
                <strong>{posts.length || '10'}+</strong>
                <span>Published Articles</span>
              </div>
              <div className="blog-hero-stat">
                <strong>4</strong>
                <span>Expert Categories</span>
              </div>
              <div className="blog-hero-stat">
                <strong>EN / 中文</strong>
                <span>Bilingual Content</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Category filter bar ── */}
      <div className="blog-filter-bar">
        <div className="blog-filter-inner">
          <span className="blog-filter-btn is-active">{t('articlesTitle')}</span>
          {categories.map(({ key, label }) => (
            <span key={key} className="blog-filter-btn">{label}</span>
          ))}
        </div>
      </div>

      {/* ── Main two-column layout ── */}
      <div className="blog-page-layout">
        {/* ── Left: article feed ── */}
        <div className="blog-main-feed">
          {posts.length > 0 ? (
            <>
              <h2>{t('articlesTitle')}</h2>
              <div className="blog-posts-grid-v2">
                {posts.map((post) => {
                  const Icon = categoryIcons[post.category] ?? Newspaper;
                  return (
                    <article className="blog-card-v2" key={post.id}>
                      <div className="blog-card-cover">
                        {post.cover_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={post.cover_image_url} alt={post.title} width={640} height={360} loading="lazy" />
                        ) : (
                          <div className="blog-card-cover-placeholder">
                            <Icon size={40} aria-hidden="true" />
                          </div>
                        )}
                        <span className={`blog-card-badge blog-badge-${post.category}`}>
                          {t(`category_${post.category}`)}
                        </span>
                      </div>

                      <div className="blog-card-body">
                        <div className="blog-card-meta">
                          <CalendarDays size={13} aria-hidden="true" />
                          <time dateTime={post.published_at}>{post.published_at.slice(0, 10)}</time>
                        </div>
                        <h3>{post.title}</h3>
                        <p className="blog-card-excerpt">{post.summary}</p>
                        <details className="blog-card-expand">
                          <summary>
                            <BookOpen size={15} aria-hidden="true" />
                            {t('readArticle')}
                            <ChevronDown size={15} className="blog-card-expand-icon" aria-hidden="true" />
                          </summary>
                          <div className="blog-card-expand-body">
                            <ProductRichDescription html={post.body_html} />
                          </div>
                        </details>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            /* ── No live posts yet: show high-quality static editorial cards ── */
            <>
              <h2>{t('articlesTitle')}</h2>
              <div className="blog-posts-grid-v2">

                {/* Static card 1 */}
                <article className="blog-card-v2">
                  <div className="blog-card-cover" style={{ background: 'linear-gradient(135deg,#e2f8fc,#b6e9f2)' }}>
                    <div className="blog-card-cover-placeholder">
                      <Snowflake size={44} aria-hidden="true" />
                    </div>
                    <span className="blog-card-badge blog-badge-SOURCING">{t('category_SOURCING')}</span>
                  </div>
                  <div className="blog-card-body">
                    <div className="blog-card-meta">
                      <CalendarDays size={13} aria-hidden="true" />
                      <time>2026-11-10</time>
                    </div>
                    <h3>{t('articleOneTitle')}</h3>
                    <p className="blog-card-excerpt">{t('articleOneBody')}</p>
                  </div>
                </article>

                {/* Static card 2 */}
                <article className="blog-card-v2">
                  <div className="blog-card-cover" style={{ background: 'linear-gradient(135deg,#e8f4ff,#c6def8)' }}>
                    <div className="blog-card-cover-placeholder">
                      <FileCheck2 size={44} aria-hidden="true" />
                    </div>
                    <span className="blog-card-badge blog-badge-COMPLIANCE">{t('category_COMPLIANCE')}</span>
                  </div>
                  <div className="blog-card-body">
                    <div className="blog-card-meta">
                      <CalendarDays size={13} aria-hidden="true" />
                      <time>2026-11-05</time>
                    </div>
                    <h3>{t('articleTwoTitle')}</h3>
                    <p className="blog-card-excerpt">{t('articleTwoBody')}</p>
                  </div>
                </article>

                {/* Static card 3 */}
                <article className="blog-card-v2">
                  <div className="blog-card-cover" style={{ background: 'linear-gradient(135deg,#f0fdf4,#c8f0d8)' }}>
                    <div className="blog-card-cover-placeholder">
                      <ClipboardCheck size={44} aria-hidden="true" />
                    </div>
                    <span className="blog-card-badge blog-badge-GUIDE">{t('category_GUIDE')}</span>
                  </div>
                  <div className="blog-card-body">
                    <div className="blog-card-meta">
                      <CalendarDays size={13} aria-hidden="true" />
                      <time>2026-10-28</time>
                    </div>
                    <h3>{t('guideOneTitle')}</h3>
                    <p className="blog-card-excerpt">{t('guideOneBody')}</p>
                  </div>
                </article>

                {/* Static card 4 */}
                <article className="blog-card-v2">
                  <div className="blog-card-cover" style={{ background: 'linear-gradient(135deg,#fff8e8,#fde8b4)' }}>
                    <div className="blog-card-cover-placeholder">
                      <BookOpen size={44} aria-hidden="true" />
                    </div>
                    <span className="blog-card-badge blog-badge-GUIDE">{t('category_GUIDE')}</span>
                  </div>
                  <div className="blog-card-body">
                    <div className="blog-card-meta">
                      <CalendarDays size={13} aria-hidden="true" />
                      <time>2026-10-15</time>
                    </div>
                    <h3>{t('guideTwoTitle')}</h3>
                    <p className="blog-card-excerpt">{t('guideTwoBody')}</p>
                  </div>
                </article>

              </div>
            </>
          )}

          {/* ── Static feature section below cards ── */}
          <div style={{ marginTop: '48px' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1a2e3b', marginBottom: '20px' }}>
              {t('guidesTitle')}
            </h2>
            <div className="blog-static-features">
              <div className="blog-static-card">
                <div className="blog-static-icon"><PackageCheck size={22} /></div>
                <div className="blog-static-info">
                  <h3>{t('guideOneTitle')}</h3>
                  <p>{t('guideOneBody')}</p>
                </div>
              </div>
              <div className="blog-static-card">
                <div className="blog-static-icon"><Layers size={22} /></div>
                <div className="blog-static-info">
                  <h3>{t('guideTwoTitle')}</h3>
                  <p>{t('guideTwoBody')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: sidebar ── */}
        <aside className="blog-sidebar">

          {/* Category breakdown */}
          <div className="blog-sidebar-card">
            <h3><Tag size={16} /> {t('articlesTitle')}</h3>
            <ul className="blog-sidebar-cats">
              {categories.map(({ key, label }) => (
                <li key={key}>
                  <button type="button">
                    {label}
                    <span className="cat-count">{categoryCounts[key] ?? 0}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Product updates card */}
          <div className="blog-sidebar-card">
            <h3><TrendingUp size={16} /> {t('updatesTitle')}</h3>
            <p style={{ margin: 0, fontSize: '.88rem', lineHeight: 1.6, color: '#526a78' }}>
              {t('updatesBody')}
            </p>
            <Link
              className="button secondary"
              href={`/${locale}/products`}
              style={{ marginTop: '14px', display: 'block', textAlign: 'center' }}
            >
              {h('browse')}
            </Link>
          </div>

          {/* Quick quote CTA */}
          <div className="blog-sidebar-card" style={{ background: 'linear-gradient(135deg,#0f172a,#0a5368)', border: 'none' }}>
            <h3 style={{ color: '#fff' }}><Newspaper size={16} style={{ color: '#18bcd6' }} /> Need a Quote?</h3>
            <p style={{ margin: '0 0 16px', fontSize: '.88rem', lineHeight: 1.6, color: '#93b8c6' }}>
              Request pricing and batch CoA for any oncology or specialty medicine worldwide.
            </p>
            <QuoteButton>{h('request')}</QuoteButton>
          </div>

        </aside>
      </div>

      {/* ── Bottom CTA strip ── */}
      <div className="blog-cta-strip">
        <h2>Stay Updated on Oncology Pharma Sourcing</h2>
        <p>Get expert guidance on cold-chain logistics, regulatory compliance, and batch-verified export documentation.</p>
        <div className="blog-cta-actions">
          <QuoteButton>{h('request')}</QuoteButton>
          <Link className="button light" href={`/${locale}/services`}>Explore Services</Link>
        </div>
      </div>
    </main>
  );
}
