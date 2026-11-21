'use client';

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { BookOpen, Check, Image as ImageIcon, Newspaper, Pencil, Plus, Trash2, UploadCloud, X } from 'lucide-react';
import { z } from 'zod';
import { apiRequest, ApiError } from '../../lib/api-client';
import type { paginationSchema } from '../../lib/api-client';
import {
  adminMultipart,
  blogCategories,
  blogCategoryLabels,
  blogPostBody,
  blogPostRecord,
  blogSlugFromTitle,
  catalogDeleteReceipt,
  imageReceipt,
  requirePagination,
  validateCatalogImage,
  validatedInput,
  type BlogCategory,
  type BlogPostRecord,
} from '../../lib/admin-management';
import { useAdminOperation } from '../../hooks/useAdminOperation';
import { AdminOperationFeedback } from './AdminOperationFeedback';

type PaginationMeta = z.infer<typeof paginationSchema>;

export function AdminBlogSetup({
  initialItems,
  initialPagination,
  initialFilterCategory,
}: {
  initialItems: BlogPostRecord[];
  initialPagination: PaginationMeta;
  initialFilterCategory: BlogCategory | '';
}) {
  const { operation, state } = useAdminOperation();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const [posts, setPosts] = useState<BlogPostRecord[]>(initialItems);
  const [pagination, setPagination] = useState<PaginationMeta>(initialPagination);
  const [filterCategory, setFilterCategory] = useState<BlogCategory | ''>(initialFilterCategory);
  const [appliedCategory, setAppliedCategory] = useState<BlogCategory | ''>(initialFilterCategory);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [category, setCategory] = useState<BlogCategory>('GUIDE');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  const [coverKey, setCoverKey] = useState<string | undefined>(undefined);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | undefined>(undefined);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [coverError, setCoverError] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const [enTitle, setEnTitle] = useState('');
  const [enSummary, setEnSummary] = useState('');
  const [enBody, setEnBody] = useState('');
  const [zhEnabled, setZhEnabled] = useState(false);
  const [zhTitle, setZhTitle] = useState('');
  const [zhSummary, setZhSummary] = useState('');
  const [zhBody, setZhBody] = useState('');
  const [published, setPublished] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const formSectionRef = useRef<HTMLElement>(null);

  const disabled = !ready || state.busy || state.blocked || uploadingCover;
  const totalCount = pagination.total_items;
  const publishedCount = posts.filter((row) => row.is_active).length;
  const draftCount = posts.filter((row) => !row.is_active).length;

  function resetForm(nextCategory: BlogCategory = 'GUIDE') {
    setEditingId(null);
    setCategory(nextCategory);
    setSlug('');
    setSlugTouched(false);
    setCoverKey(undefined);
    setCoverPreviewUrl(undefined);
    setCoverError('');
    setEnTitle('');
    setEnSummary('');
    setEnBody('');
    setZhEnabled(false);
    setZhTitle('');
    setZhSummary('');
    setZhBody('');
    setPublished(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function loadPostIntoForm(row: BlogPostRecord) {
    setEditingId(row.id);
    setCategory(row.category);
    setSlug(row.slug);
    setSlugTouched(true);
    setCoverKey(row.cover_image_key);
    setCoverPreviewUrl(row.cover_image_url);
    setCoverError('');
    setEnTitle(row.translations.en.title);
    setEnSummary(row.translations.en.summary);
    setEnBody(row.translations.en.body);
    setZhEnabled(Boolean(row.translations.zhCN));
    setZhTitle(row.translations.zhCN?.title ?? '');
    setZhSummary(row.translations.zhCN?.summary ?? '');
    setZhBody(row.translations.zhCN?.body ?? '');
    setPublished(row.is_active);
    formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function refreshList(nextCategory = appliedCategory, page = 1) {
    const query = new URLSearchParams({ page: String(page), limit: String(pagination.limit || 20) });
    if (nextCategory) query.set('category', nextCategory);
    const result = await apiRequest(`/v1/admin/cms/blogs?${query}`, z.array(blogPostRecord).max(100));
    const nextPagination = requirePagination(result.meta);
    setPosts(result.data);
    setAppliedCategory(nextCategory);
    setPagination(nextPagination);
  }

  async function handleFileSelect(file: File | undefined) {
    if (!file || !ready || state.busy || state.blocked || uploadingCover) return;
    setCoverError('');
    setUploadingCover(true);
    try {
      await validateCatalogImage(file);
      const form = new FormData();
      form.set('image', file);
      const receipt = await adminMultipart('/api/admin/catalog/images', form, imageReceipt);
      setCoverKey(receipt.object_key);
      setCoverPreviewUrl(receipt.url);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 413) {
        setCoverError('Cover image exceeds the 25 MiB limit.');
      } else if (error instanceof ApiError && error.status === 422) {
        setCoverError('Choose a valid JPEG, PNG or WebP image (up to 25 MiB).');
      } else if (error instanceof Error && error.message) {
        setCoverError(error.message);
      } else {
        setCoverError('Cover upload failed. Please try selecting the image again.');
      }
    } finally {
      setUploadingCover(false);
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
    setCoverError('');
    const normalizedSlug = slug.trim() || blogSlugFromTitle(enTitle);
    if (!normalizedSlug) {
      setCoverError('Enter a valid URL slug or English article title.');
      return;
    }

    await operation.run(
      async () => {
        const body = validatedInput(blogPostBody, {
          ...(editingId ? { id: editingId } : {}),
          slug: normalizedSlug,
          category,
          ...(coverKey ? { cover_image_key: coverKey } : {}),
          translations: {
            en: {
              title: enTitle.trim(),
              summary: enSummary.trim(),
              body: enBody.trim(),
            },
            ...(zhEnabled
              ? {
                  zhCN: {
                    title: zhTitle.trim(),
                    summary: zhSummary.trim(),
                    body: zhBody.trim(),
                  },
                }
              : {}),
          },
          is_active: published,
        });
        return (await apiRequest('/v1/admin/cms/blogs', blogPostRecord, { method: 'POST', json: body })).data;
      },
      () => refreshList(appliedCategory, 1),
      () => {
        resetForm(category);
      },
    );
  }

  async function handleTogglePublished(row: BlogPostRecord) {
    await operation.run(
      async () => {
        const body = validatedInput(blogPostBody, {
          id: row.id,
          slug: row.slug,
          category: row.category,
          ...(row.cover_image_key ? { cover_image_key: row.cover_image_key } : {}),
          translations: {
            en: row.translations.en,
            ...(row.translations.zhCN ? { zhCN: row.translations.zhCN } : {}),
          },
          is_active: !row.is_active,
          published_at: row.published_at,
        });
        return (await apiRequest('/v1/admin/cms/blogs', blogPostRecord, { method: 'POST', json: body })).data;
      },
      () => refreshList(appliedCategory, pagination.page),
    );
  }

  async function handleDelete(row: BlogPostRecord) {
    setConfirmDeleteId(null);
    await operation.run(
      async () =>
        (
          await apiRequest(`/v1/admin/cms/blogs/${row.id}`, catalogDeleteReceipt, {
            method: 'DELETE',
            json: { expected_updated_at: row.updated_at },
          })
        ).data,
      async () => refreshList(appliedCategory, posts.length === 1 && pagination.page > 1 ? pagination.page - 1 : pagination.page),
      () => {
        if (editingId === row.id) resetForm();
      },
    );
  }

  return (
    <div className="banner-setup-page">
      <div className="admin-page-heading">
        <div>
          <p className="admin-kicker">Content management</p>
          <h1>Blog Setup</h1>
        </div>
        <div className="banner-heading-actions">
          <a className="button secondary" href="/en/blog" target="_blank" rel="noreferrer">
            Open public Blog
          </a>
        </div>
      </div>

      <section className="banner-overview" aria-label="Blog statistics">
        <div>
          <Newspaper size={22} aria-hidden="true" />
          <span>
            <strong>{totalCount}</strong>
            <small>Total blog articles</small>
          </span>
        </div>
        <div>
          <Check size={22} aria-hidden="true" />
          <span>
            <strong>{publishedCount}</strong>
            <small>Published on this page</small>
          </span>
        </div>
        <div>
          <BookOpen size={22} aria-hidden="true" />
          <span>
            <strong>{draftCount}</strong>
            <small>Drafts on this page</small>
          </span>
        </div>
      </section>

      <AdminOperationFeedback state={state} />

      <section className="banner-setup-card" ref={formSectionRef}>
        <div className="banner-setup-card-header">
          <h2>{editingId ? 'Edit Blog Article' : 'Publish Blog Article'}</h2>
          {editingId && (
            <button type="button" className="button secondary" onClick={() => resetForm()}>
              Cancel edit
            </button>
          )}
        </div>

        <form onSubmit={(event) => void handleSave(event)}>
          <fieldset className="banner-setup-fieldset" disabled={disabled}>
            <div className="banner-setup-grid">
              <div className="banner-setup-fields">
                <label className="banner-field">
                  <span>Category</span>
                  <select value={category} onChange={(event) => setCategory(event.currentTarget.value as BlogCategory)}>
                    {blogCategories.map((item) => (
                      <option key={item} value={item}>
                        {blogCategoryLabels[item]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="banner-field">
                  <span>Article Title (EN)</span>
                  <input
                    required
                    maxLength={200}
                    placeholder="e.g. Cold-chain integrity in oncology sourcing"
                    value={enTitle}
                    onChange={(event) => {
                      const val = event.currentTarget.value;
                      setEnTitle(val);
                      if (!slugTouched) setSlug(blogSlugFromTitle(val));
                    }}
                  />
                </label>

                <label className="banner-field">
                  <span>
                    URL Slug <small>Lowercase letters, numbers, and hyphens</small>
                  </span>
                  <input
                    required
                    maxLength={200}
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    placeholder="e.g. cold-chain-integrity-oncology"
                    value={slug}
                    onChange={(event) => {
                      setSlugTouched(true);
                      setSlug(event.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'));
                    }}
                  />
                </label>

                <label className="banner-field">
                  <span>Short Summary (EN)</span>
                  <textarea
                    required
                    rows={2}
                    maxLength={500}
                    placeholder="Concise summary displayed on the Blog page card..."
                    value={enSummary}
                    onChange={(event) => setEnSummary(event.currentTarget.value)}
                  />
                </label>

                <label className="banner-field">
                  <span>Article Content (EN)</span>
                  <textarea
                    required
                    rows={6}
                    maxLength={15000}
                    placeholder="Full guidance or update body (basic <p>, <strong>, <h3>, <ul>, <li> formatting supported)..."
                    value={enBody}
                    onChange={(event) => setEnBody(event.currentTarget.value)}
                  />
                </label>

                <label className="banner-checkbox-row">
                  <input type="checkbox" checked={published} onChange={(event) => setPublished(event.currentTarget.checked)} />
                  <span>Publish immediately on public Blog page</span>
                </label>

                <details className="banner-optional-block">
                  <summary>Simplified Chinese Translation (Optional)</summary>
                  <div>
                    <label className="banner-checkbox-row">
                      <input type="checkbox" checked={zhEnabled} onChange={(event) => setZhEnabled(event.currentTarget.checked)} />
                      <span>Include Simplified Chinese (zh-CN) article copy</span>
                    </label>
                    {zhEnabled && (
                      <div className="banner-translation-fields">
                        <label className="banner-field">
                          <span>Title (ZH)</span>
                          <input
                            required
                            maxLength={200}
                            value={zhTitle}
                            onChange={(event) => setZhTitle(event.currentTarget.value)}
                          />
                        </label>
                        <label className="banner-field">
                          <span>Summary (ZH)</span>
                          <textarea
                            required
                            rows={2}
                            maxLength={500}
                            value={zhSummary}
                            onChange={(event) => setZhSummary(event.currentTarget.value)}
                          />
                        </label>
                        <label className="banner-field">
                          <span>Article Content (ZH)</span>
                          <textarea
                            required
                            rows={5}
                            maxLength={15000}
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
                    <div>
                      <span className="banner-preview-indicator" />
                      <strong>Card preview</strong>
                    </div>
                  </div>
                  <div className="banner-preview-canvas is-desktop">
                    <div className="banner-preview-viewport blog-admin-preview-card">
                      {coverPreviewUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={coverPreviewUrl} alt="Article cover preview" className="blog-admin-preview-img" />
                      )}
                      <div className="blog-admin-preview-body">
                        <span className="blog-category-badge">{blogCategoryLabels[category]}</span>
                        <h3>{enTitle.trim() || 'Article title will appear here'}</h3>
                        <p>{enSummary.trim() || 'Article summary preview for public readers.'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="banner-upload-heading">
                  <strong>Cover image</strong>
                  <span>Optional · JPG, PNG or WebP (up to 25 MiB)</span>
                </div>
                <div
                  className={`banner-dropzone${dragActive ? ' is-drag' : ''}${coverPreviewUrl ? ' has-preview' : ''}`}
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
                    aria-label="Upload blog cover image"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    id="blog-cover-file"
                    onChange={(event) => void handleFileSelect(event.currentTarget.files?.[0])}
                  />
                  {coverPreviewUrl ? (
                    <div className="banner-preview-box">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={coverPreviewUrl} alt="Blog cover preview" className="banner-preview-media" />
                      <div className="banner-preview-actions">
                        <span className="banner-media-badge">
                          <ImageIcon size={14} aria-hidden="true" />
                          Cover Image
                        </span>
                        <div>
                          <button type="button" onClick={() => fileInputRef.current?.click()} className="banner-preview-action">
                            Replace
                          </button>
                          <button
                            type="button"
                            className="banner-preview-remove"
                            onClick={() => {
                              setCoverKey(undefined);
                              setCoverPreviewUrl(undefined);
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
                      <span>{uploadingCover ? 'Uploading cover image…' : 'Drag and drop file or Browse image'}</span>
                      <small>JPG, PNG, WebP (up to 25 MiB)</small>
                    </button>
                  )}
                </div>
                {coverError && (
                  <p className="form-error" role="alert">
                    {coverError}
                  </p>
                )}
              </div>
            </div>

            <div className="banner-form-actions">
              <button type="button" className="button secondary" disabled={disabled} onClick={() => resetForm()}>
                Reset
              </button>
              <button type="submit" className="button primary" disabled={disabled}>
                {editingId ? 'Update' : 'Publish'}
              </button>
            </div>
          </fieldset>
        </form>
      </section>

      <section className="banner-table-card">
        <div className="banner-table-header">
          <div className="banner-table-title">
            <h2>Blog Articles</h2>
            <span className="banner-count-badge">{totalCount}</span>
          </div>
          <div className="banner-table-tools">
            <select
              aria-label="Filter by blog category"
              value={filterCategory}
              onChange={(event) => setFilterCategory(event.currentTarget.value as BlogCategory | '')}
            >
              <option value="">All Categories</option>
              {blogCategories.map((item) => (
                <option key={item} value={item}>
                  {blogCategoryLabels[item]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button secondary"
              disabled={disabled}
              onClick={() => void operation.refresh(() => refreshList(filterCategory, 1))}
            >
              Filter
            </button>
            <button
              type="button"
              className="button primary"
              disabled={disabled}
              onClick={() => {
                resetForm(filterCategory || 'GUIDE');
                formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <Plus size={16} aria-hidden="true" />
              New Article
            </button>
          </div>
        </div>

        <div className="admin-table-scroll">
          <table className="banner-table" aria-label="Blog articles">
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
                <th scope="col">Article</th>
                <th scope="col">Category &amp; Slug</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((row, index) => (
                <tr key={row.id}>
                  <td className="banner-table-index">{(pagination.page - 1) * pagination.limit + index + 1}</td>
                  <td className="banner-table-creative">
                    <div className="banner-table-creative-content">
                      <button
                        type="button"
                        className="banner-table-media-cell"
                        disabled={disabled}
                        aria-label={`Edit ${row.translations.en.title}`}
                        onClick={() => loadPostIntoForm(row)}
                      >
                        {row.cover_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={row.cover_image_url} alt="" width={160} height={80} loading="lazy" className="banner-table-thumb" />
                        ) : (
                          <span className="banner-table-text-thumb">
                            <Newspaper size={24} aria-hidden="true" />
                            <span>Article</span>
                          </span>
                        )}
                      </button>
                      <div className="banner-table-caption">
                        <strong>{row.translations.en.title}</strong>
                        <span>{row.translations.en.summary}</span>
                      </div>
                    </div>
                  </td>
                  <td className="banner-table-placement" data-label="Category & Slug">
                    <div className="banner-table-type-cell">
                      <strong>{blogCategoryLabels[row.category]}</strong>
                      <small className="banner-table-destination" title={row.slug}>/{row.slug}</small>
                      <small>{row.published_at.slice(0, 10)}</small>
                    </div>
                  </td>
                  <td className="banner-table-publication" data-label="Status">
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
                        <span>{row.is_active ? 'Published' : 'Draft'}</span>
                      </div>
                    </div>
                  </td>
                  <td className="banner-table-action-cell" data-label="Actions">
                    <div className="banner-table-actions">
                      {confirmDeleteId !== row.id && (
                        <button
                          type="button"
                          className="banner-icon-btn is-edit"
                          aria-label={`Edit ${row.translations.en.title}`}
                          disabled={disabled}
                          onClick={() => loadPostIntoForm(row)}
                        >
                          <Pencil size={17} aria-hidden="true" />
                          <span>Edit</span>
                        </button>
                      )}
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
                          <button type="button" className="banner-confirm-no" onClick={() => setConfirmDeleteId(null)}>
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
              ))}
              {!posts.length && (
                <tr>
                  <td colSpan={5} className="banner-table-empty">
                    No blog articles yet. Use the form above to publish your first article.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="banner-list-pagination">
          <span>
            {pagination.total_items
              ? `Showing ${(pagination.page - 1) * pagination.limit + 1}–${(pagination.page - 1) * pagination.limit + posts.length} of ${pagination.total_items} articles`
              : 'No articles to show'}
          </span>
          <div>
            <button
              type="button"
              className="button secondary"
              disabled={disabled || !pagination.has_prev}
              onClick={() => void operation.refresh(() => refreshList(appliedCategory, pagination.page - 1))}
            >
              Previous
            </button>
            <span>
              Page {pagination.page} of {Math.max(1, pagination.total_pages)}
            </span>
            <button
              type="button"
              className="button secondary"
              disabled={disabled || !pagination.has_next}
              onClick={() => void operation.refresh(() => refreshList(appliedCategory, pagination.page + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
