'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api-client';
import { catalogDeleteBody, catalogDeleteReceipt, readResource, type MasterDirectoryKind } from '../../lib/admin-management';

/** Delete is an explicit single-click action. Failed writes are never replayed automatically. */
export function CatalogDelete({ kind, id, name, updatedAt, lastOnPage }: {
  kind: 'products' | MasterDirectoryKind;
  id: string;
  name: string;
  updatedAt: string;
  lastOnPage: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [problem, setProblem] = useState('');
  const locked = useRef(false);
  useEffect(() => setReady(true), []);

  function refreshList(deleted = false) {
    const url = new URL(window.location.href);
    const page = Number(url.searchParams.get('page') ?? 1);
    if (deleted && lastOnPage && page > 1) url.searchParams.set('page', String(page - 1));
    window.location.replace(url.href);
  }

  async function remove() {
    if (locked.current || blocked || !ready) return;
    locked.current = true;
    setBusy(true);
    setProblem('');
    try {
      const result = await apiRequest(`/v1/admin/catalog/${kind}/${id}`, catalogDeleteReceipt, {
        method: 'DELETE', json: catalogDeleteBody.parse({ expected_updated_at: updatedAt }),
      });
      if (result.data.id !== id) throw new Error('Unexpected deletion receipt');
      refreshList(true);
      // Keep the action locked until navigation removes this row.
      return;
    } catch (error: unknown) {
      if (error instanceof ApiError && error.responseValidated && error.status === 422) {
        setProblem(kind === 'products'
          ? 'This product could not be deleted. Refresh the list and try again.'
          : 'Used by a product. Reassign or delete those products first.');
      } else if (error instanceof ApiError && error.responseValidated && error.status === 409) {
        setBlocked(true);
        setProblem('This record changed. Refresh the list to review it before deleting.');
      } else {
        // A lost response may follow a committed deletion. Confirm with a read, never another DELETE.
        try {
          await readResource(kind, id);
        } catch (readError: unknown) {
          if (readError instanceof ApiError && readError.responseValidated && readError.status === 404) {
            refreshList(true);
            return;
          }
        }
        setBlocked(true);
        setProblem('Deletion could not be confirmed. Refresh the list to check the latest state.');
      }
    }
    locked.current = false;
    setBusy(false);
  }

  return <div className="admin-catalog-delete">
    <button type="button" className="admin-product-action admin-product-delete" aria-label={`Delete ${name}`}
      title={`Delete ${name}`} disabled={!ready || busy || blocked} onClick={() => void remove()}>
      {busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
    </button>
    {problem && <div className="admin-catalog-delete-feedback">
      <p role="alert">{problem}</p>
      <button type="button" onClick={() => refreshList()}>Refresh list</button>
    </div>}
  </div>;
}
