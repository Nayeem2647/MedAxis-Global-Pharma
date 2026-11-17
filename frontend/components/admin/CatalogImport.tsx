'use client';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api-client';
import { adminMultipart, csvColumns, csvReport, downloadText } from '../../lib/admin-management';
import { AdminFeedback, feedbackValue, type AdminFeedbackValue } from './AdminFeedback';
import { AdminLink } from './AdminShell';
export async function fileDigest(file: File) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
export function CatalogImport() {
  const [file, setFile] = useState<File>();
  const [approved, setApproved] = useState<string>();
  const [result, setResult] = useState<ReturnType<typeof csvReport.parse>>();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [problem, setProblem] = useState<AdminFeedbackValue>();
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(dry: boolean) {
    if (lock.current || uncertain || !file || (!dry && (!approved || !confirm))) return;
    lock.current = true;
    setBusy(true);
    setProblem(undefined);
    if (dry) setApproved(undefined);
    let sent = false;
    try {
      if (!file.size || file.size > 5_242_880 || !file.name.toLowerCase().endsWith('.csv'))
        throw new ApiError('Invalid CSV.', {
          status: 422,
          code: 'VALIDATION_FAILED',
          responseValidated: true,
          details: [{ field: 'file', issue: 'CSV up to 5 MiB.' }],
        });
      const digest = await fileDigest(file);
      if (!dry && digest !== approved) {
        setApproved(undefined);
        return;
      }
      controller.current = new AbortController();
      const form = new FormData();
      form.set('file', file);
      sent = true;
      const report = await adminMultipart(
        `/api/admin/catalog/import-csv?dry_run=${dry}`,
        form,
        csvReport,
        controller.current.signal,
      );
      if (
        report.dry_run !== dry ||
        (dry && report.committed !== 0) ||
        (!dry && report.valid && report.committed !== report.valid_rows)
      )
        throw new ApiError('Invalid import receipt.', {
          status: 502,
          code: 'INVALID_API_RESPONSE',
        });
      setResult(report);
      setConfirm(false);
      if (dry && report.valid && report.valid_rows === report.total_rows) setApproved(digest);
      else setApproved(undefined);
    } catch (error: unknown) {
      setProblem(feedbackValue(error));
      if (sent && !dry && !(error instanceof ApiError && error.responseValidated && [400, 422].includes(error.status)))
        setUncertain(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div className="admin-page-heading">
        <h1>Bulk import</h1>
        <button
          className="button secondary"
          onClick={() => downloadText('medaxis-catalog-template.csv', `${csvColumns.join(',')}\r\n`)}
        >
          Download CSV template
        </button>
      </div>
      <section className="admin-panel stack-form">
        <p>
          UTF-8 CSV, up to 5 MiB and 1–1000 data rows. Use registered manufacturer/generic/category slugs. Separate
          multiple category slugs with |. Validate the unchanged file before committing; the backend revalidates and
          commits atomically.
        </p>
        <label>
          CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy || uncertain}
            onChange={(event) => {
              setFile(event.currentTarget.files?.[0]);
              setApproved(undefined);
              setResult(undefined);
              setConfirm(false);
              setProblem(undefined);
            }}
          />
        </label>
        {problem && <AdminFeedback problem={problem} />}
        <div className="admin-filter-actions">
          <button className="button primary" disabled={busy || uncertain || !file} onClick={() => void run(true)}>
            {busy ? 'Processing…' : 'Validate dry run'}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={!busy}
            onClick={() => controller.current?.abort()}
          >
            Abort request
          </button>
        </div>
        {approved && (
          <>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={confirm}
                disabled={busy || uncertain}
                onChange={(event) => setConfirm(event.currentTarget.checked)}
              />
              Commit this unchanged, validated file to the catalog.
            </label>
            <button className="button primary" disabled={busy || uncertain || !confirm} onClick={() => void run(false)}>
              Commit validated CSV
            </button>
          </>
        )}
        {uncertain && (
          <p role="alert">
            Import delivery is uncertain. Do not upload or commit it again. Reconcile the catalog and audit result with
            the team first.
          </p>
        )}
        {result && (
          <div role="status">
            <h2>{result.dry_run ? 'Dry-run result' : 'Import result'}</h2>
            <p>
              {result.valid ? 'Valid' : 'Invalid'} · {result.valid_rows} of {result.total_rows} valid ·{' '}
              {result.committed} committed
            </p>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>SKU</th>
                    <th>Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.row}>
                      <td>{row.row}</td>
                      <td>{row.sku ?? '—'}</td>
                      <td>
                        {row.valid ? 'Valid' : row.errors.map((error) => `${error.field}: ${error.issue}`).join('; ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <AdminLink href="/admin/catalog/products">Review catalog</AdminLink>
        <AdminLink href="/admin/audit-logs">Review audit history</AdminLink>
      </section>
    </>
  );
}
