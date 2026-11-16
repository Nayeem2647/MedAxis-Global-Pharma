'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { quotationPdf, quotationProblem, type QuotationProblem } from '../../lib/quotation';

export function QuotationPdf({ token, version, onProblem }: { token: string; version: number; onProblem(problem: QuotationProblem): void }) {
  const t = useTranslations('Quotation');
  const [wechat, setWechat] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const blobUrl = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  function revoke() { if (timer.current) clearTimeout(timer.current); if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); blobUrl.current = null; }
  useEffect(() => {
    mounted.current = true; setWechat(/MicroMessenger/i.test(navigator.userAgent));
    return () => { mounted.current = false; controller.current?.abort(); revoke(); };
  }, []);
  async function download() {
    if (lock.current || wechat !== false) return;
    lock.current = true; setBusy(true); controller.current = new AbortController();
    try {
      const blob = await quotationPdf(token, controller.current.signal);
      if (!mounted.current) return;
      revoke(); const url = URL.createObjectURL(blob); blobUrl.current = url;
      const link = document.createElement('a'); link.href = url; link.download = `quotation-v${version}.pdf`; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
      document.body.appendChild(link); link.click(); link.remove();
      timer.current = setTimeout(revoke, 1000);
    } catch (error: unknown) { if (mounted.current && !controller.current.signal.aborted) onProblem(quotationProblem(error)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  if (wechat) return <aside className="quotation-wechat" role="status"><p lang="en">To download your quotation PDF, tap ··· → Open in Browser.</p><p lang="zh-CN">如需下载报价 PDF，请点击右上角 ··· → 在浏览器中打开。</p></aside>;
  return <button type="button" className="button secondary" disabled={busy || wechat === null} onClick={() => void download()}><Download size={18}/>{t(busy ? 'preparingPdf' : 'downloadPdf')}</button>;
}
