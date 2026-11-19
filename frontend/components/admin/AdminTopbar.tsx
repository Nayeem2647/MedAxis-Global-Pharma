'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { ArrowUpRight, ChevronDown, Globe, MessageSquareText, Search, ShoppingCart } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api-client';
import { adminProfileSchema, adminRfqsSchema, type AdminProfile, type AdminSession } from '../../lib/admin-contract';
import { summarySchema } from '../../lib/admin-management';
import type { StreamState } from '../../lib/admin-stream';
import { AdminLink } from './AdminShell';

const menuItems = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/rfqs', label: 'RFQ inbox' },
  { href: '/admin/quotations', label: 'Quotations' },
  { href: '/admin/quotations/overview', label: 'Quotation overview' },
  { href: '/admin/quotations/new', label: 'Create quotation from RFQ' },
  { href: '/admin/quotations/follow-ups', label: 'Quotation follow-ups' },
  { href: '/admin/catalog/products', label: 'Product List' },
  { href: '/admin/catalog/products/new', label: 'Add New Product' },
  { href: '/admin/catalog/import', label: 'Bulk import' },
  { href: '/admin/catalog/manufacturers', label: 'Manufacturers' },
  { href: '/admin/catalog/manufacturers/new', label: 'Add new manufacturer' },
  { href: '/admin/catalog/generics', label: 'Generics' },
  { href: '/admin/catalog/categories', label: 'Categories' },
  { href: '/admin/catalog/banners', label: 'Announcements' },
  { href: '/admin/customers', label: 'Customers' },
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/settings/security', label: 'Security settings' },
  { href: '/admin/audit-logs', label: 'Audit logs' },
  { href: '/admin/sessions', label: 'Sessions' },
];

export function AdminTopbar({ session, active, revision, streamState, onLogout }: {
  session: AdminSession;
  active: boolean;
  revision: number;
  streamState: StreamState;
  onLogout(): void;
}) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [counts, setCounts] = useState<{ rfqs?: number; quotations?: number }>({});
  const [account, setAccount] = useState<AdminProfile | null>(null);
  const search = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const profile = useRef<HTMLDetailsElement>(null);
  const results = menuItems.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!search.current?.contains(event.target)) setSearchOpen(false);
      if (profile.current && !profile.current.contains(event.target)) profile.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void Promise.allSettled([
      apiRequest('/v1/admin/rfqs?status=SUBMITTED&limit=1', adminRfqsSchema, { signal: controller.signal, timeoutMs: 8000 }),
      apiRequest('/v1/admin/quotations/summary?window_hours=24', summarySchema, { signal: controller.signal, timeoutMs: 8000 }),
    ]).then(([rfqs, quotations]) => {
      if (controller.signal.aborted) return;
      setCounts({
        rfqs: rfqs.status === 'fulfilled' ? rfqs.value.meta.pagination?.total_items : undefined,
        quotations: quotations.status === 'fulfilled' ? quotations.value.data.active_quotations : undefined,
      });
      for (const result of [rfqs, quotations]) {
        if (result.status === 'rejected' && result.reason instanceof ApiError && [401, 403].includes(result.reason.status)) window.location.replace('/admin/login');
      }
    });
    return () => controller.abort();
  }, [active, revision]);

  useEffect(() => {
    if (!active) return;
    const load = () => { void apiRequest('/v1/admin/auth/profile', adminProfileSchema).then((result) => setAccount(result.data)).catch(() => {}); };
    load(); window.addEventListener('admin-profile-updated', load);
    return () => window.removeEventListener('admin-profile-updated', load);
  }, [active]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active && results[0]) window.location.assign(results[0].href);
  }

  return <header className="admin-topbar" aria-label="Admin toolbar">
    <div className="admin-topbar-search-area">
      <form className="admin-menu-search" ref={search} role="search" aria-label="Admin menu" onSubmit={submitSearch} onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false);
      }} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); input.current?.focus(); setSearchOpen(false); }
        if (event.key === 'ArrowDown' && event.target === input.current) { event.preventDefault(); setSearchOpen(true); requestAnimationFrame(() => search.current?.querySelector<HTMLAnchorElement>('nav a')?.focus()); }
      }}>
        <Search size={19} aria-hidden="true" />
        <input ref={input} type="search" aria-label="Search admin menu" placeholder="Search menu…" autoComplete="off" maxLength={100} value={query} disabled={!active} aria-controls="admin-menu-search-results" onFocus={() => setSearchOpen(true)} onChange={(event) => { setQuery(event.currentTarget.value); setSearchOpen(true); }} />
        {searchOpen && active && <nav id="admin-menu-search-results" className="admin-menu-results" aria-label="Menu search results">
          <p>{query.trim() ? `${results.length} matching menu items` : 'Go to a page'}</p>
          {results.length ? results.map((item) => <AdminLink key={item.href} href={item.href}><span>{item.label}</span><ArrowUpRight size={14} aria-hidden="true" /></AdminLink>) : <span className="admin-menu-no-results">No matching menu items.</span>}
        </nav>}
      </form>
    </div>

    <div className="admin-topbar-actions">
      <span className="admin-stream-status admin-topbar-live" data-state={active ? streamState : 'paused'} role="status"><span aria-hidden="true" />Live: {active ? streamState : 'paused'}</span>
      <a className="admin-view-website" href="/en" target="_blank" rel="noreferrer"><Globe size={17} aria-hidden="true" /><span>View Website</span><ArrowUpRight size={14} className="admin-website-arrow" aria-hidden="true" /><span className="sr-only"> (opens in new tab)</span></a>
      <AdminLink className="admin-topbar-shortcut" href="/admin/rfqs?status=SUBMITTED"><MessageSquareText size={23} aria-hidden="true" /><span className="sr-only">Submitted RFQ inbox</span>{active && counts.rfqs !== undefined && <span className="admin-topbar-badge" aria-label={`${counts.rfqs} submitted RFQs`}>{counts.rfqs > 99 ? '99+' : counts.rfqs}</span>}</AdminLink>
      <AdminLink className="admin-topbar-shortcut" href="/admin/quotations?overall_status=ACTIVE"><ShoppingCart size={25} aria-hidden="true" /><span className="sr-only">Active quotations</span>{active && counts.quotations !== undefined && <span className="admin-topbar-badge" aria-label={`${counts.quotations} active quotations`}>{counts.quotations > 99 ? '99+' : counts.quotations}</span>}</AdminLink>

      <details ref={profile} className="admin-account" onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }} onKeyDown={(event) => { if (event.key === 'Escape' && profile.current) { profile.current.open = false; profile.current.querySelector('summary')?.focus(); } }}>
        <summary aria-label="Admin account menu"><ChevronDown size={15} className="admin-account-chevron" aria-hidden="true" /><span className="admin-account-name"><strong>{account?.display_name || 'Admin'}</strong><small>Administrator</small></span><span className="admin-account-avatar"><Image src={account?.avatar_url || '/images/medaxis-logo.png'} alt="Admin profile" width={48} height={48} loading="eager" unoptimized /></span></summary>
        <div className="admin-account-menu">
          <div className="admin-account-identity">
            <span className="admin-account-avatar"><Image src={account?.avatar_url || '/images/medaxis-logo.png'} alt="" width={48} height={48} unoptimized /></span>
            <div><strong>{account?.display_name || 'Admin'}</strong><span>{account?.email || 'MedAxis administrator'}</span><span className="sr-only">Current session: {session.ip_address}</span></div>
          </div>
          <AdminLink href="/admin/settings/profile">Settings</AdminLink>
          <button type="button" className="admin-account-logout" disabled={!active} onClick={onLogout}>Logout</button>
        </div>
      </details>
    </div>
  </header>;
}
