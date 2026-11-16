import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import '../globals.css';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const metadata: Metadata = { title: 'MedAxis administration', referrer: 'no-referrer', robots: { index: false, follow: false, noarchive: true, nocache: true } };
export default function AdminLayout({ children }: { children: ReactNode }) { return <html lang="en"><body className="admin-body">{children}</body></html>; }
