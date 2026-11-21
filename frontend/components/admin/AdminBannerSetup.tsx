'use client';

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { ArrowUpRight, CalendarClock, Check, Film, Image as ImageIcon, LayoutTemplate, Megaphone, Monitor, Newspaper, Package, Pencil, Plus, Smartphone, Trash2, UploadCloud, X } from 'lucide-react';
import { z } from 'zod';
import { apiRequest, ApiError } from '../../lib/api-client';
import type { paginationSchema } from '../../lib/api-client';
import {
  adminMultipart,
  bannerBody,
  bannerPlacementLabels,
  bannerPlacements,
  bannerRatioGuides,
  bannerRecord,
  bannerResourceTypes,
  bannerScheduleState,
  catalogDeleteReceipt,
  imageReceipt,
  MAX_VIDEO_BYTES,
  resourceList,
  resourceName,
  requirePagination,
  validateCatalogImage,
  validatedInput,
  videoReceipt,
  type BannerMediaType,
  type BannerPlacement,
  type BannerRecord,
  type BannerResourceType,
  type ResourceRecord,
} from '../../lib/admin-management';
import { useAdminOperation } from '../../hooks/useAdminOperation';
import { AdminOperationFeedback } from './AdminOperationFeedback';
import { AdminLink } from './AdminShell';
import { PlacementBanner } from '../home/PlacementBanner';
import { AnnouncementStrip } from '../home/Announcements';
import { HeroPanel, type HeroPanelCopy } from '../home/HeroPanel';
import { plainText, type Banner } from '../../lib/public-catalog';

type PaginationMeta = z.infer<typeof paginationSchema>;

interface ResourceOption {
  id: string;
  label: string;
  linkPath: string;
}

const RESOURCE_SEGMENT: Record<Exclude<BannerResourceType, 'CUSTOM'>, 'products' | 'categories' | 'manufacturers' | 'generics'> = {
  PRODUCT: 'products',
  CATEGORY: 'categories',
  MANUFACTURER: 'manufacturers',
  GENERIC: 'generics',
};

const RESOURCE_LABELS: Record<BannerResourceType, string> = {
  CUSTOM: 'Custom URL',
  PRODUCT: 'Product',
  CATEGORY: 'Category',
  MANUFACTURER: 'Manufacturer',
  GENERIC: 'Generic',
};

const PLACEMENT_INFO = {
  MAIN_HERO: { icon: LayoutTemplate, label: 'Home hero', description: 'First impression on your homepage', path: '/en', variant: 'hero' },
  PRODUCTS_BANNER: { icon: Package, label: 'Products', description: 'Above the product catalog', path: '/en/products', variant: 'products' },
  BLOG_BANNER: { icon: Newspaper, label: 'Blog', description: 'Above your insights and updates', path: '/en/blog', variant: 'blog' },
  ANNOUNCEMENT: { icon: Megaphone, label: 'Announcement', description: 'Between the contact and navigation bars', path: '/en', variant: 'hero' },
} as const;

function toResourceOption(type: Exclude<BannerResourceType, 'CUSTOM'>, item: ResourceRecord): ResourceOption {
  const segment = RESOURCE_SEGMENT[type];
  const label = resourceName(item);
  const slug = 'slug' in item.translations.en ? item.translations.en.slug : '';
  return {
    id: item.id,
    label,
    linkPath: slug ? `/en/${segment}/${slug}` : `/en/${segment}`,
  };
}

export function AdminBannerSetup({
  initialItems,
  initialPagination,
  initialFilterPlacement,
  heroCopyByLocale,
}: {
  initialItems: BannerRecord[];
  initialPagination: PaginationMeta;
  initialFilterPlacement: BannerPlacement | '';
  heroCopyByLocale: Record<'en' | 'zh-CN', HeroPanelCopy>;
}) {
  const { operation, state } = useAdminOperation();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const [banners, setBanners] = useState<BannerRecord[]>(initialItems);
  const [pagination, setPagination] = useState<PaginationMeta>(initialPagination);
  const [filterPlacement, setFilterPlacement] = useState<BannerPlacement | ''>(initialFilterPlacement);
  const [appliedPlacement, setAppliedPlacement] = useState<BannerPlacement | ''>(initialFilterPlacement);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<BannerPlacement>('MAIN_HERO');
  const [linkPath, setLinkPath] = useState('');
  const [resourceType, setResourceType] = useState<BannerResourceType>('CUSTOM');
  const [resourceId, setResourceId] = useState('');
  const [resourceOptions, setResourceOptions] = useState<ResourceOption[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);

  const [mediaType, setMediaType] = useState<BannerMediaType | undefined>(undefined);
  const [mediaKey, setMediaKey] = useState<string | undefined>(undefined);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | undefined>(undefined);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [previewLocale, setPreviewLocale] = useState<'en' | 'zh-CN'>('en');

  const [enTitle, setEnTitle] = useState('');
  const [enBody, setEnBody] = useState('');
  const [zhEnabled, setZhEnabled] = useState(false);
  const [zhTitle, setZhTitle] = useState('');
  const [zhBody, setZhBody] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [showOverlay, setShowOverlay] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const formSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (resourceType === 'CUSTOM') {
      setResourceOptions([]);
      setLoadingResources(false);
      return;
    }
    const controller = new AbortController();
    const kind = RESOURCE_SEGMENT[resourceType];
    setLoadingResources(true);
    void resourceList(kind, new URLSearchParams({ limit: '100' }), controller.signal)
      .then(({ items }) => {
        if (!controller.signal.aborted) {
          setResourceOptions(items.map((item) => toResourceOption(resourceType, item)));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setResourceOptions([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingResources(false);
      });
    return () => controller.abort();
  }, [resourceType]);

  function resetForm(defaultPlacement: BannerPlacement = 'MAIN_HERO') {
    setEditingId(null);
    setPlacement(defaultPlacement);
    setLinkPath('');
    setResourceType('CUSTOM');
    setResourceId('');
    setMediaType(undefined);
    setMediaKey(undefined);
    setMediaPreviewUrl(undefined);
    setMediaError('');
    setEnTitle('');
    setEnBody('');
    setZhEnabled(false);
    setZhTitle('');
    setZhBody('');
    setSortOrder(0);
    setStartsAt('');
    setEndsAt('');
    setShowOverlay(false);
    setIsActive(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function loadBannerIntoForm(row: BannerRecord) {
    setEditingId(row.id);
    setPlacement(row.placement ?? 'ANNOUNCEMENT');
    setLinkPath(row.link_path ?? '');
    setResourceType(row.resource_type ?? 'CUSTOM');
    setResourceId(row.resource_id ?? '');
    setMediaType(row.media_type);
    setMediaKey(row.media_key);
    setMediaPreviewUrl(row.media_url);
    setMediaError('');
    setEnTitle(row.translations.en.title);
    setEnBody(row.translations.en.body);
    setZhEnabled(Boolean(row.translations.zhCN));
    setZhTitle(row.translations.zhCN?.title ?? '');
    setZhBody(row.translations.zhCN?.body ?? '');
    setSortOrder(row.sort_order);
    setStartsAt(row.starts_at ? row.starts_at.slice(0, 19) : '');
    setEndsAt(row.ends_at ? row.ends_at.slice(0, 19) : '');
    setShowOverlay(Boolean(row.show_overlay));
    setIsActive(row.is_active);
    formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function refreshList(nextPlacement: BannerPlacement | '' = appliedPlacement, page = pagination.page): Promise<void> {
    const query = new URLSearchParams({ page: String(page), limit: String(pagination.limit) });
    if (nextPlacement) query.set('placement', nextPlacement);
    const result = await apiRequest(`/v1/admin/cms/banners?${query}`, z.array(bannerRecord).max(100));
    const nextPagination = requirePagination(result.meta);
    const lastPage = Math.max(1, nextPagination.total_pages);
    if (page > lastPage) return refreshList(nextPlacement, lastPage);
    setBanners(result.data);
    setAppliedPlacement(nextPlacement);
    setPagination(nextPagination);
  }

  async function handleFileSelect(file: File | undefined) {
    if (!file || !ready || state.busy || state.blocked || uploadingMedia) return;
    setMediaError('');
    const isVideo = ['video/mp4', 'video/webm'].includes(file.type);
    setUploadingMedia(true);
    try {
      if (isVideo) {
        if (!file.size || file.size > MAX_VIDEO_BYTES) {
          throw new Error('Animation video must be MP4 or WebM up to 100 MiB.');
        }
        const form = new FormData();
        form.set('video', file);
        const receipt = await adminMultipart('/api/admin/catalog/videos', form, videoReceipt);
        setMediaType('VIDEO');
        setMediaKey(receipt.object_key);
        setMediaPreviewUrl(receipt.url);
      } else {
        await validateCatalogImage(file);
        const form = new FormData();
        form.set('image', file);
        const receipt = await adminMultipart('/api/admin/catalog/images', form, imageReceipt);
        setMediaType('IMAGE');
        setMediaKey(receipt.object_key);
        setMediaPreviewUrl(receipt.url);
      }
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 413) {
        setMediaError('Uploaded file exceeds the size limit (images up to 25 MiB, videos up to 100 MiB).');
      } else if (error instanceof ApiError && error.status === 422) {
        setMediaError('Choose a valid JPEG/PNG/WebP image (up to 25 MiB) or MP4/WebM video (up to 100 MiB).');
      } else if (error instanceof Error && error.message) {
        setMediaError(error.message);
      } else {
        setMediaError('Media upload failed. Please try selecting the file again.');
      }
    } finally {
      setUploadingMedia(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    void handleFileSelect(event.dataTransfer.files?.[0]);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMediaError('');
    if (placement !== 'ANNOUNCEMENT' && !mediaKey) {
      setMediaError('Upload a banner image or animation video for this banner placement.');
      return;
    }
    if (resourceType !== 'CUSTOM' && !resourceId) {
      setMediaError('Select a resource before saving, or choose Custom URL.');
      return;
    }
    const fallbackTitle = bannerPlacementLabels[placement];
    const fallbackBody =
      placement === 'MAIN_HERO'
        ? 'Homepage hero visual banner'
        : placement === 'PRODUCTS_BANNER'
          ? 'Products catalog showcase banner'
          : 'Blog insights showcase banner';
    const resolvedTitle = enTitle.trim() || (placement !== 'ANNOUNCEMENT' ? fallbackTitle : '');
    const resolvedBody = enBody.trim() || (placement !== 'ANNOUNCEMENT' ? fallbackBody : '');

    await operation.run(
      async () => {
        const payload = validatedInput(bannerBody, {
          ...(editingId ? { id: editingId } : {}),
          placement,
          ...(mediaType && mediaKey ? { media_type: mediaType, media_key: mediaKey } : {}),
          ...(resourceType ? { resource_type: resourceType } : {}),
          ...(resourceType !== 'CUSTOM' && resourceId ? { resource_id: resourceId } : {}),
          ...(showOverlay ? { show_overlay: true } : editingId ? { show_overlay: false } : {}),
          translations: {
            en: { title: resolvedTitle, body: resolvedBody },
            ...(zhEnabled && (zhTitle.trim() || zhBody.trim())
              ? { zhCN: { title: zhTitle.trim() || resolvedTitle, body: zhBody.trim() || resolvedBody } }
              : {}),
          },
          is_active: isActive,
          sort_order: Number(sortOrder) || 0,
          ...(startsAt ? { starts_at: new Date(`${startsAt}Z`).toISOString() } : {}),
          ...(endsAt ? { ends_at: new Date(`${endsAt}Z`).toISOString() } : {}),
          ...(linkPath.trim() ? { link_path: linkPath.trim() } : {}),
        });
        return (await apiRequest('/v1/admin/cms/banners', bannerRecord, { method: 'POST', json: payload })).data;
      },
      () => refreshList(appliedPlacement, editingId ? pagination.page : 1),
      () => {
        resetForm(placement);
      },
    );
  }

  async function handleTogglePublished(row: BannerRecord) {
    await operation.run(
      async () => {
        const payload = validatedInput(bannerBody, {
          id: row.id,
          placement: row.placement ?? 'ANNOUNCEMENT',
          ...(row.media_type && row.media_key ? { media_type: row.media_type, media_key: row.media_key } : {}),
          ...(row.resource_type ? { resource_type: row.resource_type } : {}),
          ...(row.resource_id ? { resource_id: row.resource_id } : {}),
          ...(row.show_overlay !== undefined ? { show_overlay: row.show_overlay } : {}),
          translations: row.translations,
          is_active: !row.is_active,
          sort_order: row.sort_order,
          ...(row.starts_at ? { starts_at: row.starts_at } : {}),
          ...(row.ends_at ? { ends_at: row.ends_at } : {}),
          ...(row.link_path ? { link_path: row.link_path } : {}),
        });
        return (await apiRequest('/v1/admin/cms/banners', bannerRecord, { method: 'POST', json: payload })).data;
      },
      () => refreshList(appliedPlacement),
    );
  }

  async function handleDelete(row: BannerRecord) {
    await operation.run(
      async () => {
        const receipt = await apiRequest(`/v1/admin/cms/banners/${row.id}`, catalogDeleteReceipt, {
          method: 'DELETE',
          json: { expected_updated_at: row.updated_at },
        });
        return receipt.data;
      },
      () => refreshList(appliedPlacement),
      () => {
        setConfirmDeleteId(null);
        if (editingId === row.id) resetForm();
      },
    );
  }

  const ratioGuide = bannerRatioGuides[placement];
  const disabled = !ready || state.busy || state.blocked || uploadingMedia;
  const previewTitle = (previewLocale === 'zh-CN' && zhEnabled ? zhTitle.trim() : '') || enTitle.trim() || bannerPlacementLabels[placement];
  const previewBody = (previewLocale === 'zh-CN' && zhEnabled ? zhBody.trim() : '') || enBody.trim();
  const previewBanner: Banner = {
    id: editingId ?? 'banner-preview', placement, media_type: mediaType, media_url: mediaPreviewUrl,
    show_overlay: showOverlay, title: plainText(previewTitle), body: plainText(previewBody),
    sort_order: sortOrder, ...(linkPath.trim() ? { link_path: linkPath.trim() } : {}),
  };
  const draftStatus = bannerScheduleState({ is_active: isActive, ...(startsAt ? { starts_at: `${startsAt}Z` } : {}), ...(endsAt ? { ends_at: `${endsAt}Z` } : {}) });
  const liveCount = banners.filter((row) => bannerScheduleState(row) === 'Active').length;
  const scheduledCount = banners.filter((row) => bannerScheduleState(row) === 'Scheduled').length;

  return (
    <div className="admin-products-page banner-setup-page">
      <div className="admin-page-heading">
        <div>
          <p className="admin-kicker">Website content</p>
          <div className="admin-products-title">
            <span className="admin-products-title-icon">
              <ImageIcon size={24} aria-hidden="true" />
            </span>
            <h1>Banner Setup</h1>
            <span className="admin-products-total">{pagination.total_items}</span>
          </div>
          <p className="muted">
            Make every placement count. Create, preview and schedule your website banners in one place.
          </p>
        </div>
        <div className="banner-heading-actions">
          <button type="button" className="button secondary" disabled={!ready || state.busy || uploadingMedia} onClick={() => void operation.refresh(() => refreshList())}>Refresh state</button>
          <AdminLink href="/en" className="button secondary">
            View Website <ArrowUpRight size={16} aria-hidden="true" />
          </AdminLink>
        </div>
      </div>

      <AdminOperationFeedback state={state} />

      <div className="banner-overview" aria-label="Banners on this page">
        <div><ImageIcon size={20} aria-hidden="true" /><span><strong>{pagination.total_items}</strong><small>Banners in this view</small></span></div>
        <div><Check size={20} aria-hidden="true" /><span><strong>{liveCount}</strong><small>Live on this page</small></span></div>
        <div><CalendarClock size={20} aria-hidden="true" /><span><strong>{scheduledCount}</strong><small>Scheduled on this page</small></span></div>
      </div>

      <section ref={formSectionRef} className="banner-setup-card" aria-label={editingId ? 'Edit banner' : 'Create banner'}>
        <div className="banner-setup-card-header">
          <div><p className="admin-kicker">Banner studio</p><h2>{editingId ? 'Edit Banner' : 'Add New Banner'}</h2></div>
          {editingId && (
            <button type="button" disabled={disabled} className="button secondary banner-cancel-edit" onClick={() => resetForm()}>
              Cancel edit
            </button>
          )}
        </div>
        <form onSubmit={(event) => void handleSave(event)} onInvalidCapture={(event) => {
          if (event.target instanceof HTMLElement) {
            const section = event.target.closest('details');
            if (section) section.open = true;
          }
        }}>
          <fieldset disabled={disabled} className="banner-setup-fieldset">
            <div className="banner-placement-picker" role="group" aria-label="Choose banner placement">
              {bannerPlacements.map((value) => {
                const info = PLACEMENT_INFO[value];
                const Icon = info.icon;
                return <button key={value} type="button" className={`banner-placement-option${placement === value ? ' is-selected' : ''}`} aria-pressed={placement === value} onClick={() => setPlacement(value)}>
                  <Icon size={20} aria-hidden="true" /><strong>{info.label}</strong><small>{info.description}</small>
                  <span>{bannerRatioGuides[value].ratio}{placement === value && <Check size={14} aria-hidden="true" />}</span>
                </button>;
              })}
            </div>
            <div className="banner-setup-grid">
              <div className="banner-setup-fields">
                <input type="hidden" name="placement" value={placement} />

                <label className="banner-field">
                  <span>Destination URL <small>Optional</small></span>
                  <input
                    name="link_path"
                    type="text"
                    placeholder="/en/products"
                    maxLength={500}
                    value={linkPath}
                    onChange={(event) => setLinkPath(event.currentTarget.value)}
                  />
                  <small>Use a page on this website, for example /en/products. Leave blank for a banner without a link.</small>
                </label>

                <label className="banner-field">
                  <span>Resource Type</span>
                  <select
                    name="resource_type"
                    value={resourceType}
                    onChange={(event) => {
                      const nextType = event.currentTarget.value as BannerResourceType;
                      setResourceType(nextType);
                      setResourceId('');
                    }}
                  >
                    {bannerResourceTypes.map((value) => (
                      <option key={value} value={value}>
                        {RESOURCE_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>

                {resourceType !== 'CUSTOM' && (
                  <label className="banner-field">
                    <span>{RESOURCE_LABELS[resourceType]}</span>
                    <select
                      name="resource_id"
                      value={resourceId}
                      required
                      disabled={loadingResources}
                      onChange={(event) => {
                        const selectedId = event.currentTarget.value;
                        setResourceId(selectedId);
                        const match = resourceOptions.find((opt) => opt.id === selectedId);
                        if (match) setLinkPath(match.linkPath);
                      }}
                    >
                      <option value="">
                        {loadingResources ? `Loading ${RESOURCE_LABELS[resourceType].toLowerCase()}…` : `Select ${RESOURCE_LABELS[resourceType]}`}
                      </option>
                      {resourceOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <details className="banner-optional-details" open={placement === 'ANNOUNCEMENT'}>
                  <summary>
                    Headline &amp; description
                    <small>{placement === 'ANNOUNCEMENT' ? 'Required for announcement bar' : 'Optional'}</small>
                  </summary>
                  <div className="banner-optional-body">
                    {placement === 'MAIN_HERO' && <p className="banner-field-help">The homepage introduction, search and actions always stay over every hero image or video. These fields name the creative; captions below apply to Products and Blog banners.</p>}
                    {placement !== 'ANNOUNCEMENT' && placement !== 'MAIN_HERO' && (
                      <label className="admin-check">
                        <input
                          type="checkbox"
                          checked={showOverlay}
                          onChange={(event) => setShowOverlay(event.currentTarget.checked)}
                        />
                        Show headline &amp; description over the media
                      </label>
                    )}
                    <label className="banner-field">
                      <span>Title (EN)</span>
                      <input
                        name="en_title"
                        type="text"
                        maxLength={200}
                        required={placement === 'ANNOUNCEMENT' || (placement !== 'MAIN_HERO' && showOverlay)}
                        placeholder={bannerPlacementLabels[placement]}
                        value={enTitle}
                        onChange={(event) => setEnTitle(event.currentTarget.value)}
                      />
                    </label>
                    <label className="banner-field">
                      <span>Description (EN)</span>
                      <textarea
                        name="en_body"
                        rows={2}
                        maxLength={5000}
                        required={placement === 'ANNOUNCEMENT' || (placement !== 'MAIN_HERO' && showOverlay)}
                        placeholder="Short sourcing notice or promotional caption"
                        value={enBody}
                        onChange={(event) => setEnBody(event.currentTarget.value)}
                      />
                    </label>
                  </div>
                </details>
                <details className="banner-optional-details" open>
                  <summary>Publishing &amp; schedule <small>UTC</small></summary>
                  <div className="banner-optional-body">
                    <label className="admin-check banner-active-check">
                      <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.currentTarget.checked)} />
                      Enable banner during its scheduled dates
                    </label>
                    <div className="banner-schedule-row">
                      <label className="banner-field">
                        <span>Sort order</span>
                        <input
                          name="sort_order"
                          type="number"
                          min={0}
                          max={Number.MAX_SAFE_INTEGER}
                          value={sortOrder}
                          onChange={(event) => setSortOrder(Number(event.currentTarget.value) || 0)}
                        />
                      </label>
                      <label className="banner-field">
                        <span>Starts at (UTC)</span>
                        <input
                          name="starts_at"
                          type="datetime-local"
                          step="1"
                          value={startsAt}
                          onChange={(event) => setStartsAt(event.currentTarget.value)}
                        />
                      </label>
                      <label className="banner-field">
                        <span>Ends at (UTC)</span>
                        <input
                          name="ends_at"
                          type="datetime-local"
                          step="1"
                          min={startsAt || undefined}
                          value={endsAt}
                          onChange={(event) => setEndsAt(event.currentTarget.value)}
                        />
                      </label>
                    </div>
                    <p className="banner-field-help">Leave dates empty to show whenever enabled. Lower sort orders appear first. All dates are in UTC.</p>
                    <span className={`banner-schedule-pill is-${draftStatus.toLowerCase()}`}>{draftStatus === 'Inactive' ? 'Unpublished' : draftStatus === 'Active' ? 'Live when saved' : draftStatus}</span>
                  </div>
                </details>

                <details className="banner-optional-details">
                  <summary>Translation <small>简体中文</small></summary>
                  <div className="banner-optional-body">
                    <label className="admin-check">
                      <input
                        type="checkbox"
                        checked={zhEnabled}
                        onChange={(event) => setZhEnabled(event.currentTarget.checked)}
                      />
                      Include Simplified Chinese translation (简体中文)
                    </label>
                    {zhEnabled && (
                      <div className="banner-zh-fields">
                        <label className="banner-field">
                          <span>Title (ZH)</span>
                          <input
                            name="zhCN_title"
                            type="text"
                            maxLength={200}
                            value={zhTitle}
                            onChange={(event) => setZhTitle(event.currentTarget.value)}
                          />
                        </label>
                        <label className="banner-field">
                          <span>Description (ZH)</span>
                          <textarea
                            name="zhCN_body"
                            rows={2}
                            maxLength={5000}
                            value={zhBody}
                            onChange={(event) => setZhBody(event.currentTarget.value)}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </details>
              </div>

              <div className="banner-setup-upload">
                <div className="banner-live-preview">
                  <div className="banner-preview-toolbar">
                    <div><span className="banner-preview-indicator" /><strong>Live preview</strong></div>
                    <div className="banner-preview-devices" role="group" aria-label="Preview device">
                      <button type="button" aria-label="Desktop preview" aria-pressed={previewDevice === 'desktop'} onClick={() => setPreviewDevice('desktop')}><Monitor size={16} aria-hidden="true" /></button>
                      <button type="button" aria-label="Mobile preview" aria-pressed={previewDevice === 'mobile'} onClick={() => setPreviewDevice('mobile')}><Smartphone size={16} aria-hidden="true" /></button>
                    </div>
                  </div>
                  <div className={`banner-preview-canvas is-${previewDevice}`}>
                    <div className="banner-preview-viewport">
                      {placement === 'ANNOUNCEMENT' ? <div className="banner-announcement-preview"><AnnouncementStrip banners={[previewBanner]} locale={previewLocale} labels={{ title: 'Announcement preview', dismiss: 'Dismiss announcement', previous: 'Previous announcements', next: 'Next announcements', read: 'Read notice' }} preview /></div> : placement === 'MAIN_HERO' ? <PlacementBanner banners={[previewBanner]} locale={previewLocale} variant="hero" preview><HeroPanel copy={heroCopyByLocale[previewLocale]} preview /></PlacementBanner> : mediaPreviewUrl ? <PlacementBanner banners={[previewBanner]} locale={previewLocale} variant={PLACEMENT_INFO[placement].variant} preview /> : <div className="banner-preview-placeholder"><ImageIcon size={30} aria-hidden="true" /><strong>Your next first impression</strong><span>Upload media to preview this placement.</span></div>}
                    </div>
                  </div>
                  <div className="banner-preview-footer">
                    <span>{PLACEMENT_INFO[placement].label} · {ratioGuide.ratio}</span>
                    <select aria-label="Preview language" value={previewLocale} onChange={(event) => setPreviewLocale(event.currentTarget.value as 'en' | 'zh-CN')}><option value="en">English</option><option value="zh-CN">简体中文</option></select>
                  </div>
                </div>
                <div className="banner-upload-heading"><strong>Banner media</strong><span>{placement === 'ANNOUNCEMENT' ? 'Optional · announcement displays text only' : 'Image or video'}</span></div>
                <div
                  className={`banner-dropzone${dragActive ? ' is-drag' : ''}${mediaPreviewUrl ? ' has-preview' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    aria-label="Upload banner media"
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                    hidden
                    id="banner-media-file"
                    onChange={(event) => void handleFileSelect(event.currentTarget.files?.[0])}
                  />
                  {mediaPreviewUrl ? (
                    <div className="banner-preview-box">
                      {mediaType === 'VIDEO' ? (
                        <video src={mediaPreviewUrl} autoPlay muted loop playsInline controls className="banner-preview-media" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mediaPreviewUrl} alt="Banner preview" className="banner-preview-media" />
                      )}
                      <div className="banner-preview-actions">
                        <span className="banner-media-badge">
                          {mediaType === 'VIDEO' ? <Film size={14} aria-hidden="true" /> : <ImageIcon size={14} aria-hidden="true" />}
                          {mediaType === 'VIDEO' ? 'Animation Video' : 'Banner Image'}
                        </span>
                        <div>
                          <button type="button" onClick={() => fileInputRef.current?.click()} className="banner-preview-action">
                            Replace
                          </button>
                          <button
                            type="button"
                            className="banner-preview-remove"
                            onClick={() => {
                              setMediaType(undefined);
                              setMediaKey(undefined);
                              setMediaPreviewUrl(undefined);
                              if (fileInputRef.current) fileInputRef.current.value = '';
                            }}
                          >
                            <X size={14} aria-hidden="true" />
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="banner-dropzone-label">
                      <UploadCloud size={30} aria-hidden="true" />
                      <span>{uploadingMedia ? 'Uploading media…' : 'Drag and drop file or Browse file'}</span>
                      <small>JPG, PNG, WebP (up to 25 MiB) or MP4 / WebM animation video (up to 100 MiB)</small>
                    </button>
                  )}
                </div>

                {mediaError && (
                  <p className="form-error" role="alert">
                    {mediaError}
                  </p>
                )}

                <div className="banner-ratio-note">
                  <strong>Banner Media Ratio {ratioGuide.ratio}</strong>
                  <p>
                    {ratioGuide.note} Keep essential text and subjects near the center; edges may crop on mobile.
                  </p>
                </div>

                <AdminLink href={PLACEMENT_INFO[placement].path} className="banner-placement-link">View this placement on website <ArrowUpRight size={14} aria-hidden="true" /></AdminLink>
              </div>
            </div>

            <div className="banner-setup-actions">
              <button type="button" className="button secondary" onClick={() => resetForm()}>
                Reset
              </button>
              <button type="submit" className="button primary">
                {state.busy ? 'Saving…' : editingId ? 'Update' : 'Save'}
              </button>
            </div>
          </fieldset>
        </form>
      </section>

      <section className="banner-table-card" aria-label="Banner list">
        <div className="banner-table-toolbar">
          <div>
            <div className="banner-table-title">
              <h2>Banner list</h2>
              <span className="admin-products-total">{pagination.total_items}</span>
            </div>
            <p className="banner-table-description">Manage your images, videos and scheduled announcements.</p>
          </div>
          <div className="banner-table-controls">
            <select
              aria-label="Filter by banner type"
              disabled={disabled}
              value={filterPlacement}
              onChange={(event) => setFilterPlacement(event.currentTarget.value as BannerPlacement | '')}
            >
              <option value="">All placements</option>
              {bannerPlacements.map((value) => (
                <option key={value} value={value}>
                  {bannerPlacementLabels[value]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button primary banner-filter-btn"
              disabled={disabled}
              onClick={() => void operation.refresh(() => refreshList(filterPlacement, 1))}
            >
              Filter
            </button>
            <button
              type="button"
              className="button primary"
              disabled={disabled}
              onClick={() => {
                resetForm(filterPlacement || 'MAIN_HERO');
                formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <Plus size={16} aria-hidden="true" />
              Add Banner
            </button>
          </div>
        </div>

        <div className="admin-table-scroll">
          <table className="banner-table" aria-label="Website banners">
            <colgroup>
              <col className="banner-col-index" />
              <col className="banner-col-creative" />
              <col />
              <col className="banner-col-publication" />
              <col className="banner-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Banner</th>
                <th scope="col">Placement &amp; schedule</th>
                <th scope="col">Publication</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {banners.map((row, index) => {
                const placementKey = row.placement ?? 'ANNOUNCEMENT';
                const scheduleState = bannerScheduleState(row);
                return (
                  <tr key={row.id}>
                    <td className="banner-table-index">{(pagination.page - 1) * pagination.limit + index + 1}</td>
                    <td className="banner-table-creative">
                      <div className="banner-table-creative-content">
                        <button type="button" className="banner-table-media-cell" disabled={disabled} aria-label={`Preview and edit ${row.translations.en.title}`} title="Preview and edit banner" onClick={() => loadBannerIntoForm(row)}>
                          {row.media_url ? <>
                          {row.media_type === 'VIDEO' ? (
                            <video src={row.media_url} muted playsInline preload="metadata" aria-hidden="true" className="banner-table-thumb" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={row.media_url} alt="" width={160} height={80} loading="lazy" className="banner-table-thumb" />
                          )}
                          {row.media_type === 'VIDEO' && <span className="banner-table-video-tag"><Film size={12} aria-hidden="true" />Video</span>}
                          </> : <span className="banner-table-text-thumb"><Megaphone size={26} aria-hidden="true" /><span>Text announcement</span></span>}
                        </button>
                        <div className="banner-table-caption">
                          <strong>{row.translations.en.title}</strong>
                          <span>{row.media_url ? `${row.media_type === 'VIDEO' ? 'Video' : 'Image'} · ${bannerRatioGuides[placementKey].ratio}` : 'Text announcement'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="banner-table-placement" data-label="Placement & schedule">
                      <div className="banner-table-type-cell">
                        <strong>{bannerPlacementLabels[placementKey]}</strong>
                        <small>Display order: {row.sort_order}</small>
                        {row.starts_at && <small>From {row.starts_at.slice(0, 16).replace('T', ' ')} UTC</small>}
                        {row.ends_at && <small>Until {row.ends_at.slice(0, 16).replace('T', ' ')} UTC</small>}
                        {row.link_path && <small className="banner-table-destination" title={row.link_path}>{row.link_path}</small>}
                      </div>
                    </td>
                    <td className="banner-table-publication" data-label="Publication">
                      <div className="banner-table-publication-content">
                        <div className="banner-table-toggle-row">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={row.is_active}
                        aria-label={`Toggle publish for ${row.translations.en.title}`}
                        className={`banner-switch${row.is_active ? ' is-on' : ''}`}
                        disabled={disabled}
                        onClick={() => void handleTogglePublished(row)}
                      >
                        <span />
                      </button>
                          <span>{row.is_active ? 'Enabled' : 'Disabled'}</span>
                        </div>
                        <span className={`banner-schedule-pill is-${scheduleState.toLowerCase()}`}>{scheduleState === 'Active' ? 'Live' : scheduleState === 'Inactive' ? 'Unpublished' : scheduleState}</span>
                      </div>
                    </td>
                    <td className="banner-table-action-cell" data-label="Actions">
                      <div className="banner-table-actions">
                        {confirmDeleteId !== row.id && <button
                          type="button"
                          className="banner-icon-btn is-edit"
                          aria-label={`Edit ${row.translations.en.title}`}
                          disabled={disabled}
                          onClick={() => loadBannerIntoForm(row)}
                        >
                          <Pencil size={17} aria-hidden="true" />
                          <span>Edit</span>
                        </button>}
                        {confirmDeleteId === row.id ? (
                          <span className="banner-delete-confirm">
                            <button
                              type="button"
                              className="button secondary banner-confirm-yes"
                              disabled={disabled}
                              onClick={() => void handleDelete(row)}
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              className="banner-confirm-no"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="banner-icon-btn is-delete"
                            aria-label={`Delete ${row.translations.en.title}`}
                            disabled={disabled}
                            onClick={() => setConfirmDeleteId(row.id)}
                          >
                            <Trash2 size={18} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!banners.length && (
                <tr>
                  <td colSpan={5} className="banner-table-empty">
                    No banners found for this filter. Use the Banner Setup form above to upload your first image or animation video banner.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="banner-list-pagination">
          <span>{pagination.total_items ? `Showing ${(pagination.page - 1) * pagination.limit + 1}–${(pagination.page - 1) * pagination.limit + banners.length} of ${pagination.total_items} banners` : 'No banners to show'}</span>
          <div><button type="button" className="button secondary" disabled={disabled || !pagination.has_prev} onClick={() => void operation.refresh(() => refreshList(appliedPlacement, pagination.page - 1))}>Previous</button><span>Page {pagination.page} of {Math.max(1, pagination.total_pages)}</span><button type="button" className="button secondary" disabled={disabled || !pagination.has_next} onClick={() => void operation.refresh(() => refreshList(appliedPlacement, pagination.page + 1))}>Next</button></div>
        </div>
      </section>
    </div>
  );
}
