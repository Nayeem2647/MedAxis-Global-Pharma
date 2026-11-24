'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { UploadCloud, X } from 'lucide-react';
import { ApiError } from '../../lib/api-client';
import { uploadPrescription, validatePrescription, type PrescriptionReceipt } from '../../lib/prescription-upload';

type UploadIssue = 'fiveFiles' | 'challengeNeeded' | 'uploadCancelled' | 'fileSize' | 'fileType' | 'rateLimited' | 'uploadUncertain';
interface Entry {
  id: string;
  file: File;
  url: string;
  percent: number;
  status: 'uploading' | 'uploaded' | 'error' | 'cancelled';
  receipt?: PrescriptionReceipt;
  error?: UploadIssue;
  requestId?: string;
}

export function PrescriptionUpload({
  token,
  disabled,
  onConsumed,
  onChange,
  onBusy,
}: {
  token: string;
  disabled: boolean;
  onConsumed(): void;
  onChange(ids: string[]): void;
  onBusy(busy: boolean): void;
}) {
  const t = useTranslations('Rfq');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [issue, setIssue] = useState<UploadIssue>();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = useRef<Entry[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  const busy = useRef(false);

  function commit(change: (items: Entry[]) => Entry[]) {
    if (!mounted.current) return;
    current.current = change(current.current);
    setEntries(current.current);
    onChange(current.current.flatMap((entry) => (entry.receipt ? [entry.receipt.prescription_id] : [])));
  }

  useEffect(() => {
    mounted.current = true;
    const uploads = controllers.current;
    return () => {
      mounted.current = false;
      uploads.forEach((controller) => controller.abort());
      current.current.forEach((entry) => URL.revokeObjectURL(entry.url));
    };
  }, []);

  async function select(file?: File) {
    if (!file || disabled || busy.current) return;
    if (current.current.length >= 5) {
      setIssue('fiveFiles');
      return;
    }
    if (!token) {
      setIssue('challengeNeeded');
      return;
    }
    busy.current = true;
    onBusy(true);
    setIssue(undefined);
    let id: string | undefined;
    try {
      await validatePrescription(file);
      if (!mounted.current) return;
      id = crypto.randomUUID();
      const entry: Entry = { id, file, url: URL.createObjectURL(file), percent: 0, status: 'uploading' };
      const controller = new AbortController();
      controllers.current.set(id, controller);
      commit((items) => [...items, entry]);
      // Each upload consumes a challenge. RFQ submission must acquire another one.
      onConsumed();
      const receipt = await uploadPrescription(file, token, controller.signal, (percent) =>
        commit((items) => items.map((item) => (item.id === id ? { ...item, percent } : item))),
      );
      commit((items) =>
        items.map((item) => (item.id === id ? { ...item, status: 'uploaded', percent: 100, receipt } : item)),
      );
    } catch (error: unknown) {
      const message: UploadIssue =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'uploadCancelled'
          : error instanceof ApiError && error.code === 'FILE_SIZE'
            ? 'fileSize'
            : error instanceof ApiError && ['INVALID_PRESCRIPTION_FILE', 'UNSUPPORTED_FILE_TYPE'].includes(error.code)
              ? 'fileType'
              : error instanceof ApiError && error.status === 403
                ? 'challengeNeeded'
                : error instanceof ApiError && error.status === 429
                  ? 'rateLimited'
                  : 'uploadUncertain';
      if (id) {
        commit((items) =>
          items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: message === 'uploadCancelled' ? 'cancelled' : 'error',
                  error: message,
                  requestId:
                    error instanceof ApiError && /^[\w-]{1,100}$/.test(error.requestId ?? '')
                      ? error.requestId
                      : undefined,
                }
              : item,
          ),
        );
      } else if (mounted.current) {
        setIssue(message);
      }
    } finally {
      if (id) controllers.current.delete(id);
      busy.current = false;
      if (mounted.current) onBusy(false);
    }
  }

  const pickerDisabled = disabled || busy.current || entries.length >= 5 || !token;

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    void select(file);
  }

  return (
    <div className="prescription-upload">
      <div
        className={`rfq-dropzone${dragOver ? ' is-drag-over' : ''}${pickerDisabled ? ' is-disabled' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!pickerDisabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => {
          if (!token) {
            setIssue('challengeNeeded');
            return;
          }
          if (!pickerDisabled) inputRef.current?.click();
        }}
        role="button"
        tabIndex={0}
        aria-label={t('chooseFile')}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!token) setIssue('challengeNeeded');
            else if (!pickerDisabled) inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept="image/jpeg,image/png,application/pdf"
          disabled={pickerDisabled}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            void select(file);
          }}
        />
        <div className="rfq-dropzone-icon">
          <UploadCloud size={26} aria-hidden="true" />
        </div>
        <p className="rfq-dropzone-text">
          {t('dropzonePrompt')}{' '}
          <span className="rfq-dropzone-link">{t('browseFiles')}</span>
        </p>
      </div>

      {!token && <p className="rfq-upload-hint">{t('challengeNeeded')}</p>}
      {issue && (
        <p role="alert" className="rfq-field-error">
          {t(issue)}
        </p>
      )}

      {entries.length > 0 && (
        <ul className="rfq-upload-list">
          {entries.map((entry) => (
            <li key={entry.id} className="rfq-upload-item">
              {entry.file.type.startsWith('image/') && (
                <Image
                  src={entry.url}
                  width={36}
                  height={36}
                  unoptimized
                  alt={t('privatePreview')}
                  className="rfq-upload-thumb"
                />
              )}
              <div className="rfq-upload-meta">
                <a href={entry.url} target="_blank" rel="noopener noreferrer" download={entry.file.name}>
                  {entry.file.name}
                </a>
                {entry.status === 'uploading' ? (
                  <div className="rfq-upload-progress">
                    <progress value={entry.percent} max={100} aria-label={t('uploadProgress')} />
                    <span>{entry.percent}%</span>
                  </div>
                ) : (
                  <span className={entry.error ? 'rfq-upload-err' : 'rfq-upload-ok'} role="status">
                    {t(entry.error ?? 'uploaded')}
                  </span>
                )}
                {entry.requestId && (
                  <span className="rfq-upload-req">
                    {t('requestId')}: {entry.requestId}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="rfq-upload-remove"
                disabled={disabled}
                aria-label={t(entry.status === 'uploading' ? 'cancelUpload' : 'removeFile')}
                onClick={() => {
                  controllers.current.get(entry.id)?.abort();
                  URL.revokeObjectURL(entry.url);
                  commit((items) => items.filter((item) => item.id !== entry.id));
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
