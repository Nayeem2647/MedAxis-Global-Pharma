'use client';
import { useEffect, useState } from 'react';
import { masterRecord, resourceList, type MasterRecord } from '../../lib/admin-management';
import { AdminFeedback, feedbackValue, type AdminFeedbackValue } from './AdminFeedback';

/** Search and pagination expose the complete registered directory, rather than one product page. */
export function MasterPicker({
  kind,
  name,
  label,
  initial = [],
  multiple = false,
}: {
  kind: 'manufacturers' | 'generics' | 'categories';
  name: string;
  label: string;
  initial?: { id: string; label?: string }[];
  multiple?: boolean;
}) {
  const [selected, setSelected] = useState(initial);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<MasterRecord[]>([]);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AdminFeedbackValue>();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      setProblem(undefined);
      void resourceList(
        kind,
        new URLSearchParams({
          page: String(page),
          limit: '20',
          is_active: 'true',
          ...(q.trim() ? { q: q.trim() } : {}),
        }),
        controller.signal,
      )
        .then((result) => {
          if (controller.signal.aborted) return;
          setRows(result.items.map((item) => masterRecord.parse({ ...item, _id: item.id })));
          setPages(result.pagination.total_pages);
          setTotal(result.pagination.total_items);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setProblem(feedbackValue(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, q, page]);
  return (
    <fieldset className="admin-picker">
      <legend>{label}</legend>
      {selected.map((item) => (
        <div className="admin-picker-selection" key={item.id}>
          <input type="hidden" name={name} value={item.id} />
          <span>{item.label ?? `Selected record ${item.id}`}</span>
          <button
            type="button"
            className="button secondary"
            onClick={() => setSelected((items) => items.filter((value) => value.id !== item.id))}
          >
            Remove<span className="sr-only"> {item.label ?? item.id}</span>
          </button>
        </div>
      ))}
      <label>
        Search {label.toLowerCase()}
        <input
          value={q}
          maxLength={100}
          onChange={(event) => {
            setQ(event.currentTarget.value);
            setPage(1);
          }}
          autoComplete="off"
        />
      </label>
      {problem && <AdminFeedback problem={problem} />}
      <p className="small muted" role="status">
        {busy ? 'Loading directory…' : `${total ?? 'Unknown'} active matches · Page ${page} of ${pages}`}
      </p>
      <div className="admin-picker-results">
        {!busy &&
          rows.map((row) => (
            <button
              type="button"
              className="button secondary"
              key={row.id}
              disabled={selected.some((item) => item.id === row.id)}
              onClick={() =>
                setSelected((items) => [...(multiple ? items : []), { id: row.id, label: row.translations.en.name }])
              }
            >
              {row.translations.en.name}
              {row.translations.zhCN ? ` / ${row.translations.zhCN.name}` : ''}
            </button>
          ))}
      </div>
      {!busy && !problem && !rows.length && <p>No matching active records.</p>}
      <div className="admin-filter-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy || page <= 1}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous options
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy || page >= pages}
          onClick={() => setPage((value) => value + 1)}
        >
          Next options
        </button>
      </div>
    </fieldset>
  );
}
