# Local uploads

The default storage driver is `local`, for development and test only.

Product videos use the same local driver: optional MP4/WebM uploads up to 50 MiB
are stored in `uploads/products/local/videos/`. Public delivery supports byte
ranges for browser playback and seeking. Product images remain limited to
5 MiB each, with one main image and up to five additional pictures.
No AWS account, S3 bucket, R2 bucket or cloud credentials are needed locally.
Production rejects the local driver at startup. Production storage configuration
is a separate deployment decision; the historical S3 driver remains available.

Backend configuration:

```dotenv
STORAGE_DRIVER=local
LOCAL_STORAGE_DIR=
API_ORIGIN=http://localhost:4000
PUBLIC_ORIGIN=http://localhost:3000
```

An empty `LOCAL_STORAGE_DIR` uses `backend/uploads/`, independent of the process
working directory. Startup creates these directories; each upload also creates
its parent directory if needed:

| Directory | Contents | Access |
| --- | --- | --- |
| `products/local/` | Product photos, `manufacturers/` logos, `generics/` and `categories/` pictures | Public `/v1/public/media/products/local/...` |
| `avatars/local/` | Admin avatars | Signed URLs valid for 120 seconds |
| `prescriptions/local/` | AES-256-GCM encrypted `.enc` files | Existing authenticated, audited prescription endpoint |
| `quotes/local/` | Generated quotation PDFs | Existing quotation endpoint with an expiring, revocable buyer token |

The uploads root is never mounted as an Express static directory. Quotes and
prescriptions cannot be read through the public media route. Existing file type
and size limits remain in effect. CSV imports are processed in memory.

Set frontend `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`. Use the same host
name for frontend and backend cookies. Restart both processes after changing
environment settings. Rebuild the frontend after changing public environment
variables. Run `npm run migrate` in `backend/` before using the new local object
keys on an existing MongoDB database, then `npm run dev` in each application.

Keep existing `PRESCRIPTION_ENCRYPTION_KEY` and `PRESCRIPTION_KEY_ID` unchanged.
TOTP and quotation token encryption keys are separate and must also be retained.
Do not regenerate keys during a storage switch. Uploaded files are ignored by
Git; back up both the files and MongoDB, and keep the encryption keys separately.

Do not use this local upload configuration for production. The production
validation deliberately rejects it, including when running a compiled build.

Cloud code and the historical AWS template remain available for compatibility
with existing installations; neither is used with `STORAGE_DRIVER=local`.
The old `migrate:storage` command targets S3, so it is unnecessary for a new local
installation. Selecting local storage does not download remote files or delete
remote buckets. The current local setup assumes there are no remote files to
import. Actual cloud bucket deletion requires access to the intended AWS account
and verified bucket names.
