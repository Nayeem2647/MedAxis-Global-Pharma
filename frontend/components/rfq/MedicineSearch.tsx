'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Pill, Plus, Search } from 'lucide-react';
import { apiRequest, type ApiPagination } from '../../lib/api-client';
import { catalogListSchema, type HomeProduct } from '../../lib/public-catalog';

export function MedicineSearch({
  enabled,
  onSelect,
}: {
  enabled: boolean;
  onSelect(product: HomeProduct): void;
}) {
  const t = useTranslations('Rfq');
  const locale = useLocale() === 'zh-CN' ? 'zh-CN' : 'en';
  const helpId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [result, setResult] = useState<{ key: string; products: HomeProduct[]; pagination: ApiPagination }>();

  const parameters = new URLSearchParams({ locale, page: String(page), limit: '6' });
  if (query.trim()) parameters.set('q', query.trim());
  const key = parameters.toString();
  const loading = status === 'loading' || (status === 'ready' && result?.key !== key);

  /* Fetch catalog products on query/page change */
  useEffect(() => {
    if (!enabled || !open) return;
    const controller = new AbortController();
    setStatus('loading');
    const hasQuery = key.includes('q=');
    const timer = setTimeout(
      async () => {
        try {
          const response = await apiRequest(`/v1/public/products?${key}`, catalogListSchema, {
            signal: controller.signal,
            timeoutMs: 10_000,
          });
          if (controller.signal.aborted) return;
          if (!response.meta.pagination) throw new Error('Missing pagination.');
          setResult({ key, products: response.data.products, pagination: response.meta.pagination });
          setStatus('ready');
        } catch {
          if (!controller.signal.aborted) setStatus('error');
        }
      },
      hasQuery ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, open, key, retry]);

  function handleFocus() {
    setOpen(true);
    if (status === 'idle') setStatus('loading');
  }

  /* Close dropdown on outside click */
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  function handleAdd(medicine: HomeProduct) {
    onSelect(medicine);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="rfq-search-wrap" onChange={(e) => e.stopPropagation()}>
      <Search size={17} className="rfq-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className="rfq-search-input"
        placeholder={t('searchBarPlaceholder')}
        value={query}
        maxLength={100}
        autoComplete="off"
        aria-label={t('medicineSearchLabel')}
        aria-describedby={helpId}
        aria-haspopup="listbox"
        disabled={!enabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(1);
          if (!open) setOpen(true);
        }}
        onFocus={handleFocus}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter') e.preventDefault();
        }}
      />
      <span id={helpId} className="sr-only">
        {t('medicineSearchCartHelp')}
      </span>

      {open && (
        <div
          ref={dropdownRef}
          id="rfq-search-dropdown"
          className="rfq-search-dropdown"
          role="listbox"
          aria-label={t('medicineSearchTitle')}
        >
          <p className="rfq-search-status" role="status" aria-live="polite">
            {loading
              ? t('medicineSearchLoading')
              : status === 'error'
                ? t('medicineSearchError')
                : result?.products.length
                  ? t('medicineSearchCount', { count: result.pagination.total_items })
                  : query.trim()
                    ? t('medicineSearchEmpty')
                    : t('searchStartTyping')}
          </p>

          {status === 'error' && !loading && (
            <div style={{ padding: '0 14px 12px' }}>
              <button type="button" className="rfq-search-page-btn" onClick={() => setRetry((v) => v + 1)}>
                {t('medicineSearchRetry')}
              </button>
            </div>
          )}

          {!loading && status === 'ready' && result && result.products.length > 0 && (
            <>
              <ul className="rfq-search-result-list" role="presentation">
                {result.products.map((medicine) => {
                  const detailLine = [
                    medicine.generic.name,
                    medicine.strength,
                    medicine.pack_size || medicine.dosage_form,
                  ]
                    .filter(Boolean)
                    .join(' · ');

                  return (
                    <li key={medicine.id} className="rfq-search-result-item" role="option" aria-selected={false}>
                      <div className="rfq-search-thumb" aria-hidden="true">
                        {medicine.primary_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={medicine.primary_image_url} alt="" width={44} height={44} loading="lazy" />
                        ) : (
                          <Pill size={18} className="rfq-search-thumb-icon" aria-hidden="true" />
                        )}
                      </div>

                      <div className="rfq-search-result-info">
                        <strong>{medicine.brand_name}</strong>
                        <span>{detailLine}</span>
                      </div>

                      <button
                        type="button"
                        className="rfq-search-add-btn"
                        aria-label={t('medicineAddNamed', { name: medicine.brand_name })}
                        onClick={() => handleAdd(medicine)}
                      >
                        <Plus size={14} aria-hidden="true" />
                        {t('addShort')}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {result.pagination.total_pages > 1 && (
                <div className="rfq-search-pagination">
                  <button
                    type="button"
                    className="rfq-search-page-btn"
                    disabled={!result.pagination.has_prev}
                    onClick={() => setPage((v) => v - 1)}
                    aria-label={t('medicinePrevious')}
                  >
                    <ChevronLeft size={13} aria-hidden="true" />
                    {t('medicinePrevious')}
                  </button>
                  <span>{t('medicinePage', { page: result.pagination.page, total: result.pagination.total_pages })}</span>
                  <button
                    type="button"
                    className="rfq-search-page-btn"
                    disabled={!result.pagination.has_next}
                    onClick={() => setPage((v) => v + 1)}
                    aria-label={t('medicineNext')}
                  >
                    {t('medicineNext')}
                    <ChevronRight size={13} aria-hidden="true" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
