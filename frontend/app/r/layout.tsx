import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../globals.css';
import '../quotation-workflow.css';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const metadata: Metadata = { title: 'Private request & quotation | MedAxis', referrer: 'no-referrer', robots: { index: false, follow: false, noarchive: true, nocache: true } };
export default function RequestLayout({ children }: { children: ReactNode }) { return <html lang="en"><body className="wf-guest-body">{children}</body></html>; }
