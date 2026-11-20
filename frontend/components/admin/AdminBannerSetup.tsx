'use client';

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Film, Image as ImageIcon, Pencil, Plus, Trash2, UploadCloud, X } from 'lucide-react';
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
}: {
  initialItems: BannerRecord[];
  initialPagination: PaginationMeta;
  initialFilterPlacement: BannerPlacement | '';
}) {
  const { operation, state } = useAdminOperation();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const [banners, setBanners] = useState<BannerRecord[]>(initialItems);
  const [pagination, setPagination] = useState<PaginationMeta>(initialPagination);
  const [filterPlacement, setFilterPlacement] = useState<BannerPlacement | ''>(initialFilterPlacement);

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

  async function refreshList(nextPlacement: BannerPlacement | '' = filterPlacement) {
    const query = new URLSearchParams({ page: '1', limit: '50' });
    if (nextPlacement) query.set('placement', nextPlacement);
    const result = await apiRequest(`/v1/admin/cms/banners?${query}`, z.array(bannerRecord).max(100));
    setBanners(result.data);
    if (result.meta.pagination) setPagination(result.meta.pagination);
  }

  async function handleFileSelect(file: File | undefined) {
    if (!file || uploadingMedia) return;
    setMediaError('');
    const isVideo = ['video/mp4', 'video/webm'].includes(file.type);
    setUploadingMedia(true);
    try {
      if (isVideo) {
        if (!file.size || file.size > MAX_VIDEO_BYTES) {
          throw new Error('Animation video must be MP4 or WebM up to 50 MiB.');
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
      if (error instanceof ApiError && error.status === 422) {
        setMediaError('Choose a valid JPEG/PNG/WebP image (up to 5 MiB) or MP4/WebM video (up to 50 MiB).');
      } else if (error instanceof Error && error.message) {
        setMediaError(error.message);
      } else {
        setMediaError('Media upload failed. Please try selecting the file again.');
      }
    } finally {
      setUploadingMedia(false);
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
      () => refreshList(filterPlacement),
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
      () => refreshList(filterPlacement),
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
      () => refreshList(filterPlacement),
      () => {
        setConfirmDeleteId(null);
        if (editingId === row.id) resetForm();
      },
    );
  }

  const ratioGuide = bannerRatioGuides[placement];
  const disabled = !ready || state.busy || state.blocked || uploadingMedia;

  return (
    <div className="admin-products-page banner-setup-page">
      <div className="admin-page-heading">
        <div>
          <div className="admin-products-title">
            <span className="admin-products-title-icon">
              <ImageIcon size={24} aria-hidden="true" />
            </span>
            <h1>Banner Setup</h1>
            <span className="admin-products-total">{pagination.total_items}</span>
          </div>
          <p className="muted">
            Upload image or animation video banners and manage placement across Home Hero, Products, Blog, and Announcements.
          </p>
        </div>
        <AdminLink href="/en" className="button secondary">
          View Website
        </AdminLink>
      </div>

      <AdminOperationFeedback state={state} />

      <section ref={formSectionRef} className="banner-setup-card" aria-label={editingId ? 'Edit banner' : 'Create banner'}>
        <div className="banner-setup-card-header">
          <h2>{editingId ? 'Edit Banner' : 'Add New Banner'}</h2>
          {editingId && (
            <button type="button" className="button secondary banner-cancel-edit" onClick={() => resetForm()}>
              Cancel edit
            </button>
          )}
        </div>
        <form onSubmit={(event) => void handleSave(event)}>
          <fieldset disabled={disabled} className="banner-setup-fieldset">
            <div className="banner-setup-grid">
              <div className="banner-setup-fields">
                <label className="banner-field">
                  <span>Banner Type</span>
                  <select
                    name="placement"
                    value={placement}
                    onChange={(event) => setPlacement(event.currentTarget.value as BannerPlacement)}
                  >
                    {bannerPlacements.map((value) => (
                      <option key={value} value={value}>
                        {bannerPlacementLabels[value]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="banner-field">
                  <span>Banner URL</span>
                  <input
                    name="link_path"
                    type="text"
                    placeholder="Enter url (e.g. /en/products)"
                    maxLength={500}
                    value={linkPath}
                    onChange={(event) => setLinkPath(event.currentTarget.value)}
                  />
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
                    Headline, description &amp; schedule
                    <small>{placement === 'ANNOUNCEMENT' ? 'Required for announcement bar' : 'Optional'}</small>
                  </summary>
                  <div className="banner-optional-body">
                    {placement !== 'ANNOUNCEMENT' && (
                      <label className="admin-check">
                        <input
                          type="checkbox"
                          checked={showOverlay}
                          onChange={(event) => setShowOverlay(event.currentTarget.checked)}
                        />
                        Show overlay headline &amp; search/copy over banner media
                      </label>
                    )}
                    <label className="banner-field">
                      <span>Title (EN)</span>
                      <input
                        name="en_title"
                        type="text"
                        maxLength={200}
                        required={placement === 'ANNOUNCEMENT'}
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
                        required={placement === 'ANNOUNCEMENT'}
                        placeholder="Short sourcing notice or promotional caption"
                        value={enBody}
                        onChange={(event) => setEnBody(event.currentTarget.value)}
                      />
                    </label>
                    <div className="banner-schedule-row">
                      <label className="banner-field">
                        <span>Sort order</span>
                        <input
                          name="sort_order"
                          type="number"
                          min={0}
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
                          value={endsAt}
                          onChange={(event) => setEndsAt(event.currentTarget.value)}
                        />
                      </label>
                    </div>

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
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                    className="sr-only"
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
                          <label htmlFor="banner-media-file" className="banner-preview-action">
                            Replace
                          </label>
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
                    <label htmlFor="banner-media-file" className="banner-dropzone-label">
                      <UploadCloud size={30} aria-hidden="true" />
                      <span>{uploadingMedia ? 'Uploading media…' : 'Drag and drop file or Browse file'}</span>
                      <small>JPG, PNG, WebP (up to 5 MiB) or MP4 / WebM animation video (up to 50 MiB)</small>
                    </label>
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
                    {ratioGuide.note} Banner ratio is not the same for all sections in website. Please review the ratio before upload.
                  </p>
                </div>

                <label className="admin-check banner-active-check">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(event) => setIsActive(event.currentTarget.checked)}
                  />
                  Publish banner immediately on save
                </label>
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

      <section className="banner-table-card" aria-label="Banner table">
        <div className="banner-table-toolbar">
          <div className="banner-table-title">
            <h2>Banner Table</h2>
            <span className="admin-products-total">{banners.length}</span>
          </div>
          <div className="banner-table-controls">
            <select
              aria-label="Filter by banner type"
              value={filterPlacement}
              onChange={(event) => setFilterPlacement(event.currentTarget.value as BannerPlacement | '')}
            >
              <option value="">All</option>
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
              onClick={() => void operation.refresh(() => refreshList(filterPlacement))}
            >
              Filter
            </button>
            <button
              type="button"
              className="button primary"
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
          <table className="admin-products-table banner-table">
            <thead>
              <tr>
                <th>SL</th>
                <th>Image</th>
                <th>Banner Type</th>
                <th>Published</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {banners.map((row, index) => {
                const placementKey = row.placement ?? 'ANNOUNCEMENT';
                const scheduleState = bannerScheduleState(row);
                return (
                  <tr key={row.id}>
                    <td>{index + 1}</td>
                    <td>
                      {row.media_url ? (
                        <div className="banner-table-media-cell">
                          {row.media_type === 'VIDEO' ? (
                            <video src={row.media_url} muted loop playsInline className="banner-table-thumb" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={row.media_url} alt={row.translations.en.title} width={108} height={36} className="banner-table-thumb" />
                          )}
                          {row.media_type === 'VIDEO' && <span className="banner-table-video-tag">Video</span>}
                        </div>
                      ) : (
                        <div className="banner-table-text-thumb">
                          <strong>{row.translations.en.title}</strong>
                          <span>{row.translations.en.body}</span>
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="banner-table-type-cell">
                        <strong>{bannerPlacementLabels[placementKey]}</strong>
                        <span className={`banner-schedule-pill is-${scheduleState.toLowerCase()}`}>{scheduleState}</span>
                        {row.link_path && <small>{row.link_path}</small>}
                      </div>
                    </td>
                    <td>
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
                    </td>
                    <td>
                      <div className="banner-table-actions">
                        <button
                          type="button"
                          className="banner-icon-btn is-edit"
                          aria-label={`Edit ${row.translations.en.title}`}
                          onClick={() => loadBannerIntoForm(row)}
                        >
                          <Pencil size={15} aria-hidden="true" />
                        </button>
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
                            onClick={() => setConfirmDeleteId(row.id)}
                          >
                            <Trash2 size={15} aria-hidden="true" />
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
      </section>
    </div>
  );
}
