'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { notifyAdminSessionChange } from '../../lib/admin-auth-events';
import { apiRequest } from '../../lib/api-client';
import { downloadText, enrollmentSchema } from '../../lib/admin-management';
import { sessionsSchema } from '../../lib/admin-contract';
import { useAdminOperation } from '../../hooks/useAdminOperation';
import { AdminOperationFeedback } from './AdminOperationFeedback';
import { AdminLink } from './AdminShell';
export function AuthenticatorRotation() {
  const [confirm, setConfirm] = useState(false);
  const [secret, setSecret] = useState<ReturnType<typeof enrollmentSchema.parse>>();
  const [completed, setCompleted] = useState(false);
  const { operation, state } = useAdminOperation();
  useEffect(() => {
    const clear = () => setSecret(undefined);
    window.addEventListener('pagehide', clear);
    return () => window.removeEventListener('pagehide', clear);
  }, []);
  async function rotate() {
    if (!confirm || completed) return;
    await operation.run(
      async () =>
        (
          await apiRequest('/v1/admin/auth/2fa/enroll', enrollmentSchema, {
            method: 'POST',
            json: {},
            timeoutMs: 20_000,
          })
        ).data,
      async () => {
        await apiRequest('/v1/admin/auth/sessions', sessionsSchema);
      },
      (result) => {
        setSecret(result);
        setCompleted(true);
        setConfirm(false);
        notifyAdminSessionChange();
      },
    );
  }
  return (
    <>
      <AdminLink href="/admin/sessions">← Sessions</AdminLink>
      <h1>Rotate authenticator</h1>
      <section className="admin-panel stack-form">
        <p>
          This authenticated rotation immediately replaces the enrolled authenticator and all eight backup codes. Other
          sessions and pending password challenges are revoked; the current session is retained.
        </p>
        <p className="small muted">
          The backend currently returns backup codes directly. The documented email-confirmation discrepancy remains
          unresolved; there is no additional verification endpoint.
        </p>
        <AdminOperationFeedback state={state} />
        {!completed && (
          <>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={confirm}
                disabled={state.busy || state.blocked}
                onChange={(event) => setConfirm(event.currentTarget.checked)}
              />
              I am ready to replace my authenticator and securely save the new backup codes.
            </label>
            <button
              className="button primary"
              disabled={!confirm || state.busy || state.blocked}
              onClick={() => void rotate()}
            >
              Rotate enrolled authenticator
            </button>
          </>
        )}
        {secret ? (
          <div className="admin-enrollment">
            <h2>Save once, then clear</h2>
            <Image
              src={secret.qr_data_url}
              alt="Scan the new authenticator QR with your authenticator app"
              width={256}
              height={256}
              unoptimized
            />
            <p>Scan this QR now. These codes are shown only in this page memory.</p>
            <ol>
              {secret.backup_codes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ol>
            <div className="admin-filter-actions">
              <button
                className="button primary"
                onClick={() => {
                  downloadText(
                    'medaxis-backup-codes.txt',
                    `MedAxis authenticator backup codes\n\n${secret.backup_codes.join('\n')}\n`,
                  );
                  setSecret(undefined);
                }}
              >
                Download codes once & clear
              </button>
              <button className="button secondary" onClick={() => setSecret(undefined)}>
                I saved them · clear now
              </button>
            </div>
          </div>
        ) : (
          completed && (
            <p role="status">Rotation completed. Enrollment material has been cleared and cannot be displayed again.</p>
          )
        )}
      </section>
    </>
  );
}
