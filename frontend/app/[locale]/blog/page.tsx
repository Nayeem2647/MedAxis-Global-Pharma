import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BookOpen, ClipboardCheck, FileCheck2, Newspaper, Snowflake } from 'lucide-react';
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

export default async function BlogPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Blog' });
  const h = await getTranslations({ locale, namespace: 'Home' });
  const s = await getTranslations({ locale, namespace: 'Shell' });
  const [allBanners, posts] = await Promise.all([getBanners(locale), getBlogPosts(locale)]);
  const blogBanners = allBanners.filter((banner) => banner.placement === 'BLOG_BANNER' && banner.media_url);

  return (
    <main id="main-content">
      <div className="section site-container">
        <Breadcrumbs locale={locale} entries={[{ name: s('blog'), href: `/${locale}/blog` }]} />
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
          <header className="service-hero">
            <p className="eyebrow">MEDAXIS GLOBAL PHARMA</p>
            <h1>{t('title')}</h1>
            <p>{t('description')}</p>
            <div className="state-actions">
              <QuoteButton>{h('request')}</QuoteButton>
              <Link className="button secondary" href={`/${locale}/products`}>{h('browse')}</Link>
            </div>
          </header>
        )}

        {posts.length > 0 && (
          <section id="published-posts" className="info-section">
            <h2>{t('articlesTitle')}</h2>
            <div className="blog-posts-grid">
              {posts.map((post) => (
                <article className="blog-post-card" key={post.id}>
                  {post.cover_image_url && (
                    <div className="blog-post-cover">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={post.cover_image_url} alt={post.title} width={640} height={360} loading="lazy" />
                    </div>
                  )}
                  <div className="blog-post-body">
                    <div className="blog-post-meta">
                      <span className="blog-category-badge">{t(`category_${post.category}`)}</span>
                      <time dateTime={post.published_at}>{post.published_at.slice(0, 10)}</time>
                    </div>
                    <h3>{post.title}</h3>
                    <p>{post.summary}</p>
                    <details className="blog-article-expand">
                      <summary>{t('readArticle')}</summary>
                      <div className="blog-article-content">
                        <ProductRichDescription html={post.body_html} />
                      </div>
                    </details>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <section id="articles" className="info-section">
          <h2>{posts.length > 0 ? t('guidesTitle') : t('articlesTitle')}</h2>
          <div className="service-cards">
            <article>
              <Snowflake size={30} />
              <h3>{t('articleOneTitle')}</h3>
              <p>{t('articleOneBody')}</p>
            </article>
            <article>
              <FileCheck2 size={30} />
              <h3>{t('articleTwoTitle')}</h3>
              <p>{t('articleTwoBody')}</p>
            </article>
          </div>
        </section>

        <section id="updates" className="info-section">
          <h2>{t('updatesTitle')}</h2>
          <div className="service-cards">
            <article>
              <Newspaper size={30} />
              <h3>{s('productUpdates')}</h3>
              <p>{t('updatesBody')}</p>
              <Link className="text-button" href={`/${locale}/products`}>{h('browse')}</Link>
            </article>
          </div>
        </section>

        <section id="guides" className="info-section">
          <h2>{t('guidesTitle')}</h2>
          <div className="service-cards">
            <article>
              <ClipboardCheck size={30} />
              <h3>{t('guideOneTitle')}</h3>
              <p>{t('guideOneBody')}</p>
            </article>
            <article>
              <BookOpen size={30} />
              <h3>{t('guideTwoTitle')}</h3>
              <p>{t('guideTwoBody')}</p>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
