'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

interface TrackerOptions { endpoint: string; transformRequest(payload: unknown): unknown }
interface PlausibleTracker {
  (...args: unknown[]): void;
  q?: unknown[][]; o?: TrackerOptions; init?: (options: TrackerOptions) => void;
}
declare global { interface Window { plausible?: PlausibleTracker } }
let initialized = false;

function Tracker({ domain, src, endpoint }: { domain: string; src: string; endpoint: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!initialized) {
      const tracker: PlausibleTracker = window.plausible ?? ((...args: unknown[]) => { (tracker.q ??= []).push(args); });
      tracker.init ??= (options) => { tracker.o = options; };
      window.plausible = tracker;
      tracker.init({ endpoint, transformRequest(payload: unknown) {
        if (!payload || typeof payload !== 'object' || !('n' in payload) || payload.n !== 'pageview' || !('u' in payload) || typeof payload.u !== 'string') return null;
        try {
          const url = new URL(payload.u);
          if (url.origin !== window.location.origin || !/^\/(en|zh-CN)(?:\/|$)/.test(url.pathname) || /^\/(en|zh-CN)\/(q|admin|api|account|login|register)(?:\/|$)/.test(decodeURIComponent(url.pathname))) return null;
          url.search = ''; url.hash = '';
          // Explicitly project pageviews. Custom event properties, referrers and
          // unknown metadata may contain contact, prescription or session data.
          return { n: 'pageview', u: url.href, d: domain };
        } catch { return null; }
      } });
      initialized = true;
    }
    setReady(true);
  }, [domain, endpoint]);
  return ready ? <Script id="medaxis-plausible" src={src} data-domain={domain} data-api={endpoint} data-exclude="/q/**,/admin/**,/api/**" strategy="afterInteractive"/> : null;
}

export function PublicAnalytics(props: { domain: string; src: string; endpoint: string }) {
  const pathname = usePathname();
  if (!/^\/(en|zh-CN)(?:\/|$)/.test(pathname) || /^\/(en|zh-CN)\/(q|admin|api|account|login|register)(?:\/|$)/.test(pathname)) return null;
  return <Tracker {...props}/>;
}
