'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Activity,
  ChevronDown,
  ClipboardList,
  FileText,
  Image as ImageIcon,
  Layers,
  LayoutDashboard,
  Newspaper,
  Pill,
  Settings,
  ShieldCheck,
  Star,
  Store,
  Users,
} from 'lucide-react';
import { z } from 'zod';
import { useAdminStream } from '../../hooks/useAdminStream';
import { notifyAdminSessionChange } from '../../lib/admin-auth-events';
import { ApiError, apiRequest } from '../../lib/api-client';
import { ADMIN_IDLE_MS, logoutResult, sessionsSchema, type AdminSession } from '../../lib/admin-contract';
import { AdminFeedback, feedbackValue, type AdminFeedbackValue } from './AdminFeedback';
import { AdminTopbar } from './AdminTopbar';
import { masterLabels, type MasterDirectoryKind } from '../../lib/admin-management';

const LiveContext = createContext<{ revision: number; active: boolean; expire(): void } | null>(null);
export function AdminLink({ href, children, className, current, title }: { href: string; children: ReactNode; className?: string; current?: boolean; title?: string }) {
  // Full document navigation revalidates auth and discards the private Router Cache.
  return <Link href={href} prefetch={false} className={className} title={title} aria-current={current ? 'page' : undefined} onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); window.location.assign(href); } }}>{children}</Link>;
}
export function useAdminLive() { const value = useContext(LiveContext); if (!value) throw new Error('Admin live context is required.'); return value; }
function ProductNavigation({ pathname, active }: { pathname: string; active: boolean }) {
  const inProducts = pathname.startsWith('/admin/catalog/products') || pathname === '/admin/catalog/import';
  const [expanded, setExpanded] = useState(inProducts);
  const [count, setCount] = useState<number>();
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void apiRequest('/v1/admin/catalog/products?limit=1', z.array(z.unknown()).max(1), {
      signal: controller.signal, timeoutMs: 8000,
    }).then((result) => {
      if (!controller.signal.aborted) setCount(result.meta.pagination?.total_items);
    }).catch(() => {
      if (!controller.signal.aborted) setCount(undefined);
    });
    return () => controller.abort();
  }, [active, pathname]);
  return <div className="admin-catalog-menu">
    <button type="button" className="admin-catalog-toggle" aria-expanded={expanded} aria-controls="admin-product-links" onClick={() => setExpanded((value) => !value)}>
      <Store size={18} aria-hidden="true"/><span>Manage Product</span><ChevronDown size={16} className="admin-catalog-chevron" aria-hidden="true"/>
    </button>
    <ul id="admin-product-links" className="admin-catalog-links" hidden={!expanded}>
      <li><AdminLink href="/admin/catalog/products" current={pathname === '/admin/catalog/products' || (pathname.startsWith('/admin/catalog/products/') && pathname !== '/admin/catalog/products/new')}><span>Product List</span>{active && count !== undefined && <span className="admin-product-count" aria-label={`${count} products`}>{count}</span>}</AdminLink></li>
      <li><AdminLink href="/admin/catalog/products/new" current={pathname === '/admin/catalog/products/new'}>Add New Product</AdminLink></li>
      <li><AdminLink href="/admin/catalog/import" current={pathname === '/admin/catalog/import'}>Bulk import</AdminLink></li>
    </ul>
  </div>;
}
function MasterNavigation({ pathname, kind }: { pathname: string; kind: MasterDirectoryKind }) {
  const manufacturer = kind === 'manufacturers';
  const listPath = `/admin/catalog/${kind}`;
  const createPath = listPath + '/new';
  const inDirectory = pathname === listPath || pathname.startsWith(listPath + '/');
  const [expanded, setExpanded] = useState(inDirectory);
  const linksId = `admin-${masterLabels[kind].toLowerCase()}-links`;

  return <div className={`admin-catalog-menu admin-directory-menu admin-${masterLabels[kind].toLowerCase()}-menu`}>
    <button type="button" className="admin-catalog-toggle" aria-expanded={expanded} aria-controls={linksId} onClick={() => setExpanded((value) => !value)}>
      {manufacturer ? <Star size={18} fill="currentColor" aria-hidden="true" /> : kind === 'categories' ? <Layers size={18} aria-hidden="true" /> : <Pill size={18} aria-hidden="true" />}
      <span>{kind === 'categories' ? 'Categories' : `${masterLabels[kind]}s`}</span>
      <ChevronDown size={16} className="admin-catalog-chevron" aria-hidden="true" />
    </button>
    <ul id={linksId} className="admin-catalog-links" hidden={!expanded}>
      <li><AdminLink href={createPath} current={pathname === createPath}>Add new</AdminLink></li>
      <li><AdminLink href={listPath} current={inDirectory && pathname !== createPath}>List</AdminLink></li>
    </ul>
  </div>;
}

function QuotationNavigation({ pathname }: { pathname: string }) {
  const inQuotations = pathname.startsWith('/admin/quotations');
  const inDirectory = inQuotations || pathname.startsWith('/admin/rfqs');
  const [expanded, setExpanded] = useState(inDirectory);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const links = [['/admin/rfqs', 'Website requests'], ['/admin/quotations/overview', 'Overview'], ['/admin/quotations', 'All quotations'], ['/admin/quotations/new', 'Create from RFQ'], ['/admin/quotations/follow-ups', 'Follow-ups']];
  return <div className="admin-catalog-menu admin-directory-menu"><button type="button" className="admin-catalog-toggle" aria-expanded={expanded} aria-controls="admin-quotation-links" disabled={!ready} onClick={() => setExpanded((value) => !value)}><FileText size={18} aria-hidden="true" /><span>Quotations</span><ChevronDown size={16} className="admin-catalog-chevron" aria-hidden="true" /></button><ul id="admin-quotation-links" className="admin-catalog-links" hidden={!expanded}>{links.map(([href, label]) => <li key={href}><AdminLink href={href} current={pathname === href || href === '/admin/rfqs' && pathname.startsWith('/admin/rfqs/') || href === '/admin/quotations' && inQuotations && !links.some(([route]) => route === pathname)}>{label}</AdminLink></li>)}</ul></div>;
}

export function AdminShell({ session, children }: { session: AdminSession; children: ReactNode }) {
  const pathname = usePathname(); const [active, setActive] = useState(true); const [revision, setRevision] = useState(0);
  const [remaining, setRemaining] = useState(ADMIN_IDLE_MS); const [problem, setProblem] = useState<AdminFeedbackValue>(); const [notice, setNotice] = useState('');
  const [sound, setSound] = useState(false); const audio = useRef<AudioContext | null>(null); const soundOn = useRef(false);
  const lastActivity = useRef(Date.now()); const activeRef = useRef(true); const idleAttempted = useRef(false); const loggingOut = useRef(false);
  const expire = () => { activeRef.current = false; setActive(false); window.location.replace('/admin/login'); };
  async function logout() {
    if (loggingOut.current) return; loggingOut.current = true; activeRef.current = false; setActive(false); setProblem(undefined);
    try { await apiRequest('/v1/admin/auth/logout', logoutResult, { method: 'POST', json: {}, timeoutMs: 12_000 }); notifyAdminSessionChange(); window.location.replace('/admin/login'); }
    catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) { window.location.replace('/admin/login'); return; }
      try { await apiRequest('/v1/admin/auth/sessions', sessionsSchema, { timeoutMs: 8000 }); setProblem(feedbackValue(error)); }
      catch (check: unknown) { if (check instanceof ApiError && check.status === 401) window.location.replace('/admin/login'); else setProblem(feedbackValue(error)); }
    } finally { loggingOut.current = false; }
  }
  async function changeSound(value: boolean) {
    setSound(value); soundOn.current = value;
    if (value) {
      try { audio.current ??= new AudioContext(); await audio.current.resume(); }
      catch { soundOn.current = false; setSound(false); }
    }
  }
  const state = useAdminStream({ enabled: active, onUnauthorized: expire, onReconnect: () => setRevision((value) => value + 1), onEvent: (event) => {
    if (!activeRef.current) return;
    setNotice(event.type === 'NEW_RFQ' ? `New enquiry: ${event.data.rfq_number}` : event.type === 'QUOTATION_ACCEPTED' ? 'A quotation was accepted.' : 'A clarification reply was received.'); setRevision((value) => value + 1);
    if (soundOn.current && audio.current?.state === 'running') { const oscillator = audio.current.createOscillator(); const gain = audio.current.createGain(); oscillator.connect(gain); gain.connect(audio.current.destination); gain.gain.value = .035; oscillator.frequency.value = 660; oscillator.start(); oscillator.stop(audio.current.currentTime + .12); }
  } });
  useEffect(() => {
    const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('medaxis-admin-session');
    const check=()=>{void apiRequest('/v1/admin/auth/sessions',sessionsSchema,{timeoutMs:8000}).catch((error:unknown)=>{if(error instanceof ApiError&&[401,403].includes(error.status))expire();});};
    if(channel)channel.onmessage=(event:MessageEvent<unknown>)=>{if(event.data==='recheck')check();};
    return()=>channel?.close();
  },[]);
  useEffect(() => {
    const activity = () => { if (activeRef.current) lastActivity.current = Date.now(); };
    const tick = () => { const value = Math.max(0, ADMIN_IDLE_MS - (Date.now() - lastActivity.current)); setRemaining(value); if (!value && !idleAttempted.current) { idleAttempted.current = true; void logout(); } };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(type, activity, { passive: true });
    window.addEventListener('pageshow', restore); document.addEventListener('visibilitychange', tick);
    const timer = setInterval(tick, 1000);
    return () => { clearInterval(timer); for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.removeEventListener(type, activity); window.removeEventListener('pageshow', restore); document.removeEventListener('visibilitychange', tick); void audio.current?.close(); };
    // Human activity controls the client idle deadline; stream messages never reset it.
  }, []);
  return <LiveContext.Provider value={{ revision, active, expire }}><div className="admin-console"><AdminTopbar session={session} active={active} revision={revision} streamState={state} sound={sound} onSoundChange={(value) => void changeSound(value)} onLogout={() => void logout()}/>
    <aside className="admin-sidebar">
      <nav aria-label="Admin navigation">
        <p className="admin-nav-group-label">Overview</p>
        <AdminLink href="/admin" current={pathname === '/admin'}><LayoutDashboard size={18} aria-hidden="true"/><span>Dashboard</span></AdminLink>
        <AdminLink href="/admin/rfqs" current={pathname.startsWith('/admin/rfqs')}><Activity size={18} aria-hidden="true"/><span>RFQ inbox</span></AdminLink>
        <QuotationNavigation pathname={pathname}/>

        <p className="admin-nav-group-label">Catalog &amp; Content</p>
        <ProductNavigation pathname={pathname} active={active}/>
        <MasterNavigation pathname={pathname} kind="manufacturers"/>
        <MasterNavigation pathname={pathname} kind="generics"/>
        <MasterNavigation pathname={pathname} kind="categories"/>
        <AdminLink href="/admin/catalog/banners" current={pathname.startsWith('/admin/catalog/banners')}><ImageIcon size={18} aria-hidden="true"/><span>Banner Setup</span></AdminLink>
        <AdminLink href="/admin/blog" current={pathname.startsWith('/admin/blog')} className="admin-blog-link"><Newspaper size={18} aria-hidden="true"/><span>Blog</span></AdminLink>

        <p className="admin-nav-group-label">Operations &amp; System</p>
        <AdminLink href="/admin/customers" current={pathname.startsWith('/admin/customers')}><Users size={18} aria-hidden="true"/><span>Customers</span></AdminLink>
        <AdminLink href="/admin/settings" current={pathname.startsWith('/admin/settings')}><Settings size={18} aria-hidden="true"/><span>Settings</span></AdminLink>
        <AdminLink href="/admin/audit-logs" current={pathname.startsWith('/admin/audit-logs')}><ClipboardList size={18} aria-hidden="true"/><span>Audit logs</span></AdminLink>
        <AdminLink href="/admin/sessions" current={pathname === '/admin/sessions'}><ShieldCheck size={18} aria-hidden="true"/><span>Sessions</span></AdminLink>
      </nav>
    </aside>
    <div className="admin-workspace">
      {remaining <= 120_000 && active && <p className="admin-idle-warning" role="status">You will be signed out after {Math.ceil(remaining / 60_000)} minute(s) without activity.</p>}
      {notice && active && <p className="admin-live-notice" role="status">{notice}</p>}
      <main className="admin-content">{active ? children : <section className="admin-panel"><h1>Console locked</h1><p>Finishing sign-out. Your private workspace is hidden.</p>{problem && <><AdminFeedback problem={problem}/><button className="button primary" onClick={() => void logout()}>Retry sign-out</button></>}</section>}</main>
    </div></div></LiveContext.Provider>;
}
