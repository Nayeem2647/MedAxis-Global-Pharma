'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { ApiError, apiRequest } from '../../lib/api-client';

const receipt = z.strictObject({ translated_text: z.string().min(1).max(5000), source_language: z.literal('en'), target_language: z.literal('zh-CN') });

export function GenericIndicationsTranslation({ enabled, disabled, indications, value, onChange, onBusy, onGenerated }: {
  enabled: boolean; disabled: boolean; indications: string; value: string;
  onChange: (value: string) => void; onBusy: (value: boolean) => void; onGenerated: () => void;
}) {
  const [automatic, setAutomatic] = useState(!value.trim());
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const [retry, setRetry] = useState(0);
  const latest = useRef<{ source: string; text: string } | null>(null);
  const source = indications.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');

  useEffect(() => {
    if (!enabled || !automatic || disabled || !source || source.length > 5000) { onBusy(false); return; }
    if (latest.current?.source === source) { onBusy(false); return; }
    const controller = new AbortController();
    onBusy(true); setProblem(''); setMessage('Preparing Chinese translation…');
    const timer = setTimeout(() => {
      setMessage('Translating therapeutic indications with DeepL…');
      void apiRequest('/v1/admin/catalog/translate-indications', receipt, {
        method: 'POST', json: { text: source }, signal: controller.signal, timeoutMs: 15_000,
      }).then((result) => {
        if (controller.signal.aborted) return;
        latest.current = { source, text: result.data.translated_text };
        onChange(result.data.translated_text); onGenerated();
        setMessage('Chinese description filled. Review the medical wording before saving.');
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setMessage('');
        setProblem(error instanceof ApiError && error.code === 'TRANSLATION_NOT_CONFIGURED'
          ? 'Automatic translation is not configured. Add the server DeepL API key or enter Chinese text manually.'
          : error instanceof ApiError && error.code === 'TRANSLATION_QUOTA_EXCEEDED'
            ? 'DeepL quota has been reached. Your existing Chinese description is unchanged; enter text manually or retry after the quota is restored.'
            : 'Translation could not be completed. Your existing Chinese description is unchanged. Enter text manually or retry.');
      }).finally(() => { if (!controller.signal.aborted) onBusy(false); });
    }, 1000);
    return () => { clearTimeout(timer); controller.abort(); onBusy(false); };
  }, [enabled, automatic, disabled, source, retry, onBusy, onChange, onGenerated]);

  return <div className="admin-generic-translation">
    <label className="admin-check"><input type="checkbox" checked={automatic} disabled={disabled} onChange={(event) => {
      latest.current = null; setAutomatic(event.target.checked); setProblem(''); setMessage('');
    }} />Automatically fill Chinese description from therapeutic indications</label>
    <p className="small muted">DeepL translates the English indications after you stop typing. Existing Chinese text is kept until you enable automatic filling. Editing the translation switches to manual mode.</p>
    <label><span>Description <small>Optional</small></span><textarea name="zhCN_description" rows={5} maxLength={5000} lang="zh-CN" value={value} onChange={(event) => {
      setAutomatic(false); latest.current = null; setProblem(''); setMessage('Manual Chinese description kept. Automatic filling is off.'); onChange(event.target.value);
    }} /></label>
    {message && <p className="small muted" role="status">{message}</p>}
    {problem && <div className="admin-feedback"><p role="alert">{problem}</p><button type="button" className="button secondary" disabled={disabled} onClick={() => setRetry((old) => old + 1)}>Retry translation</button></div>}
  </div>;
}
