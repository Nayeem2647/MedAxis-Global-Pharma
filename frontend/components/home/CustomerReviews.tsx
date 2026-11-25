import { getTranslations } from 'next-intl/server';
import { Quote, ShieldCheck, Star } from 'lucide-react';
import type { Locale } from '../../i18n/routing';

const REVIEW_KEYS = ['reviewOne', 'reviewTwo', 'reviewThree'] as const;

export async function CustomerReviews({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'Home' });
  return (
    <section className="reviews-section" id="reviews" aria-labelledby="reviews-heading">
      <div className="section site-container">
        <div className="centered-heading">
          <p className="eyebrow">{t('reviewsKicker')}</p>
          <h2 id="reviews-heading">{t('reviewsTitle')}</h2>
          <p className="section-intro">{t('reviewsDescription')}</p>
        </div>
        <div className="reviews-grid">
          {REVIEW_KEYS.map((key) => {
            const name = t(`${key}Author`);
            const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
            return (
              <article key={key} className="review-card">
                <div className="review-card-top">
                  <div className="review-stars" aria-label={t('reviewRatingLabel')}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star key={star} size={15} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
                    ))}
                  </div>
                  <span className="review-verified">
                    <ShieldCheck size={14} aria-hidden="true" />
                    {t('reviewVerified')}
                  </span>
                </div>
                <div className="review-quote-wrap">
                  <Quote size={20} className="review-quote-icon" aria-hidden="true" />
                  <blockquote className="review-quote">{t(`${key}Quote`)}</blockquote>
                </div>
                <footer className="review-author">
                  <span className="review-avatar" aria-hidden="true">{initials}</span>
                  <div className="review-author-meta">
                    <strong className="review-author-name">{name}</strong>
                    <span className="review-author-role">{t(`${key}Role`)}</span>
                  </div>
                  <span className="review-segment">{t(`${key}Tag`)}</span>
                </footer>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

