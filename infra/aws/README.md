# MedAxis object storage on AWS

> Historical optional configuration. Development/test now defaults to local disk
> storage. Do not deploy this stack for the local development setup.
> See [local uploads](../../backend/src/modules/storage/README.md). Existing
> remote resources are not deleted by switching the application storage driver.

The CloudFormation template creates four private S3 buckets and a CloudFront
distribution for the catalog bucket. CloudFront uses Origin Access Control and
can read only objects under `products/`. Quotes and encrypted prescriptions are
delivered through the application. Admin profile responses issue presigned
avatar GET URLs valid for 120 seconds. The template also outputs an IAM policy
for the backend runtime.

| Flow | Limit and files | Keys, retrieval and deletion |
| --- | --- | --- |
| `POST /v1/admin/catalog/images` | JPEG, PNG or WebP, 5 MiB | Returns `object_key`. Products keep `image_keys`; CloudFront serves S3 keys, and the legacy CDN serves unprefixed keys. Removing a key from a product detaches the image. Product objects can be shared across records. |
| `POST /v1/admin/catalog/manufacturers` | Browser prepares PNG/WebP logo, 262,144 encoded characters | Stores `logo_object_key`; admin detail reads new CloudFront URLs or legacy inline values. Replacing or removing a dedicated S3 logo deletes its old S3 object after the record commits. |
| `PATCH /v1/admin/auth/profile` | Browser prepares JPEG avatar, 262,144 encoded characters | Stores `avatar_object_key`. Authenticated profile GET signs the URL; replacement and removal delete the retired S3 object after commit. Legacy inline or trusted legacy URLs remain readable during migration. |
| `POST /v1/public/prescriptions/upload` | JPEG, PNG or PDF, 5 MiB | S3 stores encrypted bytes. MongoDB stores `object_key` plus existing encryption metadata. The admin stream authorizes, decrypts and audits every read. The purge job deletes S3 before marking a record purged. Legacy records await verified migration before the job can purge them. |
| PDF worker and `GET /v1/public/quotation/pdf/:token` | Generated PDF, 25 MiB | `pdf.original.object_key` / `pdf.accepted.object_key`. The application keeps the expiring, revocable buyer token and checks it again before streaming. |
| `POST /v1/admin/catalog/import-csv` | Existing multipart CSV limits | Parsed in memory; no persistent file. |

The stock logo and WeChat QR are static files in `frontend/public/images`.
The browser sends uploads to the existing application endpoints, so S3 bucket
CORS rules aren't needed. The frontend loads avatars as plain image requests
without an S3 JavaScript fetch. Keep the application CORS and cookie settings.

From the repo root, with an authenticated AWS CLI or AWS CloudShell session in
the intended account, deploy the stack. The example uses Singapore
(`ap-southeast-1`). Use your chosen deployment region consistently.

```sh
aws cloudformation deploy --stack-name medaxis-object-storage \
  --template-file infra/aws/object-storage.yaml \
  --region ap-southeast-1 --capabilities CAPABILITY_IAM
aws cloudformation describe-stacks --stack-name medaxis-object-storage \
  --region ap-southeast-1 --query "Stacks[0].Outputs" --output table
```

Attach the `BackendPolicyArn` output to the role used by the backend. Locally,
use an authenticated AWS profile with the same object permissions. The backend
uses the default AWS SDK credential chain.

| Stack output | Backend environment variable |
| --- | --- |
| Region | `AWS_REGION` |
| ProductBucket | `S3_BUCKET_PRODUCTS` |
| QuoteBucket | `S3_BUCKET_QUOTES` |
| PrescriptionBucket | `S3_BUCKET_PRESCRIPTIONS` |
| AvatarBucket | `S3_BUCKET_AVATARS` |
| PublicImageOrigin | `S3_PUBLIC_BASE_URL` |

Set `NEXT_PUBLIC_S3_PUBLIC_BASE_URL` to `PublicImageOrigin` and
`NEXT_PUBLIC_S3_AVATAR_ORIGIN` to `PrivateAvatarOrigin` in the frontend and
rebuild it. Keep the prescription encryption key and key ID so legacy encrypted
prescriptions still decrypt.

Run `npm run migrate` from `backend/` to allow the new key fields in MongoDB.
Stop old backend processes and workers before starting the S3 version. Roll out
the frontend and backend together before reopening catalog uploads. The frontend
expects the S3 backend's `object_key` upload response.

### Legacy storage configuration

Existing installations keep the following settings while legacy objects are still in use.

| Environment | Settings |
| --- | --- |
| Backend credentials | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` scoped for read access |
| Backend source buckets | `R2_BUCKET_PRODUCTS`, `R2_BUCKET_QUOTES`, `R2_BUCKET_PRESCRIPTIONS` for the file groups that need migration |
| Legacy catalog origin | `R2_PUBLIC_BASE_URL` on the backend and `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` on the frontend |

Unprefixed legacy keys use the configured legacy source while new uploads go to S3.

### Copy existing files

From `backend/`, with the same MongoDB, R2 read access and S3 credentials:

```sh
npm run migrate:storage
npm run migrate:storage -- --apply
npm run migrate:storage
```

The first and third commands only inventory references. Apply copies and reads
back each file, verifies bytes and MIME, then updates that record only if the
source reference still matches. The report prints counts and hashed record
identifiers, and exits nonzero for failures or concurrent modifications. Rerun
after correcting those issues. S3 destination keys are deterministic and existing
objects must verify before reuse. Keep the report and retry overdue prescriptions
promptly. A previously staged deployment whose **unprefixed** keys already live
in S3 can use `--source=s3` for the inventory/apply run after verifying the
source. Use separate runs after reconciling any mixed legacy data; the command
uses a single source for unprefixed objects.

The migration never deletes source objects. After the inventory is clear,
revalidate catalog caches and check a sample of each file type. Review retention
for R2 originals, especially medical files, with the storage owner before
retiring the read-only R2 settings. The application preserves legacy reads until
that cutover is confirmed.

To verify the setup, upload a test product image through the admin editor.
Open its returned CloudFront URL, reload the editor after saving, and verify
that the product image still renders. Save a manufacturer logo and an admin
avatar, then reload. Check a prescription and quotation with test files, and
verify that an unsigned private bucket URL is inaccessible.
