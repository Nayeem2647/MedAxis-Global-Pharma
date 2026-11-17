'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ApiError } from '../../lib/api-client';
import { prescriptionBlob } from '../../lib/admin-workflow';
import { AdminFeedback, feedbackValue, type AdminFeedbackValue } from './AdminFeedback';
import { useAdminLive } from './AdminShell';
export function PrescriptionViewer({ id, onClose }: { id: string; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null); const [file, setFile] = useState<{ url: string; type: string }>(); const [problem, setProblem] = useState<AdminFeedbackValue>(); const { expire } = useAdminLive(); const expiry = useRef(expire); expiry.current = expire;
  useEffect(() => {
    const active = document.activeElement; dialog.current?.showModal(); const controller = new AbortController(); let url: string | undefined;
    void prescriptionBlob(id, controller.signal).then((blob) => { if (controller.signal.aborted) return; url = URL.createObjectURL(blob); setFile({ url, type: blob.type }); }).catch((error: unknown) => { if (controller.signal.aborted) return; if (error instanceof ApiError && [401, 403].includes(error.status)) expiry.current(); else setProblem(feedbackValue(error)); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); if (active instanceof HTMLElement) active.focus(); };
  }, [id]);
  return <dialog ref={dialog} className="modal admin-document-dialog" aria-label="Private prescription" onCancel={(event) => { event.preventDefault(); onClose(); }}><div className="modal-heading"><h2>Private prescription</h2><button className="button secondary" onClick={onClose}>Close preview</button></div><p className="small muted">Authorized staff only. Keep this medical document private.</p>{problem ? <><AdminFeedback problem={problem}/><p>The file may be unavailable or purged. Refresh the RFQ before trying again.</p></> : !file ? <p role="status">Loading private file…</p> : <>{file.type === 'application/pdf' ? <iframe src={file.url} title="Private prescription PDF" referrerPolicy="no-referrer"/> : <Image src={file.url} alt="Private prescription uploaded with this RFQ" width={1000} height={1000} unoptimized/>}<a className="button secondary" href={file.url} download={`private-prescription.${file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg'}`} referrerPolicy="no-referrer">Download private file</a></>}</dialog>;
}
