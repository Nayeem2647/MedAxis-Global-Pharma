import { z } from 'zod';
import { apiUrl } from './api-config';
import { ApiError, parseApiResponse } from './api-client';

export const MAX_PRESCRIPTION_BYTES = 5_242_880;
export const prescriptionReceiptSchema = z.object({
  prescription_id: z.uuidv4(), mime_type: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  file_size_bytes: z.number().int().positive().max(MAX_PRESCRIPTION_BYTES), uploaded_at: z.iso.datetime(),
});
export type PrescriptionReceipt = z.infer<typeof prescriptionReceiptSchema>;

export async function validatePrescription(file: File): Promise<void> {
  if (!file.size || file.size > MAX_PRESCRIPTION_BYTES) throw new ApiError('Invalid file size.', { status: 422, code: 'FILE_SIZE' });
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const pdf = [37, 80, 68, 70, 45].every((byte, index) => bytes[index] === byte);
  if (!(file.type === 'image/jpeg' && jpeg || file.type === 'image/png' && png || file.type === 'application/pdf' && pdf)) {
    throw new ApiError('Unsupported or mismatched file type.', { status: 422, code: 'INVALID_PRESCRIPTION_FILE' });
  }
}

/** One upload, never automatically retried. The browser owns the multipart boundary. */
export function uploadPrescription(file: File, token: string, signal: AbortSignal, onProgress: (percent: number) => void): Promise<PrescriptionReceipt> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const xhr = new XMLHttpRequest();
    const cleanup = () => signal.removeEventListener('abort', abort);
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const abort = () => xhr.abort();
    xhr.open('POST', apiUrl('/v1/public/prescriptions/upload'));
    xhr.withCredentials = true;
    xhr.timeout = 60_000;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100))); };
    xhr.onerror = xhr.ontimeout = () => fail(new ApiError('The upload outcome could not be confirmed.', { status: 0, code: 'NETWORK_ERROR' }));
    xhr.onabort = () => fail(new DOMException('Upload cancelled.', 'AbortError'));
    xhr.onload = () => {
      cleanup();
      if (xhr.status < 200 || xhr.status > 599) { fail(new ApiError('Invalid upload response.', { status: 0, code: 'NETWORK_ERROR' })); return; }
      if (xhr.responseURL && xhr.responseURL !== apiUrl('/v1/public/prescriptions/upload').href) {
        fail(new ApiError('Unexpected upload redirect.', { status: xhr.status, code: 'INVALID_API_RESPONSE' })); return;
      }
      const headers = new Headers();
      for (const name of ['content-type', 'x-request-id']) { const value = xhr.getResponseHeader(name); if (value) headers.set(name, value); }
      const responseBody = [204, 205, 304].includes(xhr.status) ? null : xhr.responseText;
      void parseApiResponse(new Response(responseBody, { status: xhr.status, headers }), prescriptionReceiptSchema, [201])
        .then((result) => resolve(result.data), fail);
    };
    signal.addEventListener('abort', abort, { once: true });
    const form = new FormData();
    form.set('prescription', file);
    if (token) form.set('turnstile_token', token);
    xhr.send(form);
  });
}
