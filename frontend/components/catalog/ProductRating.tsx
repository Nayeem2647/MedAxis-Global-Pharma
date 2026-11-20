'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api-client';
import type { HomeProduct } from '../../lib/public-catalog';
import { personalRatingSchema, type RatingSummary } from '../../lib/product-tools';
import { Modal } from '../layout/Modal';
import { useProductTools } from './ProductToolsProvider';

export function CustomerRating({ product, interactive = true }: { product: HomeProduct; interactive?: boolean }) {
  const t = useTranslations('ProductTools');
  const tools = useProductTools();
  const { refreshRating } = tools;
  useEffect(() => { void refreshRating(product.id); }, [product.id, refreshRating]);
  const summary = tools.ratings[product.id] ?? product.customer_rating ?? { average: 0, count: 0 };
  const label = summary.count ? t('ratingSummary', { average: summary.average.toFixed(1), count: summary.count }) : t('noRatings');
  const content = <><span className="customer-rating-stars" aria-hidden="true">{[1, 2, 3, 4, 5].map((star) => <Star key={star} size={15} fill={summary.count && star <= Math.round(summary.average) ? 'currentColor' : 'none'} strokeWidth={1.5}/>)}</span><span className="customer-rating-count">{summary.count ? `${summary.average.toFixed(1)} (${summary.count})` : '(0)'}</span></>;
  return interactive ? <button type="button" className="customer-rating" aria-label={`${t('rateNamed', { name: product.brand_name })}. ${label}`} title={t('rateProduct')} onClick={() => tools.showRating(product)}>{content}</button> : <div className="customer-rating" role="img" aria-label={label}>{content}</div>;
}

export function ProductRatingDialog({ product, onClose, onSaved }: { product: HomeProduct; onClose(): void; onSaved(summary: RatingSummary): void }) {
  const t = useTranslations('ProductTools');
  const [score, setScore] = useState(0);
  const [ownScore, setOwnScore] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const path = `/v1/public/products/${product.id}/ratings`;
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false); setError('');
    void apiRequest(path, personalRatingSchema, { ratingSession: true, signal: controller.signal, timeoutMs: 8000 }).then(({ data }) => {
      setScore(data.my_rating ?? 0); setOwnScore(data.my_rating); setLoaded(true);
    }).catch(() => { if (!controller.signal.aborted) setError(t('ratingUnavailable')); });
    return () => controller.abort();
  }, [path, retry, t]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded || saving || score < 1) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const { data } = await apiRequest(path, personalRatingSchema, { method: 'PUT', json: { score }, ratingSession: true, timeoutMs: 10000 });
      onSaved({ average: data.average, count: data.count }); setOwnScore(data.my_rating); setSaved(true);
    } catch (issue) { setError(t(issue instanceof ApiError && issue.status === 429 ? 'ratingRateLimited' : 'ratingUnavailable')); }
    finally { setSaving(false); }
  }
  return <Modal title={t('rateProduct')} onClose={onClose} closeDisabled={saving} className="product-rating-dialog">
    <p className="rating-product-name">{product.brand_name}</p><p className="muted">{t('ratingHelp')}</p>
    <form onSubmit={submit}>
      <fieldset className="rating-choices" disabled={!loaded || saving}><legend>{t('chooseStars')}</legend>
        <div>{[1, 2, 3, 4, 5].map((star) => <label key={star} title={t('starCount', { count: star })}><input type="radio" name="customer-rating" value={star} checked={score === star} onChange={() => { setScore(star); setSaved(false); }} aria-label={t('starCount', { count: star })}/><Star size={34} strokeWidth={1.5} fill={star <= score ? 'currentColor' : 'none'}/></label>)}</div>
      </fieldset>
      {!loaded && !error && <p role="status">{t('loadingRating')}</p>}
      {saved && <p className="rating-success" role="status">{t('ratingSaved')}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!loaded && error ? <button type="button" className="button secondary" onClick={() => setRetry((value) => value + 1)}>{t('retry')}</button> : <button className="button primary" type="submit" disabled={!loaded || saving || score < 1}>{t(saving ? 'savingRating' : ownScore ? 'updateRating' : 'submitRating')}</button>}
    </form>
  </Modal>;
}
