'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ApiError } from '../../lib/api-client';
import { uploadPrescription, validatePrescription, type PrescriptionReceipt } from '../../lib/prescription-upload';

type UploadIssue = 'fiveFiles' | 'challengeNeeded' | 'uploadCancelled' | 'fileSize' | 'fileType' | 'rateLimited' | 'uploadUncertain';
interface Entry { id: string; file: File; url: string; percent: number; status: 'uploading' | 'uploaded' | 'error' | 'cancelled'; receipt?: PrescriptionReceipt; error?: UploadIssue; requestId?: string }
export function PrescriptionUpload({ token, disabled, onConsumed, onChange, onBusy }: {
  token: string; disabled: boolean; onConsumed(): void; onChange(ids: string[]): void; onBusy(busy: boolean): void;
}) {
  const t = useTranslations('Rfq');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [issue, setIssue] = useState<UploadIssue>();
  const current = useRef<Entry[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const busy = useRef(false);
  function commit(change: (items: Entry[]) => Entry[]) {
    if (!mounted.current) return;
    current.current = change(current.current); setEntries(current.current);
    onChange(current.current.flatMap((entry) => entry.receipt ? [entry.receipt.prescription_id] : []));
  }
  useEffect(() => {
    mounted.current = true;
    const uploads = controllers.current;
    return () => { mounted.current = false; uploads.forEach((controller) => controller.abort()); current.current.forEach((entry) => URL.revokeObjectURL(entry.url)); };
  }, []);
  async function select(file?: File) {
    if (!file || disabled || busy.current) return;
    if (current.current.length >= 5) { setIssue('fiveFiles'); return; }
    if (!token) { setIssue('challengeNeeded'); return; }
    busy.current = true; onBusy(true); setIssue(undefined);
    let id: string | undefined;
    try {
      await validatePrescription(file);
      if (!mounted.current) return;
      id = crypto.randomUUID();
      const entry: Entry = { id, file, url: URL.createObjectURL(file), percent: 0, status: 'uploading' };
      const controller = new AbortController(); controllers.current.set(id, controller);
      commit((items) => [...items, entry]);
      // Each upload consumes a challenge. RFQ submission must acquire another one.
      onConsumed();
      const receipt = await uploadPrescription(file, token, controller.signal, (percent) => commit((items) => items.map((item) => item.id === id ? { ...item, percent } : item)));
      commit((items) => items.map((item) => item.id === id ? { ...item, status: 'uploaded', percent: 100, receipt } : item));
    } catch (error: unknown) {
      const message: UploadIssue = error instanceof DOMException && error.name === 'AbortError' ? 'uploadCancelled'
        : error instanceof ApiError && error.code === 'FILE_SIZE' ? 'fileSize'
        : error instanceof ApiError && ['INVALID_PRESCRIPTION_FILE', 'UNSUPPORTED_FILE_TYPE'].includes(error.code) ? 'fileType'
        : error instanceof ApiError && error.status === 403 ? 'challengeNeeded'
        : error instanceof ApiError && error.status === 429 ? 'rateLimited' : 'uploadUncertain';
      if (id) commit((items) => items.map((item) => item.id === id ? { ...item, status: message === 'uploadCancelled' ? 'cancelled' : 'error', error: message,
        requestId: error instanceof ApiError && /^[\w-]{1,100}$/.test(error.requestId ?? '') ? error.requestId : undefined } : item));
      else if (mounted.current) setIssue(message);
    } finally { if (id) controllers.current.delete(id); busy.current = false; if (mounted.current) onBusy(false); }
  }
  return <div className="prescription-upload">
    <p className="small muted">{t('fileHelp')}</p>
    <label className="file-picker">{t('chooseFile')}<input type="file" accept="image/jpeg,image/png,application/pdf" disabled={disabled || busy.current || entries.length >= 5 || !token} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void select(file); }}/></label>
    {!token && <p className="small muted">{t('challengeNeeded')}</p>}
    {issue && <p role="alert" className="form-error">{t(issue)}</p>}
    <ul className="upload-list">{entries.map((entry) => <li key={entry.id}>
      {entry.file.type.startsWith('image/') && <Image src={entry.url} width={64} height={64} unoptimized alt={t('privatePreview')}/>}
      <div><a href={entry.url} target="_blank" rel="noopener noreferrer" download={entry.file.name}>{entry.file.name}</a>
        {entry.status === 'uploading' ? <><progress value={entry.percent} max={100} aria-label={t('uploadProgress')}/><p className="small" role="status">{t('uploadProgress')} {entry.percent}%</p></> : <p className={entry.error ? 'small form-error' : 'small'} role="status">{t(entry.error ?? 'uploaded')}</p>}
        {entry.requestId && <p className="small">{t('requestId')}: {entry.requestId}</p>}
      </div>
      <button type="button" className="text-button" disabled={disabled} onClick={() => {
        controllers.current.get(entry.id)?.abort(); URL.revokeObjectURL(entry.url); commit((items) => items.filter((item) => item.id !== entry.id));
      }}>{t(entry.status === 'uploading' ? 'cancelUpload' : 'removeFile')}</button>
    </li>)}</ul>
    <p className="small muted">{t('retention')}</p>
  </div>;
}
