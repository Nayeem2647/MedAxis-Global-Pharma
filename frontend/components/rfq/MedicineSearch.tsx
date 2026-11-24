'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, ChevronLeft, ChevronRight, Pill, Plus, Search } from 'lucide-react';
import { apiRequest, type ApiPagination } from '../../lib/api-client';
import { catalogListSchema, type HomeProduct } from '../../lib/public-catalog';

export function MedicineSearch({ enabled, selectedId, addToList = false, onSelect }: {
  enabled: boolean;
  selectedId?: string;
  addToList?: boolean;
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

  /* Fetch on query/page change */
  useEffect(() => {
    if (!enabled || !open) return;
    const controller = new AbortController();
    setStatus('loading');
    const hasQuery = key.includes('q=');
    const timer = setTimeout(async () => {
      try {
        const response = await apiRequest(
          `/v1/public/products?${key}`,
          catalogListSchema,
          { signal: controller.signal, timeoutMs: 10_000 },
        );
        if (controller.signal.aborted) return;
        if (!response.meta.pagination) throw new Error('Missing pagination.');
        setResult({ key, products: response.data.products, pagination: response.meta.pagination });
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted) setStatus('error');
      }
    }, hasQuery ? 300 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [enabled, open, key, retry]);

  /* Open dropdown when user focuses the input */
  function handleFocus() {
    setOpen(true);
    if (status === 'idle') setStatus('loading');
  }

  /* Close on outside click */
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  function handleSelect(medicine: HomeProduct) {
    onSelect(medicine);
    if (!addToList) {
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div className="rfq-search-wrap" onChange={(e) => e.stopPropagation()}>
      {/* ── Search input ── */}
      <Search size={16} className="rfq-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className="rfq-search-input"
        placeholder={t('medicineSearchPlaceholder')}
        value={query}
        maxLength={100}
        autoComplete="off"
        aria-label={t('medicineSearchLabel')}
        aria-describedby={helpId}
        aria-haspopup="listbox"
        disabled={!enabled}
        onChange={(e) => { setQuery(e.target.value); setPage(1); if (!open) setOpen(true); }}
        onFocus={handleFocus}
        onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); } if (e.key === 'Enter') e.preventDefault(); }}
      />
      <span id={helpId} className="sr-only">{t(addToList ? 'medicineSearchCartHelp' : 'medicineSearchHelp')}</span>

      {/* ── Dropdown ── */}
      {open && (
        <div
          ref={dropdownRef}
          id="rfq-search-dropdown"
          className="rfq-search-dropdown"
          role="listbox"
          aria-label={t('medicineSearchTitle')}
        >
          {/* Status line */}
          <p className="rfq-search-status" role="status" aria-live="polite">
            {loading
              ? t('medicineSearchLoading')
              : status === 'error'
              ? t('medicineSearchError')
              : result?.products.length
              ? t('medicineSearchCount', { count: result.pagination.total_items })
              : query.trim()
              ? t('medicineSearchEmpty')
              : 'Start typing to search medicines…'}
          </p>

          {/* Error retry */}
          {status === 'error' && !loading && (
            <div style={{ padding: '0 12px 10px' }}>
              <button
                type="button"
                className="rfq-search-page-btn"
                onClick={() => setRetry((v) => v + 1)}
              >
                {t('medicineSearchRetry')}
              </button>
            </div>
          )}

          {/* Results */}
          {!loading && status === 'ready' && result && result.products.length > 0 && (
            <>
              <ul className="rfq-search-result-list" role="presentation">
                {result.products.map((medicine) => {
                  const isSelected = medicine.id === selectedId;
                  return (
                    <li
                      key={medicine.id}
                      className="rfq-search-result-item"
                      role="option"
                      aria-selected={isSelected}
                    >
                      {/* Thumbnail */}
                      <div className="rfq-search-thumb" aria-hidden="true">
                        {medicine.primary_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={medicine.primary_image_url}
                            alt=""
                            width={44}
                            height={44}
                            loading="lazy"
                          />
                        ) : (
                          <Pill size={18} className="rfq-search-thumb-icon" aria-hidden="true" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="rfq-search-result-info">
                        <strong>{medicine.brand_name}</strong>
                        <span>{medicine.generic.name} · {medicine.strength} · {medicine.dosage_form}</span>
                        <span style={{ fontSize: '.72rem', color: '#93aab8' }}>{medicine.manufacturer.name} · {medicine.pack_size} · {medicine.packaging_unit}</span>
                      </div>

                      {/* Add / Selected button */}
                      <button
                        type="button"
                        className="rfq-search-add-btn"
                        disabled={isSelected && !addToList}
                        aria-label={t(addToList ? 'medicineAddNamed' : 'medicineSelectNamed', { name: medicine.brand_name })}
                        onClick={() => handleSelect(medicine)}
                      >
                        {isSelected && !addToList
                          ? <><Check size={14} aria-hidden="true" /> {t('medicineSelected')}</>
                          : <><Plus size={14} aria-hidden="true" /> {t(addToList ? 'medicineAdd' : 'medicineSelect')}</>
                        }
                      </button>
                    </li>
                  );
                })}
              </ul>

              {/* Pagination */}
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
