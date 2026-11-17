'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Activity, ChevronDown, LayoutDashboard, LogOut, Plus, ShieldCheck, Store } from 'lucide-react';
import { z } from 'zod';
import { useAdminStream } from '../../hooks/useAdminStream';
import { notifyAdminSessionChange } from '../../lib/admin-auth-events';
import { ApiError, apiRequest } from '../../lib/api-client';
import { ADMIN_IDLE_MS, logoutResult, sessionsSchema, type AdminSession } from '../../lib/admin-contract';
import { AdminFeedback, feedbackValue, type AdminFeedbackValue } from './AdminFeedback';
import { AdminTopbar } from './AdminTopbar';

const LiveContext = createContext<{ revision: number; active: boolean; expire(): void } | null>(null);
export function AdminLink({ href, children, className, current }: { href: string; children: ReactNode; className?: string; current?: boolean }) {
  // Full document navigation revalidates auth and discards the private Router Cache.
  return <Link href={href} prefetch={false} className={className} aria-current={current ? 'page' : undefined} onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); window.location.assign(href); } }}>{children}</Link>;
}
export function useAdminLive() { const value = useContext(LiveContext); if (!value) throw new Error('Admin live context is required.'); return value; }
function ProductNavigation({ pathname, active }: { pathname: string; active: boolean }) {
  const [expanded, setExpanded] = useState(true);
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
  return <div className="admin-product-menu">
    <button type="button" className="admin-product-toggle" aria-expanded={expanded} aria-controls="admin-product-links" onClick={() => setExpanded((value) => !value)}>
      <Store size={20} aria-hidden="true"/><span>Manage Product</span><ChevronDown size={18} className="admin-product-chevron" aria-hidden="true"/>
    </button>
    <ul id="admin-product-links" className="admin-product-links" hidden={!expanded}>
      <li><AdminLink href="/admin/catalog/products" current={pathname === '/admin/catalog/products' || (pathname.startsWith('/admin/catalog/products/') && pathname !== '/admin/catalog/products/new')}><span>Product List</span>{active && count !== undefined && <span className="admin-product-count" aria-label={`${count} products`}>{count}</span>}</AdminLink></li>
      <li><AdminLink href="/admin/catalog/products/new" current={pathname === '/admin/catalog/products/new'}>Add New Product</AdminLink></li>
      <li><AdminLink href="/admin/catalog/import" current={pathname === '/admin/catalog/import'}>Bulk import</AdminLink></li>
    </ul>
  </div>;
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
  return <LiveContext.Provider value={{ revision, active, expire }}><div className="admin-console"><AdminTopbar session={session} active={active} revision={revision} streamState={state} onLogout={() => void logout()}/><aside className="admin-sidebar"><div className="admin-brand"><span className="brand-mark"><Plus size={25}/></span><span>MedAxis<small>ADMIN CONSOLE</small></span></div><nav aria-label="Admin navigation">
    <AdminLink href="/admin" current={pathname === '/admin'}><LayoutDashboard size={18}/>Dashboard</AdminLink><AdminLink href="/admin/rfqs" current={pathname === '/admin/rfqs'}><Activity size={18}/>RFQ inbox</AdminLink><AdminLink href="/admin/quotations" current={pathname.startsWith('/admin/quotations')}>Quotations</AdminLink>
    <ProductNavigation pathname={pathname} active={active}/>
    {[['/admin/catalog/manufacturers','Manufacturers'],['/admin/catalog/generics','Generics'],['/admin/catalog/categories','Categories'],['/admin/catalog/banners','Announcements'],['/admin/customers','Customers'],['/admin/settings','Settings'],['/admin/audit-logs','Audit logs']].map(([href,label])=><AdminLink key={href} href={href} current={pathname===href}>{label}</AdminLink>)}<AdminLink href="/admin/sessions" current={pathname === '/admin/sessions'}><ShieldCheck size={18}/>Sessions</AdminLink></nav>
    <div className="admin-sidebar-footer"><label className="admin-sound"><input type="checkbox" checked={sound} disabled={!active} onChange={(event) => void changeSound(event.currentTarget.checked)}/>Sound alerts</label><p className="small">30-minute inactivity limit</p><button type="button" onClick={() => void logout()}><LogOut size={17}/>Sign out</button></div></aside>
    <div className="admin-workspace">
      {remaining <= 120_000 && active && <p className="admin-idle-warning" role="status">You will be signed out after {Math.ceil(remaining / 60_000)} minute(s) without activity.</p>}
      {notice && active && <p className="admin-live-notice" role="status">{notice}</p>}
      <main className="admin-content">{active ? children : <section className="admin-panel"><h1>Console locked</h1><p>Finishing sign-out. Your private workspace is hidden.</p>{problem && <><AdminFeedback problem={problem}/><button className="button primary" onClick={() => void logout()}>Retry sign-out</button></>}</section>}</main>
    </div></div></LiveContext.Provider>;
}
